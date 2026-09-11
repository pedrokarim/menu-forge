//! Coquille Tauri du studio menu-forge.
//!
//! Au démarrage, l’appli lance le backend (`studio-backend`) **dans son propre
//! processus**, en HTTP sur 127.0.0.1, et ce même serveur sert aussi
//! l’interface : la page et `/api` partagent la même origine, l’interface
//! n’a donc rien à changer (ni CORS ni protocole maison).
//!
//! - Production : port libre (`127.0.0.1:0`), interface lue dans les assets
//!   embarqués (`asset_resolver`), fenêtre sur `http://127.0.0.1:<port>/`.
//! - Développement (`tauri dev`) : fenêtre sur le serveur Vite
//!   (`http://localhost:5173`), backend sur 5174 pour le proxy de Vite.
//!
//! Un écran de démarrage (`/splash.html`, servi par le même serveur) reste
//! affiché au moins 1,8 s, jusqu’à ce que la page principale ait fini de
//! charger (20 s au plus : jamais de splash bloqué).
//!
//! Le port réel est écrit dans `<app_cache_dir>/server.json` au démarrage.
//!
//! Rich Presence Discord : permise, avec l’application officielle tant
//! qu’aucune autre n’est réglée ; à la sortie, la présence est effacée
//! (`Backend::stop_presence`, 2 s au plus) avant l’arrêt du serveur.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use studio_backend::server::{self, ServerHandle, StaticFile, StaticFiles};
use studio_backend::{paths, workspace, AppMode, Backend, BackendConfig};
use tauri::webview::PageLoadEvent;
use tauri::window::Color;
use tauri::{AppHandle, Manager, RunEvent, Theme, Url, WebviewUrl, WebviewWindowBuilder};

/// Port du backend en développement : celui vers lequel Vite « proxifie » `/api`.
const DEV_API_PORT: u16 = 5174;
/// Durée minimale d’affichage du splash (pour qu’on voie l’animation).
const SPLASH_MIN: Duration = Duration::from_millis(1800);
/// Au-delà, la fenêtre principale s’affiche même si sa page n’a pas fini de charger.
const SPLASH_TIMEOUT: Duration = Duration::from_secs(20);
const MAIN_BACKGROUND: Color = Color(0x1b, 0x1c, 0x21, 0xff);
const SPLASH_BACKGROUND: Color = Color(0x0b, 0x0b, 0x0e, 0xff);

type BoxError = Box<dyn std::error::Error>;

/// Serveur local et backend, arrêtés à la sortie de l’appli.
struct ApiServer {
    server: Mutex<Option<ServerHandle>>,
    backend: Arc<Backend>,
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// `libraries.local.json` à importer au premier lancement : variable
/// `MENU_FORGE_LIBRARIES`, sinon à côté des réglages, sinon celui du dépôt
/// (chemin connu à la compilation, utile sur la machine de développement).
fn legacy_libraries_file(config_dir: &Path) -> Option<String> {
    let candidates = [
        std::env::var("MENU_FORGE_LIBRARIES").ok().filter(|value| !value.is_empty()).map(PathBuf::from),
        Some(config_dir.join("libraries.local.json")),
        Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../libraries.local.json")),
    ];
    candidates.into_iter().flatten().find(|file| file.is_file()).map(|file| paths::resolve(&[&path_text(&file)]))
}

fn setup(app: &mut tauri::App) -> Result<(), BoxError> {
    let path = app.path();
    let config_dir = path.app_config_dir()?;
    let cache_dir = path.app_cache_dir()?;
    let default_workspace = path.document_dir()?.join("menu-forge");
    let templates_root = path.resource_dir()?.join("templates");
    let settings_path = config_dir.join("settings.json");
    std::fs::create_dir_all(&config_dir)?;
    std::fs::create_dir_all(&cache_dir)?;
    // Premier lancement : l’espace par défaut est créé s’il n’existe pas.
    if !settings_path.exists() {
        std::fs::create_dir_all(&default_workspace)?;
        workspace::ensure_layout(&path_text(&default_workspace))?;
    }

    let config = BackendConfig {
        mode: AppMode::Tauri,
        app_version: app.package_info().version.to_string(),
        settings_path: path_text(&settings_path),
        default_workspace: path_text(&default_workspace),
        legacy_libraries_file: legacy_libraries_file(&config_dir),
        templates_root: path_text(&templates_root),
        cache_dir: path_text(&cache_dir),
        workspace_override: None,
        libraries_override: None,
        // Rich Presence : l’application officielle menu-forge tant qu’aucune autre n’est réglée.
        discord_client_id: Some(studio_backend::presence::DEFAULT_CLIENT_ID.to_owned()),
        presence: true,
    };
    let backend = Arc::new(Backend::new(config));

    let dev = tauri::is_dev();
    let static_files: Option<StaticFiles> = if dev {
        None
    } else {
        let handle = app.handle().clone();
        Some(Arc::new(move |file: &str| {
            handle
                .asset_resolver()
                .get(file.to_owned())
                .map(|asset| StaticFile { body: asset.bytes, content_type: asset.mime_type })
        }))
    };
    let port = if dev { DEV_API_PORT } else { 0 };
    let server = server::serve(Arc::clone(&backend), port, static_files).map_err(|error| {
        let hint = if dev { " (studio-api tourne-t-il déjà sur 5174 ?)" } else { "" };
        format!("backend local non démarré : {error}{hint}")
    })?;
    let origin: Url = if dev {
        app.config().build.dev_url.clone().ok_or("devUrl absent de tauri.conf.json")?
    } else {
        format!("{}/", server.origin()).parse()?
    };

    let info = format!(
        "{{\"port\":{},\"pid\":{},\"api\":\"{}/api\",\"ui\":\"{origin}\"}}\n",
        server.port(),
        std::process::id(),
        server.origin()
    );
    if let Err(error) = std::fs::write(cache_dir.join("server.json"), info) {
        eprintln!("[menu-forge] server.json non écrit : {error}");
    }
    eprintln!("[menu-forge] API sur {}/api, interface sur {origin}", server.origin());
    eprintln!("[menu-forge] réglages {}", backend.settings_path());
    app.manage(ApiServer { server: Mutex::new(Some(server)), backend });

    open_windows(app.handle(), &origin)
}

fn same_origin(url: &Url, origin: &Url) -> bool {
    url.scheme() == origin.scheme()
        && url.host_str() == origin.host_str()
        && url.port_or_known_default() == origin.port_or_known_default()
}

/// Ouvre le splash, puis la fenêtre principale cachée ; la principale
/// s’affiche quand sa page a fini de charger (et pas avant 1,8 s).
fn open_windows(app: &AppHandle, origin: &Url) -> Result<(), BoxError> {
    let started = Instant::now();
    let revealed = Arc::new(AtomicBool::new(false));

    let splash_origin = origin.clone();
    WebviewWindowBuilder::new(app, "splash", WebviewUrl::External(origin.join("splash.html")?))
        .title("menu-forge")
        .inner_size(320.0, 440.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .center()
        .always_on_top(true)
        .skip_taskbar(true)
        .background_color(SPLASH_BACKGROUND)
        .theme(Some(Theme::Dark))
        .on_navigation(move |url| same_origin(url, &splash_origin))
        .build()?;

    let main_origin = origin.clone();
    let on_load = Arc::clone(&revealed);
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(origin.clone()))
        .title("menu-forge · studio")
        .inner_size(1440.0, 900.0)
        // Rail d’écrans + trois colonnes de l’éditeur : en dessous, la toile n’a plus la place de ses outils.
        .min_inner_size(1180.0, 700.0)
        // Barre de titre maison (logo, écran en cours, boutons de fenêtre) dessinée par l’interface.
        .decorations(false)
        .center()
        .visible(false)
        .background_color(MAIN_BACKGROUND)
        .theme(Some(Theme::Dark))
        // L’interface ne quitte jamais son origine (l’IPC des plugins n’est
        // autorisé que pour elle).
        .on_navigation(move |url| same_origin(url, &main_origin))
        // Glisser-déposer : sans cela, le webview garde pour lui les fichiers
        // lâchés depuis l’explorateur (événements `tauri://drag-drop`, avec
        // des chemins) et la page ne reçoit rien. Désactivé, les événements
        // HTML5 (`dragover`, `drop`, fichiers compris) arrivent à la page,
        // exactement comme en mode navigateur : un seul code pour les deux.
        .disable_drag_drop_handler()
        .on_page_load(move |window, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let delay = SPLASH_MIN.saturating_sub(started.elapsed());
                reveal_after(window.app_handle().clone(), Arc::clone(&on_load), delay);
            }
        })
        .build()?;

    reveal_after(app.clone(), revealed, SPLASH_TIMEOUT);
    Ok(())
}

/// Après `delay`, affiche la fenêtre principale, lui donne le focus et ferme
/// le splash ; une seule fois, quel que soit le premier appel à arriver.
fn reveal_after(app: AppHandle, revealed: Arc<AtomicBool>, delay: Duration) {
    thread::spawn(move || {
        thread::sleep(delay);
        if revealed.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.show();
            let _ = main.unminimize();
            let _ = main.set_focus();
        }
        if let Some(splash) = app.get_webview_window("splash") {
            let _ = splash.close();
        }
    });
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| setup(app))
        .build(tauri::generate_context!())
        .expect("impossible de démarrer menu-forge");
    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            let Some(state) = handle.try_state::<ApiServer>() else { return };
            // D’abord la présence Discord (effacée, 2 s au plus), puis le serveur.
            state.backend.stop_presence();
            let server = state.server.lock().ok().and_then(|mut server| server.take());
            if let Some(server) = server {
                server.shutdown();
            }
        }
    });
}
