//! Clés d’API des fournisseurs : dans le **trousseau du système**
//! (Gestionnaire d’identifiants de Windows, trousseau de macOS, keyutils sous
//! Linux), sous le service `menu-forge`, compte `ai-<fournisseur>`.
//!
//! Jamais dans le fichier de réglages, jamais dans les journaux, jamais
//! renvoyées à l’interface : celle-ci ne voit que « configurée » ou « absente ».

use std::collections::HashMap;
use std::sync::Mutex;

use super::error::NBSP;

/// Service sous lequel les clés sont rangées dans le trousseau.
pub const SERVICE: &str = "menu-forge";

pub trait SecretStore: Send + Sync {
    fn get(&self, provider: &str) -> Result<Option<String>, String>;
    fn set(&self, provider: &str, secret: &str) -> Result<(), String>;
    /// Retire la clé ; sans effet si elle n’existe pas.
    fn delete(&self, provider: &str) -> Result<(), String>;
    /// Où vivent les clés, pour l’interface.
    fn location(&self) -> &'static str;
}

fn account(provider: &str) -> String {
    format!("ai-{provider}")
}

/// Vérifie une clé saisie : une ligne, sans espace, de 8 à 512 caractères.
pub fn check_key(key: &str) -> Result<&str, String> {
    let key = key.trim();
    if (8..=512).contains(&key.chars().count()) && !key.chars().any(|c| c.is_whitespace() || c.is_control()) {
        Ok(key)
    } else {
        Err(format!("Clé d’API invalide{NBSP}: une seule ligne, sans espace, de 8 à 512 caractères"))
    }
}

/// Trousseau du système.
pub struct SystemStore;

impl SystemStore {
    fn entry(provider: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, &account(provider))
            .map_err(|error| format!("Trousseau du système indisponible{NBSP}: {error}"))
    }
}

impl SecretStore for SystemStore {
    fn get(&self, provider: &str) -> Result<Option<String>, String> {
        match Self::entry(provider)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(format!("Trousseau du système illisible{NBSP}: {error}")),
        }
    }

    fn set(&self, provider: &str, secret: &str) -> Result<(), String> {
        Self::entry(provider)?
            .set_password(secret)
            .map_err(|error| format!("Clé non enregistrée dans le trousseau du système{NBSP}: {error}"))
    }

    fn delete(&self, provider: &str) -> Result<(), String> {
        match Self::entry(provider)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("Clé non retirée du trousseau du système{NBSP}: {error}")),
        }
    }

    fn location(&self) -> &'static str {
        if cfg!(windows) {
            "Gestionnaire d’identifiants de Windows"
        } else if cfg!(target_os = "macos") {
            "trousseau de macOS"
        } else {
            "trousseau du système"
        }
    }
}

/// Clés en mémoire, perdues à la fermeture : tests automatiques et option
/// `--ephemeral-secrets` de `studio-api` (le vrai trousseau n’est jamais touché).
#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, String>>);

impl MemoryStore {
    fn map(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl SecretStore for MemoryStore {
    fn get(&self, provider: &str) -> Result<Option<String>, String> {
        Ok(self.map().get(provider).cloned())
    }

    fn set(&self, provider: &str, secret: &str) -> Result<(), String> {
        self.map().insert(provider.to_owned(), secret.to_owned());
        Ok(())
    }

    fn delete(&self, provider: &str) -> Result<(), String> {
        self.map().remove(provider);
        Ok(())
    }

    fn location(&self) -> &'static str {
        "mémoire de cette session, perdue à la fermeture"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_checked() {
        assert_eq!(check_key("  sk-abcdef123  "), Ok("sk-abcdef123"));
        assert!(check_key("short").is_err());
        assert!(check_key("sk-abc def123").is_err());
        assert!(check_key(&"x".repeat(513)).is_err());
    }

    #[test]
    fn memory_store_round_trip() {
        let store = MemoryStore::default();
        assert_eq!(store.get("openai"), Ok(None));
        store.set("openai", "sk-secret-1").unwrap();
        assert_eq!(store.get("openai"), Ok(Some("sk-secret-1".into())));
        store.delete("openai").unwrap();
        store.delete("openai").unwrap();
        assert_eq!(store.get("openai"), Ok(None));
    }
}
