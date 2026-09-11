//! Rich Presence Discord : affiche dans le profil Discord ce que fait le
//! studio (document ouvert, temps écoulé depuis l’ouverture de l’interface).
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
//! - ne publie **rien** tant que l’interface n’a pas envoyé d’activité
//!   (`PUT /presence`) ; l’interface la renvoie toutes les 30 s (battement de
//!   cœur) et, sans nouvel envoi depuis [`ACTIVITY_TTL`] (90 s), l’activité
//!   expire : elle est effacée côté Discord et la connexion fermée.
//!   `DELETE /presence` (fermeture de l’onglet) l’efface tout de suite ;
//! - le chronomètre de Discord (`timestamps.start`) part du premier envoi
//!   d’une « session » d’interface : après une expiration ou un effacement,
//!   l’envoi suivant repart de zéro ;
//! - se connecte quand la présence est permise par l’hôte (`--no-discord` la
//!   coupe entièrement), que `discord.enabled` est vrai et qu’une activité est
//!   à publier, avec `discord.clientId`, ou à défaut l’application de repli
//!   fournie par l’hôte (l’application officielle [`DEFAULT_CLIENT_ID`] pour
//!   l’appli et `studio-api`, aucune pour les tests) ;
//! - avant de se connecter, prend un verrou exclusif sur un fichier commun à
//!   toutes les instances ([`LOCK_FILE_NAME`] dans le dossier temporaire) : un
//!   seul processus menu-forge pilote Discord. Le verrou est gardé tant que la
//!   connexion est ouverte, relâché à la déconnexion, et libéré par le système
//!   si le processus meurt ; sans lui, le fil ne se connecte pas et réessaie
//!   toutes les 15 s ([`RETRY_INTERVAL`]) ;
//! - si Discord n’est pas lancé, si son canal est occupé ou si la connexion
//!   tombe, il réessaie toutes les 15 s et n’écrit dans les journaux qu’à
//!   chaque **nouveau** message d’erreur ; un changement de réglages
//!   (identifiant, réactivation) relance la connexion aussitôt ;
//! - fait tous ses échanges IPC dans un fil d’E/S dédié à chaque connexion
//!   (les lectures de la crate `discord-rich-presence` sont bloquantes, sans
//!   délai) et n’attend ses réponses que [`IO_TIMEOUT`] (5 s) au plus : au-delà,
//!   la connexion est abandonnée (« Discord ne répond pas ») et retentée plus
//!   tard ;
//! - espace deux `SET_ACTIVITY` d’au moins [`MIN_SEND_INTERVAL`] (4 s ; la
//!   dernière activité gagne) et ne renvoie l’activité inchangée que toutes
//!   les 15 s ([`REFRESH_INTERVAL`]) pour s’apercevoir que Discord a été fermé ;
//! - la grande image est toujours [`LARGE_IMAGE`], la petite (médaillon) est
//!   choisie par l’interface parmi [`SMALL_IMAGES`] ; quand
//!   `discord.showDocument` est faux, ni le document (`details`) ni l’espace
//!   de travail (`state`) ne sont envoyés ;
//! - efface l’activité et se déconnecte quand la présence est désactivée,
//!   quand l’identifiant d’application change (puis se reconnecte avec le
//!   nouveau) et à l’arrêt du backend ([`Presence::stop`], 2 s au plus).

use std::fs::{File, OpenOptions, TryLockError};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde_json::{json, Map, Value};

use crate::settings::DiscordSettings;

/// Délai entre deux tentatives de connexion (Discord absent, verrou pris…).
pub const RETRY_INTERVAL: Duration = Duration::from_secs(15);
/// Délai au bout duquel l’activité inchangée est renvoyée (vérifie que Discord répond).
pub const REFRESH_INTERVAL: Duration = Duration::from_secs(15);
/// Intervalle minimal entre deux `SET_ACTIVITY` (Discord limite le débit).
pub const MIN_SEND_INTERVAL: Duration = Duration::from_secs(4);
/// Durée de vie d’une activité sans nouveau `PUT /presence` : l’interface la
/// renvoie toutes les 30 s ; au-delà, elle est considérée comme fermée.
pub const ACTIVITY_TTL: Duration = Duration::from_secs(90);
/// Attente maximale d’une réponse de Discord.
pub const IO_TIMEOUT: Duration = Duration::from_secs(5);
/// Fichier de verrou commun à toutes les instances, dans le dossier temporaire.
pub const LOCK_FILE_NAME: &str = "menu-forge-discord.lock";
/// Erreur affichée quand une autre instance tient déjà le verrou.
pub const LOCKED_BY_OTHER: &str = "Une autre instance de menu-forge affiche déjà la présence Discord";
/// Erreur affichée quand Discord ne répond pas dans le délai.
pub const NO_ANSWER: &str = "Discord ne répond pas";
/// Texte affiché quand le document ne doit pas l’être et que l’interface
/// n’a pas fourni de texte générique.
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
const STOP_TIMEOUT: Duration = Duration::from_millis(2000);
/// Part de [`STOP_TIMEOUT`] accordée aux échanges avec Discord à l’arrêt.
const STOP_IO_BUDGET: Duration = Duration::from_millis(1500);

/// Activité envoyée par l’interface (`PUT /presence`), textes déjà ajustés.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Activity {
    /// Première ligne : en général le document ouvert.
    pub details: String,
    /// Seconde ligne, facultative (en général l’espace de travail).
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
    /// Présence permise par l’hôte (pas de `--no-discord`) et activée dans les réglages.
    pub enabled: bool,
    /// Un identifiant d’application est défini.
    pub configured: bool,
    pub connected: bool,
    /// Dernière erreur (Discord absent, autre instance, connexion refusée…), s’il y en a une.
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

/// Connexion ouverte avec Discord, **bloquante** : n’est utilisée que depuis
/// le fil d’E/S de sa connexion. `Err` : la connexion est perdue.
trait Connection: Send {
    /// Applique une activité (`null` pour l’effacer). `Ok(Some(raison))` :
    /// Discord répond mais refuse l’activité.
    fn set_activity(&mut self, activity: &Value) -> Result<Option<String>, String>;
    fn close(&mut self);
}

/// Ouvre une connexion pour un identifiant d’application (appelé dans le fil d’E/S).
type Connector = Arc<dyn Fn(&str) -> Result<Box<dyn Connection>, String> + Send + Sync>;

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

/// Raison d’un échec d’ouverture du canal IPC. Sous Windows, on distingue un
/// canal qui existe mais dont toutes les instances sont prises (« occupé »)
/// d’un Discord absent, en **listant** les canaux nommés, ce qui ne s’y
/// connecte pas (contrairement à une ouverture).
fn ipc_unavailable() -> String {
    #[cfg(windows)]
    {
        let sep = std::path::MAIN_SEPARATOR;
        let pipes = format!("{sep}{sep}.{sep}pipe{sep}");
        let exists = std::fs::read_dir(pipes).is_ok_and(|entries| {
            entries.flatten().any(|entry| entry.file_name().to_string_lossy().starts_with("discord-ipc-"))
        });
        if exists {
            return "le canal IPC de Discord est occupé (toutes ses connexions sont prises)".to_owned();
        }
    }
    "Discord n’est pas lancé (canal IPC introuvable)".to_owned()
}

fn connect_discord(client_id: &str) -> Result<Box<dyn Connection>, String> {
    let mut client = DiscordIpcClient::new(client_id);
    client.connect_ipc().map_err(|_| ipc_unavailable())?;
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

enum Command {
    Set(Value),
    Close,
}

type Reply = Result<Option<String>, String>;

/// Connexion vue du fil de présence : la [`Connection`] (bloquante) vit dans
/// un fil d’E/S dédié, et ses réponses ne sont attendues qu’un temps limité.
/// Une connexion qui ne répond plus est simplement abandonnée : son fil
/// s’arrête de lui-même quand sa lecture finit par échouer.
struct IoLink {
    commands: mpsc::Sender<Command>,
    replies: mpsc::Receiver<Reply>,
}

impl IoLink {
    /// Ouvre la connexion dans un nouveau fil d’E/S ; `timeout` : attente
    /// maximale de la poignée de main.
    fn open(connector: &Connector, client_id: &str, timeout: Duration) -> Result<Self, String> {
        let (commands, command_rx) = mpsc::channel::<Command>();
        let (reply_tx, replies) = mpsc::channel::<Reply>();
        let connector = Arc::clone(connector);
        let client_id = client_id.to_owned();
        thread::Builder::new()
            .name("menu-forge-discord-io".into())
            .spawn(move || {
                let mut connection = match connector(&client_id) {
                    Ok(connection) => connection,
                    Err(error) => {
                        let _ = reply_tx.send(Err(error));
                        return;
                    }
                };
                if reply_tx.send(Ok(None)).is_ok() {
                    for command in command_rx {
                        let Command::Set(activity) = command else { break };
                        let reply = connection.set_activity(&activity);
                        let lost = reply.is_err();
                        // Réponse attendue par personne (délai dépassé) ou connexion perdue : fin.
                        if reply_tx.send(reply).is_err() || lost {
                            break;
                        }
                    }
                }
                connection.close();
                let _ = reply_tx.send(Ok(None));
            })
            .map_err(|error| format!("fil d’E/S Discord non lancé ({error})"))?;
        let link = Self { commands, replies };
        link.receive(timeout)?;
        Ok(link)
    }

    fn receive(&self, timeout: Duration) -> Reply {
        match self.replies.recv_timeout(timeout) {
            Ok(reply) => reply,
            Err(RecvTimeoutError::Timeout) => Err(NO_ANSWER.to_owned()),
            Err(RecvTimeoutError::Disconnected) => Err(link_lost("fil d’E/S arrêté")),
        }
    }

    fn set(&self, activity: Value, timeout: Duration) -> Reply {
        self.commands.send(Command::Set(activity)).map_err(|_| link_lost("fil d’E/S arrêté"))?;
        self.receive(timeout)
    }

    /// Ferme la connexion ; n’attend pas plus de `timeout` la fin de la fermeture.
    fn close(self, timeout: Duration) {
        if self.commands.send(Command::Close).is_ok() {
            let _ = self.receive(timeout);
        }
    }
}

/// Résultat d’une tentative de prise du verrou commun.
enum LockState {
    /// Verrou pris : il est relâché quand le fichier est fermé.
    Held(File),
    /// Une autre instance le tient.
    Busy,
    /// Fichier inutilisable (dossier temporaire en lecture seule…).
    Unavailable(String),
}

/// Tente de prendre le verrou exclusif (sans attendre). Le système le libère
/// si le processus meurt.
fn acquire_lock(path: &Path) -> LockState {
    let file = match OpenOptions::new().create(true).truncate(false).write(true).open(path) {
        Ok(file) => file,
        Err(error) => return LockState::Unavailable(error.to_string()),
    };
    match file.try_lock() {
        Ok(()) => LockState::Held(file),
        Err(TryLockError::WouldBlock) => LockState::Busy,
        Err(TryLockError::Error(error)) => LockState::Unavailable(error.to_string()),
    }
}

/// Chemin du verrou commun à toutes les instances : `<temp>/menu-forge-discord.lock`.
pub fn default_lock_path() -> PathBuf {
    std::env::temp_dir().join(LOCK_FILE_NAME)
}

fn unix_seconds(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_secs()).unwrap_or(0)
}

/// Activité Discord à envoyer (`started` : secondes Unix du début de la session).
fn activity_payload(settings: &DiscordSettings, activity: &Activity, started: u64) -> Value {
    let details = if settings.show_document {
        activity.details.clone()
    } else {
        activity.generic_details.clone().unwrap_or_else(|| GENERIC_DETAILS.to_owned())
    };
    let mut map = Map::new();
    map.insert("details".into(), Value::String(details));
    // `state` porte le nom de l’espace de travail : masqué avec le document.
    if let (true, Some(state)) = (settings.show_document, &activity.state) {
        map.insert("state".into(), Value::String(state.clone()));
    }
    map.insert("timestamps".into(), json!({ "start": started }));
    let mut assets = Map::new();
    assets.insert("large_image".into(), Value::from(LARGE_IMAGE));
    assets.insert("large_text".into(), Value::from(LARGE_TEXT));
    // Sans petite image, Discord n’affiche aucun texte de survol : inutile de l’envoyer.
    if let Some(small_image) = activity.small_image {
        assets.insert("small_image".into(), Value::from(small_image));
        if let Some(small_text) = &activity.small_text {
            assets.insert("small_text".into(), Value::String(small_text.clone()));
        }
    }
    map.insert("assets".into(), Value::Object(assets));
    Value::Object(map)
}

// ------------------------------------------------------------------- fil

/// Session d’interface : du premier `PUT /presence` à l’expiration ou au `DELETE`.
#[derive(Clone)]
struct Session {
    activity: Activity,
    /// Début de la session : chronomètre affiché par Discord.
    started: SystemTime,
    /// Sans nouveau `PUT` d’ici là, l’activité est effacée.
    expires: Instant,
}

struct Desired {
    settings: DiscordSettings,
    session: Option<Session>,
    /// Incrémenté à chaque changement : réveille le fil.
    generation: u64,
    /// Réglages changés : se reconnecter sans attendre le délai de réessai.
    retry_now: bool,
    stop: bool,
    /// Posé par le fil quand il a fini (activité effacée).
    finished: bool,
}

#[derive(Default)]
struct Observed {
    connected: bool,
    error: Option<String>,
}

/// Ce que l’hôte (appli, `studio-api`, tests) impose à la présence.
struct Host {
    /// Application utilisée quand `discord.clientId` n’est pas défini.
    fallback: Option<String>,
    /// Faux (`--no-discord`) : le fil ne se connecte jamais.
    allowed: bool,
    /// Verrou commun aux instances (injectable pour les tests).
    lock_path: PathBuf,
}

#[derive(Clone, Copy)]
struct Timing {
    retry: Duration,
    refresh: Duration,
    min_interval: Duration,
    ttl: Duration,
    io: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            retry: RETRY_INTERVAL,
            refresh: REFRESH_INTERVAL,
            min_interval: MIN_SEND_INTERVAL,
            ttl: ACTIVITY_TTL,
            io: IO_TIMEOUT,
        }
    }
}

struct Shared {
    desired: Mutex<Desired>,
    wake: Condvar,
    observed: Mutex<Observed>,
    host: Host,
    timing: Timing,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Service de présence ; l’arrêter ([`Presence::stop`], ou le laisser
/// tomber) efface l’activité.
pub struct Presence {
    shared: Arc<Shared>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Presence {
    /// Lance le fil de présence avec ces réglages.
    /// `fallback` : application utilisée tant que `discord.clientId` n’est pas
    /// défini (`None` : la présence attend un identifiant) ; `allowed` : faux
    /// pour ne jamais se connecter (`--no-discord`).
    pub fn start(settings: DiscordSettings, fallback: Option<String>, allowed: bool) -> Self {
        let host = Host { fallback, allowed, lock_path: default_lock_path() };
        Self::spawn(settings, host, Arc::new(connect_discord), Timing::default())
    }

    fn spawn(settings: DiscordSettings, host: Host, connector: Connector, timing: Timing) -> Self {
        let shared = Arc::new(Shared {
            desired: Mutex::new(Desired {
                settings,
                session: None,
                generation: 0,
                retry_now: false,
                stop: false,
                finished: false,
            }),
            wake: Condvar::new(),
            observed: Mutex::new(Observed::default()),
            host,
            timing,
        });
        let worker = Worker { shared: Arc::clone(&shared), connector, logged_error: None, lock_warned: false };
        let thread = thread::Builder::new()
            .name("menu-forge-discord".into())
            .spawn(move || worker.run())
            .map_err(|error| eprintln!("[menu-forge] Discord : fil de présence non lancé ({error})"))
            .ok();
        Self { shared, thread: Mutex::new(thread) }
    }

    fn update(&self, change: impl FnOnce(&mut Desired) -> bool) {
        let mut desired = lock(&self.shared.desired);
        if change(&mut desired) {
            desired.generation += 1;
            self.shared.wake.notify_all();
        }
    }

    /// Nouveaux réglages, pris en compte aussitôt (reconnexion immédiate).
    pub fn configure(&self, settings: DiscordSettings) {
        self.update(|desired| {
            let changed = desired.settings != settings;
            desired.settings = settings;
            desired.retry_now |= changed;
            changed
        });
    }

    /// Dernière activité de l’interface (`PUT /presence`) ; repousse
    /// l’expiration. Une activité identique ne réveille pas le fil (rien à
    /// renvoyer à Discord). Retenue même hors connexion.
    pub fn set_activity(&self, activity: Activity) {
        let ttl = self.shared.timing.ttl;
        self.update(|desired| {
            let now = Instant::now();
            match &mut desired.session {
                Some(session) if session.expires > now => {
                    session.expires = now + ttl;
                    if session.activity == activity {
                        return false;
                    }
                    session.activity = activity;
                }
                session => *session = Some(Session { activity, started: SystemTime::now(), expires: now + ttl }),
            }
            true
        });
    }

    /// Efface l’activité tout de suite (`DELETE /presence`, fermeture de
    /// l’onglet) ; le prochain `PUT` ouvre une nouvelle session.
    pub fn clear_activity(&self) {
        self.update(|desired| desired.session.take().is_some());
    }

    pub fn status(&self) -> PresenceStatus {
        let host = &self.shared.host;
        let (enabled, configured) = {
            let desired = lock(&self.shared.desired);
            (host.allowed && desired.settings.enabled, desired.settings.client_id.is_some() || host.fallback.is_some())
        };
        let observed = lock(&self.shared.observed);
        PresenceStatus { enabled, configured, connected: observed.connected, error: observed.error.clone() }
    }

    /// Efface l’activité, ferme la connexion et arrête le fil ; n’attend pas
    /// plus de 2 s un Discord qui ne répondrait plus. Un second appel ne fait
    /// qu’attendre la fin du fil (immédiate s’il a déjà fini).
    pub fn stop(&self) {
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
        if finished {
            if let Some(thread) = lock(&self.thread).take() {
                let _ = thread.join();
            }
        }
    }

    /// Début de la session en cours (tests du chronomètre).
    #[cfg(test)]
    fn session_started(&self) -> Option<SystemTime> {
        lock(&self.shared.desired).session.as_ref().map(|session| session.started)
    }
}

impl Drop for Presence {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Connexion en cours et ce qui lui a été envoyé.
struct Link {
    client_id: String,
    io: IoLink,
    /// Verrou commun, relâché avec la connexion (`None` : verrou indisponible).
    _lock: Option<File>,
    applied: Option<Value>,
    last_sent: Option<Instant>,
}

struct Worker {
    shared: Arc<Shared>,
    connector: Connector,
    /// Dernière erreur écrite dans les journaux (pas de répétition).
    logged_error: Option<String>,
    /// Verrou indisponible déjà signalé.
    lock_warned: bool,
}

impl Worker {
    fn observe(&self, connected: bool, error: Option<String>) {
        *lock(&self.shared.observed) = Observed { connected, error };
    }

    fn fail(&mut self, error: String) {
        if self.logged_error.as_deref() != Some(error.as_str()) {
            let retry = self.shared.timing.retry.as_secs();
            eprintln!("[menu-forge] présence Discord : {error} ; nouvel essai toutes les {retry} s");
            self.logged_error = Some(error.clone());
        }
        self.observe(false, Some(error));
    }

    /// Prend le verrou commun puis ouvre la connexion.
    fn connect(&mut self, client_id: String) -> Option<Link> {
        let held = match acquire_lock(&self.shared.host.lock_path) {
            LockState::Held(file) => Some(file),
            LockState::Busy => {
                self.fail(LOCKED_BY_OTHER.to_owned());
                return None;
            }
            LockState::Unavailable(error) => {
                if !self.lock_warned {
                    eprintln!(
                        "[menu-forge] Discord : verrou {} inutilisable ({error}) ; présence publiée sans verrou",
                        self.shared.host.lock_path.display()
                    );
                    self.lock_warned = true;
                }
                None
            }
        };
        match IoLink::open(&self.connector, &client_id, self.shared.timing.io) {
            Ok(io) => {
                eprintln!("[menu-forge] Discord : présence connectée");
                self.logged_error = None;
                self.observe(true, None);
                Some(Link { client_id, io, _lock: held, applied: None, last_sent: None })
            }
            Err(error) => {
                self.fail(error);
                None
            }
        }
    }

    /// Efface l’activité et ferme la connexion en `budget` au plus ; le verrou
    /// est relâché ensuite.
    fn disconnect(&self, link: Link, budget: Duration) {
        let deadline = Instant::now() + budget;
        let Link { io, applied, _lock, .. } = link;
        let cleared = applied.is_none() || io.set(Value::Null, budget).is_ok();
        if cleared {
            io.close(deadline.saturating_duration_since(Instant::now()));
        }
        eprintln!("[menu-forge] Discord : présence arrêtée");
    }

    fn run(mut self) {
        let timing = self.shared.timing;
        let mut link: Option<Link> = None;
        let mut last_attempt: Option<Instant> = None;
        loop {
            let (settings, session, generation, stop) = {
                let mut desired = lock(&self.shared.desired);
                // Plus de battement de cœur : l’interface est fermée, la session aussi.
                if desired.session.as_ref().is_some_and(|session| session.expires <= Instant::now()) {
                    desired.session = None;
                }
                if std::mem::take(&mut desired.retry_now) {
                    last_attempt = None;
                }
                (desired.settings.clone(), desired.session.clone(), desired.generation, desired.stop)
            };
            let host = &self.shared.host;
            let client_id = if stop || !host.allowed || !settings.enabled {
                None
            } else {
                settings.client_id.clone().or_else(|| host.fallback.clone())
            };
            // Rien à publier sans application ni activité reçue de l’interface.
            let wanted = client_id.zip(session.as_ref()).map(|(client_id, session)| {
                (client_id, activity_payload(&settings, &session.activity, unix_seconds(session.started)))
            });

            // Session finie, désactivée, identifiant changé ou arrêt : effacer et fermer.
            if link.as_ref().is_some_and(|link| wanted.as_ref().map(|(id, _)| id.as_str()) != Some(link.client_id.as_str())) {
                if let Some(old) = link.take() {
                    self.disconnect(old, if stop { STOP_IO_BUDGET } else { timing.io });
                }
                last_attempt = None;
            }
            if stop {
                break;
            }
            let Some((client_id, payload)) = wanted else {
                last_attempt = None;
                self.logged_error = None;
                self.observe(false, None);
                self.wait(generation, session.map(|session| session.expires));
                continue;
            };

            if link.is_none() && last_attempt.is_none_or(|at| at.elapsed() >= timing.retry) {
                last_attempt = Some(Instant::now());
                link = self.connect(client_id);
            }

            let mut next_send = None;
            let mut lost = None;
            if let Some(current) = link.as_mut() {
                let due_at = match current.last_sent {
                    None => Instant::now(),
                    Some(sent) if current.applied.as_ref() != Some(&payload) => sent + timing.min_interval,
                    Some(sent) => sent + timing.refresh,
                };
                if Instant::now() < due_at {
                    next_send = Some(due_at);
                } else {
                    match current.io.set(payload.clone(), timing.io) {
                        Ok(refused) => {
                            current.applied = Some(payload);
                            current.last_sent = Some(Instant::now());
                            next_send = Some(Instant::now() + timing.refresh);
                            if refused.is_some() && refused != self.logged_error {
                                eprintln!("[menu-forge] Discord : activité refusée ({})", refused.as_deref().unwrap_or(""));
                                self.logged_error = refused.clone();
                            }
                            self.observe(true, refused);
                        }
                        Err(error) => lost = Some(error),
                    }
                }
            }
            if let Some(error) = lost {
                // Connexion abandonnée : son fil d’E/S se termine seul, le verrou est relâché.
                link = None;
                last_attempt = Some(Instant::now());
                self.fail(error);
            }

            let retry_at = match (&link, last_attempt) {
                (None, Some(at)) => Some(at + timing.retry),
                _ => None,
            };
            let deadline = [session.map(|session| session.expires), next_send, retry_at].into_iter().flatten().min();
            self.wait(generation, deadline);
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
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

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
    fn payload_carries_both_images_and_hides_the_workspace() {
        let settings = DiscordSettings { enabled: true, client_id: Some(ID.into()), show_document: true };
        let activity = Activity {
            details: "Édite le menu « Profil »".into(),
            state: Some("Espace « enderium »".into()),
            generic_details: Some("Édite un menu".into()),
            small_image: Some("menu"),
            small_text: Some("Menu".into()),
        };
        assert_eq!(
            activity_payload(&settings, &activity, 42),
            json!({
                "details": "Édite le menu « Profil »",
                "state": "Espace « enderium »",
                "timestamps": { "start": 42 },
                "assets": { "large_image": "logo", "large_text": "menu-forge", "small_image": "menu", "small_text": "Menu" },
            })
        );
        // Document masqué : texte générique, espace de travail masqué lui aussi, petite image conservée.
        let hidden = DiscordSettings { show_document: false, ..settings.clone() };
        assert_eq!(
            activity_payload(&hidden, &activity, 42),
            json!({
                "details": "Édite un menu",
                "timestamps": { "start": 42 },
                "assets": { "large_image": "logo", "large_text": "menu-forge", "small_image": "menu", "small_text": "Menu" },
            })
        );
        let no_generic = Activity { generic_details: None, ..activity.clone() };
        assert_eq!(activity_payload(&hidden, &no_generic, 42)["details"], GENERIC_DETAILS);
        // Petite image seule : pas de texte de survol.
        let bare = Activity { small_text: None, ..activity.clone() };
        assert_eq!(activity_payload(&settings, &bare, 42)["assets"].get("small_text"), None);
        // Texte sans image : ignoré, la grande image reste.
        let text_only = Activity { small_image: None, ..activity };
        assert_eq!(
            activity_payload(&settings, &text_only, 42)["assets"],
            json!({ "large_image": "logo", "large_text": "menu-forge" })
        );
    }

    #[test]
    fn ipc_diagnosis_never_panics() {
        // Ne se connecte pas : liste seulement les canaux nommés.
        let message = ipc_unavailable();
        assert!(message.starts_with("Discord n’est pas lancé") || message.contains("occupé"), "{message}");
    }

    // ------------------------------------------------ connexion factice

    /// Connecteur factice : journal des appels, échecs programmés, blocage à la demande.
    #[derive(Clone, Default)]
    struct Fake {
        calls: Arc<Mutex<Vec<(Instant, String)>>>,
        failures: Arc<AtomicU32>,
        /// Vrai : connexion et envois bloquent (Discord qui ne répond plus).
        hang: Arc<AtomicBool>,
    }

    struct FakeConnection {
        client_id: String,
        fake: Fake,
    }

    impl Fake {
        fn failing(failures: u32) -> Self {
            let fake = Self::default();
            fake.failures.store(failures, Ordering::SeqCst);
            fake
        }

        fn record(&self, entry: String) {
            lock(&self.calls).push((Instant::now(), entry));
        }

        /// Bloque tant que `hang` est vrai ; vrai s’il a bloqué.
        fn block(&self) -> bool {
            let mut blocked = false;
            while self.hang.load(Ordering::SeqCst) {
                blocked = true;
                thread::sleep(Duration::from_millis(5));
            }
            blocked
        }

        fn connector(&self) -> Connector {
            let fake = self.clone();
            Arc::new(move |client_id: &str| {
                if fake.block() {
                    return Err("abandonnée".to_owned());
                }
                if fake.failures.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |left| left.checked_sub(1)).is_ok() {
                    return Err("Discord n’est pas lancé".to_owned());
                }
                fake.record(format!("{client_id} connect"));
                Ok(Box::new(FakeConnection { client_id: client_id.to_owned(), fake: fake.clone() }))
            })
        }

        fn entries(&self) -> Vec<String> {
            lock(&self.calls).iter().map(|(_, entry)| entry.clone()).collect()
        }

        fn has(&self, entry: &str) -> bool {
            self.entries().iter().any(|call| call == entry)
        }

        fn count(&self, entry: &str) -> usize {
            self.entries().iter().filter(|call| *call == entry).count()
        }

        fn time_of(&self, entry: &str) -> Option<Instant> {
            lock(&self.calls).iter().find(|(_, call)| call == entry).map(|(at, _)| *at)
        }
    }

    impl Connection for FakeConnection {
        fn set_activity(&mut self, activity: &Value) -> Result<Option<String>, String> {
            if self.fake.block() {
                return Err("abandonnée".to_owned());
            }
            let text = if activity.is_null() { "clear".to_owned() } else { format!("set {}", activity["details"]) };
            self.fake.record(format!("{} {text}", self.client_id));
            Ok(None)
        }

        fn close(&mut self) {
            self.fake.record(format!("{} close", self.client_id));
        }
    }

    /// Fichier de verrou propre à un test, supprimé à la fin.
    struct TestLock(PathBuf);

    impl TestLock {
        fn new(name: &str) -> Self {
            Self(std::env::temp_dir().join(format!("menu-forge-test-{}-{name}.lock", std::process::id())))
        }
    }

    impl Drop for TestLock {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    const ID: &str = "123456789012345678";
    const OTHER: &str = "987654321098765432";

    fn enabled() -> DiscordSettings {
        DiscordSettings { enabled: true, client_id: Some(ID.into()), show_document: true }
    }

    /// Délais courts : réessai 30 ms, pas de renvoi, pas de limite de débit, pas d’expiration.
    fn fast() -> Timing {
        Timing {
            retry: Duration::from_millis(30),
            refresh: Duration::from_secs(60),
            min_interval: Duration::ZERO,
            ttl: Duration::from_secs(60),
            io: Duration::from_secs(2),
        }
    }

    fn spawn(settings: DiscordSettings, fallback: Option<&str>, fake: &Fake, timing: Timing, lock: &TestLock) -> Presence {
        let host = Host { fallback: fallback.map(str::to_owned), allowed: true, lock_path: lock.0.clone() };
        Presence::spawn(settings, host, fake.connector(), timing)
    }

    fn activity(details: &str) -> Activity {
        Activity { details: details.into(), ..Activity::default() }
    }

    fn eventually(what: &str, condition: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !condition() {
            assert!(Instant::now() < deadline, "délai dépassé : {what}");
            thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn nothing_is_published_before_the_interface_speaks() {
        let lock = TestLock::new("silent");
        let fake = Fake::default();
        let presence = spawn(enabled(), None, &fake, fast(), &lock);
        thread::sleep(Duration::from_millis(100));
        assert!(fake.entries().is_empty(), "{:?}", fake.entries());
        assert_eq!(presence.status(), PresenceStatus { enabled: true, configured: true, connected: false, error: None });
        assert_eq!(presence.session_started(), None);
        presence.set_activity(activity("Menu : boutique"));
        eventually("première activité", || fake.has(&format!("{ID} set \"Menu : boutique\"")));
        assert_eq!(fake.entries()[0], format!("{ID} connect"));
    }

    #[test]
    fn worker_follows_settings_and_activity() {
        let lock = TestLock::new("follow");
        let fake = Fake::failing(1);
        let presence = spawn(enabled(), None, &fake, fast(), &lock);
        presence.set_activity(Activity {
            details: "Menu : boutique".into(),
            state: Some("12 zones".into()),
            generic_details: Some("Édite un menu".into()),
            ..Activity::default()
        });

        // Premier essai raté (Discord absent), puis connexion au suivant.
        eventually("connexion", || presence.status().connected);
        assert_eq!(presence.status(), PresenceStatus { enabled: true, configured: true, connected: true, error: None });
        eventually("document affiché", || fake.has(&format!("{ID} set \"Menu : boutique\"")));
        presence.configure(DiscordSettings { show_document: false, ..enabled() });
        eventually("texte générique", || fake.has(&format!("{ID} set \"Édite un menu\"")));

        // Changement d’identifiant : effacer, fermer, se reconnecter.
        presence.configure(DiscordSettings { client_id: Some(OTHER.into()), ..enabled() });
        eventually("reconnexion", || fake.has(&format!("{OTHER} set \"Menu : boutique\"")));
        assert!(fake.has(&format!("{ID} clear")) && fake.has(&format!("{ID} close")));

        // Désactivation : effacer et fermer.
        presence.configure(DiscordSettings { enabled: false, client_id: Some(OTHER.into()), show_document: true });
        eventually("fermeture", || fake.has(&format!("{OTHER} close")));
        assert_eq!(presence.status(), PresenceStatus { enabled: false, configured: true, connected: false, error: None });

        // Réactivation puis arrêt du backend : l’activité est effacée.
        presence.configure(DiscordSettings { client_id: Some(OTHER.into()), ..enabled() });
        eventually("reconnexion", || presence.status().connected);
        eventually("activité renvoyée", || fake.count(&format!("{OTHER} set \"Menu : boutique\"")) == 2);
        let before = fake.entries().len();
        drop(presence);
        let after: Vec<String> = fake.entries()[before..].to_vec();
        assert_eq!(after, [format!("{OTHER} clear"), format!("{OTHER} close")]);
    }

    #[test]
    fn heartbeat_keeps_the_activity_and_silence_expires_it() {
        let lock = TestLock::new("ttl");
        let fake = Fake::default();
        let timing = Timing { ttl: Duration::from_millis(300), ..fast() };
        let presence = spawn(enabled(), None, &fake, timing, &lock);
        let set = format!("{ID} set \"Menu\"");

        presence.set_activity(activity("Menu"));
        eventually("activité", || fake.has(&set));
        let first = presence.session_started().unwrap();
        // Battements de cœur : la même activité, plus longtemps que la durée de vie.
        for _ in 0..10 {
            thread::sleep(Duration::from_millis(60));
            presence.set_activity(activity("Menu"));
        }
        assert_eq!(fake.count(&set), 1, "un PUT identique ne renvoie rien : {:?}", fake.entries());
        assert!(!fake.has(&format!("{ID} clear")));
        assert_eq!(presence.session_started(), Some(first));

        // Silence : l’activité expire, effacée et connexion fermée.
        eventually("expiration", || fake.has(&format!("{ID} close")));
        assert!(fake.has(&format!("{ID} clear")));
        assert_eq!(presence.session_started(), None);
        assert!(!presence.status().connected);

        // Nouvelle session : le chronomètre repart de zéro.
        thread::sleep(Duration::from_millis(5));
        presence.set_activity(activity("Menu"));
        eventually("nouvelle session", || fake.count(&set) == 2);
        assert!(presence.session_started().unwrap() > first);
    }

    #[test]
    fn delete_clears_at_once() {
        let lock = TestLock::new("delete");
        let fake = Fake::default();
        let presence = spawn(enabled(), None, &fake, fast(), &lock);
        presence.set_activity(activity("Menu"));
        eventually("connexion", || presence.status().connected);
        let first = presence.session_started().unwrap();
        presence.clear_activity();
        eventually("effacement", || fake.has(&format!("{ID} close")));
        assert!(fake.has(&format!("{ID} clear")));
        assert_eq!(presence.status(), PresenceStatus { enabled: true, configured: true, connected: false, error: None });
        // Le PUT suivant rouvre une session, aussitôt.
        thread::sleep(Duration::from_millis(5));
        presence.set_activity(activity("Menu"));
        eventually("reconnexion", || fake.count(&format!("{ID} connect")) == 2);
        assert!(presence.session_started().unwrap() > first);
    }

    #[test]
    fn updates_are_rate_limited_and_the_last_one_wins() {
        let lock = TestLock::new("rate");
        let fake = Fake::default();
        let timing = Timing { min_interval: Duration::from_millis(250), ..fast() };
        let presence = spawn(enabled(), None, &fake, timing, &lock);
        presence.set_activity(activity("A"));
        eventually("A", || fake.has(&format!("{ID} set \"A\"")));
        presence.set_activity(activity("B"));
        presence.set_activity(activity("C"));
        eventually("C", || fake.has(&format!("{ID} set \"C\"")));
        assert!(!fake.has(&format!("{ID} set \"B\"")), "{:?}", fake.entries());
        let gap = fake.time_of(&format!("{ID} set \"C\"")).unwrap() - fake.time_of(&format!("{ID} set \"A\"")).unwrap();
        assert!(gap >= Duration::from_millis(250), "{gap:?}");
    }

    #[test]
    fn only_one_instance_drives_discord() {
        let lock = TestLock::new("single");
        let (first_fake, second_fake) = (Fake::default(), Fake::default());
        let first = spawn(enabled(), None, &first_fake, fast(), &lock);
        first.set_activity(activity("Premier"));
        eventually("première instance", || first.status().connected);

        let second = spawn(enabled(), None, &second_fake, fast(), &lock);
        second.set_activity(activity("Second"));
        eventually("verrou refusé", || second.status().error.as_deref() == Some(LOCKED_BY_OTHER));
        thread::sleep(Duration::from_millis(80));
        assert!(second_fake.entries().is_empty(), "{:?}", second_fake.entries());
        assert!(!second.status().connected);

        // La première s’arrête : la seconde prend le relais.
        drop(first);
        eventually("relais", || second.status().connected);
        eventually("activité de la seconde", || second_fake.has(&format!("{ID} set \"Second\"")));
        assert_eq!(second.status().error, None);
    }

    #[test]
    fn forbidden_presence_never_connects() {
        let lock = TestLock::new("forbidden");
        let fake = Fake::default();
        let host = Host { fallback: Some(DEFAULT_CLIENT_ID.into()), allowed: false, lock_path: lock.0.clone() };
        let presence = Presence::spawn(enabled(), host, fake.connector(), fast());
        presence.set_activity(activity("Menu"));
        presence.configure(DiscordSettings { client_id: Some(OTHER.into()), ..enabled() });
        thread::sleep(Duration::from_millis(100));
        assert!(fake.entries().is_empty());
        assert_eq!(presence.status(), PresenceStatus { enabled: false, configured: true, connected: false, error: None });
    }

    #[test]
    fn unresponsive_discord_is_abandoned_then_retried() {
        let lock = TestLock::new("hang");
        let fake = Fake::default();
        let timing = Timing { io: Duration::from_millis(100), ..fast() };
        let presence = spawn(enabled(), None, &fake, timing, &lock);
        presence.set_activity(activity("A"));
        eventually("connexion", || presence.status().connected);

        fake.hang.store(true, Ordering::SeqCst);
        presence.set_activity(activity("B"));
        eventually("délai dépassé", || presence.status().error.as_deref() == Some(NO_ANSWER));
        assert!(!presence.status().connected);
        // Les requêtes restent immédiates pendant ce temps.
        let started = Instant::now();
        presence.set_activity(activity("C"));
        let _ = presence.status();
        assert!(started.elapsed() < Duration::from_millis(50));

        fake.hang.store(false, Ordering::SeqCst);
        eventually("reconnexion", || fake.has(&format!("{ID} set \"C\"")));
        assert!(presence.status().connected);
    }

    #[test]
    fn stop_never_waits_more_than_two_seconds() {
        let lock = TestLock::new("stop");
        let fake = Fake::default();
        let timing = Timing { io: Duration::from_secs(30), ..fast() };
        let presence = spawn(enabled(), None, &fake, timing, &lock);
        presence.set_activity(activity("A"));
        eventually("connexion", || presence.status().connected);
        fake.hang.store(true, Ordering::SeqCst);
        presence.set_activity(activity("B"));
        thread::sleep(Duration::from_millis(50));
        let started = Instant::now();
        presence.stop();
        assert!(started.elapsed() < Duration::from_millis(2500), "{:?}", started.elapsed());
        fake.hang.store(false, Ordering::SeqCst);
    }

    #[test]
    fn stop_clears_and_later_activity_is_ignored() {
        let lock = TestLock::new("stop-clear");
        let fake = Fake::default();
        let presence = spawn(enabled(), None, &fake, fast(), &lock);
        presence.set_activity(activity("A"));
        eventually("activité", || fake.has(&format!("{ID} set \"A\"")));
        presence.stop();
        assert!(fake.entries().ends_with(&[format!("{ID} clear"), format!("{ID} close")]), "{:?}", fake.entries());
        presence.set_activity(activity("B"));
        thread::sleep(Duration::from_millis(50));
        assert!(!fake.has(&format!("{ID} set \"B\"")));
        assert!(!presence.status().connected);
    }

    #[test]
    fn settings_change_retries_at_once() {
        let lock = TestLock::new("retry");
        let fake = Fake::failing(1);
        let timing = Timing { retry: Duration::from_secs(60), ..fast() };
        let presence = spawn(enabled(), None, &fake, timing, &lock);
        presence.set_activity(activity("A"));
        eventually("échec signalé", || presence.status().error.is_some());
        // Sans attendre la minute de réessai.
        presence.configure(DiscordSettings { client_id: Some(OTHER.into()), ..enabled() });
        eventually("connexion immédiate", || fake.has(&format!("{OTHER} set \"A\"")));
    }

    #[test]
    fn unconfigured_presence_stays_idle() {
        let lock = TestLock::new("idle");
        let fake = Fake::default();
        let timing = Timing { refresh: Duration::from_millis(10), ..fast() };
        let presence = spawn(DiscordSettings::default(), None, &fake, timing, &lock);
        presence.set_activity(activity("ab"));
        thread::sleep(Duration::from_millis(50));
        assert!(fake.entries().is_empty());
        assert_eq!(presence.status(), PresenceStatus { enabled: true, configured: false, connected: false, error: None });
    }

    #[test]
    fn fallback_application_is_used_without_client_id() {
        let lock = TestLock::new("fallback");
        let fake = Fake::default();
        let presence = spawn(DiscordSettings::default(), Some(DEFAULT_CLIENT_ID), &fake, fast(), &lock);
        presence.set_activity(activity("Menu"));
        eventually("connexion à l’application de repli", || fake.has(&format!("{DEFAULT_CLIENT_ID} connect")));
        assert_eq!(presence.status(), PresenceStatus { enabled: true, configured: true, connected: true, error: None });
        // Un identifiant saisi dans les réglages l’emporte sur le repli.
        presence.configure(DiscordSettings { client_id: Some(ID.into()), ..DiscordSettings::default() });
        eventually("identifiant des réglages", || fake.has(&format!("{ID} connect")));
        assert!(fake.has(&format!("{DEFAULT_CLIENT_ID} close")));
    }
}
