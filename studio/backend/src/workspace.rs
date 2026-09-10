//! Routes de l’espace de travail : `/workspace`, `/menus/:id`, `/assets/:id`,
//! `/textures/<chemin>` (voir `studio/server/workspace.ts`).

use std::fs;
use std::path::Path;

use serde_json::{Map, Value};

use crate::error::{fs_error, HttpError};
use crate::fsutil::{ensure_parent, list_files};
use crate::js::{parse_lossy, stringify, stringify_pretty};
use crate::paths::{decode_component, decode_path, inside_root, join};
use crate::{Request, Response};

const MENU_SUFFIX: &str = ".menu.json";
const ASSET_SUFFIX: &str = ".asset.json";

/// Signature d’un PNG (4 premiers octets), vérifiée à l’écriture.
pub const PNG_SIGNATURE: [u8; 4] = [0x89, 0x50, 0x4e, 0x47];

/// Identifiant de menu ou d’asset : `^[a-z0-9_]+$`.
pub fn is_valid_document_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

/// Le corps commence-t-il par la signature PNG ?
pub fn has_png_signature(data: &[u8]) -> bool {
    data.len() >= 4 && data[..4] == PNG_SIGNATURE
}

/// Document de l’espace de travail, pour la liste des récents.
#[derive(Clone, Debug)]
pub struct RecentDocument {
    /// `menu` ou `asset`.
    pub kind: &'static str,
    pub id: String,
    /// Champ `name` du document, sinon son identifiant.
    pub name: String,
    pub modified: std::time::SystemTime,
}

/// Crée `menus/`, `assets/` et `textures/` sous `root` s’ils manquent
/// (`root` doit exister ; rien n’est jamais supprimé ni écrasé).
pub fn ensure_layout(root: &str) -> std::io::Result<()> {
    for dir in ["menus", "assets", "textures"] {
        fs::create_dir_all(join(root, dir))?;
    }
    Ok(())
}

pub struct Workspace {
    root: String,
    menus_dir: String,
    assets_dir: String,
    textures_dir: String,
    templates_root: String,
}

/// Lit les documents `*<suffix>` d’un dossier (non récursif).
fn read_documents(dir: &str, suffix: &str) -> Vec<Value> {
    let mut documents = Vec::new();
    for entry in list_files(Path::new(dir), suffix) {
        if entry.contains('/') {
            continue;
        }
        match fs::read(join(dir, &entry)).ok().and_then(|bytes| parse_lossy(&bytes)) {
            Some(document) => documents.push(document),
            None => eprintln!("[menu-forge] {entry} est illisible"),
        }
    }
    documents
}

impl Workspace {
    pub fn new(root: String, templates_root: String) -> Self {
        Self {
            menus_dir: join(&root, "menus"),
            assets_dir: join(&root, "assets"),
            textures_dir: join(&root, "textures"),
            root,
            templates_root,
        }
    }

    pub fn textures_dir(&self) -> &str {
        &self.textures_dir
    }

    pub fn root(&self) -> &str {
        &self.root
    }

    /// Nombre de menus, d’assets et de textures (0 si le dossier manque).
    pub fn counts(&self) -> (usize, usize, usize) {
        let documents = |dir: &str, suffix: &str| {
            list_files(Path::new(dir), suffix).iter().filter(|entry| !entry.contains('/')).count()
        };
        (
            documents(&self.menus_dir, MENU_SUFFIX),
            documents(&self.assets_dir, ASSET_SUFFIX),
            list_files(Path::new(&self.textures_dir), ".png").len(),
        )
    }

    /// Menus et assets de l’espace, du plus récemment modifié au plus ancien.
    pub fn recent_documents(&self) -> Vec<RecentDocument> {
        let mut documents = Vec::new();
        for (kind, dir, suffix) in [("menu", &self.menus_dir, MENU_SUFFIX), ("asset", &self.assets_dir, ASSET_SUFFIX)] {
            for entry in list_files(Path::new(dir), suffix) {
                if entry.contains('/') {
                    continue;
                }
                let file = join(dir, &entry);
                let Ok(metadata) = fs::metadata(&file) else { continue };
                if !metadata.is_file() {
                    continue;
                }
                let id = entry[..entry.len() - suffix.len()].to_owned();
                let name = fs::read(&file)
                    .ok()
                    .and_then(|bytes| parse_lossy(&bytes))
                    .and_then(|document| document.get("name").and_then(Value::as_str).map(str::to_owned))
                    .unwrap_or_else(|| id.clone());
                let modified = metadata.modified().unwrap_or(std::time::UNIX_EPOCH);
                documents.push(RecentDocument { kind, id, name, modified });
            }
        }
        documents.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.id.cmp(&b.id)));
        documents
    }

    pub fn route(&self, request: &Request, pathname: &str, method: &str) -> Result<Response, HttpError> {
        if pathname == "/workspace" && method == "GET" {
            let mut body = Map::new();
            body.insert("root".into(), Value::String(self.root.clone()));
            body.insert("menus".into(), Value::Array(read_documents(&self.menus_dir, MENU_SUFFIX)));
            body.insert("assets".into(), Value::Array(read_documents(&self.assets_dir, ASSET_SUFFIX)));
            body.insert("templates".into(), Value::Array(read_documents(&self.templates_root, MENU_SUFFIX)));
            let textures = list_files(Path::new(&self.textures_dir), ".png");
            body.insert("textures".into(), Value::Array(textures.into_iter().map(Value::String).collect()));
            return Ok(Response::json(stringify(&Value::Object(body)).into_bytes()));
        }

        // Enregistrement d’un menu (/menus/:id) ou d’un asset (/assets/:id).
        if let Some((is_asset, raw_id)) = document_route(pathname) {
            if method == "PUT" {
                return self.save_document(is_asset, raw_id, &request.body);
            }
        }

        if let Some(rest) = pathname.strip_prefix("/textures/") {
            let relative = decode_path(rest)?;
            if !relative.to_lowercase().ends_with(".png") {
                return Err(HttpError::new(400, "Seuls les PNG sont acceptés"));
            }
            let file = inside_root(&self.textures_dir, &relative)?;
            if method == "GET" {
                return read_png(&file, &relative);
            }
            if method == "PUT" {
                if !has_png_signature(&request.body) {
                    return Err(HttpError::new(400, "Le fichier n’est pas un PNG"));
                }
                ensure_parent(&file)?;
                fs::write(&file, &request.body).map_err(|error| fs_error(&error, "open", &file))?;
                return Ok(Response::no_content());
            }
        }

        Err(HttpError::new(404, format!("Route inconnue : {method} {pathname}")))
    }

    fn save_document(&self, is_asset: bool, raw_id: &str, body: &[u8]) -> Result<Response, HttpError> {
        let id = decode_component(raw_id)?;
        if !is_valid_document_id(&id) {
            return Err(HttpError::new(400, format!("Identifiant invalide : {id}")));
        }
        let document = parse_lossy(body).ok_or_else(|| HttpError::new(400, "JSON invalide"))?;
        let matches = match &document {
            // `null.id` lève une TypeError côté TypeScript, d’où un 500.
            Value::Null => return Err(HttpError::new(500, "Cannot read properties of null (reading 'id')")),
            Value::Object(map) => map.get("id").and_then(Value::as_str) == Some(id.as_str()),
            _ => false,
        };
        if !matches {
            return Err(HttpError::new(400, "L’identifiant du document ne correspond pas à l’URL"));
        }
        let (dir, suffix) =
            if is_asset { (&self.assets_dir, ASSET_SUFFIX) } else { (&self.menus_dir, MENU_SUFFIX) };
        fs::create_dir_all(dir).map_err(|error| fs_error(&error, "mkdir", dir))?;
        let file = join(dir, &format!("{id}{suffix}"));
        let content = format!("{}\n", stringify_pretty(&document));
        fs::write(&file, content).map_err(|error| fs_error(&error, "open", &file))?;
        Ok(Response::no_content())
    }
}

/// `^\/(menus|assets)\/([^/]+)$` : (asset ?, identifiant encodé).
fn document_route(pathname: &str) -> Option<(bool, &str)> {
    let (is_asset, rest) = if let Some(rest) = pathname.strip_prefix("/menus/") {
        (false, rest)
    } else {
        (true, pathname.strip_prefix("/assets/")?)
    };
    (!rest.is_empty() && !rest.contains('/')).then_some((is_asset, rest))
}

/// Envoie un PNG (sans vérifier son contenu, comme `sendPng`).
pub fn read_png(file: &str, label: &str) -> Result<Response, HttpError> {
    let data = fs::read(file).map_err(|_| HttpError::new(404, format!("Texture introuvable : {label}")))?;
    Ok(Response::png(data))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_ids() {
        for id in ["mon_menu", "a", "x9_", "123"] {
            assert!(is_valid_document_id(id), "{id}");
        }
        for id in ["", "Mon", "a-b", "a b", "a/b", "é", "a.b", "..", "a\n"] {
            assert!(!is_valid_document_id(id), "{id:?}");
        }
    }

    #[test]
    fn png_signature() {
        assert!(has_png_signature(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a]));
        assert!(!has_png_signature(&[0x89, b'P', b'N']));
        assert!(!has_png_signature(b"GIF89a"));
    }

    #[test]
    fn document_routes() {
        assert_eq!(document_route("/menus/abc"), Some((false, "abc")));
        assert_eq!(document_route("/assets/x%2Fy"), Some((true, "x%2Fy")));
        assert_eq!(document_route("/menus/"), None);
        assert_eq!(document_route("/menus/a/b"), None);
        assert_eq!(document_route("/menusx/a"), None);
    }
}
