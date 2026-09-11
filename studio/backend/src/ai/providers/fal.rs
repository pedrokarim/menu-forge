//! fal : images par l’appel synchrone `POST https://fal.run/<modèle>`
//! (en-tête `Authorization: Key …`, `sync_mode` : l’image revient en `data:`
//! ou en adresse de CDN, alors téléchargée sans la clé).

use serde_json::{json, Value};

use super::{download, post_json, scaled_size, segments, Ctx, ImageJob, ImageResult, TestOutcome};
use crate::ai::error::{AiError, NBSP};

pub fn image(ctx: &Ctx, job: &ImageJob) -> Result<ImageResult, AiError> {
    let model = segments(if ctx.model.is_empty() { "fal-ai/flux/schnell" } else { &ctx.model })?;
    let (width, height) = scaled_size(job.width, job.height, 1024, 16);
    let body = json!({
        "prompt": job.prompt,
        "image_size": { "width": width, "height": height },
        "num_images": 1,
        "sync_mode": true,
        "output_format": "png"
    });
    let headers = vec![("Authorization", format!("Key {}", ctx.key()))];
    let value = post_json(ctx, ctx.url(&format!("/{model}")), headers, &body)?;
    let url = value
        .pointer("/images/0/url")
        .or_else(|| value.pointer("/image/url"))
        .and_then(Value::as_str)
        .ok_or_else(|| AiError::Invalid("fal n’a renvoyé aucune image".to_owned()))?;
    download(ctx, url)
}

/// fal n’a pas de route gratuite pour vérifier une clé : rien n’est envoyé.
pub fn test() -> TestOutcome {
    TestOutcome {
        message: format!(
            "Clé enregistrée. fal ne permet pas de la vérifier sans générer{NBSP}: la première génération le fera"
        ),
        verified: false,
    }
}
