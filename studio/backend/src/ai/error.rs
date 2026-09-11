//! Erreurs de l’IA : un statut HTTP et un message en français, qui ne
//! contient jamais la clé d’API (masquée si le fournisseur la renvoie).

use serde_json::Value;

use crate::error::HttpError;

/// Espace insécable (typographie française des messages : avant `:`, `?`, dans « »).
pub const NBSP: char = 0xA0u8 as char;

/// Longueur maximale d’un extrait de réponse du fournisseur dans un message.
const DETAIL_LIMIT: usize = 300;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AiError {
    /// Requête de l’interface invalide (400).
    BadRequest(String),
    /// Fournisseur non activé, clé absente, programme introuvable : **rien
    /// n’a été envoyé** (409).
    NotReady(String),
    /// Service injoignable (502).
    Network(String),
    /// Pas de réponse dans le délai (504), en secondes.
    Timeout(u64),
    /// Annulée depuis l’interface (409).
    Cancelled,
    /// Réponse d’erreur du fournisseur : statut HTTP et extrait de son message.
    Provider { name: &'static str, status: u16, detail: String },
    /// Réponse sans image ni texte, ou illisible (502).
    Invalid(String),
    /// Erreur du studio lui-même (500).
    Internal(String),
}

impl AiError {
    pub fn status(&self) -> u16 {
        match self {
            AiError::BadRequest(_) => 400,
            AiError::NotReady(_) | AiError::Cancelled => 409,
            AiError::Network(_) | AiError::Provider { .. } | AiError::Invalid(_) => 502,
            AiError::Timeout(_) => 504,
            AiError::Internal(_) => 500,
        }
    }

    pub fn message(&self) -> String {
        match self {
            AiError::BadRequest(message)
            | AiError::NotReady(message)
            | AiError::Network(message)
            | AiError::Invalid(message)
            | AiError::Internal(message) => message.clone(),
            AiError::Timeout(seconds) => {
                format!("Délai dépassé{NBSP}: pas de réponse en {seconds}{NBSP}s, la génération est abandonnée")
            }
            AiError::Cancelled => "Génération annulée".to_owned(),
            AiError::Provider { name, status, detail } => provider_message(name, *status, detail),
        }
    }
}

impl From<AiError> for HttpError {
    fn from(error: AiError) -> Self {
        HttpError::new(error.status(), error.message())
    }
}

fn provider_message(name: &str, status: u16, detail: &str) -> String {
    let said = if detail.is_empty() {
        String::new()
    } else {
        format!(". Réponse du service{NBSP}: «{NBSP}{detail}{NBSP}»")
    };
    match status {
        401 | 403 => format!(
            "{name} refuse la clé d’API ({status}){NBSP}: vérifie-la dans Paramètres, section IA{said}"
        ),
        402 => format!("{name}{NBSP}: crédit épuisé ou facturation à activer ({status}){said}"),
        404 => format!("{name}{NBSP}: modèle ou adresse introuvable ({status}), vérifie le modèle réglé{said}"),
        408 | 504 => format!("{name} n’a pas répondu à temps ({status}){said}"),
        413 => format!("{name}{NBSP}: requête trop volumineuse ({status}){said}"),
        429 => format!("{name}{NBSP}: limite de débit ou quota atteint ({status}), réessaie plus tard{said}"),
        400 | 422 => format!("{name} a refusé la requête ({status}){said}"),
        500..=599 => format!("{name} est indisponible pour le moment ({status}){said}"),
        _ => format!("{name} a répondu {status}{said}"),
    }
}

/// Extrait lisible d’une réponse d’erreur : le message du JSON s’il y en a
/// un, sinon le début du texte ; sur une ligne, tronqué, clé masquée.
pub fn provider_detail(body: &[u8], secret: Option<&str>) -> String {
    let text = match serde_json::from_slice::<Value>(body) {
        Ok(value) => json_message(&value).unwrap_or_default(),
        Err(_) => String::from_utf8_lossy(body).into_owned(),
    };
    let one_line = scrub(&text, secret).split_whitespace().collect::<Vec<_>>().join(" ");
    truncate(&one_line, DETAIL_LIMIT)
}

fn json_message(value: &Value) -> Option<String> {
    let candidates = [
        value.pointer("/error/message"),
        value.get("error"),
        value.get("message"),
        value.get("detail"),
        value.pointer("/errors/0/message"),
        value.get("errors"),
        value.get("title"),
    ];
    for candidate in candidates.into_iter().flatten() {
        match candidate {
            Value::Null => {}
            Value::String(text) if text.trim().is_empty() => {}
            Value::String(text) => return Some(text.clone()),
            other => return Some(other.to_string()),
        }
    }
    None
}

/// Masque toute occurrence de la clé (certains services la recopient dans leurs erreurs).
pub fn scrub(text: &str, secret: Option<&str>) -> String {
    match secret {
        Some(secret) if secret.len() >= 4 => text.replace(secret, "••••"),
        _ => text.to_owned(),
    }
}

pub fn truncate(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_owned();
    }
    let mut cut: String = text.chars().take(limit).collect();
    cut.push('…');
    cut
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn details_come_from_json_and_hide_the_key() {
        let body = br#"{"error":{"message":"Incorrect API key provided: sk-secret-123456"}}"#;
        assert_eq!(provider_detail(body, Some("sk-secret-123456")), "Incorrect API key provided: ••••");
        assert_eq!(provider_detail(br#"{"detail":[{"msg":"bad"}]}"#, None), r#"[{"msg":"bad"}]"#);
        assert_eq!(provider_detail(b"  plain\n text ", None), "plain text");
        assert_eq!(provider_detail(&vec![b'a'; 400], None).chars().count(), DETAIL_LIMIT + 1);
    }

    #[test]
    fn messages_are_french() {
        let error = AiError::Provider { name: "OpenAI", status: 401, detail: String::new() };
        assert!(error.message().starts_with("OpenAI refuse la clé d’API (401)"));
        assert_eq!(error.status(), 502);
        let error = AiError::Provider { name: "fal", status: 429, detail: "slow down".into() };
        assert!(error.message().contains("limite de débit"));
        assert!(error.message().contains("«\u{a0}slow down\u{a0}»"));
        assert_eq!(AiError::Timeout(30).status(), 504);
    }
}
