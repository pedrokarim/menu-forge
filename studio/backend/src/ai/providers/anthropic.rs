//! Anthropic : texte (`POST /v1/messages`, en-têtes `x-api-key` et
//! `anthropic-version`). Pas de génération d’images.

use serde_json::{json, Value};

use super::{get_json, plural, post_json, Ctx, TestOutcome, TextJob};
use crate::ai::error::{AiError, NBSP};

const API_VERSION: &str = "2023-06-01";
/// Réponse maximale : un menu complet tient largement.
const MAX_TOKENS: u32 = 16_000;

fn headers(ctx: &Ctx) -> Vec<(&'static str, String)> {
    vec![("x-api-key", ctx.key().to_owned()), ("anthropic-version", API_VERSION.to_owned())]
}

pub fn text(ctx: &Ctx, job: &TextJob) -> Result<String, AiError> {
    let messages: Vec<Value> =
        job.messages.iter().map(|message| json!({ "role": message.role.as_str(), "content": message.content })).collect();
    let body = json!({ "model": ctx.model, "max_tokens": MAX_TOKENS, "system": job.system, "messages": messages });
    let value = post_json(ctx, ctx.url("/v1/messages"), headers(ctx), &body)?;
    let text: String = value["content"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter(|block| block["type"] == "text")
                .filter_map(|block| block["text"].as_str())
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    if text.trim().is_empty() && value["stop_reason"] == "refusal" {
        return Err(AiError::Invalid(format!("Anthropic a refusé la demande{NBSP}: reformule la description")));
    }
    Ok(text)
}

pub fn test(ctx: &Ctx) -> Result<TestOutcome, AiError> {
    let value = get_json(ctx, ctx.url("/v1/models"), headers(ctx))?;
    let count = value["data"].as_array().map_or(0, Vec::len);
    Ok(TestOutcome::verified(format!(
        "Connexion établie{NBSP}: {} avec cette clé",
        plural(count, "modèle accessible", "modèles accessibles")
    )))
}
