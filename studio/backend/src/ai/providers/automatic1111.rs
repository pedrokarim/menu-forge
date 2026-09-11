//! Automatic1111 (Stable Diffusion WebUI lancé avec `--api`) : images par
//! `POST /sdapi/v1/txt2img` (base64 dans `images[0]`). Le « modèle » est un
//! checkpoint ; vide : celui chargé dans le WebUI.

use serde_json::json;

use super::{get_json, image_from_base64, plural, post_json, scaled_size, Ctx, ImageJob, ImageResult, TestOutcome};
use crate::ai::error::{AiError, NBSP};

pub fn image(ctx: &Ctx, job: &ImageJob) -> Result<ImageResult, AiError> {
    let (width, height) = scaled_size(job.width, job.height, 768, 8);
    let mut body = json!({
        "prompt": job.prompt,
        "negative_prompt": job.negative.clone().unwrap_or_default(),
        "width": width,
        "height": height,
        "steps": 25,
        "cfg_scale": 7,
        "batch_size": 1,
        "n_iter": 1
    });
    if !ctx.model.is_empty() {
        body["override_settings"] = json!({ "sd_model_checkpoint": ctx.model });
        body["override_settings_restore_afterwards"] = json!(true);
    }
    let value = post_json(ctx, ctx.url("/sdapi/v1/txt2img"), Vec::new(), &body)?;
    let data = value["images"][0]
        .as_str()
        .ok_or_else(|| AiError::Invalid("Automatic1111 n’a renvoyé aucune image".to_owned()))?;
    image_from_base64(ctx, data)
}

pub fn test(ctx: &Ctx) -> Result<TestOutcome, AiError> {
    let value = get_json(ctx, ctx.url("/sdapi/v1/sd-models"), Vec::new())?;
    let count = value.as_array().map_or(0, Vec::len);
    Ok(TestOutcome::verified(format!(
        "Automatic1111 répond{NBSP}: {}",
        plural(count, "checkpoint installé", "checkpoints installés")
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_are_multiples_of_eight() {
        assert_eq!(scaled_size(176, 222, 768, 8), (608, 768));
    }
}
