//! Routes de l’application, à côté des routes historiques (dont le
//! comportement ne change pas) :
//!
//! | Route | Rôle |
//! |---|---|
//! | `GET /app` | `{ name, version, mode, settingsPath, platform, overrides, firstLaunch }` ; `firstLaunch` vaut `true` si le fichier de réglages n’existait pas au démarrage du backend |
//! | `GET /settings`, `PUT /settings` | réglages (document partiel accepté, validé, appliqué aussitôt, présence Discord comprise) |
//! | `PUT /presence` | `{ details, state?, genericDetails? }` : activité Discord (textes ajustés à 2–128 caractères) → 204, retenue même hors connexion |
//! | `GET /presence` | `{ enabled, configured, connected, error }` : état de la Rich Presence Discord |
//! | `GET /workspaces` | espaces connus, avec résumé (menus, assets, textures, existence) |
//! | `POST /workspaces/open` | `{ path, name? }` : ouvre (et ajoute) un espace, qui devient actif |
//! | `DELETE /workspaces` | `{ path }` : retire de la liste, **ne supprime aucun fichier** |
//! | `GET /documents/recent` | menus et assets de l’espace actif, du plus récent au plus ancien |
//! | `POST /libraries` | `{ id, name, root, ownership }` : branche un pack extrait |
//! | `DELETE /libraries/:id` | débranche un pack (rien n’est supprimé sur le disque) |
//! | `POST /libraries/:id/reindex` | reconstruit l’index en ignorant les caches |
//!
//! Les autres méthodes sur ces chemins retombent sur les routes historiques
//! (404 « Route inconnue »), comme avant.

use std::sync::Arc;

use serde_json::{Map, Value};

use crate::error::{fs_error, HttpError};
use crate::js::{parse_lossy, stringify};
use crate::libraries::Libraries;
use crate::paths::decode_component;
use crate::presence::Activity;
use crate::settings::{
    absolute_path, apply_patch, existing_dir, iso_utc, library_value, parse_library, same_path,
    write_atomic, KnownWorkspace, Settings,
};
use crate::workspace::{ensure_layout, Workspace};
use crate::{Backend, Request, Response, Runtime};

fn json(value: &Value) -> Response {
    Response::json(stringify(value).into_bytes())
}

fn bad_request(message: String) -> HttpError {
    HttpError::new(400, message)
}

/// Corps JSON qui doit être un objet.
fn body_object(body: &[u8]) -> Result<Map<String, Value>, HttpError> {
    match parse_lossy(body) {
        Some(Value::Object(map)) => Ok(map),
        Some(_) => Err(HttpError::new(400, "Le corps de la requête doit être un objet JSON")),
        None => Err(HttpError::new(400, "JSON invalide")),
    }
}

/// Résumé d’un espace de travail connu, pour `GET /workspaces`.
fn workspace_summary(workspace: &KnownWorkspace, active: &str, templates_root: &str) -> Value {
    let exists = std::fs::metadata(&workspace.path).is_ok_and(|metadata| metadata.is_dir());
    let (menus, assets, textures) =
        if exists { Workspace::new(workspace.path.clone(), templates_root.to_owned()).counts() } else { (0, 0, 0) };
    let mut map = Map::new();
    map.insert("path".into(), Value::String(workspace.path.clone()));
    map.insert("name".into(), Value::String(workspace.name.clone()));
    map.insert("lastOpened".into(), Value::String(workspace.last_opened.clone()));
    map.insert("active".into(), Value::Bool(same_path(&workspace.path, active)));
    map.insert("exists".into(), Value::Bool(exists));
    map.insert("menus".into(), Value::from(menus));
    map.insert("assets".into(), Value::from(assets));
    map.insert("textures".into(), Value::from(textures));
    Value::Object(map)
}

impl Backend {
    /// Traite les routes de l’application ; `None` pour toute autre requête.
    pub(crate) fn route_app(
        &self,
        request: &Request,
        pathname: &str,
        method: &str,
    ) -> Result<Option<Response>, HttpError> {
        let response = match (pathname, method) {
            ("/app", "GET") => self.app_info(),
            ("/settings", "GET") => json(&self.read_state().effective_settings().to_value()),
            ("/settings", "PUT") => self.put_settings(&request.body)?,
            ("/presence", "GET") => json(&self.presence.status().to_value()),
            ("/presence", "PUT") => {
                let activity = Activity::from_map(&body_object(&request.body)?).map_err(bad_request)?;
                self.presence.set_activity(activity);
                Response::no_content()
            }
            ("/workspaces", "GET") => self.list_workspaces(),
            ("/workspaces", "DELETE") => self.forget_workspace(&request.body)?,
            ("/workspaces/open", "POST") => self.open_workspace(&request.body)?,
            ("/documents/recent", "GET") => self.recent_documents(),
            ("/libraries", "POST") => self.add_library(&request.body)?,
            _ => match library_action(pathname) {
                Some((raw_id, None)) if method == "DELETE" => self.remove_library(&decode_component(raw_id)?)?,
                Some((raw_id, Some("reindex"))) if method == "POST" => {
                    let libraries = Arc::clone(&self.read_state().libraries);
                    json(&libraries.reindex(&decode_component(raw_id)?)?)
                }
                _ => return Ok(None),
            },
        };
        Ok(Some(response))
    }

    fn app_info(&self) -> Response {
        let state = self.read_state();
        let mut overrides = Vec::new();
        if state.workspace_override.is_some() {
            overrides.push(Value::String("activeWorkspace".into()));
        }
        if state.libraries_override.is_some() {
            overrides.push(Value::String("libraries".into()));
        }
        let mut map = Map::new();
        map.insert("name".into(), Value::String("menu-forge".into()));
        map.insert("version".into(), Value::String(self.app_version.clone()));
        map.insert("mode".into(), Value::String(self.mode.as_str().into()));
        map.insert("settingsPath".into(), Value::String(self.settings_path.clone()));
        map.insert("platform".into(), Value::String(std::env::consts::OS.into()));
        map.insert("overrides".into(), Value::Array(overrides));
        map.insert("firstLaunch".into(), Value::Bool(self.first_launch));
        json(&Value::Object(map))
    }

    /// Enregistre `next` sur disque puis le retient ; rien ne change si
    /// l’écriture échoue.
    fn commit(&self, state: &mut Runtime, next: Settings) -> Result<(), HttpError> {
        write_atomic(&self.settings_path, next.to_json().as_bytes())
            .map_err(|error| HttpError::new(500, format!("Réglages non enregistrés ({}) : {error}", self.settings_path)))?;
        state.settings = next;
        Ok(())
    }

    /// Remplace les bibliothèques actives (index déjà construits conservés).
    fn swap_libraries(&self, state: &mut Runtime) {
        let sources = state.settings.libraries.clone();
        state.libraries = Arc::new(Libraries::with_previous(sources, self.library_cache_dir.clone(), Some(&state.libraries)));
        state.libraries_override = None;
    }

    /// Change l’espace de travail actif.
    fn swap_workspace(&self, state: &mut Runtime) {
        let active = state.settings.active_workspace.clone();
        if !same_path(state.workspace.root(), &active) {
            state.workspace = Arc::new(Workspace::new(active, self.templates_root.clone()));
        }
        state.workspace_override = None;
    }

    fn put_settings(&self, body: &[u8]) -> Result<Response, HttpError> {
        let mut patch = body_object(body)?;
        let mut state = self.write_state();
        // Une valeur renvoyée telle qu’elle a été lue ne change rien (et ne
        // fige pas un remplacement de session dans le fichier).
        if patch.get("activeWorkspace").and_then(Value::as_str).is_some_and(|path| {
            std::path::Path::new(path).is_absolute() && same_path(path, state.active_workspace())
        }) {
            patch.remove("activeWorkspace");
        }
        let effective_libraries = state.effective_libraries().to_vec();
        let base = Settings { libraries: effective_libraries.clone(), ..state.settings.clone() };
        let mut next = apply_patch(&base, &Value::Object(patch.clone()), true).map_err(bad_request)?;

        let libraries_changed = patch.contains_key("libraries") && next.libraries != effective_libraries;
        if !libraries_changed {
            next.libraries = state.settings.libraries.clone();
        }
        let workspace_changed = patch.contains_key("activeWorkspace");
        if workspace_changed {
            let active = next.active_workspace.clone();
            ensure_layout(&active).map_err(|error| fs_error(&error, "mkdir", &active))?;
            next.touch_workspace(&active, None);
        }
        self.commit(&mut state, next)?;
        if patch.contains_key("discord") {
            self.presence.configure(state.settings.discord.clone());
        }
        if libraries_changed {
            self.swap_libraries(&mut state);
        }
        if workspace_changed {
            self.swap_workspace(&mut state);
        }
        Ok(json(&state.effective_settings().to_value()))
    }

    fn list_workspaces(&self) -> Response {
        let (known, active) = {
            let state = self.read_state();
            (state.settings.workspaces.clone(), state.active_workspace().to_owned())
        };
        let list = known.iter().map(|workspace| workspace_summary(workspace, &active, &self.templates_root)).collect();
        let mut map = Map::new();
        map.insert("active".into(), Value::String(active));
        map.insert("workspaces".into(), Value::Array(list));
        json(&Value::Object(map))
    }

    fn open_workspace(&self, body: &[u8]) -> Result<Response, HttpError> {
        let body = body_object(body)?;
        let path = absolute_path(body.get("path").unwrap_or(&Value::Null), "path").map_err(bad_request)?;
        existing_dir(&path, "path").map_err(bad_request)?;
        let name = match body.get("name") {
            None | Some(Value::Null) => None,
            Some(Value::String(name)) if !name.trim().is_empty() && name.trim().chars().count() <= 200 => {
                Some(name.trim().to_owned())
            }
            Some(_) => return Err(HttpError::new(400, "« name » doit être un texte non vide (200 caractères au plus)")),
        };
        ensure_layout(&path).map_err(|error| fs_error(&error, "mkdir", &path))?;

        let mut state = self.write_state();
        let mut next = state.settings.clone();
        next.touch_workspace(&path, name.as_deref());
        self.commit(&mut state, next)?;
        self.swap_workspace(&mut state);
        let entry = state.settings.workspaces[0].clone();
        drop(state);
        Ok(json(&workspace_summary(&entry, &entry.path, &self.templates_root)))
    }

    fn forget_workspace(&self, body: &[u8]) -> Result<Response, HttpError> {
        let body = body_object(body)?;
        let path = absolute_path(body.get("path").unwrap_or(&Value::Null), "path").map_err(bad_request)?;
        let mut state = self.write_state();
        let position = state
            .settings
            .workspace_position(&path)
            .ok_or_else(|| HttpError::new(404, format!("Espace de travail inconnu : {path}")))?;
        if same_path(&path, state.active_workspace()) || same_path(&path, &state.settings.active_workspace) {
            return Err(HttpError::new(
                409,
                "Impossible de retirer l’espace de travail actif : ouvrez-en un autre d’abord",
            ));
        }
        let mut next = state.settings.clone();
        next.workspaces.remove(position);
        self.commit(&mut state, next)?;
        Ok(Response::no_content())
    }

    fn recent_documents(&self) -> Response {
        let workspace = Arc::clone(&self.read_state().workspace);
        let list = workspace
            .recent_documents()
            .into_iter()
            .map(|document| {
                let mut map = Map::new();
                map.insert("type".into(), Value::String(document.kind.into()));
                map.insert("id".into(), Value::String(document.id));
                map.insert("name".into(), Value::String(document.name));
                map.insert("modified".into(), Value::String(iso_utc(document.modified)));
                Value::Object(map)
            })
            .collect();
        json(&Value::Array(list))
    }

    fn add_library(&self, body: &[u8]) -> Result<Response, HttpError> {
        let body = parse_lossy(body).ok_or_else(|| HttpError::new(400, "JSON invalide"))?;
        let library = parse_library(&body, "", true).map_err(bad_request)?;
        let mut state = self.write_state();
        let mut libraries = state.effective_libraries().to_vec();
        if libraries.iter().any(|known| known.id == library.id) {
            return Err(HttpError::new(409, format!("Une bibliothèque porte déjà l’identifiant « {} »", library.id)));
        }
        libraries.push(library.clone());
        let next = Settings { libraries, ..state.settings.clone() };
        self.commit(&mut state, next)?;
        self.swap_libraries(&mut state);
        Ok(json(&library_value(&library)))
    }

    fn remove_library(&self, id: &str) -> Result<Response, HttpError> {
        let mut state = self.write_state();
        let mut libraries = state.effective_libraries().to_vec();
        let position = libraries
            .iter()
            .position(|library| library.id == id)
            .ok_or_else(|| HttpError::new(404, format!("Bibliothèque inconnue : {id}")))?;
        libraries.remove(position);
        let next = Settings { libraries, ..state.settings.clone() };
        self.commit(&mut state, next)?;
        self.swap_libraries(&mut state);
        Ok(Response::no_content())
    }
}

/// `/libraries/:id` → `(id, None)`, `/libraries/:id/<action>` → `(id, Some(action))`.
fn library_action(pathname: &str) -> Option<(&str, Option<&str>)> {
    let rest = pathname.strip_prefix("/libraries/")?;
    match rest.split_once('/') {
        None if !rest.is_empty() => Some((rest, None)),
        Some((id, action)) if !id.is_empty() && !action.contains('/') => Some((id, Some(action))),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn library_actions() {
        assert_eq!(library_action("/libraries/vanilla"), Some(("vanilla", None)));
        assert_eq!(library_action("/libraries/vanilla/reindex"), Some(("vanilla", Some("reindex"))));
        assert_eq!(library_action("/libraries/"), None);
        assert_eq!(library_action("/libraries//reindex"), None);
        assert_eq!(library_action("/libraries/v/raw/a.png"), None);
    }
}
