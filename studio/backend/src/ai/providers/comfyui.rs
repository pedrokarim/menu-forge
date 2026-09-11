//! ComfyUI (local) : un flux « texte vers image » minimal (chargeur de
//! checkpoint, deux encodages de texte, échantillonneur, décodage,
//! sauvegarde) envoyé à `POST /prompt`, puis `GET /history/<id>` chaque
//! seconde jusqu’à l’image, lue par `GET /view`. Le « modèle » est le nom du
//! checkpoint.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use super::{call, encode_query, get_json, image_from_bytes, post_json, scaled_size, Ctx, ImageJob, ImageResult, TestOutcome};
use crate::ai::error::{AiError, NBSP};

const POLL_INTERVAL: Duration = Duration::from_secs(1);

/// Flux au format de l’API de ComfyUI (nœuds numérotés).
fn workflow(checkpoint: &str, job: &ImageJob, seed: u64) -> Value {
    let (width, height) = scaled_size(job.width, job.height, 1024, 64);
    json!({
        "3": { "class_type": "KSampler", "inputs": {
            "seed": seed, "steps": 25, "cfg": 7, "sampler_name": "euler", "scheduler": "normal", "denoise": 1,
            "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]
        } },
        "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": checkpoint } },
        "5": { "class_type": "EmptyLatentImage", "inputs": { "width": width, "height": height, "batch_size": 1 } },
        "6": { "class_type": "CLIPTextEncode", "inputs": { "text": job.prompt, "clip": ["4", 1] } },
        "7": { "class_type": "CLIPTextEncode", "inputs": { "text": job.negative.clone().unwrap_or_default(), "clip": ["4", 1] } },
        "8": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0], "vae": ["4", 2] } },
        "9": { "class_type": "SaveImage", "inputs": { "filename_prefix": "menu-forge", "images": ["8", 0] } }
    })
}

/// Première image produite par la tâche `id`, si elle est finie.
fn finished_image(history: &Value, id: &str) -> Result<Option<(String, String, String)>, AiError> {
    let Some(entry) = history.get(id) else {
        return Ok(None);
    };
    if entry.pointer("/status/status_str") == Some(&json!("error")) {
        return Err(AiError::Invalid(format!("ComfyUI{NBSP}: la génération a échoué (voir la console de ComfyUI)")));
    }
    let outputs = entry["outputs"].as_object().into_iter().flat_map(|outputs| outputs.values());
    for output in outputs {
        if let Some(image) = output["images"].get(0) {
            let text = |key: &str| image[key].as_str().unwrap_or_default().to_owned();
            return Ok(Some((text("filename"), text("subfolder"), text("type"))));
        }
    }
    Ok(None)
}

pub fn image(ctx: &Ctx, job: &ImageJob) -> Result<ImageResult, AiError> {
    let seed = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_micros() as u64) % 1_000_000_007;
    let checkpoint = if ctx.model.is_empty() { "sd_xl_base_1.0.safetensors" } else { &ctx.model };
    let body = json!({ "prompt": workflow(checkpoint, job, seed), "client_id": "menu-forge" });
    let queued = post_json(ctx, ctx.url("/prompt"), Vec::new(), &body)?;
    let id = queued["prompt_id"]
        .as_str()
        .filter(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
        .ok_or_else(|| AiError::Invalid("ComfyUI n’a pas accepté le flux (pas de prompt_id)".to_owned()))?
        .to_owned();
    let (filename, subfolder, kind) = loop {
        let history = get_json(ctx, ctx.url(&format!("/history/{id}")), Vec::new())?;
        if let Some(found) = finished_image(&history, &id)? {
            break found;
        }
        ctx.budget.sleep(POLL_INTERVAL)?;
    };
    let url = ctx.url(&format!(
        "/view?filename={}&subfolder={}&type={}",
        encode_query(&filename),
        encode_query(&subfolder),
        encode_query(if kind.is_empty() { "output" } else { &kind })
    ));
    let response = call(ctx, "GET", url, Vec::new(), None)?;
    image_from_bytes(ctx, response.body)
}

pub fn test(ctx: &Ctx) -> Result<TestOutcome, AiError> {
    let value = get_json(ctx, ctx.url("/system_stats"), Vec::new())?;
    let message = match value.pointer("/system/comfyui_version").and_then(Value::as_str) {
        Some(version) => format!("ComfyUI {version} répond"),
        None => "ComfyUI répond".to_owned(),
    };
    Ok(TestOutcome::verified(message))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workflow_wires_the_checkpoint_and_size() {
        let job = ImageJob { prompt: "épée".into(), negative: None, width: 64, height: 20 };
        let flow = workflow("model.safetensors", &job, 7);
        assert_eq!(flow["4"]["inputs"]["ckpt_name"], "model.safetensors");
        assert_eq!(flow["5"]["inputs"]["width"], 1024);
        assert_eq!(flow["5"]["inputs"]["height"], 320);
        assert_eq!(flow["6"]["inputs"]["text"], "épée");
    }

    #[test]
    fn history_is_read() {
        let pending = json!({});
        assert_eq!(finished_image(&pending, "a").unwrap(), None);
        let done = json!({ "a": { "outputs": { "9": { "images": [{ "filename": "x.png", "subfolder": "", "type": "output" }] } } } });
        assert_eq!(finished_image(&done, "a").unwrap(), Some(("x.png".into(), String::new(), "output".into())));
        let failed = json!({ "a": { "status": { "status_str": "error" }, "outputs": {} } });
        assert!(finished_image(&failed, "a").is_err());
    }
}
