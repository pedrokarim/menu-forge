//! IA multi-fournisseurs : génération de textures (images) et d’interfaces
//! (texte structuré) pour le studio. Voir `docs/ai.md`.
//!
//! Le backend fait **tous** les appels réseau : l’interface ne parle qu’à
//! ces routes locales, qui exigent l’en-tête `X-Menu-Forge: 1` pour tout ce
//! qui n’est pas une lecture (voir [`crate::server`]).
//!
//! | Route | Rôle |
//! |---|---|
//! | `GET /ai/providers` | `{ secretStore, providers: [...] }` : catalogue, réglages, état des clés (`keyConfigured`, jamais la clé) |
//! | `PUT /ai/providers/:id` | `{ enabled?, imageModel?, textModel?, endpoint? }` : réglages non secrets (fichier de réglages, section `ai`) |
//! | `PUT /ai/keys/:id` | `{ key }` : range la clé dans le trousseau du système |
//! | `DELETE /ai/keys/:id` | retire la clé du trousseau |
//! | `POST /ai/test/:id` | test de connexion (liste des modèles, version du programme…) → `{ ok, verified, message }` |
//! | `POST /ai/image` | `{ provider, prompt, system?, negativePrompt?, width, height, requestId? }` → `{ provider, model, mime, data (base64), size, elapsedMs, note }` |
//! | `POST /ai/text` | `{ provider, system, messages: [{ role, content }], json?, requestId? }` → `{ provider, model, text, elapsedMs }` |
//! | `POST /ai/cancel` | `{ requestId }` : annule la génération en cours (elle répond 409 « Génération annulée ») |
//! | `GET /ai/progress/:requestId` | `{ active, phase?, events?, elapsedMs?, phaseMs? }` : progression d’une génération en cours (voir [`progress`]) |
//!
//! Rien n’est envoyé à un fournisseur tant qu’il n’est pas **activé** (et,
//! s’il en exige une, qu’une clé n’est pas enregistrée) : refus 409 avant
//! toute requête. Rien ne part au démarrage : seules ces routes, appelées
//! par une action explicite, contactent un fournisseur.

pub mod config;
pub mod error;
pub mod net;
pub mod progress;
pub mod providers;
pub mod secrets;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::{Map, Value};

use config::{Capability, ProviderInfo, ProviderKind, ProviderSettings};
use error::{AiError, NBSP};
use net::{Budget, CancelToken};
use progress::Progress;
use providers::{Ctx, ImageJob, Message, Role, TextJob};
use secrets::SecretStore;

use crate::error::HttpError;
use crate::js::{parse_lossy, stringify};
use crate::paths::decode_component;
use crate::settings::Settings;
use crate::{Backend, Request, Response};

/// Échéance d’une image (sondages de Replicate et ComfyUI compris).
const IMAGE_TIMEOUT: Duration = Duration::from_secs(300);
/// Échéance d’un texte (un menu complet).
const TEXT_TIMEOUT: Duration = Duration::from_secs(240);
/// Échéance d’une exécution de Codex CLI (un agent, plus lent).
const CLI_TIMEOUT: Duration = Duration::from_secs(600);
/// Échéance d’un test de connexion.
const TEST_TIMEOUT: Duration = Duration::from_secs(25);

const PROMPT_LIMIT: usize = 8_000;
const SYSTEM_LIMIT: usize = 100_000;
const MESSAGE_LIMIT: usize = 200_000;
const CONVERSATION_LIMIT: usize = 400_000;
const MAX_MESSAGES: usize = 16;
/// Côté maximal d’une texture demandée (celui de l’éditeur de pixels).
const MAX_SIDE: u64 = 1024;

/// Génération en cours : de quoi l’annuler et lire sa progression.
struct Running {
    cancel: CancelToken,
    progress: Progress,
}

/// État de l’IA dans le backend : magasin des clés et générations en cours.
pub struct AiService {
    store: RwLock<Arc<dyn SecretStore>>,
    jobs: Mutex<HashMap<String, Running>>,
}

impl AiService {
    pub fn new(store: Arc<dyn SecretStore>) -> Self {
        Self { store: RwLock::new(store), jobs: Mutex::new(HashMap::new()) }
    }

    pub fn store(&self) -> Arc<dyn SecretStore> {
        Arc::clone(&self.store.read().unwrap_or_else(|poisoned| poisoned.into_inner()))
    }

    pub fn set_store(&self, store: Arc<dyn SecretStore>) {
        *self.store.write().unwrap_or_else(|poisoned| poisoned.into_inner()) = store;
    }

    fn jobs(&self) -> std::sync::MutexGuard<'_, HashMap<String, Running>> {
        self.jobs.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Enregistre une génération annulable, et suivie, par son identifiant
    /// (s’il y en a un ; sans identifiant, ni annulation ni progression).
    fn register(&self, id: Option<String>) -> JobGuard<'_> {
        let token = CancelToken::new();
        let progress = if id.is_some() { Progress::tracked() } else { Progress::default() };
        if let Some(id) = &id {
            self.jobs().insert(id.clone(), Running { cancel: token.clone(), progress: progress.clone() });
        }
        JobGuard { service: self, id, token, progress }
    }

    fn cancel(&self, id: &str) -> bool {
        match self.jobs().get(id) {
            Some(running) => {
                running.cancel.cancel();
                true
            }
            None => false,
        }
    }

    /// Progression d’une génération en cours ; `{ active: false }` si elle est
    /// finie ou inconnue (l’interface arrête alors de la lire).
    fn progress(&self, id: &str) -> Value {
        self.jobs().get(id).map(|running| running.progress.clone()).unwrap_or_default().snapshot()
    }
}

/// Retire la génération de la liste des annulables à la fin de la requête.
struct JobGuard<'a> {
    service: &'a AiService,
    id: Option<String>,
    token: CancelToken,
    progress: Progress,
}

impl Drop for JobGuard<'_> {
    fn drop(&mut self) {
        if let Some(id) = &self.id {
            self.service.jobs().remove(id);
        }
    }
}

fn json_response(value: &Value) -> Response {
    Response::json(stringify(value).into_bytes())
}

fn object(body: &[u8]) -> Result<Map<String, Value>, AiError> {
    match parse_lossy(body) {
        Some(Value::Object(map)) => Ok(map),
        Some(_) => Err(AiError::BadRequest("Le corps de la requête doit être un objet JSON".to_owned())),
        None => Err(AiError::BadRequest("JSON invalide".to_owned())),
    }
}

fn text_field(map: &Map<String, Value>, key: &str, limit: usize) -> Result<Option<String>, AiError> {
    match map.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) if text.chars().count() <= limit => Ok(Some(text.clone())),
        Some(Value::String(_)) => Err(AiError::BadRequest(format!("«{NBSP}{key}{NBSP}» dépasse {limit} caractères"))),
        Some(_) => Err(AiError::BadRequest(format!("«{NBSP}{key}{NBSP}» doit être un texte"))),
    }
}

fn required_text(map: &Map<String, Value>, key: &str, limit: usize) -> Result<String, AiError> {
    text_field(map, key, limit)?
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| AiError::BadRequest(format!("«{NBSP}{key}{NBSP}» est obligatoire (texte non vide)")))
}

fn side(map: &Map<String, Value>, key: &str) -> Result<u32, AiError> {
    map.get(key)
        .and_then(Value::as_u64)
        .filter(|value| (1..=MAX_SIDE).contains(value))
        .map(|value| value as u32)
        .ok_or_else(|| AiError::BadRequest(format!("«{NBSP}{key}{NBSP}» doit être un entier de 1 à {MAX_SIDE}")))
}

/// Identifiant d’annulation choisi par l’interface : `[A-Za-z0-9_-]`, 64 caractères au plus.
fn valid_request_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn request_id(map: &Map<String, Value>) -> Result<Option<String>, AiError> {
    match map.get("requestId") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(id)) if valid_request_id(id) => Ok(Some(id.clone())),
        Some(_) => Err(AiError::BadRequest(format!("«{NBSP}requestId{NBSP}» invalide"))),
    }
}

fn known(id: &str) -> Result<&'static ProviderInfo, AiError> {
    config::provider(id).ok_or_else(|| AiError::BadRequest(format!("Fournisseur d’IA inconnu{NBSP}: «{NBSP}{id}{NBSP}»")))
}

fn optional(value: Option<&str>) -> Value {
    value.map_or(Value::Null, |text| Value::String(text.to_owned()))
}

impl Backend {
    /// Remplace le magasin des clés (tests, option `--ephemeral-secrets`) ;
    /// par défaut, le trousseau du système.
    pub fn with_secret_store(self, store: Arc<dyn SecretStore>) -> Self {
        self.ai.set_store(store);
        self
    }

    /// Routes `/ai/…` ; `None` pour toute autre requête.
    pub(crate) fn route_ai(&self, request: &Request, pathname: &str, method: &str) -> Result<Option<Response>, HttpError> {
        let Some(rest) = pathname.strip_prefix("/ai/") else {
            return Ok(None);
        };
        let (head, tail) = match rest.split_once('/') {
            Some((head, tail)) if !tail.is_empty() && !tail.contains('/') => (head, Some(decode_component(tail)?)),
            Some(_) => return Ok(None),
            None => (rest, None),
        };
        let in_path = |id: &str| known(id).map_err(|error| HttpError::new(404, error.message()));
        let response = match (head, tail.as_deref(), method) {
            ("providers", None, "GET") => self.ai_list(),
            ("providers", Some(id), "PUT") => self.ai_configure(in_path(id)?, &request.body)?,
            ("keys", Some(id), "PUT") => self.ai_set_key(in_path(id)?, &request.body)?,
            ("keys", Some(id), "DELETE") => self.ai_delete_key(in_path(id)?)?,
            ("test", Some(id), "POST") => self.ai_test(in_path(id)?)?,
            ("image", None, "POST") => self.ai_image(&request.body)?,
            ("text", None, "POST") => self.ai_text(&request.body)?,
            ("progress", Some(id), "GET") => {
                if !valid_request_id(id) {
                    return Err(AiError::BadRequest(format!("«{NBSP}requestId{NBSP}» invalide")).into());
                }
                json_response(&self.ai.progress(id))
            }
            ("cancel", None, "POST") => {
                let map = object(&request.body)?;
                let id = request_id(&map)?
                    .ok_or_else(|| AiError::BadRequest(format!("«{NBSP}requestId{NBSP}» est obligatoire")))?;
                self.ai.cancel(&id);
                Response::no_content()
            }
            _ => return Ok(None),
        };
        Ok(Some(response))
    }

    fn ai_settings(&self, id: &str) -> ProviderSettings {
        self.read_state().settings.ai.provider(id)
    }

    /// Fiche d’un fournisseur pour l’interface : **jamais** la clé, seulement
    /// si elle est configurée.
    fn provider_entry(&self, info: &'static ProviderInfo, store: &dyn SecretStore) -> Value {
        let settings = self.ai_settings(info.id);
        let (configured, key_error) = if info.key_required {
            match store.get(info.id) {
                Ok(key) => (Value::Bool(key.is_some()), Value::Null),
                Err(error) => (Value::Null, Value::String(error)),
            }
        } else {
            (Value::Null, Value::Null)
        };
        let program = (info.kind == ProviderKind::Cli).then(|| providers::codex::locate(settings.endpoint.as_deref()));
        let endpoint = match &program {
            Some(found) => found.as_ref().map(|path| Value::String(path.display().to_string())).unwrap_or(Value::Null),
            None => Value::String(settings.endpoint.clone().unwrap_or_else(|| info.default_endpoint.to_owned())),
        };
        let issue = if !settings.enabled {
            Some("désactivé")
        } else if info.key_required && configured != Value::Bool(true) {
            Some("clé absente")
        } else if matches!(program, Some(None)) {
            Some("programme introuvable")
        } else {
            None
        };
        let model = |capability| {
            if info.supports(capability) {
                optional(settings.model(info, capability).as_deref())
            } else {
                Value::Null
            }
        };
        let mut custom = Map::new();
        custom.insert("imageModel".into(), optional(settings.image_model.as_deref()));
        custom.insert("textModel".into(), optional(settings.text_model.as_deref()));
        custom.insert("endpoint".into(), optional(settings.endpoint.as_deref()));
        let mut defaults = Map::new();
        defaults.insert("imageModel".into(), optional(info.default_image_model));
        defaults.insert("textModel".into(), optional(info.default_text_model));
        defaults.insert("endpoint".into(), optional(Some(info.default_endpoint).filter(|text| !text.is_empty())));

        let mut map = Map::new();
        map.insert("id".into(), Value::String(info.id.into()));
        map.insert("name".into(), Value::String(info.name.into()));
        map.insert("kind".into(), Value::String(info.kind.as_str().into()));
        map.insert("image".into(), Value::Bool(info.image));
        map.insert("text".into(), Value::Bool(info.text));
        map.insert("keyRequired".into(), Value::Bool(info.key_required));
        map.insert("keyConfigured".into(), configured);
        map.insert("keyError".into(), key_error);
        map.insert("enabled".into(), Value::Bool(settings.enabled));
        map.insert("imageModel".into(), model(Capability::Image));
        map.insert("textModel".into(), model(Capability::Text));
        map.insert("endpoint".into(), endpoint);
        map.insert("custom".into(), Value::Object(custom));
        map.insert("defaults".into(), Value::Object(defaults));
        map.insert("helpUrl".into(), Value::String(info.help_url.into()));
        map.insert("ready".into(), Value::Bool(issue.is_none()));
        map.insert("issue".into(), optional(issue));
        Value::Object(map)
    }

    fn ai_list(&self) -> Response {
        let store = self.ai.store();
        let providers = config::PROVIDERS.iter().map(|info| self.provider_entry(info, &*store)).collect();
        let mut map = Map::new();
        map.insert("secretStore".into(), Value::String(store.location().into()));
        map.insert("providers".into(), Value::Array(providers));
        json_response(&Value::Object(map))
    }

    fn ai_configure(&self, info: &'static ProviderInfo, body: &[u8]) -> Result<Response, HttpError> {
        let patch = object(body)?;
        let mut providers = Map::new();
        providers.insert(info.id.to_owned(), Value::Object(patch));
        let mut section = Map::new();
        section.insert("providers".into(), Value::Object(providers));
        {
            let mut state = self.write_state();
            let ai = config::apply_patch(&state.settings.ai, &Value::Object(section)).map_err(|message| HttpError::new(400, message))?;
            let next = Settings { ai, ..state.settings.clone() };
            self.commit(&mut state, next)?;
        }
        Ok(json_response(&self.provider_entry(info, &*self.ai.store())))
    }

    fn ai_set_key(&self, info: &'static ProviderInfo, body: &[u8]) -> Result<Response, HttpError> {
        if !info.key_required {
            return Err(AiError::BadRequest(format!("{} n’utilise pas de clé d’API", info.name)).into());
        }
        let map = object(body)?;
        let key = text_field(&map, "key", 1000)?.unwrap_or_default();
        let key = secrets::check_key(&key).map_err(AiError::BadRequest)?;
        let store = self.ai.store();
        store.set(info.id, key).map_err(|message| HttpError::new(500, message))?;
        Ok(json_response(&self.provider_entry(info, &*store)))
    }

    fn ai_delete_key(&self, info: &'static ProviderInfo) -> Result<Response, HttpError> {
        let store = self.ai.store();
        store.delete(info.id).map_err(|message| HttpError::new(500, message))?;
        Ok(json_response(&self.provider_entry(info, &*store)))
    }

    /// Contexte d’une génération ; refuse (sans rien envoyer) un fournisseur
    /// désactivé, sans clé, ou dont le programme est introuvable.
    fn ai_context(
        &self,
        info: &'static ProviderInfo,
        capability: Capability,
        timeout: Duration,
        cancel: CancelToken,
        progress: Progress,
    ) -> Result<Ctx, AiError> {
        if !info.supports(capability) {
            let what = if capability == Capability::Image { "d’images" } else { "de texte" };
            return Err(AiError::BadRequest(format!("{} ne génère pas {what}", info.name)));
        }
        let settings = self.ai_settings(info.id);
        if !settings.enabled {
            return Err(AiError::NotReady(format!(
                "{} n’est pas activé{NBSP}: active-le dans Paramètres, section IA. Rien n’a été envoyé",
                info.name
            )));
        }
        let key = if info.key_required {
            match self.ai.store().get(info.id) {
                Ok(Some(key)) => Some(key),
                Ok(None) => {
                    return Err(AiError::NotReady(format!(
                        "Aucune clé d’API pour {}{NBSP}: ajoute-la dans Paramètres, section IA. Rien n’a été envoyé",
                        info.name
                    )))
                }
                Err(message) => return Err(AiError::NotReady(message)),
            }
        } else {
            None
        };
        let endpoint = if info.kind == ProviderKind::Cli {
            providers::codex::locate(settings.endpoint.as_deref())
                .ok_or_else(|| {
                    AiError::NotReady(format!(
                        "Codex CLI introuvable{NBSP}: installe-le ou indique son chemin dans Paramètres, section IA"
                    ))
                })?
                .to_string_lossy()
                .into_owned()
        } else {
            settings.endpoint.clone().unwrap_or_else(|| info.default_endpoint.to_owned()).trim_end_matches('/').to_owned()
        };
        let model = settings.model(info, capability).unwrap_or_default();
        Ok(Ctx { info, endpoint, key, model, budget: Budget::new(timeout, cancel).with_progress(progress) })
    }

    fn ai_test(&self, info: &'static ProviderInfo) -> Result<Response, HttpError> {
        let capability = if info.text { Capability::Text } else { Capability::Image };
        let ctx = self.ai_context(info, capability, TEST_TIMEOUT, CancelToken::new(), Progress::default())?;
        let budget = ctx.budget.clone();
        let outcome = net::run_job(&budget, move || providers::test(&ctx))?;
        let mut map = Map::new();
        map.insert("ok".into(), Value::Bool(true));
        map.insert("verified".into(), Value::Bool(outcome.verified));
        map.insert("message".into(), Value::String(outcome.message));
        Ok(json_response(&Value::Object(map)))
    }

    fn ai_image(&self, body: &[u8]) -> Result<Response, HttpError> {
        let map = object(body)?;
        let info = known(&required_text(&map, "provider", 64)?)?;
        let prompt = required_text(&map, "prompt", PROMPT_LIMIT)?;
        let system = text_field(&map, "system", PROMPT_LIMIT)?.filter(|text| !text.trim().is_empty());
        let negative = text_field(&map, "negativePrompt", 2_000)?.filter(|text| !text.trim().is_empty());
        let (width, height) = (side(&map, "width")?, side(&map, "height")?);
        let guard = self.ai.register(request_id(&map)?);
        let timeout = if info.kind == ProviderKind::Cli { CLI_TIMEOUT } else { IMAGE_TIMEOUT };
        let ctx = self.ai_context(info, Capability::Image, timeout, guard.token.clone(), guard.progress.clone())?;
        // Les API d’images n’ont pas de message système : consignes en tête du prompt.
        let prompt = match system {
            Some(system) => format!("{system}\n\n{prompt}"),
            None => prompt,
        };
        let job = ImageJob { prompt, negative, width, height };
        let (budget, model) = (ctx.budget.clone(), ctx.model.clone());
        let started = Instant::now();
        let image = net::run_job(&budget, move || providers::generate_image(&ctx, &job))?;
        let mut out = Map::new();
        out.insert("provider".into(), Value::String(info.id.into()));
        out.insert("model".into(), Value::String(model));
        out.insert("mime".into(), Value::String(image.mime.into()));
        out.insert("data".into(), Value::String(base64::engine::general_purpose::STANDARD.encode(&image.bytes)));
        out.insert("size".into(), Value::from(image.bytes.len()));
        out.insert("elapsedMs".into(), Value::from(started.elapsed().as_millis() as u64));
        out.insert("note".into(), optional(image.note.as_deref()));
        drop(guard);
        Ok(json_response(&Value::Object(out)))
    }

    fn ai_text(&self, body: &[u8]) -> Result<Response, HttpError> {
        let map = object(body)?;
        let info = known(&required_text(&map, "provider", 64)?)?;
        let system = required_text(&map, "system", SYSTEM_LIMIT)?;
        let json = match map.get("json") {
            None | Some(Value::Null) => true,
            Some(Value::Bool(flag)) => *flag,
            Some(_) => return Err(AiError::BadRequest(format!("«{NBSP}json{NBSP}» doit valoir true ou false")).into()),
        };
        let items = map
            .get("messages")
            .and_then(Value::as_array)
            .filter(|items| (1..=MAX_MESSAGES).contains(&items.len()))
            .ok_or_else(|| AiError::BadRequest(format!("«{NBSP}messages{NBSP}» doit être une liste de 1 à {MAX_MESSAGES} messages")))?;
        let mut messages = Vec::new();
        let mut total = system.chars().count();
        for (index, item) in items.iter().enumerate() {
            let item = item.as_object().ok_or_else(|| AiError::BadRequest(format!("Message {index} invalide")))?;
            let role = match item.get("role").and_then(Value::as_str) {
                Some("user") => Role::User,
                Some("assistant") => Role::Assistant,
                _ => return Err(AiError::BadRequest(format!("Message {index}{NBSP}: rôle «{NBSP}user{NBSP}» ou «{NBSP}assistant{NBSP}» attendu")).into()),
            };
            let content = required_text(item, "content", MESSAGE_LIMIT)?;
            total += content.chars().count();
            messages.push(Message { role, content });
        }
        if total > CONVERSATION_LIMIT {
            return Err(AiError::BadRequest(format!("Conversation trop longue ({total} caractères, {CONVERSATION_LIMIT} au plus)")).into());
        }
        if messages.last().map(|message| message.role) != Some(Role::User) {
            return Err(AiError::BadRequest("Le dernier message doit venir de l’utilisateur".to_owned()).into());
        }
        let guard = self.ai.register(request_id(&map)?);
        let timeout = if info.kind == ProviderKind::Cli { CLI_TIMEOUT } else { TEXT_TIMEOUT };
        let ctx = self.ai_context(info, Capability::Text, timeout, guard.token.clone(), guard.progress.clone())?;
        let job = TextJob { system, messages, json };
        let (budget, model) = (ctx.budget.clone(), ctx.model.clone());
        let started = Instant::now();
        let text = net::run_job(&budget, move || providers::generate_text(&ctx, &job))?;
        let mut out = Map::new();
        out.insert("provider".into(), Value::String(info.id.into()));
        out.insert("model".into(), Value::String(model));
        out.insert("text".into(), Value::String(text));
        out.insert("elapsedMs".into(), Value::from(started.elapsed().as_millis() as u64));
        drop(guard);
        Ok(json_response(&Value::Object(out)))
    }
}
