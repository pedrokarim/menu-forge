//! Rich Presence Discord : affiche dans le profil Discord ce que fait le
//! studio (document ouvert, temps écoulé depuis le démarrage du backend).
//!
//! C’est le backend qui parle à Discord (canal IPC local : `discord-ipc-0`
//! sous Windows), donc la présence marche en appli Tauri comme en mode
//! navigateur. Un fil dédié, possédé par le [`Presence`] du `Backend`, fait
//! tout le travail : les requêtes HTTP ne font que déposer les réglages ou la
//! dernière activité sous un mutex et réveiller le fil (condvar), elles ne
//! touchent jamais au canal IPC et ne peuvent donc ni bloquer ni échouer à
//! cause de Discord.
//!
//! Le fil :
//! - se connecte quand `discord.enabled` est vrai, avec `discord.clientId`, ou à
//!   défaut l’application de repli fournie par l’hôte (l’application officielle
//!   [`DEFAULT_CLIENT_ID`] pour l’appli et `npm run dev`, aucune pour les tests) ;
//!   si Discord n’est pas lancé ou si la connexion tombe, il réessaie toutes
//!   les 15 s ([`RETRY_INTERVAL`]) et n’écrit dans les journaux qu’à chaque
//!   **nouveau** message d’erreur ;
//! - applique la dernière activité reçue (`PUT /presence`), ou une activité
//!   générique tant que l’interface n’en a envoyé aucune ; la renvoie toutes
//!   les 15 s ([`REFRESH_INTERVAL`]) pour s’apercevoir que Discord a été fermé ;
//!   la grande image est toujours [`LARGE_IMAGE`], la petite (médaillon) est
//!   choisie par l’interface parmi [`SMALL_IMAGES`] ;
//! - efface l’activité et se déconnecte quand la présence est désactivée,
//!   quand l’identifiant d’application change (puis se reconnecte avec le
//!   nouveau) et à l’arrêt du backend.

use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde_json::{json, Map, Value};

use crate::settings::DiscordSettings;

/// Délai entre deux tentatives de connexion.
pub const RETRY_INTERVAL: Duration = Duration::from_secs(15);
/// Délai au bout duquel l’activité est renvoyée (vérifie que Discord répond).
pub const REFRESH_INTERVAL: Duration = Duration::from_secs(15);
/// Texte affiché quand le document ne doit pas l’être (ou avant toute activité).
pub const GENERIC_DETAILS: &str = "Crée des menus";
/// Application Discord officielle « menu-forge » (identifiant public, pas un secret),
/// utilisée tant que `discord.clientId` n’est pas défini.
pub const DEFAULT_CLIENT_ID: &str = "1370756359037124698";
/// Clé de la grande image, à déclarer dans le portail développeur Discord.
pub const LARGE_IMAGE: &str = "logo";
/// Texte au survol de la grande image.
pub const LARGE_TEXT: &str = "menu-forge";
/// Clés admises pour la petite image (médaillon), à déclarer elles aussi dans
/// le portail développeur. Images : `public/brand/discord/` (script
/// `scripts/discord_assets.py`).
pub const SMALL_IMAGES: [&str; 7] = ["menu", "asset", "home", "library", "settings", "workspace", "about"];
/// Longueurs admises par Discord pour `details` et `state` (unités UTF-16).
pub const MIN_TEXT: usize = 2;
pub const MAX_TEXT: usize = 128;
/// Caractère de complément d’un texte trop court : U+2800 (motif braille
/// vide), invisible et que Discord ne supprime pas comme une espace.
const PAD: char = '⠀';
/// Temps laissé au fil pour effacer l’activité à l’arrêt du backend.
const STOP_TIMEOUT: Duration = Duration::from_secs(2);

/// Activité envoyée par l’interface (`PUT /presence`), textes déjà ajustés.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Activity {
    /// Première ligne : en général le document ouvert.
    pub details: String,
    /// Seconde ligne, facultative.
    pub state: Option<String>,
    /// Remplace `details` quand `discord.showDocument` est faux.
    pub generic_details: Option<String>,
    /// Clé de la petite image, l’une de [`SMALL_IMAGES`].
    pub small_image: Option<&'static str>,
    /// Texte au survol de la petite image (envoyé seulement avec elle).
    pub small_text: Option<String>,
}

/// Champs admis dans le corps de `PUT /presence`.
const ACTIVITY_FIELDS: [&str; 5] = ["details", "state", "genericDetails", "smallImage", "smallText"];

impl Activity {
    /// Valide le corps de `PUT /presence` :
    /// `{ "details": string, "state"?: string|null, "genericDetails"?: string|null,
    ///    "smallImage"?: clé|null, "smallText"?: string|null }`.
    pub fn from_map(map: &Map<String, Value>) -> Result<Self, String> {
        if let Some(key) = map.keys().find(|key| !ACTIVITY_FIELDS.contains(&key.as_str())) {
            return Err(format!("Champ inconnu : « {key} »"));
        }
        let details = match map.get("details") {
            Some(Value::String(text)) => fit_text(text),
            _ => None,
        }
        .ok_or("« details » est obligatoire (texte non vide)")?;
        let optional = |key: &str| match map.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(text)) => Ok(fit_text(text)),
            Some(_) => Err(format!("« {key} » doit être un texte")),
        };
        let small_image = match map.get("smallImage") {
            None | Some(Value::Null) => None,
            Some(Value::String(key)) if SMALL_IMAGES.contains(&key.as_str()) => {
                SMALL_IMAGES.iter().copied().find(|known| known == key)
            }
            Some(_) => {
                return Err(format!("« smallImage » doit valoir null ou une clé parmi : {}", SMALL_IMAGES.join(", ")))
            }
        };
        Ok(Self {
            details,
            state: optional("state")?,
            generic_details: optional("genericDetails")?,
            small_image,
            small_text: optional("smallText")?,
        })
    }
}

/// Ajuste un texte aux longueurs de Discord : espaces de bord retirés, `None`
/// s’il est vide ; complété s’il est trop court ; tronqué avec « … » au-delà
/// de [`MAX_TEXT`] unités UTF-16 (sans couper un caractère).
pub fn fit_text(text: &str) -> Option<String> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    let mut fitted = if text.encode_utf16().count() <= MAX_TEXT {
        text.to_owned()
    } else {
        let mut kept = String::new();
        let mut units = 0;
        for character in text.chars() {
            if units + character.len_utf16() > MAX_TEXT - 1 {
                break;
            }
            units += character.len_utf16();
            kept.push(character);
        }
        format!("{}…", kept.trim_end())
    };
    while fitted.encode_utf16().count() < MIN_TEXT {
        fitted.push(PAD);
    }
    Some(fitted)
}

/// État de la présence, pour `GET /presence`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PresenceStatus {
    pub enabled: bool,
    /// Un identifiant d’application est défini.
    pub configured: bool,
    pub connected: bool,
    /// Dernière erreur (Discord absent, connexion refusée…), s’il y en a une.
    pub error: Option<String>,
}

impl PresenceStatus {
    pub fn to_value(&self) -> Value {
        let mut map = Map::new();
        map.insert("enabled".into(), Value::Bool(self.enabled));
        map.insert("configured".into(), Value::Bool(self.configured));
        map.insert("connected".into(), Value::Bool(self.connected));
        map.insert("error".into(), self.error.clone().map(Value::String).unwrap_or(Value::Null));
        Value::Object(map)
    }
}

// ------------------------------------------------------------- transport

/// Connexion ouverte avec Discord. `Err` : la connexion est perdue.
trait Connection: Send {
    /// Applique une activité (`null` pour l’effacer). `Ok(Some(raison))` :
    /// Discord répond mais refuse l’activité.
    fn set_activity(&mut self, activity: &Value) -> Result<Option<String>, String>;
    fn close(&mut self);
}

/// Ouvre une connexion pour un identifiant d’application.
type Connector = Box<dyn FnMut(&str) -> Result<Box<dyn Connection>, String> + Send>;

/// Connexion réelle, par la crate `discord-rich-presence`.
struct DiscordConnection {
    client: DiscordIpcClient,
    nonce: u64,
}

fn link_lost(error: impl std::fmt::Display) -> String {
    format!("connexion à Discord perdue ({error})")
}

/// Message d’un refus de Discord (`{ code, message }` ou `{ data: { code, message } }`).
fn refusal(data: &Value) -> String {
    let data = if data.get("data").is_some_and(Value::is_object) { &data["data"] } else { data };
    match (data.get("message").and_then(Value::as_str), data.get("code")) {
        (Some(message), Some(code)) => format!("{message} (code {code})"),
        (Some(message), None) => message.to_owned(),
        _ => "réponse inattendue".to_owned(),
    }
}

fn connect_discord(client_id: &str) -> Result<Box<dyn Connection>, String> {
    let mut client = DiscordIpcClient::new(client_id);
    client.connect_ipc().map_err(|_| "Discord n’est pas lancé (canal IPC introuvable)".to_owned())?;
    // Poignée de main faite ici (et non par `connect`) pour lire la réponse :
    // Discord ferme la connexion (opcode 2) si l’identifiant est inconnu.
    client.send(json!({ "v": 1, "client_id": client_id }), 0).map_err(link_lost)?;
    let (opcode, data) = client.recv().map_err(link_lost)?;
    if opcode != 1 || data.get("evt").and_then(Value::as_str) == Some("ERROR") {
        let _ = client.close();
        return Err(format!("Discord refuse la connexion : {}", refusal(&data)));
    }
    Ok(Box::new(DiscordConnection { client, nonce: 0 }))
}

impl Connection for DiscordConnection {
    fn set_activity(&mut self, activity: &Value) -> Result<Option<String>, String> {
        self.nonce += 1;
        let nonce = format!("menu-forge-{}", self.nonce);
        let frame = json!({
            "cmd": "SET_ACTIVITY",
            "args": { "pid": std::process::id(), "activity": activity },
            "nonce": nonce,
        });
        self.client.send(frame, 1).map_err(link_lost)?;
        // Lire la réponse : évite qu’elles s’accumulent dans le canal et
        // révèle un refus (texte trop long, image inconnue…).
        loop {
            let (opcode, data) = self.client.recv().map_err(link_lost)?;
            if opcode == 2 {
                return Err(format!("Discord a fermé la connexion : {}", refusal(&data)));
            }
            if data.get("nonce").and_then(Value::as_str) != Some(nonce.as_str()) {
                continue;
            }
            return Ok((data.get("evt").and_then(Value::as_str) == Some("ERROR")).then(|| refusal(&data)));
        }
    }

    fn close(&mut self) {
        let _ = self.client.close();
    }
}

/// Activité Discord à envoyer (`started` : secondes Unix du démarrage).
fn activity_payload(settings: &DiscordSettings, activity: Option<&Activity>, started: u64) -> Value {
    let generic = || GENERIC_DETAILS.to_owned();
    let details = match activity {
        None => generic(),
        Some(activity) if settings.show_document => activity.details.clone(),
        Some(activity) => activity.generic_details.clone().unwrap_or_else(generic),
    };
    let mut map = Map::new();
    map.insert("details".into(), Value::String(details));
    if let Some(state) = activity.and_then(|activity| activity.state.clone()) {
        map.insert("state".into(), Value::String(state));
    }
    map.insert("timestamps".into(), json!({ "start": started }));
    let mut assets = Map::new();
    assets.insert("large_image".into(), Value::from(LARGE_IMAGE));
    assets.insert("large_text".into(), Value::from(LARGE_TEXT));
    // Sans petite image, Discord n’affiche aucun texte de survol : inutile de l’envoyer.
    if let Some(activity) = activity {
        if let Some(small_image) = activity.small_image {
            assets.insert("small_image".into(), Value::from(small_image));
            if let Some(small_text) = &activity.small_text {
                assets.insert("small_text".into(), Value::String(small_text.clone()));
            }
        }
    }
    map.insert("assets".into(), Value::Object(assets));
    Value::Object(map)
}

// ------------------------------------------------------------------- fil

struct Desired {
    settings: DiscordSettings,
    activity: Option<Activity>,
    /// Incrémenté à chaque changement : réveille le fil.
    generation: u64,
    stop: bool,
    /// Posé par le fil quand il a fini (activité effacée).
    finished: bool,
}

#[derive(Default)]
struct Observed {
    connected: bool,
    error: Option<String>,
}

struct Shared {
    desired: Mutex<Desired>,
    wake: Condvar,
    observed: Mutex<Observed>,
    /// Application utilisée quand `discord.clientId` n’est pas défini.
    fallback: Option<String>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Clone, Copy)]
struct Timing {
    retry: Duration,
    refresh: Duration,
}

/// Service de présence ; l’arrêter (le laisser tomber) efface l’activité.
pub struct Presence {
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
}

impl Presence {
    /// Lance le fil de présence avec ces réglages.
    /// `fallback` : application utilisée tant que `discord.clientId` n’est pas
    /// défini (`None` : la présence attend un identifiant).
    pub fn start(settings: DiscordSettings, fallback: Option<String>) -> Self {
        Self::spawn(settings, fallback, Box::new(connect_discord), Timing { retry: RETRY_INTERVAL, refresh: REFRESH_INTERVAL })
    }

    fn spawn(settings: DiscordSettings, fallback: Option<String>, connector: Connector, timing: Timing) -> Self {
        let shared = Arc::new(Shared {
            desired: Mutex::new(Desired { settings, activity: None, generation: 0, stop: false, finished: false }),
            wake: Condvar::new(),
            observed: Mutex::new(Observed::default()),
            fallback,
        });
        let started = SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_secs()).unwrap_or(0);
        let worker = Worker { shared: Arc::clone(&shared), connector, timing, started, logged_error: None };
        let thread = thread::Builder::new()
            .name("menu-forge-discord".into())
            .spawn(move || worker.run())
            .map_err(|error| eprintln!("[menu-forge] Discord : fil de présence non lancé ({error})"))
            .ok();
        Self { shared, thread }
    }

    fn update(&self, change: impl FnOnce(&mut Desired) -> bool) {
        let mut desired = lock(&self.shared.desired);
        if change(&mut desired) {
            desired.generation += 1;
            self.shared.wake.notify_all();
        }
    }

    /// Nouveaux réglages, pris en compte aussitôt.
    pub fn configure(&self, settings: DiscordSettings) {
        self.update(|desired| {
            let changed = desired.settings != settings;
            desired.settings = settings;
            changed
        });
    }

    /// Dernière activité ; retenue même hors connexion (appliquée à la connexion).
    pub fn set_activity(&self, activity: Activity) {
        self.update(|desired| {
            let changed = desired.activity.as_ref() != Some(&activity);
            desired.activity = Some(activity);
            changed
        });
    }

    pub fn status(&self) -> PresenceStatus {
        let (enabled, configured) = {
            let desired = lock(&self.shared.desired);
            (desired.settings.enabled, desired.settings.client_id.is_some() || self.shared.fallback.is_some())
        };
        let observed = lock(&self.shared.observed);
        PresenceStatus { enabled, configured, connected: observed.connected, error: observed.error.clone() }
    }
}

impl Drop for Presence {
    /// Efface l’activité et ferme la connexion ; n’attend pas plus de
    /// [`STOP_TIMEOUT`] un Discord qui ne répondrait plus.
    fn drop(&mut self) {
        let mut desired = lock(&self.shared.desired);
        desired.stop = true;
        self.shared.wake.notify_all();
        let deadline = Instant::now() + STOP_TIMEOUT;
        while !desired.finished {
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            desired = self.shared.wake.wait_timeout(desired, deadline - now).unwrap_or_else(|p| p.into_inner()).0;
        }
        let finished = desired.finished;
        drop(desired);
        if let (true, Some(thread)) = (finished, self.thread.take()) {
            let _ = thread.join();
        }
    }
}

/// Connexion en cours et ce qui lui a été envoyé.
struct Link {
    client_id: String,
    connection: Box<dyn Connection>,
    applied: Option<Value>,
    last_sent: Instant,
}

struct Worker {
    shared: Arc<Shared>,
    connector: Connector,
    timing: Timing,
    /// Démarrage du backend (secondes Unix) : temps écoulé affiché par Discord.
    started: u64,
    /// Dernière erreur écrite dans les journaux (pas de répétition).
    logged_error: Option<String>,
}

impl Worker {
    fn observe(&self, connected: bool, error: Option<String>) {
        *lock(&self.shared.observed) = Observed { connected, error };
    }

    fn fail(&mut self, error: String) {
        if self.logged_error.as_deref() != Some(error.as_str()) {
            eprintln!("[menu-forge] présence Discord : {error} ; nouvel essai toutes les {} s", self.timing.retry.as_secs());
            self.logged_error = Some(error.clone());
        }
        self.observe(false, Some(error));
    }

    fn disconnect(&self, mut link: Link) {
        if link.applied.is_some() {
            let _ = link.connection.set_activity(&Value::Null);
        }
        link.connection.close();
        eprintln!("[menu-forge] Discord : présence arrêtée");
    }

    fn run(mut self) {
        let mut link: Option<Link> = None;
        let mut last_attempt: Option<Instant> = None;
        loop {
            let (settings, activity, generation, stop) = {
                let desired = lock(&self.shared.desired);
                (desired.settings.clone(), desired.activity.clone(), desired.generation, desired.stop)
            };
            let wanted = if stop || !settings.enabled {
                None
            } else {
                settings.client_id.clone().or_else(|| self.shared.fallback.clone())
            };

            // Désactivée, identifiant changé ou arrêt : effacer et fermer.
            if link.as_ref().is_some_and(|link| wanted.as_deref() != Some(link.client_id.as_str())) {
                if let Some(old) = link.take() {
                    self.disconnect(old);
                }
                last_attempt = None;
            }
            if stop {
                break;
            }
            let Some(client_id) = wanted else {
                self.logged_error = None;
                self.observe(false, None);
                self.wait(generation, None);
                continue;
            };

            if link.is_none() && last_attempt.is_none_or(|at| at.elapsed() >= self.timing.retry) {
                last_attempt = Some(Instant::now());
                match (self.connector)(&client_id) {
                    Ok(connection) => {
                        eprintln!("[menu-forge] Discord : présence connectée");
                        self.logged_error = None;
                        self.observe(true, None);
                        link = Some(Link { client_id, connection, applied: None, last_sent: Instant::now() });
                    }
                    Err(error) => self.fail(error),
                }
            }

            if let Some(current) = link.as_mut() {
                let payload = activity_payload(&settings, activity.as_ref(), self.started);
                let due = current.applied.as_ref() != Some(&payload) || current.last_sent.elapsed() >= self.timing.refresh;
                if due {
                    match current.connection.set_activity(&payload) {
                        Ok(refused) => {
                            current.applied = Some(payload);
                            current.last_sent = Instant::now();
                            if refused.is_some() && refused != self.logged_error {
                                eprintln!("[menu-forge] Discord : activité refusée ({})", refused.as_deref().unwrap_or(""));
                                self.logged_error = refused.clone();
                            }
                            self.observe(true, refused);
                        }
                        Err(error) => {
                            if let Some(mut lost) = link.take() {
                                lost.connection.close();
                            }
                            last_attempt = Some(Instant::now());
                            self.fail(error);
                        }
                    }
                }
            }

            let deadline = match (&link, last_attempt) {
                (Some(current), _) => current.last_sent + self.timing.refresh,
                (None, Some(at)) => at + self.timing.retry,
                (None, None) => Instant::now(),
            };
            self.wait(generation, Some(deadline));
        }
        self.observe(false, None);
        lock(&self.shared.desired).finished = true;
        self.shared.wake.notify_all();
    }

    /// Attend un changement (réglages, activité, arrêt) ou l’échéance.
    fn wait(&self, generation: u64, deadline: Option<Instant>) {
        let mut desired = lock(&self.shared.desired);
        while desired.generation == generation && !desired.stop {
            desired = match deadline {
                None => self.shared.wake.wait(desired).unwrap_or_else(|p| p.into_inner()),
                Some(deadline) => {
                    let now = Instant::now();
                    if now >= deadline {
                        return;
                    }
                    self.shared.wake.wait_timeout(desired, deadline - now).unwrap_or_else(|p| p.into_inner()).0
                }
            };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texts_fit_discord_limits() {
        assert_eq!(fit_text("  Menu : boutique  ").as_deref(), Some("Menu : boutique"));
        assert_eq!(fit_text("   "), None);
        let short = fit_text("x").unwrap();
        assert_eq!(short.encode_utf16().count(), 2);
        assert!(short.starts_with('x'));
        let long = fit_text(&"é".repeat(300)).unwrap();
        assert_eq!(long.encode_utf16().count(), 128);
        assert!(long.ends_with('…'));
        // Un emoji compte pour deux unités UTF-16 et n’est jamais coupé.
        let emoji = fit_text(&"😀".repeat(100)).unwrap();
        assert!(emoji.encode_utf16().count() <= 128 && emoji.ends_with('…'));
        assert_eq!(fit_text(&"a".repeat(128)).unwrap(), "a".repeat(128));
    }

    #[test]
    fn activity_body_is_validated() {
        let parse = |value: Value| Activity::from_map(value.as_object().unwrap());
        let activity = parse(json!({"details": "Menu : boutique", "state": "", "genericDetails": null})).unwrap();
        assert_eq!(activity, Activity { details: "Menu : boutique".into(), ..Activity::default() });
        let activity = parse(json!({"details": "Menu", "smallImage": "asset", "smallText": "  Compose un asset  "})).unwrap();
        assert_eq!((activity.small_image, activity.small_text.as_deref()), (Some("asset"), Some("Compose un asset")));
        for key in SMALL_IMAGES {
            assert_eq!(parse(json!({"details": "ab", "smallImage": key})).unwrap().small_image, Some(key));
        }
        let activity = parse(json!({"details": "ab", "smallImage": null, "smallText": "x"})).unwrap();
        assert_eq!(activity.small_image, None);
        assert_eq!(activity.small_text.map(|text| text.encode_utf16().count()), Some(2));
        for (body, expected) in [
            (json!({}), "« details » est obligatoire"),
            (json!({"details": "  "}), "« details » est obligatoire"),
            (json!({"details": 3}), "« details » est obligatoire"),
            (json!({"details": "a", "state": 1}), "« state » doit être un texte"),
            (json!({"details": "a", "genericDetails": []}), "« genericDetails » doit être un texte"),
            (json!({"details": "a", "large": "x"}), "Champ inconnu : « large »"),
            (json!({"details": "a", "smallImage": "logo"}), "« smallImage » doit valoir null ou une clé parmi : menu, asset,"),
            (json!({"details": "a", "smallImage": "Menu"}), "« smallImage » doit valoir null ou une clé parmi"),
            (json!({"details": "a", "smallImage": ""}), "« smallImage » doit valoir null ou une clé parmi"),
            (json!({"details": "a", "smallImage": 1}), "« smallImage » doit valoir null ou une clé parmi"),
            (json!({"details": "a", "smallText": false}), "« smallText » doit être un texte"),
        ] {
            assert!(parse(body.clone()).unwrap_err().starts_with(expected), "{body}");
        }
    }

    #[test]
    fn payload_carries_both_images() {
        let settings = DiscordSettings { enabled: true, client_id: Some(ID.into()), show_document: true };
        let activity = Activity {
            details: "Édite le menu « Profil »".into(),
            state: Some("Espace « enderium »".into()),
            generic_details: Some("Édite un menu".into()),
            small_image: Some("menu"),
            small_text: Some("Menu".into()),
        };
        assert_eq!(
            activity_payload(&settings, Some(&activity), 42),
            json!({
                "details": "Édite le menu « Profil »",
                "state": "Espace « enderium »",
                "timestamps": { "start": 42 },
                "assets": { "large_image": "logo", "large_text": "menu-forge", "small_image": "menu", "small_text": "Menu" },
            })
        );
        // Document masqué : texte générique, petite image conservée.
        let hidden = DiscordSettings { show_document: false, ..settings.clone() };
        let payload = activity_payload(&hidden, Some(&activity), 42);
        assert_eq!((payload["details"].as_str(), payload["assets"]["small_image"].as_str()), (Some("Édite un menu"), Some("menu")));
        // Petite image seule : pas de texte de survol.
        let bare = Activity { small_text: None, ..activity.clone() };
        assert_eq!(activity_payload(&settings, Some(&bare), 42)["assets"].get("small_text"), None);
        // Texte sans image : ignoré, la grande image reste.
        let text_only = Activity { small_image: None, ..activity };
        assert_eq!(
            activity_payload(&settings, Some(&text_only), 42)["assets"],
            json!({ "large_image": "logo", "large_text": "menu-forge" })
        );
        // Aucune activité reçue : texte générique, grande image seule.
        assert_eq!(
            activity_payload(&settings, None, 7),
            json!({
                "details": GENERIC_DETAILS,
                "timestamps": { "start": 7 },
                "assets": { "large_image": "logo", "large_text": "menu-forge" },
            })
        );
    }

    /// Journal des appels d’une connexion factice.
    type Calls = Arc<Mutex<Vec<String>>>;

    struct FakeConnection {
        client_id: String,
        calls: Calls,
    }

    impl Connection for FakeConnection {
        fn set_activity(&mut self, activity: &Value) -> Result<Option<String>, String> {
            let text = if activity.is_null() { "clear".to_owned() } else { format!("set {}", activity["details"]) };
            lock(&self.calls).push(format!("{} {text}", self.client_id));
            Ok(None)
        }

        fn close(&mut self) {
            lock(&self.calls).push(format!("{} close", self.client_id));
        }
    }

    /// Connecteur factice : échoue `failures` fois, puis réussit.
    fn fake(calls: &Calls, mut failures: u32) -> Connector {
        let calls = Arc::clone(calls);
        Box::new(move |client_id: &str| {
            if failures > 0 {
                failures -= 1;
                return Err("Discord n’est pas lancé".to_owned());
            }
            lock(&calls).push(format!("{client_id} connect"));
            Ok(Box::new(FakeConnection { client_id: client_id.to_owned(), calls: Arc::clone(&calls) }))
        })
    }

    fn eventually(what: &str, condition: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !condition() {
            assert!(Instant::now() < deadline, "délai dépassé : {what}");
            thread::sleep(Duration::from_millis(5));
        }
    }

    fn has(calls: &Calls, entry: &str) -> bool {
        lock(calls).iter().any(|call| call == entry)
    }

    const ID: &str = "123456789012345678";
    const OTHER: &str = "987654321098765432";

    #[test]
    fn worker_follows_settings_and_activity() {
        let calls = Calls::default();
        let settings = DiscordSettings { enabled: true, client_id: Some(ID.into()), show_document: true };
        let timing = Timing { retry: Duration::from_millis(30), refresh: Duration::from_secs(60) };
        let presence = Presence::spawn(settings.clone(), None, fake(&calls, 1), timing);

        // Premier essai raté (Discord absent), puis connexion au suivant.
        eventually("échec signalé", || presence.status().error.is_some() || presence.status().connected);
        eventually("connexion", || presence.status().connected);
        assert_eq!(presence.status(), PresenceStatus { enabled: true, configured: true, connected: true, error: None });
        eventually("activité générique", || has(&calls, &format!("{ID} set \"{GENERIC_DETAILS}\"")));

        let activity = Activity {
            details: "Menu : boutique".into(),
            state: Some("12 zones".into()),
            generic_details: Some("Édite un menu".into()),
            ..Activity::default()
        };
        presence.set_activity(activity);
        eventually("document affiché", || has(&calls, &format!("{ID} set \"Menu : boutique\"")));
        presence.configure(DiscordSettings { show_document: false, ..settings.clone() });
        eventually("texte générique", || has(&calls, &format!("{ID} set \"Édite un menu\"")));

        // Changement d’identifiant : effacer, fermer, se reconnecter.
        presence.configure(DiscordSettings { client_id: Some(OTHER.into()), ..settings.clone() });
        eventually("reconnexion", || has(&calls, &format!("{OTHER} set \"Menu : boutique\"")));
        assert!(has(&calls, &format!("{ID} clear")) && has(&calls, &format!("{ID} close")));

        // Désactivation : effacer et fermer.
        presence.configure(DiscordSettings { enabled: false, client_id: Some(OTHER.into()), show_document: true });
        eventually("fermeture", || has(&calls, &format!("{OTHER} close")));
        assert_eq!(presence.status(), PresenceStatus { enabled: false, configured: true, connected: false, error: None });

        // Réactivation puis arrêt du backend : l’activité est effacée.
        presence.configure(DiscordSettings { client_id: Some(OTHER.into()), ..settings });
        eventually("reconnexion", || presence.status().connected);
        let before = lock(&calls).len();
        drop(presence);
        let after: Vec<String> = lock(&calls)[before..].to_vec();
        assert!(after.ends_with(&[format!("{OTHER} clear"), format!("{OTHER} close")]), "{after:?}");
    }

    #[test]
    fn unconfigured_presence_stays_idle() {
        let calls = Calls::default();
        let timing = Timing { retry: Duration::from_millis(10), refresh: Duration::from_millis(10) };
        let presence = Presence::spawn(DiscordSettings::default(), None, fake(&calls, 0), timing);
        presence.set_activity(Activity { details: "ab".into(), ..Activity::default() });
        thread::sleep(Duration::from_millis(50));
        assert!(lock(&calls).is_empty());
        assert_eq!(presence.status(), PresenceStatus { enabled: true, configured: false, connected: false, error: None });
    }

    #[test]
    fn fallback_application_is_used_without_client_id() {
        let calls = Calls::default();
        let timing = Timing { retry: Duration::from_millis(10), refresh: Duration::from_secs(60) };
        let presence = Presence::spawn(DiscordSettings::default(), Some(DEFAULT_CLIENT_ID.into()), fake(&calls, 0), timing);
        eventually("connexion à l’application de repli", || has(&calls, &format!("{DEFAULT_CLIENT_ID} connect")));
        assert_eq!(presence.status(), PresenceStatus { enabled: true, configured: true, connected: true, error: None });
        // Un identifiant saisi dans les réglages l’emporte sur le repli.
        presence.configure(DiscordSettings { client_id: Some(ID.into()), ..DiscordSettings::default() });
        eventually("identifiant des réglages", || has(&calls, &format!("{ID} connect")));
        assert!(has(&calls, &format!("{DEFAULT_CLIENT_ID} close")));
    }
}
