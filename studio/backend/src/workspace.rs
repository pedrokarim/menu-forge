//! Routes de l’espace de travail : `/workspace`, `/menus/:id`, `/assets/:id`,
//! `/textures/<chemin>` (portage de l’ancien `workspace.ts`), les images de
//! l’éditeur de pixels : `/pixels`, `/pixels/:id` (format dans `docs/pixels.md`),
//! et la gestion des documents (renommer, dupliquer, mettre à la corbeille),
//! exposée par [`crate::app`].

use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::SystemTime;

use serde_json::{Map, Value};

use crate::error::{fs_error, HttpError};
use crate::fsutil::{copy_dir, ensure_parent, list_files};
use crate::js::{parse_lossy, stringify, stringify_pretty};
use crate::paths::{decode_component, decode_path, inside_root, join};
use crate::settings::{iso_utc, write_atomic};
use crate::{Request, Response};

const MENU_SUFFIX: &str = ".menu.json";
const ASSET_SUFFIX: &str = ".asset.json";
const PIXEL_SUFFIX: &str = ".pixel.json";

/// Côté maximal d’une image de pixels, en pixels (comme les assets).
pub const MAX_PIXEL_SIZE: u64 = 1024;
/// Nombre maximal de calques d’une image de pixels.
pub const MAX_PIXEL_LAYERS: usize = 64;

/// Espace insécable, avant « : » dans les messages affichés.
const NBSP: char = 0xa0_u8 as char;
/// Corbeille de l’espace de travail : rien n’y est jamais supprimé.
pub const TRASH_DIR: &str = ".trash";

/// Nature d’un document de l’espace de travail.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocumentKind {
    Menu,
    Asset,
    Pixel,
}

impl DocumentKind {
    /// Champ `type` des routes de documents : `"menu"` ou `"asset"`.
    pub fn parse(value: Option<&Value>) -> Result<Self, HttpError> {
        match value.and_then(Value::as_str) {
            Some("menu") => Ok(Self::Menu),
            Some("asset") => Ok(Self::Asset),
            Some("pixel") => Ok(Self::Pixel),
            _ => Err(HttpError::new(400, "« type » doit valoir « menu », « asset » ou « pixel »")),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Menu => "menu",
            Self::Asset => "asset",
            Self::Pixel => "pixel",
        }
    }

    /// Dossier du document dans l’espace (et dans la corbeille).
    fn folder(self) -> &'static str {
        match self {
            Self::Menu => "menus",
            Self::Asset => "assets",
            Self::Pixel => "pixels",
        }
    }

    fn suffix(self) -> &'static str {
        match self {
            Self::Menu => MENU_SUFFIX,
            Self::Asset => ASSET_SUFFIX,
            Self::Pixel => PIXEL_SUFFIX,
        }
    }

    /// Nom commun, avec majuscule, pour les messages (« Menu », « Asset »).
    fn title(self) -> &'static str {
        match self {
            Self::Menu => "Menu",
            Self::Asset => "Asset",
            Self::Pixel => "Image",
        }
    }

    /// Nom avec son article indéfini, pour les messages (« Un menu », « Une image »).
    fn indefinite(self) -> &'static str {
        match self {
            Self::Menu => "Un menu",
            Self::Asset => "Un asset",
            Self::Pixel => "Une image",
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
    /// `menu`, `asset` ou `pixel`.
    pub kind: &'static str,
    pub id: String,
    /// Champ `name` du document, sinon son identifiant.
    pub name: String,
    pub modified: std::time::SystemTime,
    /// Image de pixels : texture exportée (`export.texture`), pour la vignette.
    pub texture: Option<String>,
}

/// Décode le début d’un texte base64 (au moins `count` octets) ; `None` si le
/// texte est trop court ou contient un caractère étranger au base64.
fn base64_head(text: &str, count: usize) -> Option<Vec<u8>> {
    fn value(byte: u8) -> Option<u32> {
        match byte {
            b'A'..=b'Z' => Some(u32::from(byte - b'A')),
            b'a'..=b'z' => Some(u32::from(byte - b'a') + 26),
            b'0'..=b'9' => Some(u32::from(byte - b'0') + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::with_capacity(count + 2);
    for chunk in text.as_bytes().chunks(4) {
        if out.len() >= count {
            break;
        }
        if chunk.len() < 4 {
            return None;
        }
        // Bourrage final (`=`, deux au plus) : ces positions ne portent aucun octet.
        let padding = chunk.iter().rev().take_while(|&&byte| byte == b'=').count();
        if padding > 2 {
            return None;
        }
        let mut group = 0u32;
        for &byte in &chunk[..4 - padding] {
            group = (group << 6) | value(byte)?;
        }
        group <<= 6 * padding;
        out.extend_from_slice(&group.to_be_bytes()[1..4 - padding]);
    }
    (out.len() >= count).then(|| {
        out.truncate(count);
        out
    })
}

/// Texte base64 bien formé : alphabet standard, longueur multiple de 4,
/// bourrage `=` seulement à la fin (deux au plus).
fn is_base64(text: &str) -> bool {
    let bytes = text.as_bytes();
    if bytes.is_empty() || !bytes.len().is_multiple_of(4) {
        return false;
    }
    let padding = bytes.iter().rev().take_while(|&&byte| byte == b'=').count();
    padding <= 2
        && bytes[..bytes.len() - padding]
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'+' || *byte == b'/')
}

/// Dimensions d’un PNG encodé en base64, lues dans son en-tête `IHDR`.
fn png_size_from_base64(text: &str) -> Option<(u32, u32)> {
    if !is_base64(text) {
        return None;
    }
    let head = base64_head(text, 24)?;
    if head[..8] != [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a] || &head[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes([head[16], head[17], head[18], head[19]]);
    let height = u32::from_be_bytes([head[20], head[21], head[22], head[23]]);
    Some((width, height))
}

/// Entier positif d’un objet JSON (`size.width`…), s’il est dans `range`.
fn integer_in(map: &Map<String, Value>, key: &str, range: std::ops::RangeInclusive<u64>) -> Option<u64> {
    map.get(key).and_then(Value::as_u64).filter(|value| range.contains(value))
}

/// Vérifie une image de pixels avant de l’écrire (voir `docs/pixels.md`) ;
/// `textures_dir` borne la texture d’export.
fn validate_pixel_document(document: &Map<String, Value>, id: &str, textures_dir: &str) -> Result<(), HttpError> {
    let invalid = |message: String| Err(HttpError::new(400, message));
    let quoted = |key: &str| format!("«{NBSP}{key}{NBSP}»");
    if document.get("id").and_then(Value::as_str) != Some(id) {
        return invalid("L’identifiant du document ne correspond pas à l’URL".into());
    }
    if document.get("formatVersion").and_then(Value::as_u64) != Some(1) {
        return invalid(format!("{} doit valoir 1", quoted("formatVersion")));
    }
    if document.get("name").and_then(Value::as_str).is_none_or(|name| name.trim().is_empty()) {
        return invalid(format!("{} doit être un texte non vide", quoted("name")));
    }
    let size = document.get("size").and_then(Value::as_object);
    let width = size.and_then(|size| integer_in(size, "width", 1..=MAX_PIXEL_SIZE));
    let height = size.and_then(|size| integer_in(size, "height", 1..=MAX_PIXEL_SIZE));
    let (Some(width), Some(height)) = (width, height) else {
        return invalid(format!("{} doit contenir width et height, entiers de 1 à {MAX_PIXEL_SIZE}", quoted("size")));
    };

    let Some(layers) = document.get("layers").and_then(Value::as_array) else {
        return invalid(format!("{} doit être une liste de calques", quoted("layers")));
    };
    if layers.is_empty() || layers.len() > MAX_PIXEL_LAYERS {
        return invalid(format!("{} doit contenir de 1 à {MAX_PIXEL_LAYERS} calques", quoted("layers")));
    }
    let mut seen = HashSet::new();
    for (index, layer) in layers.iter().enumerate() {
        let key = |field: &str| quoted(&format!("layers[{index}].{field}"));
        let Some(layer) = layer.as_object() else {
            return invalid(format!("{} doit être un objet", quoted(&format!("layers[{index}]"))));
        };
        match layer.get("id").and_then(Value::as_str) {
            Some(layer_id) if is_valid_document_id(layer_id) => {
                if !seen.insert(layer_id) {
                    return invalid(format!("{}{NBSP}: identifiant en double ({layer_id})", key("id")));
                }
            }
            _ => return invalid(format!("{} doit être fait de lettres minuscules, chiffres et _", key("id"))),
        }
        if !layer.get("name").is_some_and(Value::is_string) {
            return invalid(format!("{} doit être un texte", key("name")));
        }
        if !layer.get("visible").is_some_and(Value::is_boolean) {
            return invalid(format!("{} doit valoir true ou false", key("visible")));
        }
        if integer_in(layer, "opacity", 0..=100).is_none() {
            return invalid(format!("{} doit être un entier de 0 à 100", key("opacity")));
        }
        match layer.get("png").and_then(Value::as_str).and_then(png_size_from_base64) {
            None => return invalid(format!("{} doit être un PNG encodé en base64", key("png"))),
            Some((w, h)) if (u64::from(w), u64::from(h)) != (width, height) => {
                return invalid(format!("{}{NBSP}: PNG de {w} × {h} px, {width} × {height} attendus", key("png")));
            }
            Some(_) => {}
        }
    }

    let texture = document.get("export").and_then(Value::as_object).and_then(|export| export.get("texture"));
    let Some(texture) = texture.and_then(Value::as_str).filter(|path| !path.is_empty()) else {
        return invalid(format!("{} doit être le chemin d’un PNG sous textures/", quoted("export.texture")));
    };
    if !texture.to_lowercase().ends_with(".png") || texture.starts_with('/') || texture.starts_with('\\') {
        return invalid(format!("{} doit être le chemin d’un PNG sous textures/", quoted("export.texture")));
    }
    if inside_root(textures_dir, texture).is_err() {
        return invalid(format!("{}{NBSP}: chemin en dehors du dossier textures/", quoted("export.texture")));
    }
    if let Some(source) = document.get("source") {
        if !source.is_object() && !source.is_null() {
            return invalid(format!("{} doit être un objet", quoted("source")));
        }
    }
    Ok(())
}

/// Résumé d’une image de pixels (sans les calques), pour `GET /pixels`.
fn pixel_summary(id: &str, document: &Value, modified: std::time::SystemTime) -> Value {
    let size = document.get("size");
    let dimension = |key: &str| size.and_then(|size| size.get(key)).and_then(Value::as_u64).unwrap_or(0);
    let mut map = Map::new();
    map.insert("id".into(), Value::String(id.to_owned()));
    let name = document.get("name").and_then(Value::as_str).unwrap_or(id);
    map.insert("name".into(), Value::String(name.to_owned()));
    map.insert("width".into(), Value::from(dimension("width")));
    map.insert("height".into(), Value::from(dimension("height")));
    let layers = document.get("layers").and_then(Value::as_array).map_or(0, Vec::len);
    map.insert("layers".into(), Value::from(layers));
    let texture = export_texture(document).unwrap_or_default();
    map.insert("texture".into(), Value::String(texture));
    map.insert("modified".into(), Value::String(iso_utc(modified)));
    Value::Object(map)
}

/// `export.texture` d’une image de pixels.
fn export_texture(document: &Value) -> Option<String> {
    document.get("export")?.get("texture")?.as_str().map(str::to_owned)
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
    pixels_dir: String,
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
            pixels_dir: join(&root, "pixels"),
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

    /// Menus, assets et images de pixels de l’espace, du plus récemment modifié
    /// au plus ancien.
    pub fn recent_documents(&self) -> Vec<RecentDocument> {
        let mut documents = Vec::new();
        for (kind, dir, suffix) in [
            ("menu", &self.menus_dir, MENU_SUFFIX),
            ("asset", &self.assets_dir, ASSET_SUFFIX),
            ("pixel", &self.pixels_dir, PIXEL_SUFFIX),
        ] {
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
                let document = fs::read(&file).ok().and_then(|bytes| parse_lossy(&bytes));
                let name = document
                    .as_ref()
                    .and_then(|document| document.get("name").and_then(Value::as_str).map(str::to_owned))
                    .unwrap_or_else(|| id.clone());
                let texture = if kind == "pixel" { document.as_ref().and_then(export_texture) } else { None };
                let modified = metadata.modified().unwrap_or(std::time::UNIX_EPOCH);
                documents.push(RecentDocument { kind, id, name, modified, texture });
            }
        }
        documents.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.id.cmp(&b.id)));
        documents
    }

    fn document_path(&self, kind: DocumentKind, id: &str) -> String {
        let dir = match kind {
            DocumentKind::Menu => &self.menus_dir,
            DocumentKind::Asset => &self.assets_dir,
            DocumentKind::Pixel => &self.pixels_dir,
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

    /// Export PNG d’une image de pixels. Pour une copie (toujours), ou pour un
    /// renommage quand il est à sa place par défaut (`pixels/<from>.png`), il
    /// est recopié sous un chemin libre (`pixels/<to>.png`, sinon
    /// `pixels/<to>_2.png`…) et le document suit : sans cela, la copie
    /// réécrirait le PNG de l’original. L’original n’est jamais déplacé (un
    /// menu peut l’utiliser) ; un chemin personnalisé reste tel quel au renommage.
    fn copy_pixel_export(
        &self,
        from: &str,
        to: &str,
        document: &mut Map<String, Value>,
        duplicate: bool,
    ) -> Result<(), HttpError> {
        let Some(current) = document.get("export").and_then(|export| export.get("texture")).and_then(Value::as_str) else {
            return Ok(());
        };
        let current = current.to_owned();
        if !duplicate && current != format!("pixels/{from}.png") {
            return Ok(());
        }
        let mut candidate = format!("pixels/{to}.png");
        let mut index = 2;
        while Path::new(&join(&self.textures_dir, &candidate)).exists() {
            candidate = format!("pixels/{to}_{index}.png");
            index += 1;
        }
        let source = inside_root(&self.textures_dir, &current)?;
        if Path::new(&source).is_file() {
            let target = join(&self.textures_dir, &candidate);
            ensure_parent(&target)?;
            fs::copy(&source, &target).map_err(|error| fs_error(&error, "copyfile", &target))?;
        }
        if let Some(Value::Object(export)) = document.get_mut("export") {
            export.insert("texture".into(), Value::String(candidate));
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
        duplicate: bool,
    ) -> Result<Map<String, Value>, HttpError> {
        let mut document = self.read_document(kind, from)?;
        let target = self.document_path(kind, to);
        if Path::new(&target).exists() {
            return Err(HttpError::new(409, format!("{} « {to} » existe déjà", kind.indefinite())));
        }
        document.insert("id".into(), Value::String(to.to_owned()));
        if let Some(name) = name {
            document.insert("name".into(), Value::String(name));
        }
        match kind {
            DocumentKind::Menu => self.copy_generated_textures(from, to, &mut document)?,
            DocumentKind::Asset => self.copy_asset_export(from, to)?,
            DocumentKind::Pixel => self.copy_pixel_export(from, to, &mut document, duplicate)?,
        }
        ensure_parent(&target)?;
        let content = format!("{}\n", stringify_pretty(&Value::Object(document.clone())));
        let mut file = fs::File::options()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|error| match error.kind() {
                std::io::ErrorKind::AlreadyExists => {
                    HttpError::new(409, format!("{} « {to} » existe déjà", kind.indefinite()))
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
        let document = self.copy_document(kind, &from, &to, name, true)?;
        Ok(document_summary(kind, &to, &document))
    }

    /// `POST /documents/rename` : `{ type, from, to, name? }`. Le document est
    /// réécrit sous son nouvel identifiant, puis l’ancien fichier retiré.
    pub fn rename_document(&self, body: &Map<String, Value>) -> Result<Value, HttpError> {
        let kind = DocumentKind::parse(body.get("type"))?;
        let from = body_id(body, "from")?;
        let to = body_id(body, "to")?;
        let name = body_name(body)?;
        let document = self.copy_document(kind, &from, &to, name, false)?;
        let old = self.document_path(kind, &from);
        if let Err(error) = fs::remove_file(&old) {
            // L’ancien fichier reste : on retire la copie pour ne pas laisser deux documents.
            let _ = fs::remove_file(self.document_path(kind, &to));
            return Err(fs_error(&error, "unlink", &old));
        }
        Ok(document_summary(kind, &to, &document))
    }

    /// `POST /documents/trash` : `{ type, id }`. Le fichier est déplacé dans
    /// `.trash/<date>/<menus|assets|pixels>/` ; ses textures restent en place.
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

        // Images de l’éditeur de pixels : liste, lecture, enregistrement.
        if pathname == "/pixels" && method == "GET" {
            return Ok(self.list_pixels());
        }
        if let Some(raw_id) = pixel_route(pathname) {
            match method {
                "GET" => return self.read_pixel(raw_id),
                "PUT" => return self.save_pixel(raw_id, &request.body),
                _ => {}
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

    /// Identifiant d’image décodé et validé, et son fichier (toujours sous `pixels/`).
    fn pixel_file(&self, raw_id: &str) -> Result<(String, String), HttpError> {
        let id = decode_component(raw_id)?;
        if !is_valid_document_id(&id) {
            return Err(HttpError::new(400, format!("Identifiant invalide{NBSP}: {id}")));
        }
        let file = join(&self.pixels_dir, &format!("{id}{PIXEL_SUFFIX}"));
        Ok((id, file))
    }

    /// `GET /pixels`  résumés des images, par identifiant.
    fn list_pixels(&self) -> Response {
        let mut list = Vec::new();
        for entry in list_files(Path::new(&self.pixels_dir), PIXEL_SUFFIX) {
            if entry.contains('/') {
                continue;
            }
            let file = join(&self.pixels_dir, &entry);
            let Ok(metadata) = fs::metadata(&file) else { continue };
            let Some(document) = fs::read(&file).ok().and_then(|bytes| parse_lossy(&bytes)) else {
                eprintln!("[menu-forge] {entry} est illisible");
                continue;
            };
            let id = &entry[..entry.len() - PIXEL_SUFFIX.len()];
            list.push(pixel_summary(id, &document, metadata.modified().unwrap_or(std::time::UNIX_EPOCH)));
        }
        Response::json(stringify(&Value::Array(list)).into_bytes())
    }

    /// `GET /pixels/:id`  le document complet, calques compris.
    fn read_pixel(&self, raw_id: &str) -> Result<Response, HttpError> {
        let (id, file) = self.pixel_file(raw_id)?;
        let bytes = fs::read(&file).map_err(|_| HttpError::new(404, format!("Image introuvable{NBSP}: {id}")))?;
        let document =
            parse_lossy(&bytes).ok_or_else(|| HttpError::new(500, format!("Image illisible{NBSP}: {id}")))?;
        Ok(Response::json(stringify(&document).into_bytes()))
    }

    /// `PUT /pixels/:id`  document validé puis écrit d’un bloc (écriture atomique).
    fn save_pixel(&self, raw_id: &str, body: &[u8]) -> Result<Response, HttpError> {
        let (id, file) = self.pixel_file(raw_id)?;
        let document = match parse_lossy(body) {
            Some(Value::Object(map)) => map,
            Some(_) => return Err(HttpError::new(400, "Le corps de la requête doit être un objet JSON")),
            None => return Err(HttpError::new(400, "JSON invalide")),
        };
        validate_pixel_document(&document, &id, &self.textures_dir)?;
        let content = format!("{}\n", stringify_pretty(&Value::Object(document)));
        write_atomic(&file, content.as_bytes()).map_err(|error| fs_error(&error, "open", &file))?;
        Ok(Response::no_content())
    }
}

/// `^\/pixels\/([^/]+)$`  identifiant encodé.
fn pixel_route(pathname: &str) -> Option<&str> {
    let rest = pathname.strip_prefix("/pixels/")?;
    (!rest.is_empty() && !rest.contains('/')).then_some(rest)
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

    /// Encodage base64 standard (tests seulement).
    fn encode_base64(data: &[u8]) -> String {
        const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for chunk in data.chunks(3) {
            let group = chunk.iter().enumerate().fold(0u32, |group, (index, &byte)| group | u32::from(byte) << (16 - 8 * index));
            for index in 0..4 {
                if index <= chunk.len() {
                    out.push(ALPHABET[(group >> (18 - 6 * index) & 63) as usize] as char);
                } else {
                    out.push('=');
                }
            }
        }
        out
    }

    /// En-tête PNG (signature + IHDR) de `width` × `height`, suivi d’octets quelconques.
    fn png_head(width: u32, height: u32) -> Vec<u8> {
        let mut data = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R'];
        data.extend_from_slice(&width.to_be_bytes());
        data.extend_from_slice(&height.to_be_bytes());
        data.extend_from_slice(&[8, 6, 0, 0, 0]);
        data
    }

    #[test]
    fn base64_png_header() {
        assert_eq!(encode_base64(b"Man"), "TWFu");
        assert_eq!(encode_base64(b"Ma"), "TWE=");
        assert_eq!(base64_head("TWFuTWE=", 5).as_deref(), Some(&b"ManMa"[..]));
        assert_eq!(base64_head("TWFu", 4), None);
        assert_eq!(base64_head("TW*u", 3), None);
        assert!(is_base64("TWE=") && !is_base64("TWE") && !is_base64("T=E=") && !is_base64("TW E") && !is_base64(""));
        assert_eq!(png_size_from_base64(&encode_base64(&png_head(16, 8))), Some((16, 8)));
        assert_eq!(png_size_from_base64(&encode_base64(&png_head(1024, 1))), Some((1024, 1)));
        assert_eq!(png_size_from_base64(&encode_base64(b"GIF89a, pas un PNG du tout...")), None);
        assert_eq!(png_size_from_base64("iVBORw0KGgo="), None, "trop court pour l’en-tête IHDR");
    }

    fn pixel_document(width: u32, height: u32) -> Map<String, Value> {
        let png = encode_base64(&png_head(width, height));
        let value = serde_json::json!({
            "formatVersion": 1, "id": "epee", "name": "Épée",
            "size": { "width": width, "height": height },
            "layers": [
                { "id": "fond", "name": "Fond", "visible": true, "opacity": 100, "png": png },
                { "id": "lame", "name": "Lame", "visible": false, "opacity": 40, "png": png }
            ],
            "export": { "texture": "pixels/epee.png" }
        });
        value.as_object().unwrap().clone()
    }

    #[test]
    fn pixel_documents_are_validated() {
        let root = r"C:\ws\textures";
        assert!(validate_pixel_document(&pixel_document(16, 8), "epee", root).is_ok());
        type Mutation = fn(&mut Map<String, Value>);
        let refused: [(&str, Mutation); 14] = [
            ("identifiant", |doc| put_key(doc, "id", "autre")),
            ("formatVersion", |doc| put_key(doc, "formatVersion", 2)),
            ("name", |doc| put_key(doc, "name", " ")),
            ("taille nulle", |doc| put_key(doc, "size", serde_json::json!({ "width": 0, "height": 8 }))),
            ("taille énorme", |doc| put_key(doc, "size", serde_json::json!({ "width": 2048, "height": 8 }))),
            ("sans calque", |doc| put_key(doc, "layers", serde_json::json!([]))),
            ("calque en double", |doc| {
                let layers = doc.get_mut("layers").unwrap().as_array_mut().unwrap();
                layers[1]["id"] = "fond".into();
            }),
            ("opacité", |doc| doc.get_mut("layers").unwrap()[0]["opacity"] = 101.into()),
            ("pas un PNG", |doc| doc.get_mut("layers").unwrap()[0]["png"] = "R0lGODlhAQABAAAAACw=".into()),
            ("PNG d’une autre taille", |doc| {
                doc.get_mut("layers").unwrap()[0]["png"] = encode_base64(&png_head(8, 8)).into();
            }),
            ("export absolu", |doc| put_key(doc, "export", serde_json::json!({ "texture": "C:/x.png" }))),
            ("export hors de textures", |doc| put_key(doc, "export", serde_json::json!({ "texture": "../menus/x.png" }))),
            ("export pas PNG", |doc| put_key(doc, "export", serde_json::json!({ "texture": "pixels/x.json" }))),
            ("source", |doc| put_key(doc, "source", "library")),
        ];
        for (case, mutate) in refused {
            let mut document = pixel_document(16, 8);
            mutate(&mut document);
            let error = validate_pixel_document(&document, "epee", root).expect_err(case);
            assert_eq!(error.status, 400, "{case}");
        }
    }

    fn put_key(document: &mut Map<String, Value>, key: &str, value: impl Into<Value>) {
        document.insert(key.into(), value.into());
    }

    #[test]
    fn pixel_routes() {
        assert_eq!(pixel_route("/pixels/epee"), Some("epee"));
        assert_eq!(pixel_route("/pixels/..%2Fx"), Some("..%2Fx"));
        assert_eq!(pixel_route("/pixels/"), None);
        assert_eq!(pixel_route("/pixels"), None);
        assert_eq!(pixel_route("/pixels/a/b"), None);
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
