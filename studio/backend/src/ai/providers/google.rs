//! Google Gemini (en-tête `x-goog-api-key`) : images par
//! `models/<modèle>:generateContent` (réponse `inlineData`, base64), texte
//! par le même appel (`responseMimeType: application/json`). Les modèles
//! Imagen (`imagen-…`, arrêtés par Google en août 2026) passent encore par
//! `:predict` si un compte y a accès.

use serde_json::{json, Value};

use super::{
    closest_ratio, get_json, image_from_base64, plural, post_json, segment, Ctx, ImageJob, ImageResult, Role, TestOutcome, TextJob,
};
use crate::ai::error::{truncate, AiError, NBSP};

fn headers(ctx: &Ctx) -> Vec<(&'static str, String)> {
    vec![("x-goog-api-key", ctx.key().to_owned())]
}

fn model_url(ctx: &Ctx, action: &str) -> Result<String, AiError> {
    Ok(ctx.url(&format!("/v1beta/models/{}:{action}", segment(&ctx.model)?)))
}

fn parts(value: &Value) -> Vec<Value> {
    value.pointer("/candidates/0/content/parts").and_then(Value::as_array).cloned().unwrap_or_default()
}

/// Refus explicite (filtre de sécurité) : message clair plutôt que « aucune image ».
fn refusal(value: &Value) -> Option<AiError> {
    let reason = value
        .pointer("/promptFeedback/blockReason")
        .or_else(|| value.pointer("/candidates/0/finishReason").filter(|reason| *reason != "STOP"))
        .and_then(Value::as_str)?;
    Some(AiError::Invalid(format!("Gemini a refusé la demande ({reason}){NBSP}: reformule la description")))
}

pub fn image(ctx: &Ctx, job: &ImageJob) -> Result<ImageResult, AiError> {
    if ctx.model.starts_with("imagen") {
        let ratio = closest_ratio(job.width, job.height, &["1:1", "3:4", "4:3", "9:16", "16:9"]);
        let body = json!({ "instances": [{ "prompt": job.prompt }], "parameters": { "sampleCount": 1, "aspectRatio": ratio } });
        let value = post_json(ctx, model_url(ctx, "predict")?, headers(ctx), &body)?;
        let data = value
            .pointer("/predictions/0/bytesBase64Encoded")
            .and_then(Value::as_str)
            .ok_or_else(|| AiError::Invalid("Imagen n’a renvoyé aucune image".to_owned()))?;
        return image_from_base64(ctx, data);
    }
    let body = json!({
        "contents": [{ "role": "user", "parts": [{ "text": job.prompt }] }],
        "generationConfig": { "responseModalities": ["TEXT", "IMAGE"] }
    });
    let value = post_json(ctx, model_url(ctx, "generateContent")?, headers(ctx), &body)?;
    let parts = parts(&value);
    for part in &parts {
        let inline = part.get("inlineData").or_else(|| part.get("inline_data"));
        if let Some(data) = inline.and_then(|inline| inline.get("data")).and_then(Value::as_str) {
            return image_from_base64(ctx, data);
        }
    }
    if let Some(error) = refusal(&value) {
        return Err(error);
    }
    let said: String = parts.iter().filter_map(|part| part["text"].as_str()).collect::<Vec<_>>().join(" ");
    let said = if said.trim().is_empty() {
        String::new()
    } else {
        format!(". Réponse{NBSP}: «{NBSP}{}{NBSP}»", truncate(said.trim(), 200))
    };
    Err(AiError::Invalid(format!("Gemini n’a renvoyé aucune image{said}")))
}

pub fn text(ctx: &Ctx, job: &TextJob) -> Result<String, AiError> {
    let contents: Vec<Value> = job
        .messages
        .iter()
        .map(|message| {
            let role = if message.role == Role::Assistant { "model" } else { "user" };
            json!({ "role": role, "parts": [{ "text": message.content }] })
        })
        .collect();
    let mut body = json!({ "systemInstruction": { "parts": [{ "text": job.system }] }, "contents": contents });
    if job.json {
        body["generationConfig"] = json!({ "responseMimeType": "application/json" });
    }
    let value = post_json(ctx, model_url(ctx, "generateContent")?, headers(ctx), &body)?;
    let text: String = parts(&value)
        .iter()
        .filter(|part| part["thought"] != true)
        .filter_map(|part| part["text"].as_str())
        .collect::<Vec<_>>()
        .join("");
    if text.trim().is_empty() {
        if let Some(error) = refusal(&value) {
            return Err(error);
        }
    }
    Ok(text)
}

pub fn test(ctx: &Ctx) -> Result<TestOutcome, AiError> {
    let value = get_json(ctx, ctx.url("/v1beta/models"), headers(ctx))?;
    let count = value["models"].as_array().map_or(0, Vec::len);
    Ok(TestOutcome::verified(format!(
        "Connexion établie{NBSP}: {} avec cette clé",
        plural(count, "modèle accessible", "modèles accessibles")
    )))
}
