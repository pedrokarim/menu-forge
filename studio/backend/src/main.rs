//! `studio-api` : serveur HTTP local qui expose le backend sous `/api`, pour le
//! mode navigateur (Vite le « proxifie ») et les tests automatiques.
//!
//! N’écoute que sur 127.0.0.1. Configuration : arguments, sinon variables
//! d’environnement, sinon valeurs par défaut relatives au dossier `studio/`.

use std::sync::Arc;

use studio_backend::{load_library_sources, paths, server, Backend, BackendConfig};

const DEFAULT_PORT: u16 = 5174;

const USAGE: &str = "\
studio-api : backend local du studio menu-forge (HTTP, 127.0.0.1 uniquement)

Options (chacune a sa variable d’environnement) :
  --port <n>          MENU_FORGE_API_PORT     port d’écoute (5174 ; 0 = port libre)
  --settings <file>   MENU_FORGE_SETTINGS     réglages persistants (<studio>/.cache/settings.json)
  --workspace <dir>   MENU_FORGE_WORKSPACE    espace de travail imposé pour la session, non enregistré
                                              (sinon celui des réglages ; au premier lancement <studio>/../examples)
  --libraries <file>  MENU_FORGE_LIBRARIES    bibliothèques imposées pour la session, non enregistrées
                                              (sinon celles des réglages, importées de <studio>/../libraries.local.json)
  --templates <dir>   MENU_FORGE_TEMPLATES    gabarits (<studio>/../templates)
  --cache <dir>       MENU_FORGE_CACHE        caches (<studio>/.cache)
  --studio-dir <dir>  MENU_FORGE_STUDIO_DIR   dossier studio/ servant de base aux valeurs par défaut
  --no-discord        MENU_FORGE_NO_DISCORD   sans l’application Discord par défaut (tests : jamais le vrai profil)
";

struct Options {
    port: u16,
    studio_dir: String,
    settings: Option<String>,
    workspace: Option<String>,
    libraries: Option<String>,
    templates: Option<String>,
    cache: Option<String>,
    no_discord: bool,
}

fn parse_options() -> Result<Options, String> {
    let env = |name: &str| std::env::var(name).ok().filter(|value| !value.is_empty());
    // Par défaut : le dossier parent de la crate (studio/), connu à la compilation.
    let mut studio_dir = env("MENU_FORGE_STUDIO_DIR")
        .unwrap_or_else(|| paths::resolve(&[env!("CARGO_MANIFEST_DIR"), ".."]));
    let mut port = env("MENU_FORGE_API_PORT");
    let mut settings = env("MENU_FORGE_SETTINGS");
    let mut workspace = env("MENU_FORGE_WORKSPACE");
    let mut libraries = env("MENU_FORGE_LIBRARIES");
    let mut templates = env("MENU_FORGE_TEMPLATES");
    let mut cache = env("MENU_FORGE_CACHE");
    let mut no_discord = env("MENU_FORGE_NO_DISCORD").is_some();

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "-h" || arg == "--help" {
            print!("{USAGE}");
            std::process::exit(0);
        }
        if arg == "--no-discord" {
            no_discord = true;
            continue;
        }
        let (name, inline) = match arg.split_once('=') {
            Some((name, value)) => (name.to_owned(), Some(value.to_owned())),
            None => (arg.clone(), None),
        };
        let value = match inline {
            Some(value) => value,
            None => args.next().ok_or_else(|| format!("valeur manquante pour {name}"))?,
        };
        match name.as_str() {
            "--port" => port = Some(value),
            "--settings" => settings = Some(value),
            "--workspace" => workspace = Some(value),
            "--libraries" => libraries = Some(value),
            "--templates" => templates = Some(value),
            "--cache" => cache = Some(value),
            "--studio-dir" => studio_dir = value,
            _ => return Err(format!("option inconnue : {name}")),
        }
    }
    let port = match port {
        Some(port) => port.parse().map_err(|_| format!("port invalide : {port}"))?,
        None => DEFAULT_PORT,
    };
    Ok(Options { port, studio_dir, settings, workspace, libraries, templates, cache, no_discord })
}

fn build_config(options: &Options) -> BackendConfig {
    let mut config = BackendConfig::defaults(&options.studio_dir);
    if let Some(settings) = &options.settings {
        config.settings_path = paths::resolve(&[settings]);
    }
    if let Some(workspace) = &options.workspace {
        config.workspace_override = Some(paths::resolve(&[workspace]));
    }
    if let Some(templates) = &options.templates {
        config.templates_root = paths::resolve(&[templates]);
    }
    if let Some(cache) = &options.cache {
        config.cache_dir = paths::resolve(&[cache]);
    }
    if let Some(file) = &options.libraries {
        config.libraries_override = Some(load_library_sources(&paths::resolve(&[file])));
    }
    if options.no_discord {
        config.discord_client_id = None;
    }
    config
}

fn main() {
    let options = match parse_options() {
        Ok(options) => options,
        Err(message) => {
            eprintln!("studio-api : {message}\n\n{USAGE}");
            std::process::exit(2);
        }
    };
    let backend = Arc::new(Backend::new(build_config(&options)));
    let handle = match server::serve(Arc::clone(&backend), options.port, None) {
        Ok(handle) => handle,
        Err(error) => {
            eprintln!("studio-api : impossible d’écouter ({error})");
            std::process::exit(1);
        }
    };

    println!("  menu-forge : API sur {}/api", handle.origin());
    println!("  menu-forge : réglages {}", backend.settings_path());
    println!("  menu-forge : espace de travail {}", backend.workspace_root());
    for library in backend.libraries() {
        println!("  menu-forge : bibliothèque « {} » ({})", library.name, library.root);
    }
    handle.wait();
}
