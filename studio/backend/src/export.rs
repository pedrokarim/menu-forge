//! Export des menus (routes documentées dans l’en-tête de [`crate::app`]) :
//!
//! - **vers le plugin** : menus résolus et textures qu’ils utilisent, copiés
//!   dans `<export.enderiumResources>/menuforge/` ;
//! - **pack ZIP autonome** (pour tester sans serveur), écrit dans
//!   `<espace actif>/exports/`.
//!
//! La génération (résolution des gabarits, polices, textures recadrées) est
//! faite par l’interface avec le même algorithme que la lib
//! (`studio/src/export/`, parité vérifiée par `studio/tests/parity.test.ts`) :
//! le backend ne fait qu’écrire, et jamais hors de ces deux dossiers.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use serde_json::{Map, Value};

use crate::error::{fs_error, HttpError};
use crate::fsutil::ensure_parent;
use crate::js::{parse_lossy, stringify, stringify_pretty};
use crate::paths::{decode_component, inside_root, join};
use crate::settings::iso_utc;
use crate::workspace::{has_png_signature, is_valid_document_id};
use crate::{Backend, Response};

/// Sous-dossier du dossier d’export où tout est écrit.
pub const EXPORT_DIR: &str = "menuforge";
/// Manifeste du dernier export (fichiers écrits), dans [`EXPORT_DIR`].
pub const MANIFEST: &str = ".menu-forge-export.json";
/// Dossier des packs ZIP, dans l’espace de travail actif.
pub const PACKS_DIR: &str = "exports";

/// `PK\x03\x04` : en-tête local d’une entrée zip.
const ZIP_LOCAL_HEADER: [u8; 4] = [0x50, 0x4b, 0x03, 0x04];
/// `PK\x05\x06` : fin de répertoire (archive vide).
const ZIP_EMPTY_ARCHIVE: [u8; 4] = [0x50, 0x4b, 0x05, 0x06];
/// Barre oblique inverse, refusée dans les chemins de texture.
const BACKSLASH: u8 = 92;

fn bad_request(message: impl Into<String>) -> HttpError {
    HttpError::new(400, message)
}

/// Nom de pack accepté : `[a-z0-9_.-]+.zip`, sans point initial.
pub fn is_valid_pack_name(name: &str) -> bool {
    name.len() > 4
        && name.ends_with(".zip")
        && !name.starts_with('.')
        && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'_' | b'.' | b'-'))
}

/// Chemin de texture accepté : relatif, séparé par `/`, en `.png`, sans
/// segment vide, `.` ou `..`, sans `:` ni barre oblique inverse.
pub fn is_valid_texture_path(path: &str) -> bool {
    !path.is_empty()
        && path.to_lowercase().ends_with(".png")
        && !path.bytes().any(|b| b == BACKSLASH || b == b':')
        && !path.split('/').any(|segment| segment.is_empty() || segment == "." || segment == "..")
}

/// Entrée de manifeste qu’un export a pu écrire (et qu’il peut donc supprimer).
fn is_managed_entry(entry: &str) -> bool {
    if let Some(file) = entry.strip_prefix("menus/") {
        return file.strip_suffix(".menu.json").is_some_and(is_valid_document_id);
    }
    entry.strip_prefix("textures/").is_some_and(is_valid_texture_path)
}

/// `/exports/<nom>` → `<nom>` encodé (un seul segment).
pub fn pack_route(pathname: &str) -> Option<&str> {
    let name = pathname.strip_prefix("/exports/")?;
    (!name.is_empty() && !name.contains('/')).then_some(name)
}

fn array<'a>(body: &'a Map<String, Value>, key: &str) -> Result<&'a Vec<Value>, HttpError> {
    body.get(key).and_then(Value::as_array).ok_or_else(|| bad_request(format!("« {key} » doit être une liste")))
}

/// Fichiers listés par le manifeste du dossier d’export (vide s’il manque ou est illisible).
fn read_manifest(target: &str) -> Vec<String> {
    fs::read(join(target, MANIFEST))
        .ok()
        .and_then(|bytes| parse_lossy(&bytes))
        .and_then(|manifest| manifest.get("files").and_then(Value::as_array).cloned())
        .map(|files| files.iter().filter_map(Value::as_str).map(str::to_owned).collect())
        .unwrap_or_default()
}

fn write_manifest(target: &str, files: &BTreeSet<String>) -> Result<(), HttpError> {
    let mut manifest = Map::new();
    manifest.insert("version".into(), Value::from(1));
    manifest.insert("exportedAt".into(), Value::String(iso_utc(std::time::SystemTime::now())));
    manifest.insert("files".into(), Value::Array(files.iter().cloned().map(Value::String).collect()));
    let file = join(target, MANIFEST);
    ensure_parent(&file)?;
    fs::write(&file, format!("{}\n", stringify_pretty(&Value::Object(manifest))))
        .map_err(|error| fs_error(&error, "open", &file))
}

/// Supprime les dossiers devenus vides entre `file` et `root` (exclu).
fn remove_empty_parents(file: &str, root: &str) {
    let root = Path::new(root);
    let mut current = Path::new(file).parent();
    while let Some(dir) = current {
        if dir == root || !dir.starts_with(root) || fs::remove_dir(dir).is_err() {
            break;
        }
        current = dir.parent();
    }
}

impl Backend {
    /// `POST /export/plugin` : voir l’en-tête de [`crate::app`].
    pub(crate) fn export_plugin(&self, body: &[u8]) -> Result<Response, HttpError> {
        let body = match parse_lossy(body) {
            Some(Value::Object(map)) => map,
            Some(_) => return Err(bad_request("Le corps de la requête doit être un objet JSON")),
            None => return Err(bad_request("JSON invalide")),
        };
        let (resources, textures_dir) = {
            let state = self.read_state();
            (state.settings.export.enderium_resources.clone(), state.workspace.textures_dir().to_owned())
        };
        let resources = resources.ok_or_else(|| {
            HttpError::new(409, "Aucun dossier d’export : choisissez-le dans Paramètres, section « Export vers le plugin »")
        })?;
        if !Path::new(&resources).is_dir() {
            return Err(HttpError::new(409, format!("Dossier d’export introuvable : {resources}")));
        }
        let target = join(&resources, EXPORT_DIR);

        // 1. Tout vérifier avant d’écrire quoi que ce soit.
        let mut files: Vec<(String, Vec<u8>)> = Vec::new();
        let mut ids = BTreeSet::new();
        for (index, menu) in array(&body, "menus")?.iter().enumerate() {
            let id = menu
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| is_valid_document_id(id))
                .ok_or_else(|| bad_request(format!("menus[{index}] : identifiant absent ou invalide (attendu : [a-z0-9_]+)")))?;
            if !ids.insert(id.to_owned()) {
                return Err(bad_request(format!("Le menu « {id} » est présent deux fois")));
            }
            files.push((format!("menus/{id}.menu.json"), format!("{}\n", stringify_pretty(menu)).into_bytes()));
        }
        let mut textures = BTreeSet::new();
        for (index, texture) in array(&body, "textures")?.iter().enumerate() {
            let path = texture
                .as_str()
                .filter(|path| is_valid_texture_path(path))
                .ok_or_else(|| bad_request(format!("textures[{index}] : chemin de PNG relatif attendu")))?;
            if !textures.insert(path.to_owned()) {
                continue;
            }
            let source = inside_root(&textures_dir, path)?;
            let data = fs::read(&source).map_err(|_| bad_request(format!("Texture introuvable : {path}")))?;
            if !has_png_signature(&data) {
                return Err(bad_request(format!("La texture {path} n’est pas un PNG")));
            }
            files.push((format!("textures/{path}"), data));
        }
        let mut planned = Vec::with_capacity(files.len());
        for (relative, data) in files {
            planned.push((inside_root(&target, &relative)?, relative, data));
        }

        // 2. Écriture.
        for (path, _, data) in &planned {
            ensure_parent(path)?;
            fs::write(path, data).map_err(|error| fs_error(&error, "open", path))?;
        }

        // 3. Fichiers du précédent export absents de celui-ci : supprimés, eux seuls.
        let current: BTreeSet<String> = planned.iter().map(|(_, relative, _)| relative.clone()).collect();
        let mut removed = Vec::new();
        for relative in read_manifest(&target) {
            if current.contains(&relative) || !is_managed_entry(&relative) {
                continue;
            }
            let Ok(path) = inside_root(&target, &relative) else { continue };
            match fs::remove_file(&path) {
                Ok(()) => {
                    remove_empty_parents(&path, &target);
                    removed.push(relative);
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(fs_error(&error, "unlink", &path)),
            }
        }
        write_manifest(&target, &current)?;

        let mut result = Map::new();
        result.insert("directory".into(), Value::String(target));
        result.insert("menus".into(), Value::from(ids.len()));
        result.insert("textures".into(), Value::from(textures.len()));
        result.insert("removed".into(), Value::Array(removed.into_iter().map(Value::String).collect()));
        Ok(Response::json(stringify(&Value::Object(result)).into_bytes()))
    }

    /// `PUT /exports/<nom>.zip` : voir l’en-tête de [`crate::app`].
    pub(crate) fn export_pack(&self, raw_name: &str, body: &[u8]) -> Result<Response, HttpError> {
        let name = decode_component(raw_name)?;
        if !is_valid_pack_name(&name) {
            return Err(bad_request(format!("Nom de pack invalide : {name} (attendu : [a-z0-9_.-]+.zip)")));
        }
        if body.len() < 4 || (body[..4] != ZIP_LOCAL_HEADER && body[..4] != ZIP_EMPTY_ARCHIVE) {
            return Err(bad_request("Le fichier n’est pas une archive zip"));
        }
        let root = self.read_state().workspace.root().to_owned();
        let dir = join(&root, PACKS_DIR);
        let file = inside_root(&dir, &name)?;
        fs::create_dir_all(&dir).map_err(|error| fs_error(&error, "mkdir", &dir))?;
        fs::write(&file, body).map_err(|error| fs_error(&error, "open", &file))?;
        let mut result = Map::new();
        result.insert("path".into(), Value::String(file));
        result.insert("size".into(), Value::from(body.len()));
        Ok(Response::json(stringify(&Value::Object(result)).into_bytes()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pack_names() {
        for name in ["menuforge.zip", "pack-1.2_test.zip"] {
            assert!(is_valid_pack_name(name), "{name}");
        }
        for name in ["", ".zip", ".hidden.zip", "Pack.zip", "a b.zip", "a/b.zip", "a.rar", "zip"] {
            assert!(!is_valid_pack_name(name), "{name:?}");
        }
    }

    #[test]
    fn texture_paths() {
        for path in ["a.png", "menus/shop/bg.PNG", "x-y_z/1.png"] {
            assert!(is_valid_texture_path(path), "{path}");
        }
        let backslash = format!("a{}b.png", char::from(BACKSLASH));
        for path in ["", "a.jpg", "/a.png", "../a.png", "a/../b.png", "a//b.png", "./a.png", "C:/a.png", backslash.as_str()] {
            assert!(!is_valid_texture_path(path), "{path:?}");
        }
    }

    #[test]
    fn managed_entries() {
        assert!(is_managed_entry("menus/shop.menu.json"));
        assert!(is_managed_entry("textures/a/b.png"));
        assert!(!is_managed_entry("menus/Shop.menu.json"));
        assert!(!is_managed_entry("menus/a/b.menu.json"));
        assert!(!is_managed_entry("textures/../x.png"));
        assert!(!is_managed_entry(".menu-forge-export.json"));
        assert!(!is_managed_entry("other/file.png"));
    }

    #[test]
    fn pack_routes() {
        assert_eq!(pack_route("/exports/a.zip"), Some("a.zip"));
        assert_eq!(pack_route("/exports/"), None);
        assert_eq!(pack_route("/exports/a/b.zip"), None);
        assert_eq!(pack_route("/export/plugin"), None);
    }
}
