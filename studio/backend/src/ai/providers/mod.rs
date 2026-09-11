//! Un fournisseur = un module. Chacun traduit une demande d’image ou de texte
//! en requête pour son API et lit la réponse ; ce module-ci les répartit et
//! fournit les aides communes (JSON, base64, téléchargement, ratios).
//!
//! Aucun module ne recommence une requête échouée (sauf un seul repli
//! documenté, voir `openai`) ; les sondages s’arrêtent à l’échéance du
//! [`Budget`].

mod anthropic;
mod automatic1111;
pub mod codex;
mod comfyui;
mod fal;
mod google;
mod mistral;
mod ollama;
mod openai;
mod replicate;
mod stability;

use base64::Engine;
use serde_json::Value;

use super::config::ProviderInfo;
use super::error::{provider_detail, AiError, NBSP};
use super::net::{self, Budget, HttpRequest, HttpResponse};

/// Contexte d’une génération : fournisseur, adresse, clé, modèle, échéance.
#[derive(Clone)]
pub struct Ctx {
    pub info: &'static ProviderInfo,
    /// Adresse de l’API sans `/` final ; chemin du programme pour une CLI.
    pub endpoint: String,
    pub key: Option<String>,
    /// Modèle choisi ; vide : celui du fournisseur (Automatic1111, Codex).
    pub model: String,
    pub budget: Budget,
}

impl Ctx {
    pub fn url(&self, path: &str) -> String {
        format!("{}{path}", self.endpoint)
    }

    pub fn key(&self) -> &str {
        self.key.as_deref().unwrap_or("")
    }
}

/// Demande d’image. `width` × `height` : taille de la texture visée (le
/// fournisseur produit une image plus grande, du même format).
#[derive(Clone, Debug)]
pub struct ImageJob {
    pub prompt: String,
    pub negative: Option<String>,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug)]
pub struct ImageResult {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
    /// Remarque du fournisseur (prompt réécrit par OpenAI…).
    pub note: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    User,
    Assistant,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::User => "user",
            Role::Assistant => "assistant",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Message {
    pub role: Role,
    pub content: String,
}

/// Demande de texte (structuré : `json` demande un objet JSON seul).
#[derive(Clone, Debug)]
pub struct TextJob {
    pub system: String,
    pub messages: Vec<Message>,
    pub json: bool,
}

/// Résultat d’un test de connexion ; `verified` faux si rien n’a pu être
/// vérifié sans générer (fal).
pub struct TestOutcome {
    pub message: String,
    pub verified: bool,
}

impl TestOutcome {
    pub fn verified(message: String) -> Self {
        Self { message, verified: true }
    }
}

pub fn generate_image(ctx: &Ctx, job: &ImageJob) -> Result<ImageResult, AiError> {
    match ctx.info.id {
        "openai" => openai::image(ctx, job),
        "google" => google::image(ctx, job),
        "stability" => stability::image(ctx, job),
        "fal" => fal::image(ctx, job),
        "replicate" => replicate::image(ctx, job),
        "comfyui" => comfyui::image(ctx, job),
        "automatic1111" => automatic1111::image(ctx, job),
        "codex" => codex::image(ctx, job),
        _ => Err(AiError::BadRequest(format!("{} ne génère pas d’images", ctx.info.name))),
    }
}

pub fn generate_text(ctx: &Ctx, job: &TextJob) -> Result<String, AiError> {
    let text = match ctx.info.id {
        "openai" => openai::text(ctx, job),
        "anthropic" => anthropic::text(ctx, job),
        "google" => google::text(ctx, job),
        "mistral" => mistral::text(ctx, job),
        "ollama" => ollama::text(ctx, job),
        "codex" => codex::text(ctx, job),
        _ => Err(AiError::BadRequest(format!("{} ne génère pas de texte", ctx.info.name))),
    }?;
    if text.trim().is_empty() {
        return Err(AiError::Invalid(format!("{} n’a renvoyé aucun texte", ctx.info.name)));
    }
    Ok(text)
}

pub fn test(ctx: &Ctx) -> Result<TestOutcome, AiError> {
    match ctx.info.id {
        "openai" => openai::test(ctx),
        "anthropic" => anthropic::test(ctx),
        "google" => google::test(ctx),
        "mistral" => mistral::test(ctx),
        "stability" => stability::test(ctx),
        "fal" => Ok(fal::test()),
        "replicate" => replicate::test(ctx),
        "comfyui" => comfyui::test(ctx),
        "automatic1111" => automatic1111::test(ctx),
        "ollama" => ollama::test(ctx),
        "codex" => codex::test(ctx),
        _ => Err(AiError::BadRequest(format!("Pas de test pour {}", ctx.info.name))),
    }
}

// ---------------------------------------------------------------- aides

/// Envoie une requête ; un statut hors 2xx devient une erreur du fournisseur
/// (message tiré de sa réponse, clé masquée).
pub(crate) fn call(
    ctx: &Ctx,
    method: &str,
    url: String,
    headers: Vec<(&str, String)>,
    body: Option<Vec<u8>>,
) -> Result<HttpResponse, AiError> {
    let response = net::send(HttpRequest { method, url, headers, body }, &ctx.budget)?;
    if (200..300).contains(&response.status) {
        return Ok(response);
    }
    Err(AiError::Provider {
        name: ctx.info.name,
        status: response.status,
        detail: provider_detail(&response.body, ctx.key.as_deref()),
    })
}

fn parse_json(ctx: &Ctx, response: &HttpResponse) -> Result<Value, AiError> {
    serde_json::from_slice(&response.body)
        .map_err(|_| AiError::Invalid(format!("Réponse illisible de {}{NBSP}: JSON attendu", ctx.info.name)))
}

pub(crate) fn post_json(ctx: &Ctx, url: String, mut headers: Vec<(&str, String)>, body: &Value) -> Result<Value, AiError> {
    headers.push(("Content-Type", "application/json".to_owned()));
    let bytes = serde_json::to_vec(body).map_err(|error| AiError::Internal(error.to_string()))?;
    let response = call(ctx, "POST", url, headers, Some(bytes))?;
    parse_json(ctx, &response)
}

pub(crate) fn get_json(ctx: &Ctx, url: String, headers: Vec<(&str, String)>) -> Result<Value, AiError> {
    let response = call(ctx, "GET", url, headers, None)?;
    parse_json(ctx, &response)
}

/// Type d’une image d’après ses premiers octets.
pub fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else {
        None
    }
}

pub(crate) fn image_from_bytes(ctx: &Ctx, bytes: Vec<u8>) -> Result<ImageResult, AiError> {
    let mime = sniff(&bytes).ok_or_else(|| {
        AiError::Invalid(format!("{} a renvoyé un fichier qui n’est pas une image (PNG, JPEG, WebP ou GIF)", ctx.info.name))
    })?;
    Ok(ImageResult { bytes, mime, note: None })
}

/// Image en base64, avec ou sans préfixe `data:…;base64,`.
pub(crate) fn image_from_base64(ctx: &Ctx, text: &str) -> Result<ImageResult, AiError> {
    let payload = match text.split_once(";base64,") {
        Some((head, data)) if head.starts_with("data:") => data,
        _ => text,
    };
    let payload: String = payload.chars().filter(|c| !c.is_whitespace()).collect();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&payload)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(&payload))
        .map_err(|_| AiError::Invalid(format!("Image illisible de {}{NBSP}: base64 invalide", ctx.info.name)))?;
    image_from_bytes(ctx, bytes)
}

/// Récupère une image désignée par le fournisseur : `data:` ou adresse
/// http(s), téléchargée **sans** la clé (fichiers publics des CDN).
pub(crate) fn download(ctx: &Ctx, url: &str) -> Result<ImageResult, AiError> {
    if url.starts_with("data:") {
        return image_from_base64(ctx, url);
    }
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AiError::Invalid(format!("{} a renvoyé une adresse d’image inattendue", ctx.info.name)));
    }
    let response = call(ctx, "GET", url.to_owned(), Vec::new(), None)?;
    image_from_bytes(ctx, response.body)
}

fn valid_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment != "."
        && segment != ".."
        && segment.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// Modèle placé dans un chemin, en un seul segment (`gemini-3.8-flash`).
pub(crate) fn segment(model: &str) -> Result<&str, AiError> {
    if valid_segment(model) {
        Ok(model)
    } else {
        Err(AiError::BadRequest(format!("Modèle invalide{NBSP}: «{NBSP}{model}{NBSP}»")))
    }
}

/// Modèle placé dans un chemin, en plusieurs segments (`fal-ai/flux/schnell`).
pub(crate) fn segments(model: &str) -> Result<&str, AiError> {
    if model.split('/').all(valid_segment) {
        Ok(model)
    } else {
        Err(AiError::BadRequest(format!("Modèle invalide{NBSP}: «{NBSP}{model}{NBSP}»")))
    }
}

/// « 1 modèle », « 3 modèles » (espace insécable).
pub(crate) fn plural(count: usize, one: &str, many: &str) -> String {
    format!("{count}{NBSP}{}", if count > 1 { many } else { one })
}

/// Encodage d’une valeur de requête (`?filename=…`).
pub(crate) fn encode_query(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Ratio proposé le plus proche de `width` : `height` (`"16:9"`…).
pub(crate) fn closest_ratio<'a>(width: u32, height: u32, options: &[&'a str]) -> &'a str {
    let target = (f64::from(width.max(1)) / f64::from(height.max(1))).ln();
    let value = |ratio: &str| {
        let (a, b) = ratio.split_once(':').unwrap_or(("1", "1"));
        (a.parse::<f64>().unwrap_or(1.0) / b.parse::<f64>().unwrap_or(1.0)).ln()
    };
    options
        .iter()
        .copied()
        .min_by(|a, b| (value(a) - target).abs().total_cmp(&(value(b) - target).abs()))
        .unwrap_or("1:1")
}

/// Taille de même format que `width` × `height`, dont le grand côté vaut
/// `longest`, arrondie au multiple de `multiple`.
pub(crate) fn scaled_size(width: u32, height: u32, longest: u32, multiple: u32) -> (u32, u32) {
    let (width, height) = (f64::from(width.max(1)), f64::from(height.max(1)));
    let scale = f64::from(longest) / width.max(height);
    let round = |side: f64| (((side * scale) / f64::from(multiple)).round() as u32).max(1) * multiple;
    (round(width), round(height))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helpers() {
        assert_eq!(sniff(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0]), Some("image/png"));
        assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(sniff(b"<html>"), None);
        assert_eq!(closest_ratio(176, 222, &["1:1", "4:5", "16:9"]), "4:5");
        assert_eq!(closest_ratio(64, 20, &["1:1", "3:2", "21:9"]), "21:9");
        assert_eq!(scaled_size(64, 20, 1024, 16), (1024, 320));
        assert_eq!(scaled_size(16, 16, 768, 8), (768, 768));
        assert_eq!(encode_query("a b/é"), "a%20b%2F%C3%A9");
        assert!(segment("gemini-3.8-flash").is_ok());
        assert!(segment("../x").is_err());
        assert!(segments("fal-ai/flux/schnell").is_ok());
        assert!(segments("fal-ai//x").is_err());
        assert!(segments("a/../b").is_err());
    }
}
