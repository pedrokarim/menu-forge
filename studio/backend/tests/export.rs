//! Tests des routes d’export (`POST /export/plugin`, `PUT /exports/<nom>.zip`)
//! sur des dossiers temporaires : chaque test ne supprime que ce qu’il a créé.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use serde_json::{json, Value};
use studio_backend::{AppMode, Backend, BackendConfig, Request};

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// Dossier temporaire supprimé à la fin du test.
struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "studio-export-{name}-{}-{}",
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

/// Backend dont l’espace actif est `<tmp>/workspace` et le dossier d’export
/// `<tmp>/resources` (réglé par `PUT /settings` si `with_target`).
fn backend(dir: &TempDir, with_target: bool) -> Backend {
    fs::create_dir_all(dir.path("workspace/textures/shop")).unwrap();
    fs::create_dir_all(dir.path("resources")).unwrap();
    let backend = Backend::new(BackendConfig {
        mode: AppMode::Browser,
        app_version: "0.0.0".into(),
        settings_path: dir.text("config/settings.json"),
        default_workspace: dir.text("workspace"),
        legacy_libraries_file: None,
        templates_root: dir.text("templates"),
        cache_dir: dir.text("cache"),
        workspace_override: None,
        libraries_override: None,
        discord_client_id: None,
        presence: false,
    });
    if with_target {
        let (status, _, text) = call(&backend, "PUT", "/settings", json!({"export": {"enderiumResources": dir.text("resources")}}));
        assert_eq!(status, 200, "{text}");
    }
    backend
}

fn call(backend: &Backend, method: &str, path: &str, body: Value) -> (u16, Value, String) {
    let bytes = if body.is_null() { Vec::new() } else { serde_json::to_vec(&body).unwrap() };
    raw(backend, method, path, bytes)
}

fn raw(backend: &Backend, method: &str, path: &str, body: Vec<u8>) -> (u16, Value, String) {
    let response = backend.handle(&Request::new(method, path, body));
    let text = String::from_utf8_lossy(&response.body).into_owned();
    (response.status, serde_json::from_str(&text).unwrap_or(Value::Null), text)
}

/// Octets d’un « PNG » (signature suivie d’un marqueur) : le backend ne vérifie que la signature.
fn png(marker: u8) -> Vec<u8> {
    vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, marker]
}

fn shop() -> Value {
    json!({"formatVersion": 1, "id": "shop", "name": "Boutique", "container": {"type": "chest", "rows": 3},
           "layers": [{"id": "bg", "texture": "shop/bg.png", "x": 0, "y": 0}]})
}

#[test]
fn plugin_export_writes_menus_and_textures_under_menuforge() {
    let dir = TempDir::new("plugin");
    let backend = backend(&dir, true);
    fs::write(dir.path("workspace/textures/shop/bg.png"), png(1)).unwrap();

    let (status, result, text) =
        call(&backend, "POST", "/export/plugin", json!({"menus": [shop()], "textures": ["shop/bg.png", "shop/bg.png"]}));
    assert_eq!(status, 200, "{text}");
    assert_eq!(result["menus"], 1);
    assert_eq!(result["textures"], 1);
    assert_eq!(result["removed"], json!([]));
    assert_eq!(PathBuf::from(result["directory"].as_str().unwrap()), dir.path("resources").join("menuforge"));

    let menu: Value =
        serde_json::from_slice(&fs::read(dir.path("resources/menuforge/menus/shop.menu.json")).unwrap()).unwrap();
    assert_eq!(menu, shop());
    assert_eq!(fs::read(dir.path("resources/menuforge/textures/shop/bg.png")).unwrap(), png(1));
    let manifest: Value =
        serde_json::from_slice(&fs::read(dir.path("resources/menuforge/.menu-forge-export.json")).unwrap()).unwrap();
    assert_eq!(manifest["files"], json!(["menus/shop.menu.json", "textures/shop/bg.png"]));
    // Rien n’est écrit hors de menuforge/.
    let entries: Vec<_> = fs::read_dir(dir.path("resources")).unwrap().map(|entry| entry.unwrap().file_name()).collect();
    assert_eq!(entries, ["menuforge"]);
}

#[test]
fn plugin_export_removes_only_files_of_the_previous_export() {
    let dir = TempDir::new("stale");
    let backend = backend(&dir, true);
    fs::write(dir.path("workspace/textures/shop/bg.png"), png(1)).unwrap();
    assert_eq!(call(&backend, "POST", "/export/plugin", json!({"menus": [shop()], "textures": ["shop/bg.png"]})).0, 200);
    // Fichier déposé à la main : jamais listé dans un manifeste, jamais supprimé.
    fs::write(dir.path("resources/menuforge/menus/manual.menu.json"), "{}").unwrap();

    let (status, result, text) = call(&backend, "POST", "/export/plugin", json!({"menus": [], "textures": []}));
    assert_eq!(status, 200, "{text}");
    assert_eq!(result["removed"], json!(["menus/shop.menu.json", "textures/shop/bg.png"]));
    assert!(!dir.path("resources/menuforge/menus/shop.menu.json").exists());
    assert!(!dir.path("resources/menuforge/textures/shop").exists(), "dossier vidé retiré");
    assert!(dir.path("resources/menuforge/menus/manual.menu.json").exists());
    assert!(dir.path("workspace/textures/shop/bg.png").exists(), "la source n’est jamais touchée");
}

#[test]
fn plugin_export_is_refused_without_a_target_folder() {
    let dir = TempDir::new("notarget");
    let backend = backend(&dir, false);
    let (status, _, text) = call(&backend, "POST", "/export/plugin", json!({"menus": [], "textures": []}));
    assert_eq!(status, 409, "{text}");
    assert!(text.contains("Export vers le plugin"), "{text}");

    let backend = self::backend(&dir, true);
    fs::remove_dir_all(dir.path("resources")).unwrap();
    assert_eq!(call(&backend, "POST", "/export/plugin", json!({"menus": [], "textures": []})).0, 409);
}

#[test]
fn plugin_export_validates_everything_before_writing() {
    let dir = TempDir::new("invalid");
    let backend = backend(&dir, true);
    fs::write(dir.path("workspace/textures/shop/bg.png"), png(1)).unwrap();
    fs::write(dir.path("workspace/textures/fake.png"), b"GIF89a").unwrap();
    fs::write(dir.path("workspace/secret.png"), png(2)).unwrap();

    let cases = [
        (json!([]), 400),
        (json!({"menus": {}, "textures": []}), 400),
        (json!({"menus": [{"id": "Bad"}], "textures": []}), 400),
        (json!({"menus": [shop(), shop()], "textures": []}), 400),
        (json!({"menus": [shop()], "textures": ["../secret.png"]}), 400),
        (json!({"menus": [shop()], "textures": ["missing.png"]}), 400),
        (json!({"menus": [shop()], "textures": ["fake.png"]}), 400),
        (json!({"menus": [shop()], "textures": ["shop/bg.png", 3]}), 400),
    ];
    for (body, expected) in cases {
        let (status, _, text) = call(&backend, "POST", "/export/plugin", body.clone());
        assert_eq!(status, expected, "{body} → {text}");
    }
    assert!(!dir.path("resources/menuforge").exists(), "aucun fichier écrit après un refus");
}

#[test]
fn pack_zip_is_written_in_the_workspace_exports_folder() {
    let dir = TempDir::new("zip");
    let backend = backend(&dir, false);
    let archive = [&[0x50, 0x4b, 0x05, 0x06][..], &[0u8; 18]].concat();

    let (status, result, text) = raw(&backend, "PUT", "/exports/menuforge-test.zip", archive.clone());
    assert_eq!(status, 200, "{text}");
    assert_eq!(result["size"], archive.len());
    assert_eq!(PathBuf::from(result["path"].as_str().unwrap()), dir.path("workspace/exports/menuforge-test.zip"));
    assert_eq!(fs::read(dir.path("workspace/exports/menuforge-test.zip")).unwrap(), archive);

    assert_eq!(raw(&backend, "PUT", "/exports/Pack.zip", archive.clone()).0, 400);
    assert_eq!(raw(&backend, "PUT", "/exports/a%2Fb.zip", archive.clone()).0, 400);
    assert_eq!(raw(&backend, "PUT", "/exports/pack.zip", b"not a zip".to_vec()).0, 400);
    assert_eq!(raw(&backend, "GET", "/exports/menuforge-test.zip", Vec::new()).0, 404);
    let entries: Vec<_> = fs::read_dir(dir.path("workspace/exports")).unwrap().map(|entry| entry.unwrap().file_name()).collect();
    assert_eq!(entries, ["menuforge-test.zip"]);
}

/// Base64 standard, pour construire les corps de `POST /export/bedrock`.
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let word = (u32::from(chunk[0]) << 16)
            | (u32::from(chunk.get(1).copied().unwrap_or(0)) << 8)
            | u32::from(chunk.get(2).copied().unwrap_or(0));
        for position in 0..4 {
            if position <= chunk.len() {
                out.push(ALPHABET[((word >> (18 - 6 * position)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Backend dont le dossier d’export Bedrock est `<tmp>/bedrock`.
fn bedrock_backend(dir: &TempDir) -> Backend {
    let backend = backend(dir, false);
    fs::create_dir_all(dir.path("bedrock")).unwrap();
    let (status, _, text) = call(&backend, "PUT", "/settings", json!({"export": {"bedrockDirectory": dir.text("bedrock")}}));
    assert_eq!(status, 200, "{text}");
    backend
}

/// Corps d’un export Bedrock : manifest du pack en `version`, descripteur, et une disposition et une texture par menu.
fn bedrock_files(version: [u64; 3], menus: &[&str]) -> Value {
    let manifest = json!({"format_version": 2, "header": {"name": "Menu Forge", "uuid": "pack-uuid", "version": version}, "modules": []});
    let mut files = vec![
        json!({"path": "pack/manifest.json", "data": base64(manifest.to_string().as_bytes())}),
        json!({"path": "runtime.json", "data": base64(b"{\"menus\": []}")}),
    ];
    for menu in menus {
        files.push(json!({"path": format!("pack/ui/menu_forge/{menu}.json"), "data": base64(b"{}")}));
        files.push(json!({"path": format!("pack/textures/menu_forge/{menu}/bg.png"), "data": base64(&png(1))}));
    }
    json!({ "files": files })
}

#[test]
fn bedrock_export_writes_the_pack_and_the_runtime_descriptor() {
    let dir = TempDir::new("bedrock");
    let backend = bedrock_backend(&dir);
    let (status, info, text) = call(&backend, "GET", "/export/bedrock", Value::Null);
    assert_eq!(status, 200, "{text}");
    assert_eq!(info["version"], Value::Null);
    assert_eq!(PathBuf::from(info["directory"].as_str().unwrap()), dir.path("bedrock"));

    let (status, result, text) = call(&backend, "POST", "/export/bedrock", bedrock_files([1, 0, 0], &["shop"]));
    assert_eq!(status, 200, "{text}");
    assert_eq!(result["files"], 4);
    assert_eq!(result["version"], json!([1, 0, 0]));
    assert_eq!(result["removed"], json!([]));
    assert_eq!(fs::read(dir.path("bedrock/pack/textures/menu_forge/shop/bg.png")).unwrap(), png(1));
    assert_eq!(fs::read_to_string(dir.path("bedrock/runtime.json")).unwrap(), "{\"menus\": []}");
    let manifest: Value =
        serde_json::from_slice(&fs::read(dir.path("bedrock/.menu-forge-bedrock-export.json")).unwrap()).unwrap();
    assert_eq!(
        manifest["files"],
        json!(["pack/manifest.json", "pack/textures/menu_forge/shop/bg.png", "pack/ui/menu_forge/shop.json", "runtime.json"])
    );
    assert_eq!(call(&backend, "GET", "/export/bedrock", Value::Null).1["version"], json!([1, 0, 0]));
}

#[test]
fn bedrock_export_requires_a_higher_version_and_removes_stale_files() {
    let dir = TempDir::new("bedrock-stale");
    let backend = bedrock_backend(&dir);
    assert_eq!(call(&backend, "POST", "/export/bedrock", bedrock_files([1, 0, 4], &["shop", "old"])).0, 200);
    // Fichier déposé à la main : jamais listé dans un manifeste, jamais supprimé.
    fs::write(dir.path("bedrock/pack/ui/manual.json"), "{}").unwrap();

    for stale in [[1, 0, 4], [1, 0, 3], [0, 9, 9]] {
        let (status, _, text) = call(&backend, "POST", "/export/bedrock", bedrock_files(stale, &["shop"]));
        assert_eq!(status, 409, "{stale:?} → {text}");
    }
    let (status, result, text) = call(&backend, "POST", "/export/bedrock", bedrock_files([1, 0, 5], &["shop"]));
    assert_eq!(status, 200, "{text}");
    assert_eq!(result["removed"], json!(["pack/textures/menu_forge/old/bg.png", "pack/ui/menu_forge/old.json"]));
    assert!(!dir.path("bedrock/pack/textures/menu_forge/old").exists(), "dossier vidé retiré");
    assert!(dir.path("bedrock/pack/ui/manual.json").exists());
    assert!(dir.path("bedrock/pack/ui/menu_forge/shop.json").exists());
}

#[test]
fn bedrock_export_is_refused_without_target_or_with_invalid_files() {
    let dir = TempDir::new("bedrock-invalid");
    let backend = backend(&dir, false);
    for method in ["GET", "POST"] {
        let (status, _, text) = call(&backend, method, "/export/bedrock", bedrock_files([1, 0, 0], &[]));
        assert_eq!(status, 409, "{method} → {text}");
        assert!(text.contains("Export pour Bedrock"), "{text}");
    }

    let backend = bedrock_backend(&dir);
    let valid = bedrock_files([1, 0, 0], &["shop"]);
    let with = |path: &str, data: String| {
        let mut body = valid.clone();
        body["files"].as_array_mut().unwrap().push(json!({ "path": path, "data": data }));
        body
    };
    let without = |path: &str| {
        let mut body = valid.clone();
        body["files"].as_array_mut().unwrap().retain(|file| file["path"] != path);
        body
    };
    let cases = [
        json!([]),
        json!({"files": {}}),
        with("../outside.json", base64(b"{}")),
        with("pack/../x.json", base64(b"{}")),
        with("pack/notes.txt", base64(b"x")),
        with("other/a.json", base64(b"{}")),
        with("pack/a.json", "@@@@".into()),
        with("pack/a.png", base64(b"GIF89a")),
        with("pack/a.json", base64(b"{pas du json")),
        with("pack/ui/menu_forge/shop.json", base64(b"{}")),
        without("runtime.json"),
        without("pack/manifest.json"),
    ];
    for body in cases {
        let (status, _, text) = call(&backend, "POST", "/export/bedrock", body.clone());
        assert_eq!(status, 400, "{body} → {text}");
    }
    assert_eq!(fs::read_dir(dir.path("bedrock")).unwrap().count(), 0, "aucun fichier écrit après un refus");
}
