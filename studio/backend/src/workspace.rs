//! Routes de l’espace de travail : `/workspace`, `/menus/:id`, `/assets/:id`,
//! `/textures/<chemin>` (portage de l’ancien `workspace.ts`), et gestion des
//! documents (renommer, dupliquer, mettre à la corbeille), exposée par
//! [`crate::app`].

use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::SystemTime;

use serde_json::{Map, Value};

use crate::error::{fs_error, HttpError};
use crate::fsutil::{copy_dir, ensure_parent, list_files};
use crate::js::{parse_lossy, stringify, stringify_pretty};
use crate::paths::{decode_component, decode_path, inside_root, join};
use crate::settings::iso_utc;
use crate::{Request, Response};

const MENU_SUFFIX: &str = ".menu.json";
const ASSET_SUFFIX: &str = ".asset.json";
/// Corbeille de l’espace de travail : rien n’y est jamais supprimé.
pub const TRASH_DIR: &str = ".trash";

/// Nature d’un document de l’espace de travail.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocumentKind {
    Menu,
    Asset,
}

impl DocumentKind {
    /// Champ `type` des routes de documents : `"menu"` ou `"asset"`.
    pub fn parse(value: Option<&Value>) -> Result<Self, HttpError> {
        match value.and_then(Value::as_str) {
            Some("menu") => Ok(Self::Menu),
            Some("asset") => Ok(Self::Asset),
            _ => Err(HttpError::new(400, "« type » doit valoir « menu » ou « asset »")),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Menu => "menu",
            Self::Asset => "asset",
        }
    }

    /// Dossier du document dans l’espace (et dans la corbeille).
    fn folder(self) -> &'static str {
        match self {
            Self::Menu => "menus",
            Self::Asset => "assets",
        }
    }

    fn suffix(self) -> &'static str {
        match self {
            Self::Menu => MENU_SUFFIX,
            Self::Asset => ASSET_SUFFIX,
        }
    }

    /// Nom commun, avec majuscule, pour les messages (« Menu », « Asset »).
    fn title(self) -> &'static str {
        match self {
            Self::Menu => "Menu",
            Self::Asset => "Asset",
        }
    }
}

/// Identifiant de document lu dans le corps d’une requête.
fn body_id(body: &Map<String, Value>, key: &str) -> Result<String, HttpError> {
    match body.get(key) {
        Some(Value::String(id)) if is_valid_document_id(id) => Ok(id.clone()),
        Some(Value::String(id)) => Err(HttpError::new(
            400,
            format!("« {key} » : identifiant invalide « {id} » (lettres minuscules, chiffres et _ uniquement)"),
        )),
        _ => Err(HttpError::new(400, format!("« {key} » doit être un identifiant (texte)"))),
    }
}

/// Nom lisible facultatif (`name`) : texte non vide de 200 caractères au plus.
fn body_name(body: &Map<String, Value>) -> Result<Option<String>, HttpError> {
    match body.get("name") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(name)) if !name.trim().is_empty() && name.trim().chars().count() <= 200 => {
            Ok(Some(name.trim().to_owned()))
        }
        Some(_) => Err(HttpError::new(400, "« name » doit être un texte non vide (200 caractères au plus)")),
    }
}

/// Réponse des routes de documents : `{ type, id, name }`.
fn document_summary(kind: DocumentKind, id: &str, document: &Map<String, Value>) -> Value {
    let name = document.get("name").and_then(Value::as_str).unwrap_or(id);
    let mut map = Map::new();
    map.insert("type".into(), Value::String(kind.as_str().into()));
    map.insert("id".into(), Value::String(id.to_owned()));
    map.insert("name".into(), Value::String(name.to_owned()));
    Value::Object(map)
}

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

    fn document_path(&self, kind: DocumentKind, id: &str) -> String {
        let dir = match kind {
            DocumentKind::Menu => &self.menus_dir,
            DocumentKind::Asset => &self.assets_dir,
        };
        join(dir, &format!("{id}{}", kind.suffix()))
    }

    /// Contenu d’un document existant (objet JSON).
    fn read_document(&self, kind: DocumentKind, id: &str) -> Result<Map<String, Value>, HttpError> {
        let file = self.document_path(kind, id);
        if !Path::new(&file).is_file() {
            return Err(HttpError::new(404, format!("{} introuvable : {id}", kind.title())));
        }
        let bytes = fs::read(&file).map_err(|error| fs_error(&error, "open", &file))?;
        match parse_lossy(&bytes) {
            Some(Value::Object(map)) => Ok(map),
            _ => Err(HttpError::new(
                400,
                format!("{id}{} est illisible : corrigez-le ou mettez-le à la corbeille", kind.suffix()),
            )),
        }
    }

    /// Premier dossier `textures/<base>`, `<base>_2`, `<base>_3`… qui n’existe pas.
    fn free_texture_folder(&self, base: &str) -> String {
        let mut candidate = base.to_owned();
        let mut index = 2;
        while Path::new(&join(&self.textures_dir, &candidate)).exists() {
            candidate = format!("{base}_{index}");
            index += 1;
        }
        candidate
    }

    /// Textures générées d’un menu (`generated/<from>/…`) recopiées dans un
    /// dossier libre à son nouveau nom ; les chemins des couches suivent.
    /// L’original n’est jamais déplacé : d’autres menus peuvent y renvoyer.
    fn copy_generated_textures(&self, from: &str, to: &str, document: &mut Map<String, Value>) -> Result<(), HttpError> {
        let prefix = format!("generated/{from}/");
        let Some(Value::Array(layers)) = document.get_mut("layers") else { return Ok(()) };
        let uses_generated = layers.iter().any(|layer| {
            layer.get("texture").and_then(Value::as_str).is_some_and(|texture| texture.starts_with(&prefix))
        });
        if !uses_generated {
            return Ok(());
        }
        let folder = self.free_texture_folder(&format!("generated/{to}"));
        let source = join(&self.textures_dir, &format!("generated/{from}"));
        if Path::new(&source).is_dir() {
            let target = join(&self.textures_dir, &folder);
            copy_dir(Path::new(&source), Path::new(&target)).map_err(|error| fs_error(&error, "copyfile", &target))?;
        }
        for layer in layers.iter_mut() {
            if let Some(Value::String(texture)) = layer.get_mut("texture") {
                if let Some(rest) = texture.strip_prefix(&prefix) {
                    *texture = format!("{folder}/{rest}");
                }
            }
        }
        Ok(())
    }

    /// Export PNG d’un asset (`assets/<from>.png`) copié sous `assets/<to>.png`
    /// s’il n’existe pas encore : l’original reste (un menu peut l’utiliser).
    fn copy_asset_export(&self, from: &str, to: &str) -> Result<(), HttpError> {
        let source = join(&self.textures_dir, &format!("assets/{from}.png"));
        let target = join(&self.textures_dir, &format!("assets/{to}.png"));
        if Path::new(&source).is_file() && !Path::new(&target).exists() {
            fs::copy(&source, &target).map_err(|error| fs_error(&error, "copyfile", &target))?;
        }
        Ok(())
    }

    /// Écrit une copie du document `from` sous l’identifiant `to` (jamais
    /// par-dessus un document existant) et renvoie son contenu.
    fn copy_document(
        &self,
        kind: DocumentKind,
        from: &str,
        to: &str,
        name: Option<String>,
    ) -> Result<Map<String, Value>, HttpError> {
        let mut document = self.read_document(kind, from)?;
        let target = self.document_path(kind, to);
        if Path::new(&target).exists() {
            return Err(HttpError::new(409, format!("Un {} « {to} » existe déjà", kind.as_str())));
        }
        document.insert("id".into(), Value::String(to.to_owned()));
        if let Some(name) = name {
            document.insert("name".into(), Value::String(name));
        }
        match kind {
            DocumentKind::Menu => self.copy_generated_textures(from, to, &mut document)?,
            DocumentKind::Asset => self.copy_asset_export(from, to)?,
        }
        ensure_parent(&target)?;
        let content = format!("{}\n", stringify_pretty(&Value::Object(document.clone())));
        let mut file = fs::File::options()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|error| match error.kind() {
                std::io::ErrorKind::AlreadyExists => {
                    HttpError::new(409, format!("Un {} « {to} » existe déjà", kind.as_str()))
                }
                _ => fs_error(&error, "open", &target),
            })?;
        file.write_all(content.as_bytes()).map_err(|error| fs_error(&error, "write", &target))?;
        Ok(document)
    }

    /// `POST /documents/duplicate` : `{ type, from, to, name? }`.
    pub fn duplicate_document(&self, body: &Map<String, Value>) -> Result<Value, HttpError> {
        let kind = DocumentKind::parse(body.get("type"))?;
        let from = body_id(body, "from")?;
        let to = body_id(body, "to")?;
        let name = body_name(body)?;
        let document = self.copy_document(kind, &from, &to, name)?;
        Ok(document_summary(kind, &to, &document))
    }

    /// `POST /documents/rename` : `{ type, from, to, name? }`. Le document est
    /// réécrit sous son nouvel identifiant, puis l’ancien fichier retiré.
    pub fn rename_document(&self, body: &Map<String, Value>) -> Result<Value, HttpError> {
        let kind = DocumentKind::parse(body.get("type"))?;
        let from = body_id(body, "from")?;
        let to = body_id(body, "to")?;
        let name = body_name(body)?;
        let document = self.copy_document(kind, &from, &to, name)?;
        let old = self.document_path(kind, &from);
        if let Err(error) = fs::remove_file(&old) {
            // L’ancien fichier reste : on retire la copie pour ne pas laisser deux documents.
            let _ = fs::remove_file(self.document_path(kind, &to));
            return Err(fs_error(&error, "unlink", &old));
        }
        Ok(document_summary(kind, &to, &document))
    }

    /// `POST /documents/trash` : `{ type, id }`. Le fichier est déplacé dans
    /// `.trash/<date>/<menus|assets>/` ; ses textures restent en place.
    pub fn trash_document(&self, body: &Map<String, Value>) -> Result<Value, HttpError> {
        let kind = DocumentKind::parse(body.get("type"))?;
        let id = body_id(body, "id")?;
        let file = self.document_path(kind, &id);
        if !Path::new(&file).is_file() {
            return Err(HttpError::new(404, format!("{} introuvable : {id}", kind.title())));
        }
        // `2026-09-11T10:22:33.123Z` → `2026-09-11T10-22-33-123Z` (« : » interdit sous Windows).
        let stamp = iso_utc(SystemTime::now()).replace([':', '.'], "-");
        let mut folder = format!("{TRASH_DIR}/{stamp}");
        let mut index = 2;
        while Path::new(&join(&self.root, &folder)).exists() {
            folder = format!("{TRASH_DIR}/{stamp}-{index}");
            index += 1;
        }
        let relative = format!("{folder}/{}/{id}{}", kind.folder(), kind.suffix());
        let target = inside_root(&self.root, &relative)?;
        ensure_parent(&target)?;
        fs::rename(&file, &target).map_err(|error| fs_error(&error, "rename", &file))?;
        let mut map = Map::new();
        map.insert("type".into(), Value::String(kind.as_str().into()));
        map.insert("id".into(), Value::String(id));
        map.insert("trashed".into(), Value::String(relative));
        Ok(Value::Object(map))
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
