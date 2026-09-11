//! Backend local du studio Menu Forge.
//!
//! Portage en Rust de l’ancien serveur TypeScript (plugin Vite, retiré
//! depuis), avec un comportement identique pour les routes historiques :
//! mêmes codes HTTP, mêmes messages d’erreur, même JSON octet pour octet,
//! même cache disque
//! d’index. S’y ajoutent les routes de l’application (réglages, espaces de
//! travail, documents récents, gestion des bibliothèques, Rich Presence
//! Discord), voir [`app`] et [`presence`].
//!
//! L’API est indépendante du transport : [`Backend::handle`] reçoit une
//! [`Request`] dont le chemin est **ce qui suit `/api`**, tel qu’il arrive sur
//! le fil (encodé en pourcentage, requête `?…` éventuelle comprise). Le
//! décodage et la normalisation (`.`/`..`, `%2e`, `\`) sont faits ici, comme le
//! faisait `new URL(...)` côté Node. Le transport HTTP est dans [`server`] :
//! `studio-api` (mode navigateur) et la coquille Tauri s’en servent tous deux.
//!
//! ```no_run
//! use studio_backend::{Backend, BackendConfig, Request};
//!
//! let backend = Backend::new(BackendConfig::defaults("C:/…/menu-forge/studio"));
//! let response = backend.handle(&Request::new("GET", "/workspace", Vec::new()));
//! assert_eq!(response.status, 200);
//! ```

pub mod ai;
pub mod app;
mod error;
pub mod export;
mod fsutil;
pub mod js;
pub mod libraries;
pub mod paths;
pub mod presence;
pub mod server;
pub mod settings;
pub mod workspace;

use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};

pub use error::HttpError;
pub use libraries::{load_library_sources, LibrarySource, Ownership, INDEX_VERSION};
pub use paths::strip_api_prefix;
pub use settings::Settings;

use libraries::Libraries;
use workspace::Workspace;

/// Requête adressée au backend.
#[derive(Clone, Debug)]
pub struct Request {
    /// Méthode HTTP en majuscules (`GET`, `PUT`, `POST`…).
    pub method: String,
    /// Chemin **après `/api`**, non décodé : `/libraries/vanilla/raw/assets/x%20y.png`.
    /// Une requête (`?…`) ou un fragment (`#…`) éventuels sont ignorés.
    pub path: String,
    /// Corps brut (JSON ou PNG selon la route).
    pub body: Vec<u8>,
}

impl Request {
    pub fn new(method: impl Into<String>, path: impl Into<String>, body: Vec<u8>) -> Self {
        Self { method: method.into(), path: path.into(), body }
    }
}

/// Réponse du backend.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    /// `Content-Type`, absent pour un 204.
    pub content_type: Option<&'static str>,
    /// En-têtes supplémentaires (`Cache-Control: no-store` pour les PNG).
    pub headers: Vec<(&'static str, &'static str)>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn json(body: Vec<u8>) -> Self {
        Self { status: 200, content_type: Some("application/json; charset=utf-8"), headers: Vec::new(), body }
    }

    pub fn png(body: Vec<u8>) -> Self {
        Self {
            status: 200,
            content_type: Some("image/png"),
            headers: vec![("Cache-Control", "no-store")],
            body,
        }
    }

    pub fn no_content() -> Self {
        Self { status: 204, content_type: None, headers: Vec::new(), body: Vec::new() }
    }

    pub fn text(status: u16, message: &str) -> Self {
        Self {
            status,
            content_type: Some("text/plain; charset=utf-8"),
            headers: Vec::new(),
            body: message.as_bytes().to_vec(),
        }
    }
}

impl From<HttpError> for Response {
    fn from(error: HttpError) -> Self {
        Response::text(error.status, &error.message)
    }
}

/// Mode d’exécution, exposé par `GET /app`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AppMode {
    /// `studio-api` derrière Vite (développement, tests automatiques).
    Browser,
    /// Appli de bureau Tauri.
    Tauri,
}

impl AppMode {
    pub fn as_str(self) -> &'static str {
        match self {
            AppMode::Browser => "browser",
            AppMode::Tauri => "tauri",
        }
    }
}

/// Configuration du backend. Les chemins relatifs sont résolus depuis le
/// dossier courant (comme `path.resolve`).
#[derive(Clone, Debug)]
pub struct BackendConfig {
    pub mode: AppMode,
    /// Version affichée par `GET /app`.
    pub app_version: String,
    /// Fichier JSON des réglages persistants.
    pub settings_path: String,
    /// Espace de travail actif au premier lancement (pas de réglages).
    pub default_workspace: String,
    /// `libraries.local.json` à importer au premier lancement, s’il existe.
    pub legacy_libraries_file: Option<String>,
    /// Dossier des gabarits fournis (lecture seule).
    pub templates_root: String,
    /// Dossier des caches ; les index vont dans `<cache_dir>/libraries/<id>.json`.
    pub cache_dir: String,
    /// Espace de travail imposé pour cette session (option `--workspace`),
    /// **non enregistré** ; il cesse de s’appliquer dès qu’un espace est
    /// ouvert par l’API.
    pub workspace_override: Option<String>,
    /// Bibliothèques imposées pour cette session (option `--libraries`),
    /// **non enregistrées** ; toute modification des bibliothèques par l’API
    /// part de cette liste et l’enregistre.
    pub libraries_override: Option<Vec<LibrarySource>>,
    /// Application Discord utilisée tant que `discord.clientId` n’est pas
    /// défini : l’application officielle pour l’appli et `studio-api`
    /// (fournie par eux), `None` pour les tests (jamais le vrai profil Discord).
    pub discord_client_id: Option<String>,
    /// Rich Presence permise : faux (`--no-discord`), le fil ne se connecte
    /// jamais à Discord, même avec un `discord.clientId` réglé.
    pub presence: bool,
}

impl BackendConfig {
    /// Mode navigateur, relatif au dossier `studio/` : réglages dans
    /// `.cache/settings.json`, espace par défaut `../examples`, gabarits
    /// `../templates`, bibliothèques importées de `../libraries.local.json`.
    /// Présence permise mais sans application de repli : c’est à l’hôte
    /// (`studio-api`, l’appli) de fournir [`presence::DEFAULT_CLIENT_ID`].
    pub fn defaults(studio_dir: &str) -> Self {
        let studio_dir = paths::resolve(&[studio_dir]);
        Self {
            mode: AppMode::Browser,
            app_version: env!("CARGO_PKG_VERSION").to_owned(),
            settings_path: paths::resolve(&[&studio_dir, ".cache/settings.json"]),
            default_workspace: paths::resolve(&[&studio_dir, "../examples"]),
            legacy_libraries_file: Some(paths::resolve(&[&studio_dir, "../libraries.local.json"])),
            templates_root: paths::resolve(&[&studio_dir, "../templates"]),
            cache_dir: paths::resolve(&[&studio_dir, ".cache"]),
            workspace_override: None,
            libraries_override: None,
            discord_client_id: None,
            presence: true,
        }
    }
}

/// État modifiable à chaud (espace actif, bibliothèques).
struct Runtime {
    /// Réglages tels qu’enregistrés sur disque.
    settings: Settings,
    workspace_override: Option<String>,
    libraries_override: Option<Vec<LibrarySource>>,
    workspace: Arc<Workspace>,
    libraries: Arc<Libraries>,
}

impl Runtime {
    fn active_workspace(&self) -> &str {
        self.workspace_override.as_deref().unwrap_or(&self.settings.active_workspace)
    }

    fn effective_libraries(&self) -> &[LibrarySource] {
        self.libraries_override.as_deref().unwrap_or(&self.settings.libraries)
    }

    /// Réglages vus par l’interface : remplacements de session appliqués.
    fn effective_settings(&self) -> Settings {
        let mut settings = self.settings.clone();
        settings.active_workspace = self.active_workspace().to_owned();
        settings.libraries = self.effective_libraries().to_vec();
        settings
    }
}

/// Le backend. `Sync` : un même `Backend` sert des requêtes depuis plusieurs
/// fils ; l’espace actif et les bibliothèques peuvent changer entre deux
/// requêtes sans redémarrage (les index déjà construits restent en mémoire).
pub struct Backend {
    mode: AppMode,
    app_version: String,
    settings_path: String,
    templates_root: String,
    library_cache_dir: String,
    /// Le fichier de réglages n’existait pas au démarrage du backend (premier
    /// lancement), exposé par `GET /app`. Un fichier invalide, mis de côté,
    /// ne compte pas comme un premier lancement.
    first_launch: bool,
    /// Le fichier de réglages existe mais n’a pu être ni relu ni mis de côté :
    /// les réglages vivent en mémoire et **rien n’est écrit** (le fichier est
    /// laissé intact), exposé par `GET /app` (`settingsReadOnly`).
    settings_read_only: bool,
    state: RwLock<Runtime>,
    /// Rich Presence Discord : son fil s’arrête (et efface l’activité) avec le
    /// backend, ou avant par [`Backend::stop_presence`].
    presence: presence::Presence,
    /// IA : magasin des clés (trousseau du système par défaut) et générations
    /// en cours ; aucune requête ne part vers un fournisseur au démarrage.
    ai: ai::AiService,
}

impl Backend {
    pub fn new(config: BackendConfig) -> Self {
        let settings_path = paths::resolve(&[&config.settings_path]);
        let templates_root = paths::resolve(&[&config.templates_root]);
        let library_cache_dir = paths::join(&paths::resolve(&[&config.cache_dir]), "libraries");
        let (settings, first_launch, settings_read_only) = Self::load_settings(&settings_path, &config);
        let workspace_override = config.workspace_override.map(|path| paths::resolve(&[&path]));
        let active = workspace_override.clone().unwrap_or_else(|| settings.active_workspace.clone());
        let libraries = config.libraries_override.clone().unwrap_or_else(|| settings.libraries.clone());
        let presence =
            presence::Presence::start(settings.discord.clone(), config.discord_client_id.clone(), config.presence);
        let runtime = Runtime {
            workspace: Arc::new(Workspace::new(active, templates_root.clone())),
            libraries: Arc::new(Libraries::new(libraries, library_cache_dir.clone())),
            settings,
            workspace_override,
            libraries_override: config.libraries_override,
        };
        Self {
            mode: config.mode,
            app_version: config.app_version,
            settings_path,
            templates_root,
            library_cache_dir,
            first_launch,
            settings_read_only,
            state: RwLock::new(runtime),
            presence,
            ai: ai::AiService::new(Arc::new(ai::secrets::SystemStore)),
        }
    }

    /// Relit les réglages ; au premier lancement (ou si le fichier invalide a
    /// pu être mis de côté), part des valeurs par défaut et les enregistre.
    /// Renvoie `(réglages, premier lancement, lecture seule)` : un fichier
    /// présent mais illisible, ou invalide et impossible à mettre de côté,
    /// n’est **jamais** écrasé (défauts en mémoire, rien d’écrit).
    fn load_settings(settings_path: &str, config: &BackendConfig) -> (Settings, bool, bool) {
        let imported = || {
            config
                .legacy_libraries_file
                .as_deref()
                .map(load_library_sources)
                .unwrap_or_default()
        };
        let defaults = Settings::first_launch(&config.default_workspace, Vec::new());
        let read_only = |reason: String| {
            eprintln!(
                "[menu-forge] réglages {reason} ; valeurs par défaut en mémoire, fichier {settings_path} laissé intact, rien ne sera enregistré"
            );
            (Settings::first_launch(&config.default_workspace, imported()), false, true)
        };
        let (settings, first_launch) = match settings::load(settings_path, &defaults) {
            settings::Loaded::Existing { settings, ignored_discord, ignored_ai } => {
                if let Some(reason) = ignored_discord {
                    eprintln!(
                        "[menu-forge] section « discord » des réglages invalide ({reason}) : ignorée, présence Discord aux valeurs par défaut"
                    );
                }
                if let Some(reason) = ignored_ai {
                    eprintln!(
                        "[menu-forge] section « ai » des réglages invalide ({reason}) : ignorée, fournisseurs d’IA désactivés"
                    );
                }
                return (settings, false, false);
            }
            settings::Loaded::Missing => (Settings::first_launch(&config.default_workspace, imported()), true),
            settings::Loaded::Unreadable { reason } => return read_only(format!("illisibles ({reason})")),
            settings::Loaded::Invalid { reason, backup: None } => {
                return read_only(format!("invalides ({reason}) et impossibles à mettre de côté"))
            }
            settings::Loaded::Invalid { reason, backup: Some(file) } => {
                eprintln!(
                    "[menu-forge] réglages invalides ({reason}) ; valeurs par défaut utilisées, ancien fichier mis de côté : {file}"
                );
                (Settings::first_launch(&config.default_workspace, imported()), false)
            }
        };
        if let Err(error) = settings::write_atomic(settings_path, settings.to_json().as_bytes()) {
            eprintln!("[menu-forge] réglages non enregistrés dans {settings_path} : {error}");
        }
        (settings, first_launch, false)
    }

    /// Réglages en lecture seule (fichier illisible laissé intact) : les
    /// modifications ne vivent qu’en mémoire.
    pub fn settings_read_only(&self) -> bool {
        self.settings_read_only
    }

    /// Arrête la Rich Presence : efface l’activité, ferme la connexion et
    /// arrête son fil, sans attendre plus de 2 s. À appeler à la sortie de
    /// l’appli (le `Backend`, partagé, n’est pas forcément libéré avant).
    pub fn stop_presence(&self) {
        self.presence.stop();
    }

    fn read_state(&self) -> RwLockReadGuard<'_, Runtime> {
        self.state.read().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn write_state(&self) -> RwLockWriteGuard<'_, Runtime> {
        self.state.write().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Racine résolue de l’espace de travail actif.
    pub fn workspace_root(&self) -> String {
        self.read_state().workspace.root().to_owned()
    }

    /// Bibliothèques retenues (identifiants valides, doublons fusionnés).
    pub fn libraries(&self) -> Vec<LibrarySource> {
        self.read_state().libraries.sources().cloned().collect()
    }

    /// Réglages vus par l’interface (remplacements de session appliqués).
    pub fn settings(&self) -> Settings {
        self.read_state().effective_settings()
    }

    pub fn settings_path(&self) -> &str {
        &self.settings_path
    }

    pub fn mode(&self) -> AppMode {
        self.mode
    }

    /// Le fichier de réglages n’existait pas au démarrage (premier lancement).
    pub fn first_launch(&self) -> bool {
        self.first_launch
    }

    /// Traite une requête `/api/…` (voir [`Request::path`]). Ne panique pas sur
    /// une entrée invalide : toute erreur devient une réponse texte.
    pub fn handle(&self, request: &Request) -> Response {
        match self.route(request) {
            Ok(response) => response,
            Err(error) => {
                if error.status == 500 {
                    eprintln!("[menu-forge] {}", error.message);
                }
                error.into()
            }
        }
    }

    fn route(&self, request: &Request) -> Result<Response, HttpError> {
        let pathname = paths::url_pathname(&request.path);
        let method = request.method.as_str();
        if let Some(response) = self.route_app(request, &pathname, method)? {
            return Ok(response);
        }
        if let Some(response) = self.route_ai(request, &pathname, method)? {
            return Ok(response);
        }
        // Instantané de l’état : un changement d’espace pendant la requête
        // ne la coupe pas en deux.
        let (workspace, libraries) = {
            let state = self.read_state();
            (Arc::clone(&state.workspace), Arc::clone(&state.libraries))
        };
        if let Some(response) = libraries.route(request, &pathname, method, workspace.textures_dir())? {
            return Ok(response);
        }
        workspace.route(request, &pathname, method)
    }
}
