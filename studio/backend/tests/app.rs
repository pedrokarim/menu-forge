//! Tests des routes de l’application (réglages, espaces de travail,
//! documents récents, bibliothèques) et du serveur HTTP, sur des dossiers
//! temporaires.

use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use serde_json::{json, Value};
use studio_backend::server::{self, StaticFile, StaticFiles};
use studio_backend::{AppMode, Backend, BackendConfig, LibrarySource, Ownership, Request};

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// Dossier temporaire supprimé à la fin du test.
struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "studio-backend-{name}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    fn path(&self, relative: &str) -> PathBuf {
        self.0.join(relative)
    }

    fn text(&self, relative: &str) -> String {
        self.path(relative).to_string_lossy().into_owned()
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn config(dir: &TempDir) -> BackendConfig {
    fs::create_dir_all(dir.path("default")).unwrap();
    BackendConfig {
        mode: AppMode::Browser,
        app_version: "9.9.9".into(),
        settings_path: dir.text("config/settings.json"),
        default_workspace: dir.text("default"),
        legacy_libraries_file: Some(dir.text("libraries.local.json")),
        templates_root: dir.text("templates"),
        cache_dir: dir.text("cache"),
        workspace_override: None,
        libraries_override: None,
    }
}

/// PNG minimal (en-tête IHDR suffisant pour l’index : 16 × 8).
fn png() -> Vec<u8> {
    let mut data = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R'];
    data.extend_from_slice(&16u32.to_be_bytes());
    data.extend_from_slice(&8u32.to_be_bytes());
    data
}

/// Resource pack extrait avec une texture.
fn make_pack(dir: &TempDir, name: &str) -> String {
    let textures = dir.path(&format!("{name}/assets/minecraft/textures/ui"));
    fs::create_dir_all(&textures).unwrap();
    fs::write(textures.join("a.png"), png()).unwrap();
    dir.text(name)
}

fn call(backend: &Backend, method: &str, path: &str, body: Value) -> (u16, Value, String) {
    let bytes = if body.is_null() { Vec::new() } else { serde_json::to_vec(&body).unwrap() };
    let response = backend.handle(&Request::new(method, path, bytes));
    let text = String::from_utf8_lossy(&response.body).into_owned();
    let value = serde_json::from_str(&text).unwrap_or(Value::Null);
    (response.status, value, text)
}

fn saved_settings(dir: &TempDir) -> Value {
    serde_json::from_slice(&fs::read(dir.path("config/settings.json")).unwrap()).unwrap()
}

fn same(a: &str, b: &Path) -> bool {
    let b = b.to_string_lossy();
    if cfg!(windows) { a.eq_ignore_ascii_case(&b) } else { a == b }
}

#[test]
fn first_launch_imports_libraries_and_persists_atomically() {
    let dir = TempDir::new("first");
    make_pack(&dir, "packs/vanilla");
    fs::write(
        dir.path("libraries.local.json"),
        r#"[{"id":"vanilla","name":"Vanilla","root":"packs/vanilla","ownership":"own"},{"id":"Bad","root":"x"}]"#,
    )
    .unwrap();
    let backend = Backend::new(config(&dir));
    assert!(backend.first_launch());
    assert_eq!(call(&backend, "GET", "/app", Value::Null).1["firstLaunch"], true);

    let (status, settings, _) = call(&backend, "GET", "/settings", Value::Null);
    assert_eq!(status, 200);
    assert_eq!(settings["version"], 1);
    assert!(same(settings["activeWorkspace"].as_str().unwrap(), &dir.path("default")));
    assert_eq!(settings["libraries"].as_array().unwrap().len(), 1);
    assert!(same(settings["libraries"][0]["root"].as_str().unwrap(), &dir.path("packs").join("vanilla")));
    assert_eq!(settings["ui"], json!({"defaultZoom": 0, "showGrid": true, "confirmations": {"delete": true, "discardChanges": true}}));
    assert_eq!(settings["export"], json!({"enderiumResources": null, "namespace": "menuforge", "packFormat": 46}));
    assert_eq!(settings["discord"], json!({"enabled": true, "clientId": null, "showDocument": true}));
    assert_eq!(saved_settings(&dir), settings);
    // Écriture atomique : aucun fichier temporaire ne reste.
    let leftovers: Vec<_> = fs::read_dir(dir.path("config")).unwrap().map(|entry| entry.unwrap().file_name()).collect();
    assert_eq!(leftovers, ["settings.json"]);

    // Relancement : les réglages priment, l’ancien fichier n’est plus relu.
    fs::remove_file(dir.path("libraries.local.json")).unwrap();
    let backend = Backend::new(config(&dir));
    assert_eq!(call(&backend, "GET", "/settings", Value::Null).1, settings);
    let (_, app, _) = call(&backend, "GET", "/app", Value::Null);
    assert_eq!(app["name"], "menu-forge");
    assert_eq!(app["version"], "9.9.9");
    assert_eq!(app["mode"], "browser");
    assert_eq!(app["platform"], std::env::consts::OS);
    assert!(same(app["settingsPath"].as_str().unwrap(), &dir.path("config").join("settings.json")));
    assert_eq!(app["overrides"], json!([]));
    assert_eq!(app["firstLaunch"], false);
    assert!(!backend.first_launch());
}

#[test]
fn invalid_settings_file_is_set_aside() {
    let dir = TempDir::new("invalid");
    fs::create_dir_all(dir.path("config")).unwrap();
    fs::write(dir.path("config/settings.json"), r#"{"ui":{"defaultZoom":99}}"#).unwrap();
    let backend = Backend::new(config(&dir));
    assert_eq!(call(&backend, "GET", "/settings", Value::Null).1["ui"]["defaultZoom"], 0);
    // Un fichier invalide existait : ce n’est pas un premier lancement.
    assert_eq!(call(&backend, "GET", "/app", Value::Null).1["firstLaunch"], false);
    let names: Vec<String> = fs::read_dir(dir.path("config"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names.len(), 2, "{names:?}");
    assert!(names.iter().any(|name| name.starts_with("settings.invalid-")));
}

#[test]
fn put_settings_validates_and_applies() {
    let dir = TempDir::new("put");
    let backend = Backend::new(config(&dir));
    let (_, before, _) = call(&backend, "GET", "/settings", Value::Null);

    let (status, after, _) = call(&backend, "PUT", "/settings", json!({"ui": {"defaultZoom": 5, "confirmations": {"delete": false}}}));
    assert_eq!(status, 200);
    assert_eq!(after["ui"], json!({"defaultZoom": 5, "showGrid": true, "confirmations": {"delete": false, "discardChanges": true}}));
    assert_eq!(saved_settings(&dir)["ui"]["defaultZoom"], 5);

    let refused = [
        (json!({"ui": {"defaultZoom": "grand"}}), "« ui.defaultZoom » doit être un entier entre 0 et 12"),
        (json!({"ui": {"defaultZoom": 13}}), "« ui.defaultZoom » doit être un entier entre 0 et 12"),
        (json!({"couleur": "bleu"}), "Réglage inconnu : « couleur »"),
        (json!(["x"]), "Le corps de la requête doit être un objet JSON"),
        (json!({"export": {"enderiumResources": dir.text("absent")}}), "« export.enderiumResources » : dossier introuvable"),
        (json!({"export": {"enderiumResources": "relatif"}}), "« export.enderiumResources » doit être un chemin absolu"),
        (json!({"activeWorkspace": dir.text("absent")}), "« activeWorkspace » : dossier introuvable"),
        (json!({"libraries": [{"id": "x", "root": dir.text("default")}]}), "« libraries[0].root » : ce dossier ne contient pas de dossier assets/"),
    ];
    for (patch, expected) in refused {
        let (status, _, message) = call(&backend, "PUT", "/settings", patch.clone());
        assert_eq!(status, 400, "{patch}");
        assert!(message.starts_with(expected), "{patch} → {message}");
    }
    let response = backend.handle(&Request::new("PUT", "/settings", b"pas du json".to_vec()));
    assert_eq!((response.status, response.body.as_slice()), (400, "JSON invalide".as_bytes()));
    // Rien n’a changé après les refus.
    assert_eq!(saved_settings(&dir)["ui"]["defaultZoom"], 5);

    // Aller-retour : renvoyer ce qu’on a lu ne change rien.
    let (status, round_trip, _) = call(&backend, "PUT", "/settings", after.clone());
    assert_eq!(status, 200);
    assert_eq!(round_trip, after);
    assert_ne!(before["ui"], after["ui"]);

    // Export : chemin existant accepté, `null` pour l’oublier.
    let resources = dir.path("resources");
    fs::create_dir_all(&resources).unwrap();
    let (status, next, _) = call(&backend, "PUT", "/settings", json!({"export": {"enderiumResources": resources, "packFormat": 32, "namespace": "enderium"}}));
    assert_eq!(status, 200);
    assert_eq!(next["export"]["packFormat"], 32);
    assert_eq!(next["export"]["namespace"], "enderium");
    let (_, next, _) = call(&backend, "PUT", "/settings", json!({"export": {"enderiumResources": null}}));
    assert_eq!(next["export"]["enderiumResources"], Value::Null);

    // Changer d’espace actif par les réglages équivaut à l’ouvrir.
    let other = dir.path("other");
    fs::create_dir_all(&other).unwrap();
    let (status, next, _) = call(&backend, "PUT", "/settings", json!({"activeWorkspace": other}));
    assert_eq!(status, 200);
    assert!(same(next["activeWorkspace"].as_str().unwrap(), &other));
    assert!(other.join("menus").is_dir() && other.join("assets").is_dir() && other.join("textures").is_dir());
    assert!(same(&backend.workspace_root(), &other));
}

#[test]
fn settings_file_without_discord_section_is_read_with_defaults() {
    let dir = TempDir::new("no-discord");
    fs::create_dir_all(dir.path("config")).unwrap();
    let old = json!({
        "version": 1,
        "activeWorkspace": dir.text("default"),
        "workspaces": [],
        "libraries": [],
        "ui": {"defaultZoom": 3, "showGrid": false, "confirmations": {"delete": true, "discardChanges": true}},
        "export": {"enderiumResources": null, "namespace": "menuforge", "packFormat": 46}
    });
    fs::write(dir.path("config/settings.json"), old.to_string()).unwrap();
    let backend = Backend::new(config(&dir));
    let (_, settings, _) = call(&backend, "GET", "/settings", Value::Null);
    assert_eq!(settings["ui"]["defaultZoom"], 3);
    assert_eq!(settings["discord"], json!({"enabled": true, "clientId": null, "showDocument": true}));
    assert_eq!(call(&backend, "GET", "/app", Value::Null).1["firstLaunch"], false);
    let names: Vec<_> = fs::read_dir(dir.path("config")).unwrap().map(|entry| entry.unwrap().file_name()).collect();
    assert_eq!(names, ["settings.json"], "rien n’est mis de côté");
}

#[test]
fn presence_routes_and_discord_settings() {
    let dir = TempDir::new("presence");
    let backend = Backend::new(config(&dir));

    let (status, presence, _) = call(&backend, "GET", "/presence", Value::Null);
    assert_eq!(status, 200);
    assert_eq!(presence, json!({"enabled": true, "configured": false, "connected": false, "error": null}));

    // Activité retenue même sans Discord (appliquée à la connexion).
    let activity = json!({"details": "Menu : boutique", "state": "12 zones", "genericDetails": "Édite un menu"});
    let (status, _, body) = call(&backend, "PUT", "/presence", activity);
    assert_eq!((status, body.as_str()), (204, ""));
    assert_eq!(call(&backend, "PUT", "/presence", json!({"details": "x".repeat(500)})).0, 204);
    // Petite image (médaillon) : une clé connue et son texte de survol.
    for key in ["menu", "asset", "home", "library", "settings", "workspace", "about"] {
        let body = json!({"details": "Édite le menu « Profil »", "smallImage": key, "smallText": "x".repeat(300)});
        assert_eq!(call(&backend, "PUT", "/presence", body).0, 204, "{key}");
    }
    let body = json!({"details": "Sur l’accueil", "smallImage": null, "smallText": null});
    assert_eq!(call(&backend, "PUT", "/presence", body).0, 204);
    for (body, expected) in [
        (json!(["x"]), "Le corps de la requête doit être un objet JSON"),
        (json!({}), "« details » est obligatoire (texte non vide)"),
        (json!({"details": ""}), "« details » est obligatoire (texte non vide)"),
        (json!({"details": 3}), "« details » est obligatoire (texte non vide)"),
        (json!({"details": "ok", "state": 1}), "« state » doit être un texte"),
        (json!({"details": "ok", "extra": 1}), "Champ inconnu : « extra »"),
        (
            json!({"details": "ok", "smallImage": "logo"}),
            "« smallImage » doit valoir null ou une clé parmi : menu, asset, home, library, settings, workspace, about",
        ),
        (json!({"details": "ok", "smallImage": ["menu"]}), "« smallImage » doit valoir null ou une clé parmi"),
        (json!({"details": "ok", "smallText": 3}), "« smallText » doit être un texte"),
        (json!({"details": "ok", "large_image": "x"}), "Champ inconnu : « large_image »"),
    ] {
        let (status, _, message) = call(&backend, "PUT", "/presence", body.clone());
        assert_eq!(status, 400, "{body}");
        assert!(message.starts_with(expected), "{body} → {message}");
    }
    let response = backend.handle(&Request::new("PUT", "/presence", b"pas du json".to_vec()));
    assert_eq!((response.status, response.body.as_slice()), (400, "JSON invalide".as_bytes()));

    // Réglages : désactiver d’abord (pas de vraie connexion pendant les tests).
    let (status, settings, _) = call(&backend, "PUT", "/settings", json!({"discord": {"enabled": false}}));
    assert_eq!(status, 200);
    assert_eq!(settings["discord"], json!({"enabled": false, "clientId": null, "showDocument": true}));
    let (status, settings, _) =
        call(&backend, "PUT", "/settings", json!({"discord": {"clientId": "123456789012345678", "showDocument": false}}));
    assert_eq!(status, 200);
    assert_eq!(settings["discord"], json!({"enabled": false, "clientId": "123456789012345678", "showDocument": false}));
    assert_eq!(saved_settings(&dir)["discord"], settings["discord"]);
    let (_, presence, _) = call(&backend, "GET", "/presence", Value::Null);
    assert_eq!(presence, json!({"enabled": false, "configured": true, "connected": false, "error": null}));

    for (patch, expected) in [
        (json!({"discord": {"clientId": "abc"}}), "« discord.clientId » doit valoir null ou un identifiant d’application Discord"),
        (json!({"discord": {"clientId": 123456789012345678u64}}), "« discord.clientId » doit valoir null"),
        (json!({"discord": {"enabled": "oui"}}), "« discord.enabled » doit valoir true ou false"),
        (json!({"discord": {"secret": 1}}), "Réglage inconnu : « discord.secret »"),
    ] {
        let (status, _, message) = call(&backend, "PUT", "/settings", patch.clone());
        assert_eq!(status, 400, "{patch}");
        assert!(message.starts_with(expected), "{patch} → {message}");
    }
    assert_eq!(saved_settings(&dir)["discord"]["clientId"], "123456789012345678");

    // Oublier l’identifiant : plus configuré.
    let (_, settings, _) = call(&backend, "PUT", "/settings", json!({"discord": {"clientId": null}}));
    assert_eq!(settings["discord"]["clientId"], Value::Null);
    assert_eq!(call(&backend, "GET", "/presence", Value::Null).1["configured"], false);
}

#[test]
fn workspaces_open_switch_and_forget() {
    let dir = TempDir::new("workspaces");
    let backend = Backend::new(config(&dir));
    fs::write(dir.path("file.txt"), "x").unwrap();

    for (body, expected) in [
        (json!({"path": "relatif/ws"}), "« path » doit être un chemin absolu"),
        (json!({"path": dir.text("absent")}), "« path » : dossier introuvable"),
        (json!({"path": dir.text("file.txt")}), "« path » n’est pas un dossier"),
        (json!({}), "« path » doit être un chemin (texte)"),
        (json!({"path": dir.text("default"), "name": ""}), "« name » doit être un texte non vide"),
    ] {
        let (status, _, message) = call(&backend, "POST", "/workspaces/open", body.clone());
        assert_eq!(status, 400, "{body}");
        assert!(message.starts_with(expected), "{body} → {message}");
    }
    assert!(!dir.path("absent").exists());

    let second = dir.path("second");
    fs::create_dir_all(&second).unwrap();
    let (status, opened, _) = call(&backend, "POST", "/workspaces/open", json!({"path": second, "name": "Mon espace"}));
    assert_eq!(status, 200);
    assert_eq!(opened["name"], "Mon espace");
    assert_eq!(opened["active"], true);
    assert_eq!((opened["menus"].as_u64(), opened["exists"].as_bool()), (Some(0), Some(true)));
    for sub in ["menus", "assets", "textures"] {
        assert!(second.join(sub).is_dir(), "{sub}");
    }

    // Changement à chaud : les routes historiques suivent l’espace actif.
    let (_, snapshot, _) = call(&backend, "GET", "/workspace", Value::Null);
    assert!(same(snapshot["root"].as_str().unwrap(), &second));
    let (status, _, _) = call(&backend, "PUT", "/menus/essai", json!({"id": "essai", "name": "Essai"}));
    assert_eq!(status, 204);
    assert!(second.join("menus/essai.menu.json").is_file());
    let response = backend.handle(&Request::new("PUT", "/textures/x/y.png", png()));
    assert_eq!(response.status, 204);

    let (_, list, _) = call(&backend, "GET", "/workspaces", Value::Null);
    assert!(same(list["active"].as_str().unwrap(), &second));
    let entries = list["workspaces"].as_array().unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0]["name"], "Mon espace");
    assert_eq!((entries[0]["menus"].as_u64(), entries[0]["textures"].as_u64()), (Some(1), Some(1)));
    assert_eq!(entries[1]["active"], false);
    assert!(entries[0]["lastOpened"].as_str().unwrap() >= entries[1]["lastOpened"].as_str().unwrap());

    // Retirer : jamais l’espace actif, jamais de suppression de fichiers.
    let (status, _, message) = call(&backend, "DELETE", "/workspaces", json!({"path": second}));
    assert_eq!(status, 409, "{message}");
    let (status, _, _) = call(&backend, "DELETE", "/workspaces", json!({"path": dir.text("default")}));
    assert_eq!(status, 204);
    assert!(dir.path("default").is_dir());
    let (status, _, message) = call(&backend, "DELETE", "/workspaces", json!({"path": dir.text("default")}));
    assert_eq!(status, 404);
    assert!(message.starts_with("Espace de travail inconnu"), "{message}");
    assert_eq!(saved_settings(&dir)["workspaces"].as_array().unwrap().len(), 1);

    // Un dossier supprimé à la main reste listé, marqué absent.
    let third = dir.path("third");
    fs::create_dir_all(&third).unwrap();
    call(&backend, "POST", "/workspaces/open", json!({"path": third}));
    call(&backend, "POST", "/workspaces/open", json!({"path": second}));
    fs::remove_dir_all(&third).unwrap();
    let (_, list, _) = call(&backend, "GET", "/workspaces", Value::Null);
    let missing = list["workspaces"].as_array().unwrap().iter().find(|entry| entry["name"] == "third").unwrap();
    assert_eq!(missing["exists"], false);
}

#[test]
fn recent_documents_are_sorted_by_modification() {
    let dir = TempDir::new("recent");
    let backend = Backend::new(config(&dir));
    let root = dir.path("default");
    fs::create_dir_all(root.join("menus")).unwrap();
    fs::create_dir_all(root.join("assets")).unwrap();
    let write = |relative: &str, content: &str, age: u64| {
        let file = root.join(relative);
        fs::write(&file, content).unwrap();
        let time = SystemTime::now() - Duration::from_secs(age);
        fs::File::options().write(true).open(&file).unwrap().set_modified(time).unwrap();
    };
    write("menus/old.menu.json", r#"{"id":"old","name":"Ancien"}"#, 3600);
    write("assets/button.asset.json", r#"{"id":"button","name":"Bouton"}"#, 60);
    write("menus/broken.menu.json", "{", 600);
    write("menus/notes.txt", "x", 0);

    let (status, list, _) = call(&backend, "GET", "/documents/recent", Value::Null);
    assert_eq!(status, 200);
    let summary: Vec<(String, String, String)> = list
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| (entry["type"].as_str().unwrap().into(), entry["id"].as_str().unwrap().into(), entry["name"].as_str().unwrap().into()))
        .collect();
    assert_eq!(
        summary,
        [
            ("asset".into(), "button".into(), "Bouton".into()),
            ("menu".into(), "broken".into(), "broken".into()),
            ("menu".into(), "old".into(), "Ancien".into()),
        ]
    );
    let modified = list[0]["modified"].as_str().unwrap();
    assert!(modified.ends_with('Z') && modified.len() == 24, "{modified}");
}

#[test]
fn libraries_add_remove_reindex_keep_memory_index() {
    let dir = TempDir::new("libraries");
    let backend = Backend::new(config(&dir));
    let pack = make_pack(&dir, "pack");

    let body = json!({"id": "maison", "name": "Pack maison", "root": pack, "ownership": "own"});
    let (status, added, _) = call(&backend, "POST", "/libraries", body.clone());
    assert_eq!(status, 200);
    assert_eq!(added["ownership"], "own");
    let (status, _, message) = call(&backend, "POST", "/libraries", body);
    assert_eq!(status, 409, "{message}");
    for (body, expected) in [
        (json!({"id": "x", "root": dir.text("default")}), "« root » : ce dossier ne contient pas de dossier assets/"),
        (json!({"id": "x", "root": "pack"}), "« root » doit être un chemin absolu"),
        (json!({"id": "Pas Bon", "root": pack}), "« id » invalide"),
        (json!({"id": "x", "root": pack, "ownership": "moi"}), "« ownership » doit valoir"),
        (json!({"id": "x", "root": pack, "extra": 1}), "Réglage inconnu : « extra »"),
    ] {
        let (status, _, message) = call(&backend, "POST", "/libraries", body.clone());
        assert_eq!(status, 400, "{body}");
        assert!(message.starts_with(expected), "{body} → {message}");
    }
    let (_, list, _) = call(&backend, "GET", "/libraries", Value::Null);
    assert_eq!(list, json!([{"id": "maison", "name": "Pack maison", "ownership": "own"}]));
    assert_eq!(saved_settings(&dir)["libraries"][0]["id"], "maison");

    let count = |backend: &Backend| call(backend, "GET", "/libraries/maison/index", Value::Null).1["textures"].as_array().map(Vec::len);
    assert_eq!(count(&backend), Some(1));
    fs::write(dir.path("pack/assets/minecraft/textures/ui/b.png"), png()).unwrap();

    // Changer d’espace ou ajouter une autre bibliothèque garde l’index en mémoire.
    let other = dir.path("other");
    fs::create_dir_all(&other).unwrap();
    call(&backend, "POST", "/workspaces/open", json!({"path": other}));
    let second_pack = make_pack(&dir, "pack2");
    call(&backend, "POST", "/libraries", json!({"id": "autre", "root": second_pack}));
    assert_eq!(count(&backend), Some(1));

    // Les imports vont dans l’espace actif.
    let (status, imported, _) =
        call(&backend, "POST", "/libraries/maison/import", json!({"path": "assets/minecraft/textures/ui/a.png"}));
    assert_eq!(status, 200);
    assert_eq!(imported["texture"], "library/maison/minecraft/textures/ui/a.png");
    assert!(other.join("textures/library/maison/minecraft/textures/ui/a.png").is_file());

    let (status, summary, _) = call(&backend, "POST", "/libraries/maison/reindex", Value::Null);
    assert_eq!(status, 200);
    assert_eq!(summary, json!({"id": "maison", "textures": 2, "fonts": 0}));
    assert_eq!(count(&backend), Some(2));
    assert_eq!(call(&backend, "POST", "/libraries/nope/reindex", Value::Null).0, 404);

    assert_eq!(call(&backend, "DELETE", "/libraries/maison", Value::Null).0, 204);
    let (status, _, message) = call(&backend, "GET", "/libraries/maison/index", Value::Null);
    assert_eq!((status, message.as_str()), (404, "Bibliothèque inconnue : maison"));
    assert_eq!(call(&backend, "DELETE", "/libraries/maison", Value::Null).0, 404);
    assert!(dir.path("pack/assets").is_dir(), "le pack n’est jamais supprimé");
    assert_eq!(saved_settings(&dir)["libraries"].as_array().unwrap().len(), 1);
}

#[test]
fn session_overrides_are_not_persisted() {
    let dir = TempDir::new("overrides");
    let session = dir.path("session");
    fs::create_dir_all(&session).unwrap();
    let pack = make_pack(&dir, "pack");
    let mut config = config(&dir);
    config.workspace_override = Some(session.to_string_lossy().into_owned());
    config.libraries_override =
        Some(vec![LibrarySource { id: "tmp".into(), name: "Tmp".into(), root: pack, ownership: Ownership::ThirdParty }]);
    let backend = Backend::new(config);

    let (_, app, _) = call(&backend, "GET", "/app", Value::Null);
    assert_eq!(app["overrides"], json!(["activeWorkspace", "libraries"]));
    assert!(same(&backend.workspace_root(), &session));
    let (_, settings, _) = call(&backend, "GET", "/settings", Value::Null);
    assert!(same(settings["activeWorkspace"].as_str().unwrap(), &session));
    assert_eq!(settings["libraries"][0]["id"], "tmp");
    let saved = saved_settings(&dir);
    assert!(same(saved["activeWorkspace"].as_str().unwrap(), &dir.path("default")));
    assert_eq!(saved["libraries"], json!([]));
    assert!(!session.join("menus").exists(), "rien n’est créé dans l’espace imposé");

    // Aller-retour complet : les remplacements restent hors du fichier.
    let (status, _, _) = call(&backend, "PUT", "/settings", settings.clone());
    assert_eq!(status, 200);
    let saved = saved_settings(&dir);
    assert!(same(saved["activeWorkspace"].as_str().unwrap(), &dir.path("default")));
    assert_eq!(saved["libraries"], json!([]));
    assert_eq!(saved["workspaces"].as_array().unwrap().len(), 1);

    // Ouvrir un espace par l’API met fin au remplacement.
    call(&backend, "POST", "/workspaces/open", json!({"path": dir.path("default")}));
    let (_, app, _) = call(&backend, "GET", "/app", Value::Null);
    assert_eq!(app["overrides"], json!(["libraries"]));
    assert!(same(&backend.workspace_root(), &dir.path("default")));
    // Modifier les bibliothèques part de la liste vue et l’enregistre.
    assert_eq!(call(&backend, "DELETE", "/libraries/tmp", Value::Null).0, 204);
    assert_eq!(call(&backend, "GET", "/app", Value::Null).1["overrides"], json!([]));
    assert_eq!(saved_settings(&dir)["libraries"], json!([]));
}

#[test]
fn legacy_behaviour_on_other_methods_is_unchanged() {
    let dir = TempDir::new("legacy");
    let backend = Backend::new(config(&dir));
    for (method, path) in [
        ("POST", "/app"),
        ("DELETE", "/settings"),
        ("PUT", "/workspaces"),
        ("GET", "/workspaces/open"),
        ("POST", "/documents/recent"),
        ("PUT", "/libraries"),
        ("GET", "/libraries/vanilla/reindex"),
        ("PUT", "/libraries/vanilla"),
        ("POST", "/presence"),
        ("DELETE", "/presence"),
    ] {
        let (status, _, message) = call(&backend, method, path, Value::Null);
        assert_eq!((status, message), (404, format!("Route inconnue : {method} {path}")));
    }
}

fn http(port: u16, raw: &str) -> Option<(u16, String, Vec<u8>)> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    stream.write_all(raw.as_bytes()).ok()?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).ok()?;
    let split = response.windows(4).position(|window| window == b"\r\n\r\n")?;
    let head = String::from_utf8_lossy(&response[..split]).into_owned();
    let status = head.split(' ').nth(1)?.parse().ok()?;
    Some((status, head, response[split + 4..].to_vec()))
}

fn get(port: u16, path: &str, host: &str) -> (u16, String, Vec<u8>) {
    http(port, &format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n")).expect("réponse HTTP")
}

#[test]
fn server_serves_api_and_interface_on_one_origin() {
    let dir = TempDir::new("server");
    let backend = Arc::new(Backend::new(config(&dir)));
    let files: StaticFiles = Arc::new(|path: &str| {
        let body: &[u8] = match path {
            "/index.html" => b"<!doctype html><title>studio</title>",
            "/splash.html" => b"<!doctype html><title>splash</title>",
            "/fonts/pixelify-sans-600.woff2" => b"wOF2",
            _ => return None,
        };
        let content_type = if path.ends_with(".woff2") { "font/woff2" } else { "text/html" };
        Some(StaticFile { body: body.to_vec(), content_type: content_type.into() })
    });
    let handle = server::serve(backend, 0, Some(files)).unwrap();
    let port = handle.port();
    assert_ne!(port, 0);
    let host = format!("127.0.0.1:{port}");

    let (status, head, body) = get(port, "/api/app", &host);
    assert_eq!(status, 200);
    assert!(head.contains("application/json"));
    assert_eq!(serde_json::from_slice::<Value>(&body).unwrap()["mode"], "browser");

    assert_eq!(get(port, "/", &host).2, b"<!doctype html><title>studio</title>");
    assert_eq!(get(port, "/splash.html", &host).2, b"<!doctype html><title>splash</title>");
    let (status, head, _) = get(port, "/fonts/pixelify-sans-600.woff2", &host);
    assert_eq!(status, 200);
    assert!(head.contains("font/woff2"), "{head}");
    // Route de l’application : repli sur index.html ; fichier absent : 404.
    assert_eq!(get(port, "/menus/mon_menu", &host).2, b"<!doctype html><title>studio</title>");
    assert_eq!(get(port, "/manque.js", &host).0, 404);
    // Contrôle Host / Origin, pour l’API comme pour l’interface.
    assert_eq!(get(port, "/api/app", "evil.example").0, 403);
    assert_eq!(get(port, "/", "evil.example").0, 403);
    let (status, _, _) = http(
        port,
        &format!("GET /api/app HTTP/1.1\r\nHost: {host}\r\nOrigin: https://evil.example\r\nConnection: close\r\n\r\n"),
    )
    .unwrap();
    assert_eq!(status, 403);
    let (status, _, _) =
        http(port, &format!("POST /index.html HTTP/1.1\r\nHost: {host}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"))
            .unwrap();
    assert_eq!(status, 405);

    handle.shutdown();
    std::thread::sleep(Duration::from_millis(200));
    assert!(http(port, &format!("GET /api/app HTTP/1.1\r\nHost: {host}\r\n\r\n")).is_none(), "port libéré");
}

#[test]
fn server_without_interface_keeps_legacy_404() {
    let dir = TempDir::new("server-api");
    let handle = server::serve(Arc::new(Backend::new(config(&dir))), 0, None).unwrap();
    let port = handle.port();
    let (status, _, body) = get(port, "/index.html", &format!("localhost:{port}"));
    assert_eq!((status, String::from_utf8_lossy(&body).into_owned()), (404, "Hors de l’API : /index.html".to_owned()));
    handle.shutdown();
}
