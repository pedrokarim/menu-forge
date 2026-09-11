//! Lecture de dossiers avec les mêmes règles que `listFiles` (serveur TypeScript).

use std::fs;
use std::io;
use std::path::Path;

use crate::js::utf16_compare;

fn walk(dir: &Path, prefix: &str, extension: &str, out: &mut Vec<String>) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let relative = if prefix.is_empty() { name } else { format!("{prefix}/{name}") };
        // Comme `readdir({ recursive: true })` : les liens ne sont pas suivis,
        // et un dossier dont le nom finit par l’extension est listé aussi.
        let is_dir = entry.file_type()?.is_dir();
        if relative.to_lowercase().ends_with(extension) {
            out.push(relative.clone());
        }
        if is_dir {
            walk(&entry.path(), &relative, extension, out)?;
        }
    }
    Ok(())
}

/// Chemins relatifs (séparateur `/`) des fichiers d’extension `extension` sous
/// `dir`, triés comme `Array.prototype.sort()`. Toute erreur de lecture donne
/// une liste vide, comme côté TypeScript.
pub fn list_files(dir: &Path, extension: &str) -> Vec<String> {
    let mut out = Vec::new();
    if walk(dir, "", extension, &mut out).is_err() {
        return Vec::new();
    }
    out.sort_by(|a, b| utf16_compare(a, b));
    out
}

/// Sous-dossiers directs, dans l’ordre de `fs.readdir` (ordre du système sous
/// Windows, tri par octets ailleurs, comme libuv).
pub fn list_dirs(dir: &Path) -> io::Result<Vec<String>> {
    let mut names = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            names.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    if !cfg!(windows) {
        names.sort();
    }
    Ok(names)
}

/// Copie récursive de `from` vers `to` (créé s’il manque) ; un fichier déjà
/// présent dans `to` n’est **jamais** écrasé. Les liens ne sont pas suivis.
pub fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else if kind.is_file() && !target.exists() {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// Crée le dossier parent de `file` (équivalent de `mkdir -p`).
pub fn ensure_parent(file: &str) -> Result<(), crate::error::HttpError> {
    let parent = crate::paths::dirname(file);
    fs::create_dir_all(&parent).map_err(|error| crate::error::fs_error(&error, "mkdir", &parent))
}
