//! Réglages persistants du studio : espaces de travail connus, espace actif,
//! bibliothèques, préférences d’interface et d’export.
//!
//! Un seul fichier JSON (chemin fourni par `BackendConfig::settings_path`),
//! écrit de façon atomique (fichier temporaire puis renommage). La même
//! validation sert à relire le fichier et à appliquer un `PUT /settings` :
//! un document partiel est « appliqué » sur des réglages existants.
//!
//! Forme du fichier (et de `GET /settings`) :
//!
//! ```json
//! {
//!   "version": 1,
//!   "activeWorkspace": "C:\\…\\menu-forge",
//!   "workspaces": [{ "path": "C:\\…\\menu-forge", "name": "menu-forge", "lastOpened": "2026-09-10T08:00:00.000Z" }],
//!   "libraries": [{ "id": "vanilla", "name": "…", "root": "C:\\…", "ownership": "third-party" }],
//!   "ui": { "defaultZoom": 3, "showGrid": true, "confirmations": { "delete": true, "discardChanges": true } },
//!   "export": { "enderiumResources": null, "namespace": "menuforge", "packFormat": 46 }
//! }
//! ```

use std::fs;
use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value};

use crate::js::{parse_lossy, stringify_pretty};
use crate::libraries::{is_valid_library_id, LibrarySource, Ownership};
use crate::paths;

/// Version du format de réglages.
pub const SETTINGS_VERSION: u64 = 1;
/// Zoom par défaut de la toile (niveaux proposés par le studio : 1 à 12).
pub const DEFAULT_ZOOM: u64 = 3;
pub const MAX_ZOOM: u64 = 12;
/// Espace de noms par défaut des polices générées (celui de la lib).
pub const DEFAULT_NAMESPACE: &str = "menuforge";
/// `pack_format` par défaut (46 = Minecraft 1.21.4, comme la lib).
pub const DEFAULT_PACK_FORMAT: u64 = 46;

/// Espace de travail déjà ouvert.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KnownWorkspace {
    /// Chemin absolu, normalisé.
    pub path: String,
    pub name: String,
    /// Date du dernier accès (ISO 8601, UTC).
    pub last_opened: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Confirmations {
    /// Demander avant de supprimer (couche, zone, document).
    pub delete: bool,
    /// Demander avant d’abandonner des modifications non enregistrées.
    pub discard_changes: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UiSettings {
    pub default_zoom: u64,
    pub show_grid: bool,
    pub confirmations: Confirmations,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExportSettings {
    /// Dossier des ressources d’enderium-core (`core/src/main/resources`), s’il est connu.
    pub enderium_resources: Option<String>,
    pub namespace: String,
    pub pack_format: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Settings {
    pub active_workspace: String,
    /// Du plus récemment ouvert au plus ancien.
    pub workspaces: Vec<KnownWorkspace>,
    pub libraries: Vec<LibrarySource>,
    pub ui: UiSettings,
    pub export: ExportSettings,
}

impl Settings {
    /// Réglages d’un premier lancement : un seul espace de travail connu.
    pub fn first_launch(default_workspace: &str, libraries: Vec<LibrarySource>) -> Self {
        let path = paths::resolve(&[default_workspace]);
        Self {
            workspaces: vec![KnownWorkspace { name: folder_name(&path), path: path.clone(), last_opened: now_iso() }],
            active_workspace: path,
            libraries,
            ui: UiSettings {
                default_zoom: DEFAULT_ZOOM,
                show_grid: true,
                confirmations: Confirmations { delete: true, discard_changes: true },
            },
            export: ExportSettings {
                enderium_resources: None,
                namespace: DEFAULT_NAMESPACE.to_owned(),
                pack_format: DEFAULT_PACK_FORMAT,
            },
        }
    }

    /// Position d’un espace de travail connu.
    pub fn workspace_position(&self, path: &str) -> Option<usize> {
        self.workspaces.iter().position(|workspace| same_path(&workspace.path, path))
    }

    /// Marque `path` comme ouvert maintenant : l’ajoute si besoin, le place en
    /// tête de liste et en fait l’espace actif.
    pub fn touch_workspace(&mut self, path: &str, name: Option<&str>) {
        let path = paths::resolve(&[path]);
        let mut entry = match self.workspace_position(&path) {
            Some(position) => self.workspaces.remove(position),
            None => KnownWorkspace { name: folder_name(&path), path: path.clone(), last_opened: String::new() },
        };
        if let Some(name) = name {
            entry.name = name.to_owned();
        }
        entry.last_opened = now_iso();
        self.workspaces.insert(0, entry);
        self.active_workspace = path;
    }

    pub fn to_value(&self) -> Value {
        let mut root = Map::new();
        root.insert("version".into(), Value::from(SETTINGS_VERSION));
        root.insert("activeWorkspace".into(), Value::String(self.active_workspace.clone()));
        root.insert("workspaces".into(), Value::Array(self.workspaces.iter().map(workspace_value).collect()));
        root.insert("libraries".into(), Value::Array(self.libraries.iter().map(library_value).collect()));

        let mut confirmations = Map::new();
        confirmations.insert("delete".into(), Value::Bool(self.ui.confirmations.delete));
        confirmations.insert("discardChanges".into(), Value::Bool(self.ui.confirmations.discard_changes));
        let mut ui = Map::new();
        ui.insert("defaultZoom".into(), Value::from(self.ui.default_zoom));
        ui.insert("showGrid".into(), Value::Bool(self.ui.show_grid));
        ui.insert("confirmations".into(), Value::Object(confirmations));
        root.insert("ui".into(), Value::Object(ui));

        let mut export = Map::new();
        export.insert(
            "enderiumResources".into(),
            self.export.enderium_resources.clone().map(Value::String).unwrap_or(Value::Null),
        );
        export.insert("namespace".into(), Value::String(self.export.namespace.clone()));
        export.insert("packFormat".into(), Value::from(self.export.pack_format));
        root.insert("export".into(), Value::Object(export));
        Value::Object(root)
    }

    /// Document JSON tel qu’écrit sur disque (indenté, retour à la ligne final).
    pub fn to_json(&self) -> String {
        format!("{}\n", stringify_pretty(&self.to_value()))
    }
}

pub fn workspace_value(workspace: &KnownWorkspace) -> Value {
    let mut map = Map::new();
    map.insert("path".into(), Value::String(workspace.path.clone()));
    map.insert("name".into(), Value::String(workspace.name.clone()));
    map.insert("lastOpened".into(), Value::String(workspace.last_opened.clone()));
    Value::Object(map)
}

pub fn library_value(library: &LibrarySource) -> Value {
    let mut map = Map::new();
    map.insert("id".into(), Value::String(library.id.clone()));
    map.insert("name".into(), Value::String(library.name.clone()));
    map.insert("root".into(), Value::String(library.root.clone()));
    map.insert("ownership".into(), Value::String(library.ownership.as_str().into()));
    Value::Object(map)
}

/// Nom du dernier segment d’un chemin (`C:\a\mon espace` → `mon espace`).
pub fn folder_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path.to_owned())
}

/// Deux chemins désignent-ils le même dossier ? (insensible à la casse sous Windows)
pub fn same_path(a: &str, b: &str) -> bool {
    let (a, b) = (paths::resolve(&[a]), paths::resolve(&[b]));
    if cfg!(windows) { a.to_lowercase() == b.to_lowercase() } else { a == b }
}

// ------------------------------------------------------------------ dates

/// Date au format de `Date.prototype.toISOString` (UTC, millisecondes).
pub fn iso_utc(time: SystemTime) -> String {
    let millis = match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as i64,
        Err(error) => -(error.duration().as_millis() as i64),
    };
    let seconds = millis.div_euclid(1000);
    let (days, rest) = (seconds.div_euclid(86_400), seconds.rem_euclid(86_400));
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60,
        millis.rem_euclid(1000)
    )
}

pub fn now_iso() -> String {
    iso_utc(SystemTime::now())
}

/// Jour civil (année, mois, jour) d’un nombre de jours depuis 1970-01-01
/// (algorithme de Howard Hinnant).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

// ------------------------------------------------------------- validation

/// Chemin absolu attendu (`C:\…` sous Windows, `/…` ailleurs), renvoyé normalisé.
pub fn absolute_path(value: &Value, key: &str) -> Result<String, String> {
    let text = value.as_str().ok_or_else(|| format!("« {key} » doit être un chemin (texte)"))?;
    if text.trim().is_empty() || !Path::new(text).is_absolute() {
        return Err(format!("« {key} » doit être un chemin absolu (reçu : « {text} »)"));
    }
    Ok(paths::resolve(&[text]))
}

/// Dossier existant attendu.
pub fn existing_dir(path: &str, key: &str) -> Result<(), String> {
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => Ok(()),
        Ok(_) => Err(format!("« {key} » n’est pas un dossier : {path}")),
        Err(_) => Err(format!("« {key} » : dossier introuvable : {path}")),
    }
}

/// Racine d’un resource pack extrait : dossier existant contenant `assets/`.
pub fn check_pack_root(root: &str, key: &str) -> Result<(), String> {
    existing_dir(root, key)?;
    if !Path::new(root).join("assets").is_dir() {
        return Err(format!(
            "« {key} » : ce dossier ne contient pas de dossier assets/, ce n’est pas un resource pack extrait : {root}"
        ));
    }
    Ok(())
}

/// Espace de noms Minecraft : `^[a-z0-9_.-]+$` (même règle que la lib).
pub fn is_valid_namespace(namespace: &str) -> bool {
    !namespace.is_empty()
        && namespace.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'_' | b'.' | b'-'))
}

fn object<'a>(value: &'a Value, key: &str) -> Result<&'a Map<String, Value>, String> {
    value.as_object().ok_or_else(|| format!("« {key} » doit être un objet"))
}

fn boolean(value: &Value, key: &str) -> Result<bool, String> {
    value.as_bool().ok_or_else(|| format!("« {key} » doit valoir true ou false"))
}

fn integer(value: &Value, key: &str, min: u64, max: u64) -> Result<u64, String> {
    value
        .as_u64()
        .or_else(|| value.as_f64().filter(|number| number.fract() == 0.0 && *number >= 0.0).map(|number| number as u64))
        .filter(|number| (min..=max).contains(number))
        .ok_or_else(|| format!("« {key} » doit être un entier entre {min} et {max}"))
}

fn non_empty_text(value: &Value, key: &str) -> Result<String, String> {
    match value.as_str().map(str::trim) {
        Some(text) if !text.is_empty() && text.chars().count() <= 200 => Ok(text.to_owned()),
        _ => Err(format!("« {key} » doit être un texte non vide (200 caractères au plus)")),
    }
}

fn unknown_keys(map: &Map<String, Value>, allowed: &[&str], prefix: &str) -> Result<(), String> {
    match map.keys().find(|key| !allowed.contains(&key.as_str())) {
        Some(key) => Err(format!("Réglage inconnu : « {prefix}{key} »")),
        None => Ok(()),
    }
}

/// Valide une bibliothèque (`POST /libraries`, entrée de `libraries`). `name`
/// et `ownership` sont facultatifs, comme dans `libraries.local.json`.
/// `check_root` : vérifier que la racine est un pack extrait existant.
/// Une chaîne `key` vide désigne le corps de la requête lui-même.
pub fn parse_library(value: &Value, key: &str, check_root: bool) -> Result<LibrarySource, String> {
    let field = |name: &str| if key.is_empty() { name.to_owned() } else { format!("{key}.{name}") };
    let map = match (value.as_object(), key.is_empty()) {
        (Some(map), _) => map,
        (None, true) => return Err("Le corps de la requête doit être un objet JSON".to_owned()),
        (None, false) => return Err(format!("« {key} » doit être un objet")),
    };
    unknown_keys(map, &["id", "name", "root", "ownership"], &field(""))?;
    let id = match map.get("id").and_then(Value::as_str) {
        Some(id) if is_valid_library_id(id) => id.to_owned(),
        Some(id) => {
            return Err(format!(
                "« {} » invalide : « {id} » (lettres minuscules, chiffres, « _ » et « - » seulement)",
                field("id")
            ));
        }
        None => return Err(format!("« {} » est obligatoire (texte)", field("id"))),
    };
    let name = match map.get("name") {
        None => id.clone(),
        Some(name) => non_empty_text(name, &field("name"))?,
    };
    let root = absolute_path(map.get("root").unwrap_or(&Value::Null), &field("root"))?;
    if check_root {
        check_pack_root(&root, &field("root"))?;
    }
    let ownership = match map.get("ownership").map(|value| value.as_str()) {
        None | Some(Some("third-party")) => Ownership::ThirdParty,
        Some(Some("own")) => Ownership::Own,
        Some(_) => return Err(format!("« {} » doit valoir « own » ou « third-party »", field("ownership"))),
    };
    Ok(LibrarySource { id, name, root, ownership })
}

/// Applique un document (complet ou partiel) sur `base`.
///
/// Clés de premier niveau inconnues refusées ; `ui`, `export` et
/// `ui.confirmations` sont fusionnés clé par clé ; `workspaces` et `libraries`
/// sont remplacés en entier. `check_paths` : vérifier sur le disque les
/// chemins **nouveaux ou modifiés** par rapport à `base` (un réglage relu tel
/// quel ne devient pas invalide parce qu’un disque est débranché).
pub fn apply_patch(base: &Settings, patch: &Value, check_paths: bool) -> Result<Settings, String> {
    let patch = patch.as_object().ok_or("Les réglages doivent être un objet JSON")?;
    unknown_keys(patch, &["version", "activeWorkspace", "workspaces", "libraries", "ui", "export"], "")?;
    let mut next = base.clone();

    if let Some(version) = patch.get("version") {
        if version.as_u64() != Some(SETTINGS_VERSION) && version.as_f64() != Some(SETTINGS_VERSION as f64) {
            return Err(format!("Version de réglages non prise en charge : {version} (attendue : {SETTINGS_VERSION})"));
        }
    }

    if let Some(value) = patch.get("workspaces") {
        let items = value.as_array().ok_or("« workspaces » doit être une liste")?;
        let mut workspaces: Vec<KnownWorkspace> = Vec::new();
        for (position, item) in items.iter().enumerate() {
            let key = format!("workspaces[{position}]");
            let map = object(item, &key)?;
            unknown_keys(map, &["path", "name", "lastOpened"], &format!("{key}."))?;
            let path = absolute_path(map.get("path").unwrap_or(&Value::Null), &format!("{key}.path"))?;
            if workspaces.iter().any(|known| same_path(&known.path, &path)) {
                return Err(format!("« {key}.path » : espace de travail en double : {path}"));
            }
            let name = match map.get("name") {
                None => folder_name(&path),
                Some(name) => non_empty_text(name, &format!("{key}.name"))?,
            };
            let last_opened = match map.get("lastOpened") {
                None => String::new(),
                Some(Value::String(date)) => date.clone(),
                Some(_) => return Err(format!("« {key}.lastOpened » doit être une date (texte ISO 8601)")),
            };
            workspaces.push(KnownWorkspace { path, name, last_opened });
        }
        next.workspaces = workspaces;
    }

    if let Some(value) = patch.get("activeWorkspace") {
        let path = absolute_path(value, "activeWorkspace")?;
        if check_paths && !same_path(&path, &base.active_workspace) {
            existing_dir(&path, "activeWorkspace")?;
        }
        next.active_workspace = path;
    }
    // L’espace actif fait toujours partie des espaces connus.
    if next.workspace_position(&next.active_workspace).is_none() {
        let path = next.active_workspace.clone();
        next.workspaces.insert(0, KnownWorkspace { name: folder_name(&path), path, last_opened: now_iso() });
    }

    if let Some(value) = patch.get("libraries") {
        let items = value.as_array().ok_or("« libraries » doit être une liste")?;
        let mut libraries: Vec<LibrarySource> = Vec::new();
        for (position, item) in items.iter().enumerate() {
            let key = format!("libraries[{position}]");
            let library = parse_library(item, &key, false)?;
            if libraries.iter().any(|known| known.id == library.id) {
                return Err(format!("« {key}.id » : identifiant de bibliothèque en double : {}", library.id));
            }
            let unchanged = base.libraries.iter().any(|known| known.id == library.id && same_path(&known.root, &library.root));
            if check_paths && !unchanged {
                check_pack_root(&library.root, &format!("{key}.root"))?;
            }
            libraries.push(library);
        }
        next.libraries = libraries;
    }

    if let Some(value) = patch.get("ui") {
        let ui = object(value, "ui")?;
        unknown_keys(ui, &["defaultZoom", "showGrid", "confirmations"], "ui.")?;
        if let Some(zoom) = ui.get("defaultZoom") {
            next.ui.default_zoom = integer(zoom, "ui.defaultZoom", 1, MAX_ZOOM)?;
        }
        if let Some(grid) = ui.get("showGrid") {
            next.ui.show_grid = boolean(grid, "ui.showGrid")?;
        }
        if let Some(value) = ui.get("confirmations") {
            let confirmations = object(value, "ui.confirmations")?;
            unknown_keys(confirmations, &["delete", "discardChanges"], "ui.confirmations.")?;
            if let Some(flag) = confirmations.get("delete") {
                next.ui.confirmations.delete = boolean(flag, "ui.confirmations.delete")?;
            }
            if let Some(flag) = confirmations.get("discardChanges") {
                next.ui.confirmations.discard_changes = boolean(flag, "ui.confirmations.discardChanges")?;
            }
        }
    }

    if let Some(value) = patch.get("export") {
        let export = object(value, "export")?;
        unknown_keys(export, &["enderiumResources", "namespace", "packFormat"], "export.")?;
        if let Some(value) = export.get("enderiumResources") {
            next.export.enderium_resources = match value {
                Value::Null => None,
                value => {
                    let path = absolute_path(value, "export.enderiumResources")?;
                    let unchanged = base.export.enderium_resources.as_deref().is_some_and(|old| same_path(old, &path));
                    if check_paths && !unchanged {
                        existing_dir(&path, "export.enderiumResources")?;
                    }
                    Some(path)
                }
            };
        }
        if let Some(value) = export.get("namespace") {
            match value.as_str() {
                Some(namespace) if is_valid_namespace(namespace) => next.export.namespace = namespace.to_owned(),
                _ => {
                    return Err(
                        "« export.namespace » invalide (lettres minuscules, chiffres, « _ », « . » et « - » seulement)"
                            .to_owned(),
                    );
                }
            }
        }
        if let Some(value) = export.get("packFormat") {
            next.export.pack_format = integer(value, "export.packFormat", 1, 1000)?;
        }
    }
    Ok(next)
}

// ---------------------------------------------------------------- fichier

/// Résultat de la lecture du fichier de réglages.
pub enum Loaded {
    /// Fichier lu et valide.
    Existing(Settings),
    /// Pas de fichier : premier lancement.
    Missing,
    /// Fichier illisible ou invalide, mis de côté sous ce nom.
    Invalid { reason: String, backup: Option<String> },
}

/// Relit le fichier ; un fichier invalide est renommé en
/// `settings.invalid-<horodatage>.json` pour ne jamais être écrasé.
pub fn load(path: &str, defaults: &Settings) -> Loaded {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Loaded::Missing,
        Err(error) => return Loaded::Invalid { reason: error.to_string(), backup: None },
    };
    let parsed = parse_lossy(&bytes).ok_or_else(|| "JSON invalide".to_owned());
    let patch_base = Settings { workspaces: Vec::new(), ..defaults.clone() };
    match parsed.and_then(|value| apply_patch(&patch_base, &value, false)) {
        Ok(settings) => Loaded::Existing(settings),
        Err(reason) => {
            let stamp = now_iso().replace([':', '.'], "-");
            let backup = format!("{}.invalid-{stamp}.json", path.trim_end_matches(".json"));
            let backup = fs::rename(path, &backup).ok().map(|()| backup);
            Loaded::Invalid { reason, backup }
        }
    }
}

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Écrit `content` dans `path` de façon atomique : fichier temporaire à côté,
/// vidé sur le disque, puis renommé par-dessus l’ancien.
pub fn write_atomic(path: &str, content: &[u8]) -> io::Result<()> {
    let parent = paths::dirname(path);
    fs::create_dir_all(&parent)?;
    let temp = format!(
        "{path}.{}-{}.tmp",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let written = (|| {
        let mut file = fs::File::create(&temp)?;
        file.write_all(content)?;
        file.sync_all()
    })();
    let result = written.and_then(|()| fs::rename(&temp, path));
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ABSOLUTE: &str = if cfg!(windows) { r"C:\x" } else { "/x" };

    fn base() -> Settings {
        Settings::first_launch(if cfg!(windows) { r"C:\ws\a" } else { "/ws/a" }, Vec::new())
    }

    #[test]
    fn iso_dates_match_javascript() {
        assert_eq!(iso_utc(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        let time = UNIX_EPOCH + std::time::Duration::from_millis(1_788_998_400_123);
        assert_eq!(iso_utc(time), "2026-09-10T00:00:00.123Z");
        let leap = UNIX_EPOCH + std::time::Duration::from_secs(951_782_400); // 29/02/2000
        assert_eq!(iso_utc(leap), "2000-02-29T00:00:00.000Z");
    }

    #[test]
    fn partial_patch_merges_nested_objects() {
        let next = apply_patch(&base(), &json!({"ui": {"confirmations": {"delete": false}}}), true).unwrap();
        assert!(!next.ui.confirmations.delete);
        assert!(next.ui.confirmations.discard_changes);
        assert_eq!(next.ui.default_zoom, DEFAULT_ZOOM);
        let round_trip = apply_patch(&next, &next.to_value(), true).unwrap();
        assert_eq!(round_trip, next);
    }

    #[test]
    fn strict_validation_in_french() {
        let cases = [
            (json!([]), "Les réglages doivent être un objet JSON"),
            (json!({"theme": 1}), "Réglage inconnu : « theme »"),
            (json!({"ui": {"zoom": 2}}), "Réglage inconnu : « ui.zoom »"),
            (json!({"ui": {"defaultZoom": 0}}), "« ui.defaultZoom » doit être un entier entre 1 et 12"),
            (json!({"ui": {"defaultZoom": 2.5}}), "« ui.defaultZoom » doit être un entier entre 1 et 12"),
            (json!({"ui": {"showGrid": "oui"}}), "« ui.showGrid » doit valoir true ou false"),
            (json!({"export": {"namespace": "Menu"}}), "« export.namespace » invalide"),
            (json!({"export": {"packFormat": -1}}), "« export.packFormat » doit être un entier entre 1 et 1000"),
            (json!({"activeWorkspace": "relatif/ws"}), "« activeWorkspace » doit être un chemin absolu"),
            (json!({"version": 2}), "Version de réglages non prise en charge"),
            (json!({"libraries": [{"id": "A", "root": "/x"}]}), "« libraries[0].id » invalide"),
            (json!({"libraries": [{"id": "a", "root": "x"}]}), "« libraries[0].root » doit être un chemin absolu"),
            (json!({"libraries": [{"id": "a", "root": ABSOLUTE, "ownership": "mine"}]}), "« libraries[0].ownership »"),
        ];
        for (patch, expected) in cases {
            let error = apply_patch(&base(), &patch, false).unwrap_err();
            assert!(error.starts_with(expected), "{patch} → {error}");
        }
    }

    #[test]
    fn active_workspace_is_always_known() {
        let other = if cfg!(windows) { r"C:\ws\b" } else { "/ws/b" };
        let next = apply_patch(&base(), &json!({"activeWorkspace": other, "workspaces": []}), false).unwrap();
        assert_eq!(next.workspaces.len(), 1);
        assert!(same_path(&next.workspaces[0].path, other));
    }

    #[test]
    fn touch_moves_workspace_to_front() {
        let mut settings = base();
        let other = if cfg!(windows) { r"C:\ws\b" } else { "/ws/b" };
        settings.touch_workspace(other, Some("B"));
        settings.touch_workspace(&settings.workspaces[1].path.clone(), None);
        assert_eq!(settings.workspaces.len(), 2);
        assert_eq!(settings.workspaces[1].name, "B");
        assert_eq!(settings.workspaces[0].name, "a");
    }
}
