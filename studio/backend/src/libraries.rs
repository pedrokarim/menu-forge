//! Bibliothèques d’assets : des resource packs extraits, branchés en lecture
//! seule (voir `studio/server/libraries.ts`). Le studio y pioche des textures
//! (copiées dans l’espace de travail) et peut reconstruire un menu à partir
//! d’une police du pack.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::{Arc, Mutex};

use rayon::prelude::*;
use serde_json::{Map, Number, Value};

use crate::error::HttpError;
use crate::fsutil::{ensure_parent, list_dirs, list_files};
use crate::js::{locale_compare, parse_lossy, stringify};
use crate::paths::{decode_component, decode_path, dirname, inside_root, join, resolve};
use crate::workspace::read_png;
use crate::{Request, Response};

/// À incrémenter quand la forme de l’index change (invalide les caches disque).
/// Doit rester égal à `INDEX_VERSION` de `libraries.ts` : les deux backends
/// partagent le même cache.
pub const INDEX_VERSION: u32 = 1;

/// Pack branché en lecture seule.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LibrarySource {
    pub id: String,
    pub name: String,
    /// Dossier d’un resource pack extrait (celui qui contient `assets/`).
    pub root: String,
    /// `own` : assets du projet ; `third-party` : usage local uniquement.
    pub ownership: Ownership,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ownership {
    Own,
    ThirdParty,
}

impl Ownership {
    pub fn as_str(self) -> &'static str {
        match self {
            Ownership::Own => "own",
            Ownership::ThirdParty => "third-party",
        }
    }
}

/// Identifiant de bibliothèque : `^[a-z0-9_-]+$`.
pub fn is_valid_library_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

/// Lit la liste des bibliothèques (fichier JSON local, facultatif). Les racines
/// relatives sont résolues depuis le dossier du fichier.
pub fn load_library_sources(file: &str) -> Vec<LibrarySource> {
    let file = resolve(&[file]);
    let Some(Value::Array(entries)) = fs::read(&file).ok().and_then(|bytes| parse_lossy(&bytes)) else {
        return Vec::new();
    };
    let base_dir = dirname(&file);
    entries
        .iter()
        .filter_map(|entry| {
            let entry = entry.as_object()?;
            let id = entry.get("id")?.as_str()?;
            let root = entry.get("root")?.as_str()?;
            if !is_valid_library_id(id) {
                return None;
            }
            Some(LibrarySource {
                id: id.to_owned(),
                name: entry.get("name").and_then(Value::as_str).unwrap_or(id).to_owned(),
                root: resolve(&[&base_dir, root]),
                ownership: if entry.get("ownership").and_then(Value::as_str) == Some("own") {
                    Ownership::Own
                } else {
                    Ownership::ThirdParty
                },
            })
        })
        .collect()
}

/// Taille d’un PNG lue dans son en-tête IHDR, sans décoder l’image.
pub fn png_size_from_header(header: &[u8]) -> Option<(u32, u32)> {
    if header.len() < 24 || header[..4] != [0x89, 0x50, 0x4e, 0x47] {
        return None;
    }
    let width = u32::from_be_bytes(header[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(header[20..24].try_into().ok()?);
    Some((width, height))
}

fn read_png_size(file: &str) -> Option<(u32, u32)> {
    let mut handle = fs::File::open(file).ok()?;
    let mut header = [0u8; 24];
    let mut filled = 0;
    while filled < header.len() {
        match handle.read(&mut header[filled..]) {
            Ok(0) => break,
            Ok(count) => filled += count,
            Err(_) => return None,
        }
    }
    png_size_from_header(&header[..filled])
}

/// Fichier de texture d’un provider `bitmap` (sans espace de noms = `minecraft`).
/// Reprend `file.split(':', 2)` : ce qui suit un second `:` est ignoré.
pub fn texture_of_file(file: &str) -> String {
    let (namespace, relative) = match file.split_once(':') {
        Some((namespace, rest)) => (namespace, rest.split(':').next().unwrap_or("")),
        None => ("minecraft", file),
    };
    if relative.ends_with(".png") {
        format!("assets/{namespace}/textures/{relative}")
    } else {
        format!("assets/{namespace}/textures/{relative}.png")
    }
}

fn with_namespace(id: &str) -> String {
    if id.contains(':') { id.to_owned() } else { format!("minecraft:{id}") }
}

/// Glyphe-image d’une police.
#[derive(Clone, Debug, PartialEq)]
pub struct FontGlyph {
    pub texture: String,
    pub ascent: Number,
    pub height: Number,
    /// La texture existe-t-elle dans le pack ?
    pub found: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LibraryFont {
    /// Identifiant de police, ex. `minecraft:menus/badges/home`.
    pub id: String,
    pub glyphs: Vec<FontGlyph>,
    pub references: Vec<String>,
}

/// Analyse le contenu d’une police. Seuls les glyphes-images (provider
/// `bitmap` à exactement un caractère) sont retenus, pas les grilles de police.
/// Les cas où le code TypeScript lève une `TypeError` (police ou provider
/// `null`) donnent la même erreur 500.
pub fn parse_font_value(data: &Value, id: &str) -> Result<LibraryFont, HttpError> {
    let providers = match data {
        Value::Null => {
            return Err(HttpError::new(500, "Cannot read properties of null (reading 'providers')"));
        }
        Value::Object(map) => map.get("providers").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]),
        _ => &[],
    };
    let mut glyphs = Vec::new();
    let mut references = Vec::new();
    for provider in providers {
        let provider = match provider {
            Value::Null => return Err(HttpError::new(500, "Cannot read properties of null (reading 'type')")),
            Value::Object(map) => map,
            _ => continue,
        };
        let kind = provider.get("type").and_then(Value::as_str);
        if kind == Some("reference") {
            if let Some(reference) = provider.get("id").and_then(Value::as_str) {
                references.push(with_namespace(reference));
            }
        }
        let (Some("bitmap"), Some(file)) = (kind, provider.get("file").and_then(Value::as_str)) else {
            continue;
        };
        let count: usize = provider
            .get("chars")
            .and_then(Value::as_array)
            .map(|rows| rows.iter().filter_map(Value::as_str).map(|row| row.chars().count()).sum())
            .unwrap_or(0);
        if count != 1 {
            continue;
        }
        let number_or = |key: &str, fallback: u32| match provider.get(key) {
            Some(Value::Number(number)) => number.clone(),
            _ => Number::from(fallback),
        };
        glyphs.push(FontGlyph {
            texture: texture_of_file(file),
            ascent: number_or("ascent", 7),
            height: number_or("height", 8),
            found: false,
        });
    }
    Ok(LibraryFont { id: id.to_owned(), glyphs, references })
}

/// Lit et analyse une police ; `None` si le fichier est illisible.
fn parse_font(file: &str, id: &str) -> Result<Option<LibraryFont>, HttpError> {
    let Some(data) = fs::read(file).ok().and_then(|bytes| parse_lossy(&bytes)) else {
        return Ok(None);
    };
    parse_font_value(&data, id).map(Some)
}

/// Contenu d’un espace de noms du pack.
pub struct NamespaceListing {
    pub namespace: String,
    pub textures: Vec<String>,
    pub fonts: Vec<String>,
}

/// Signature du cache : nombre de textures et de polices par espace de noms.
pub fn cache_signature(listing: &[NamespaceListing]) -> String {
    listing
        .iter()
        .map(|entry| format!("{}:{}:{}", entry.namespace, entry.textures.len(), entry.fonts.len()))
        .collect::<Vec<_>>()
        .join("|")
}

/// Index servi depuis le cache s’il correspond (version, racine, signature).
/// Un cache sans `index` donne un corps vide, comme `JSON.stringify(undefined)`.
fn read_cache(cache_file: &str, root: &str, signature: &str) -> Option<Vec<u8>> {
    let cached = parse_lossy(&fs::read(cache_file).ok()?)?;
    let cached = cached.as_object()?;
    let valid = cached.get("version").and_then(Value::as_f64) == Some(f64::from(INDEX_VERSION))
        && cached.get("root").and_then(Value::as_str) == Some(root)
        && cached.get("signature").and_then(Value::as_str) == Some(signature);
    if !valid {
        return None;
    }
    Some(cached.get("index").map(|index| stringify(index).into_bytes()).unwrap_or_default())
}

struct Texture {
    path: String,
    width: u32,
    height: u32,
    usages: Vec<Value>,
}

/// Indexe un pack : taille de chaque PNG, glyphes-images de chaque police, et
/// pour chaque texture les polices qui l’utilisent. Le résultat (JSON prêt à
/// servir) est mis en cache sur disque, invalidé si le nombre de fichiers du
/// pack change.
pub fn build_index(source: &LibrarySource, cache_dir: &str) -> Result<Vec<u8>, HttpError> {
    let assets_dir = join(&source.root, "assets");
    let namespaces =
        list_dirs(Path::new(&assets_dir)).map_err(|_| HttpError::new(404, format!("Pack introuvable : {assets_dir}")))?;

    let listing: Vec<NamespaceListing> = namespaces
        .into_par_iter()
        .map(|namespace| {
            let base = join(&assets_dir, &namespace);
            NamespaceListing {
                textures: list_files(Path::new(&join(&base, "textures")), ".png"),
                fonts: list_files(Path::new(&join(&base, "font")), ".json"),
                namespace,
            }
        })
        .collect();
    let signature = cache_signature(&listing);
    let cache_file = join(cache_dir, &format!("{}.json", source.id));
    if let Some(index) = read_cache(&cache_file, &source.root, &signature) {
        return Ok(index);
    }

    let texture_jobs: Vec<(String, String)> = listing
        .iter()
        .flat_map(|entry| {
            entry.textures.iter().map(|relative| {
                let key = format!("assets/{}/textures/{relative}", entry.namespace);
                (key, join(&assets_dir, &format!("{}/textures/{relative}", entry.namespace)))
            })
        })
        .collect();
    let font_jobs: Vec<(String, String)> = listing
        .iter()
        .flat_map(|entry| {
            entry.fonts.iter().map(|relative| {
                let stem = if relative.to_ascii_lowercase().ends_with(".json") {
                    &relative[..relative.len() - 5]
                } else {
                    relative.as_str()
                };
                (format!("{}:{stem}", entry.namespace), join(&assets_dir, &format!("{}/font/{relative}", entry.namespace)))
            })
        })
        .collect();

    let sizes: Vec<Option<(u32, u32)>> = texture_jobs.par_iter().map(|(_, file)| read_png_size(file)).collect();
    let mut textures: Vec<Texture> = Vec::new();
    let mut by_path: HashMap<String, usize> = HashMap::new();
    for ((key, _), size) in texture_jobs.into_iter().zip(sizes) {
        if let Some((width, height)) = size {
            by_path.insert(key.clone(), textures.len());
            textures.push(Texture { path: key, width, height, usages: Vec::new() });
        }
    }
    let parsed: Vec<Result<Option<LibraryFont>, HttpError>> =
        font_jobs.par_iter().map(|(id, file)| parse_font(file, id)).collect();
    let mut fonts: Vec<LibraryFont> = Vec::new();
    for font in parsed {
        if let Some(font) = font? {
            fonts.push(font);
        }
    }

    // Les usages suivent l’ordre des fichiers de police, avant le tri final.
    for font in &mut fonts {
        for glyph in &mut font.glyphs {
            let position = by_path.get(&glyph.texture).copied();
            glyph.found = position.is_some();
            if let Some(position) = position {
                let mut usage = Map::new();
                usage.insert("font".into(), Value::String(font.id.clone()));
                usage.insert("ascent".into(), Value::Number(glyph.ascent.clone()));
                usage.insert("height".into(), Value::Number(glyph.height.clone()));
                textures[position].usages.push(Value::Object(usage));
            }
        }
    }

    textures.sort_by(|a, b| locale_compare(&a.path, &b.path));
    fonts.sort_by(|a, b| locale_compare(&a.id, &b.id));
    let index = index_value(textures, fonts);
    let index_json = stringify(&index);

    let mut cache = Map::new();
    cache.insert("version".into(), Value::from(INDEX_VERSION));
    cache.insert("root".into(), Value::String(source.root.clone()));
    cache.insert("signature".into(), Value::String(signature));
    cache.insert("index".into(), index);
    let written = fs::create_dir_all(cache_dir).and_then(|()| fs::write(&cache_file, stringify(&Value::Object(cache))));
    if let Err(error) = written {
        eprintln!("[menu-forge] cache d’index non écrit pour « {} » : {error}", source.id);
    }
    Ok(index_json.into_bytes())
}

fn index_value(textures: Vec<Texture>, fonts: Vec<LibraryFont>) -> Value {
    let textures = textures
        .into_iter()
        .map(|texture| {
            let mut map = Map::new();
            map.insert("path".into(), Value::String(texture.path));
            map.insert("width".into(), Value::from(texture.width));
            map.insert("height".into(), Value::from(texture.height));
            map.insert("usages".into(), Value::Array(texture.usages));
            Value::Object(map)
        })
        .collect();
    let fonts = fonts
        .into_iter()
        .map(|font| {
            let glyphs = font
                .glyphs
                .into_iter()
                .map(|glyph| {
                    let mut map = Map::new();
                    map.insert("texture".into(), Value::String(glyph.texture));
                    map.insert("ascent".into(), Value::Number(glyph.ascent));
                    map.insert("height".into(), Value::Number(glyph.height));
                    map.insert("found".into(), Value::Bool(glyph.found));
                    Value::Object(map)
                })
                .collect();
            let mut map = Map::new();
            map.insert("id".into(), Value::String(font.id));
            map.insert("glyphs".into(), Value::Array(glyphs));
            map.insert("references".into(), Value::Array(font.references.into_iter().map(Value::String).collect()));
            Value::Object(map)
        })
        .collect();
    let mut map = Map::new();
    map.insert("textures".into(), Value::Array(textures));
    map.insert("fonts".into(), Value::Array(fonts));
    Value::Object(map)
}

/// Index en mémoire (JSON prêt à servir), construit une seule fois. Partagé
/// entre deux jeux de bibliothèques successifs tant que la racine du pack ne
/// change pas (ajout ou retrait d’une autre bibliothèque, changement
/// d’espace de travail).
type IndexCell = Arc<Mutex<Option<Arc<Vec<u8>>>>>;

struct Slot {
    source: LibrarySource,
    index: IndexCell,
}

/// Routes `/libraries/*` : liste des sources, index d’un pack, lecture d’un
/// fichier (PNG, JSON), copie d’une texture dans l’espace de travail.
pub struct Libraries {
    slots: Vec<Slot>,
    cache_dir: String,
}

impl Libraries {
    pub fn new(sources: Vec<LibrarySource>, cache_dir: String) -> Self {
        Self::with_previous(sources, cache_dir, None)
    }

    /// Comme [`Libraries::new`], en reprenant les index déjà construits par
    /// `previous` pour les bibliothèques de même identifiant et même racine.
    pub fn with_previous(sources: Vec<LibrarySource>, cache_dir: String, previous: Option<&Libraries>) -> Self {
        // Comme `new Map(...)` : un doublon garde la place du premier, la valeur du dernier.
        let mut slots: Vec<Slot> = Vec::new();
        for source in sources.into_iter().filter(|source| is_valid_library_id(&source.id)) {
            let reused = previous.and_then(|previous| {
                previous
                    .slots
                    .iter()
                    .find(|slot| slot.source.id == source.id && slot.source.root == source.root)
                    .map(|slot| Arc::clone(&slot.index))
            });
            let slot = Slot { source, index: reused.unwrap_or_default() };
            match slots.iter().position(|existing| existing.source.id == slot.source.id) {
                Some(position) => slots[position] = slot,
                None => slots.push(slot),
            }
        }
        Self { slots, cache_dir }
    }

    pub fn sources(&self) -> impl Iterator<Item = &LibrarySource> {
        self.slots.iter().map(|slot| &slot.source)
    }

    /// Reconstruit l’index d’une bibliothèque en ignorant les caches (mémoire
    /// et disque), et renvoie `{ id, textures, fonts }` (nombres d’entrées).
    pub fn reindex(&self, id: &str) -> Result<Value, HttpError> {
        let slot = self.slot(id)?;
        let mut cell = slot.index.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        *cell = None;
        let cache_file = join(&self.cache_dir, &format!("{}.json", slot.source.id));
        if let Err(error) = fs::remove_file(&cache_file) {
            if error.kind() != std::io::ErrorKind::NotFound {
                return Err(HttpError::new(500, format!("Cache d’index non supprimé : {cache_file} ({error})")));
            }
        }
        let index = Arc::new(build_index(&slot.source, &self.cache_dir)?);
        *cell = Some(Arc::clone(&index));
        drop(cell);
        let parsed = parse_lossy(&index).unwrap_or(Value::Null);
        let count = |key: &str| parsed.get(key).and_then(Value::as_array).map_or(0, Vec::len);
        let mut map = Map::new();
        map.insert("id".into(), Value::String(slot.source.id.clone()));
        map.insert("textures".into(), Value::from(count("textures")));
        map.insert("fonts".into(), Value::from(count("fonts")));
        Ok(Value::Object(map))
    }

    fn slot(&self, id: &str) -> Result<&Slot, HttpError> {
        self.slots
            .iter()
            .find(|slot| slot.source.id == id)
            .ok_or_else(|| HttpError::new(404, format!("Bibliothèque inconnue : {id}")))
    }

    fn index_of(&self, slot: &Slot) -> Result<Arc<Vec<u8>>, HttpError> {
        // Le verrou est gardé pendant la construction : les requêtes simultanées
        // sur le même pack attendent le même index (une erreur n’est pas retenue).
        let mut cell = slot.index.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(index) = cell.as_ref() {
            return Ok(Arc::clone(index));
        }
        let index = Arc::new(build_index(&slot.source, &self.cache_dir)?);
        *cell = Some(Arc::clone(&index));
        Ok(index)
    }

    /// Traite la requête si elle concerne les bibliothèques ; `None` sinon.
    /// `workspace_textures` : dossier `textures/` de l’espace de travail actif
    /// (destination des imports).
    pub fn route(
        &self,
        request: &Request,
        pathname: &str,
        method: &str,
        workspace_textures: &str,
    ) -> Result<Option<Response>, HttpError> {
        if pathname == "/libraries" && method == "GET" {
            let list: Vec<Value> = self
                .sources()
                .map(|source| {
                    let mut map = Map::new();
                    map.insert("id".into(), Value::String(source.id.clone()));
                    map.insert("name".into(), Value::String(source.name.clone()));
                    map.insert("ownership".into(), Value::String(source.ownership.as_str().into()));
                    Value::Object(map)
                })
                .collect();
            return Ok(Some(Response::json(stringify(&Value::Array(list)).into_bytes())));
        }

        let Some((raw_id, action, extra)) = library_route(pathname) else {
            return Ok(None);
        };
        let slot = self.slot(&decode_component(raw_id)?)?;
        let source = &slot.source;

        match (action, method) {
            ("index", "GET") => Ok(Some(Response::json(self.index_of(slot)?.as_ref().clone()))),
            ("raw", "GET") => {
                let relative = decode_path(extra.unwrap_or(""))?;
                let file = inside_root(&source.root, &relative)?;
                let lower = relative.to_lowercase();
                if lower.ends_with(".png") {
                    return read_png(&file, &relative).map(Some);
                }
                // Les JSON (polices, modèles) servent au moteur de texte et aux imports.
                if lower.ends_with(".json") {
                    let content = fs::read(&file)
                        .map_err(|_| HttpError::new(404, format!("Fichier introuvable : {relative}")))?;
                    return Ok(Some(Response::json(String::from_utf8_lossy(&content).into_owned().into_bytes())));
                }
                Err(HttpError::new(400, "Seuls les PNG et les JSON sont servis"))
            }
            ("import", "POST") => import(source, &request.body, workspace_textures).map(Some),
            _ => Err(HttpError::new(405, format!("Méthode non prise en charge : {method} {pathname}"))),
        }
    }
}

/// Copie une texture du pack dans `<textures>/library/<id>/…`.
fn import(source: &LibrarySource, body: &[u8], workspace_textures: &str) -> Result<Response, HttpError> {
    let body = parse_lossy(body).ok_or_else(|| HttpError::new(400, "JSON invalide"))?;
    let relative = match &body {
        Value::Null => {
            return Err(HttpError::new(
                500,
                "Cannot destructure property 'path' of '(intermediate value)' as it is null.",
            ));
        }
        Value::Object(map) => map.get("path").and_then(Value::as_str),
        _ => None,
    };
    let relative = match relative {
        Some(relative) if relative.to_lowercase().ends_with(".png") => relative,
        _ => return Err(HttpError::new(400, "Chemin de texture attendu")),
    };
    let from = inside_root(&source.root, relative)?;
    let target = format!("library/{}/{}", source.id, relative.strip_prefix("assets/").unwrap_or(relative));
    let to = inside_root(workspace_textures, &target)?;
    ensure_parent(&to)?;
    fs::copy(&from, &to)
        .map_err(|_| HttpError::new(404, format!("Texture introuvable dans la bibliothèque : {relative}")))?;
    let mut map = Map::new();
    map.insert("texture".into(), Value::String(target));
    Ok(Response::json(stringify(&Value::Object(map)).into_bytes()))
}

/// `^\/libraries\/([^/]+)\/(index|raw|import)(?:\/(.*))?$`.
fn library_route(pathname: &str) -> Option<(&str, &str, Option<&str>)> {
    let rest = pathname.strip_prefix("/libraries/")?;
    let (id, after) = rest.split_once('/')?;
    if id.is_empty() {
        return None;
    }
    for action in ["index", "raw", "import"] {
        if after == action {
            return Some((id, action, None));
        }
        if let Some(extra) = after.strip_prefix(action).and_then(|tail| tail.strip_prefix('/')) {
            return Some((id, action, Some(extra)));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texture_of_file_resolution() {
        assert_eq!(texture_of_file("custom/x"), "assets/minecraft/textures/custom/x.png");
        assert_eq!(texture_of_file("custom/x.png"), "assets/minecraft/textures/custom/x.png");
        assert_eq!(texture_of_file("ns:ui/y.png"), "assets/ns/textures/ui/y.png");
        assert_eq!(texture_of_file("ns:ui/y"), "assets/ns/textures/ui/y.png");
        // `split(':', 2)` ignore ce qui suit le second `:`.
        assert_eq!(texture_of_file("a:b:c"), "assets/a/textures/b.png");
        // `endsWith('.png')` est sensible à la casse.
        assert_eq!(texture_of_file("x.PNG"), "assets/minecraft/textures/x.PNG.png");
    }

    #[test]
    fn font_parsing_keeps_single_char_bitmaps() {
        let data: Value = serde_json::from_str(
            r#"{"providers":[
                {"type":"bitmap","file":"ui/a.png","ascent":12,"height":-3.5,"chars":[""]},
                {"type":"bitmap","file":"ns:ui/b","chars":["😀"]},
                {"type":"bitmap","file":"font/ascii.png","chars":["ab","cd"]},
                {"type":"bitmap","file":"ui/c.png","chars":["", "x"]},
                {"type":"bitmap","file":"ui/d.png","chars":"x"},
                {"type":"reference","id":"menus/home"},
                {"type":"reference","id":"ns:other"},
                {"type":"space","advances":{" ":4}},
                5, "texte", []
            ]}"#,
        )
        .unwrap();
        let font = parse_font_value(&data, "minecraft:test").unwrap();
        assert_eq!(font.references, ["minecraft:menus/home", "ns:other"]);
        let textures: Vec<&str> = font.glyphs.iter().map(|glyph| glyph.texture.as_str()).collect();
        assert_eq!(
            textures,
            ["assets/minecraft/textures/ui/a.png", "assets/ns/textures/ui/b.png", "assets/minecraft/textures/ui/c.png"]
        );
        assert_eq!(font.glyphs[0].ascent, Number::from(12));
        assert_eq!(font.glyphs[0].height.as_f64(), Some(-3.5));
        assert_eq!(font.glyphs[1].ascent, Number::from(7));
        assert_eq!(font.glyphs[1].height, Number::from(8));
    }

    #[test]
    fn font_parsing_type_errors() {
        let error = parse_font_value(&Value::Null, "x").unwrap_err();
        assert_eq!(error.status, 500);
        let data: Value = serde_json::from_str(r#"{"providers":[null]}"#).unwrap();
        assert_eq!(parse_font_value(&data, "x").unwrap_err().message, "Cannot read properties of null (reading 'type')");
        let data: Value = serde_json::from_str(r#"[1,2]"#).unwrap();
        assert!(parse_font_value(&data, "x").unwrap().glyphs.is_empty());
    }

    #[test]
    fn png_header() {
        let mut header = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R'];
        header.extend_from_slice(&256u32.to_be_bytes());
        header.extend_from_slice(&16u32.to_be_bytes());
        assert_eq!(png_size_from_header(&header), Some((256, 16)));
        assert_eq!(png_size_from_header(&header[..23]), None);
        let mut not_png = header.clone();
        not_png[0] = 0;
        assert_eq!(png_size_from_header(&not_png), None);
    }

    #[test]
    fn signature_format() {
        let listing = vec![
            NamespaceListing { namespace: "minecraft".into(), textures: vec!["a.png".into(); 3], fonts: vec![] },
            NamespaceListing { namespace: "nameplates".into(), textures: vec![], fonts: vec!["f.json".into()] },
        ];
        assert_eq!(cache_signature(&listing), "minecraft:3:0|nameplates:0:1");
        assert_eq!(cache_signature(&[]), "");
    }

    #[test]
    fn cache_is_shared_and_validated() {
        let dir = std::env::temp_dir().join(format!("studio-backend-cache-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("lib.json");
        let file = file.to_string_lossy();
        fs::write(&*file, r#"{"version":1,"root":"R","signature":"minecraft:1:0","index":{"textures":[],"fonts":[]}}"#)
            .unwrap();
        assert_eq!(read_cache(&file, "R", "minecraft:1:0").unwrap(), br#"{"textures":[],"fonts":[]}"#);
        assert!(read_cache(&file, "R", "minecraft:2:0").is_none());
        assert!(read_cache(&file, "autre", "minecraft:1:0").is_none());
        fs::write(&*file, r#"{"version":2,"root":"R","signature":"s","index":{}}"#).unwrap();
        assert!(read_cache(&file, "R", "s").is_none());
        fs::write(&*file, r#"{"version":1.0,"root":"R","signature":"s"}"#).unwrap();
        assert_eq!(read_cache(&file, "R", "s").unwrap(), b"");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn library_routes() {
        assert_eq!(library_route("/libraries/v/index"), Some(("v", "index", None)));
        assert_eq!(library_route("/libraries/v/raw/assets/a.png"), Some(("v", "raw", Some("assets/a.png"))));
        assert_eq!(library_route("/libraries/v/raw/"), Some(("v", "raw", Some(""))));
        assert_eq!(library_route("/libraries/v/indexx"), None);
        assert_eq!(library_route("/libraries//index"), None);
        assert_eq!(library_route("/libraries/v"), None);
    }

    #[test]
    fn library_ids() {
        assert!(is_valid_library_id("reference_pack_2026"));
        assert!(is_valid_library_id("a-b"));
        assert!(!is_valid_library_id("A"));
        assert!(!is_valid_library_id(""));
        assert!(!is_valid_library_id("a/b"));
    }
}
