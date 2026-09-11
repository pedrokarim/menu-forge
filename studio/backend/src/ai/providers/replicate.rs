//! Replicate : prédiction d’un modèle officiel
//! (`POST /v1/models/<propriétaire>/<nom>/predictions`, `Prefer: wait`) ou
//! d’une version précise (`<propriétaire>/<nom>:<version>` →
//! `POST /v1/predictions`). Si la prédiction n’est pas finie au retour, elle
//! est relue chaque seconde jusqu’à l’échéance ; l’image (adresse du CDN) est
//! téléchargée sans la clé.

use std::time::Duration;

use serde_json::{json, Value};

use super::{closest_ratio, download, get_json, openai, post_json, segments, Ctx, ImageJob, ImageResult, TestOutcome};
use crate::ai::error::{AiError, NBSP};

const RATIOS: &[&str] = &["1:1", "16:9", "21:9", "3:2", "2:3", "4:5", "5:4", "3:4", "4:3", "9:16", "9:21"];
const POLL_INTERVAL: Duration = Duration::from_secs(1);

/// Adresse de relecture : celle de la réponse si elle est sur l’API réglée
/// (la clé n’est jamais envoyée ailleurs), sinon reconstruite depuis l’id.
fn poll_url(ctx: &Ctx, prediction: &Value) -> Result<String, AiError> {
    if let Some(url) = prediction.pointer("/urls/get").and_then(Value::as_str) {
        if url.starts_with(&format!("{}/", ctx.endpoint)) {
            return Ok(url.to_owned());
        }
    }
    let id = prediction["id"]
        .as_str()
        .filter(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric()))
        .ok_or_else(|| AiError::Invalid("Replicate a renvoyé une prédiction sans identifiant".to_owned()))?;
    Ok(ctx.url(&format!("/v1/predictions/{id}")))
}

pub fn image(ctx: &Ctx, job: &ImageJob) -> Result<ImageResult, AiError> {
    let model = if ctx.model.is_empty() { "black-forest-labs/flux-schnell" } else { &ctx.model };
    let input = json!({
        "prompt": job.prompt,
        "aspect_ratio": closest_ratio(job.width, job.height, RATIOS),
        "output_format": "png",
        "num_outputs": 1
    });
    let (url, body) = match model.split_once(':') {
        Some((name, version)) => {
            segments(name)?;
            (ctx.url("/v1/predictions"), json!({ "version": version, "input": input }))
        }
        None => (ctx.url(&format!("/v1/models/{}/predictions", segments(model)?)), json!({ "input": input })),
    };
    let mut headers = openai::bearer(ctx);
    headers.push(("Prefer", "wait=60".to_owned()));
    let mut prediction = post_json(ctx, url, headers, &body)?;
    loop {
        match prediction["status"].as_str().unwrap_or_default() {
            "succeeded" => break,
            status @ ("failed" | "canceled" | "aborted") => {
                let reason = prediction["error"].as_str().unwrap_or(status);
                return Err(AiError::Invalid(format!("Replicate{NBSP}: la génération a échoué ({reason})")));
            }
            _ => {
                ctx.budget.sleep(POLL_INTERVAL)?;
                prediction = get_json(ctx, poll_url(ctx, &prediction)?, openai::bearer(ctx))?;
            }
        }
    }
    let output = &prediction["output"];
    let url = output
        .as_str()
        .or_else(|| output.get(0).and_then(Value::as_str))
        .ok_or_else(|| AiError::Invalid("Replicate n’a renvoyé aucune image".to_owned()))?;
    download(ctx, url)
}

pub fn test(ctx: &Ctx) -> Result<TestOutcome, AiError> {
    get_json(ctx, ctx.url("/v1/account"), openai::bearer(ctx))?;
    Ok(TestOutcome::verified("Connexion établie".to_owned()))
}
