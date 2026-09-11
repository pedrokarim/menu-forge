//! OpenAI : images (`POST /v1/images/generations`, modèles GPT Image, base64
//! dans `data[0].b64_json`) et texte (`POST /v1/chat/completions`, mode JSON).

use serde_json::{json, Value};

use super::{get_json, image_from_base64, plural, post_json, Ctx, ImageJob, ImageResult, TestOutcome, TextJob};
use crate::ai::error::{AiError, NBSP};

pub(crate) fn bearer(ctx: &Ctx) -> Vec<(&'static str, String)> {
    vec![("Authorization", format!("Bearer {}", ctx.key()))]
}

/// Tailles des modèles GPT Image : carré, paysage, portrait.
fn size_for(width: u32, height: u32) -> &'static str {
    let ratio = f64::from(width.max(1)) / f64::from(height.max(1));
    if ratio >= 1.25 {
        "1536x1024"
    } else if ratio <= 0.8 {
        "1024x1536"
    } else {
        "1024x1024"
    }
}

pub fn image(ctx: &Ctx, job: &ImageJob) -> Result<ImageResult, AiError> {
    let url = ctx.url("/v1/images/generations");
    let legacy = ctx.model.starts_with("dall-e");
    let mut body = json!({ "model": ctx.model, "prompt": job.prompt, "n": 1, "size": size_for(job.width, job.height) });
    if legacy {
        body["response_format"] = json!("b64_json");
    } else {
        body["background"] = json!("transparent");
        body["output_format"] = json!("png");
    }
    let value = match post_json(ctx, url.clone(), bearer(ctx), &body) {
        // Modèle sans fond transparent : une seule nouvelle requête, sans ce
        // paramètre (le studio détoure le fond lui-même ensuite).
        Err(AiError::Provider { status: 400, detail, .. }) if !legacy && detail.to_lowercase().contains("background") => {
            if let Some(map) = body.as_object_mut() {
                map.remove("background");
            }
            post_json(ctx, url, bearer(ctx), &body)?
        }
        other => other?,
    };
    let first = &value["data"][0];
    let data = first["b64_json"]
        .as_str()
        .ok_or_else(|| AiError::Invalid("OpenAI n’a renvoyé aucune image".to_owned()))?;
    let mut image = image_from_base64(ctx, data)?;
    image.note = first["revised_prompt"].as_str().map(str::to_owned);
    Ok(image)
}

/// API « chat completions » (OpenAI, Mistral) : message système, puis la conversation.
pub(crate) fn chat_completion(ctx: &Ctx, job: &TextJob, path: &str) -> Result<String, AiError> {
    let mut messages = vec![json!({ "role": "system", "content": job.system })];
    messages.extend(job.messages.iter().map(|message| json!({ "role": message.role.as_str(), "content": message.content })));
    let mut body = json!({ "model": ctx.model, "messages": messages });
    if job.json {
        body["response_format"] = json!({ "type": "json_object" });
    }
    let value = post_json(ctx, ctx.url(path), bearer(ctx), &body)?;
    Ok(value.pointer("/choices/0/message/content").and_then(Value::as_str).unwrap_or_default().to_owned())
}

pub fn text(ctx: &Ctx, job: &TextJob) -> Result<String, AiError> {
    chat_completion(ctx, job, "/v1/chat/completions")
}

/// Liste des modèles : vérifie la clé sans rien générer.
pub(crate) fn list_models(ctx: &Ctx) -> Result<TestOutcome, AiError> {
    let value = get_json(ctx, ctx.url("/v1/models"), bearer(ctx))?;
    let count = value["data"].as_array().map_or(0, Vec::len);
    Ok(TestOutcome::verified(format!(
        "Connexion établie{NBSP}: {} avec cette clé",
        plural(count, "modèle accessible", "modèles accessibles")
    )))
}

pub fn test(ctx: &Ctx) -> Result<TestOutcome, AiError> {
    list_models(ctx)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_follow_the_texture_format() {
        assert_eq!(size_for(16, 16), "1024x1024");
        assert_eq!(size_for(64, 20), "1536x1024");
        assert_eq!(size_for(176, 200), "1024x1024");
        assert_eq!(size_for(176, 222), "1024x1536");
        assert_eq!(size_for(20, 64), "1024x1536");
    }
}
