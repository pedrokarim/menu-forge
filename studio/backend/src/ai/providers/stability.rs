//! Stability AI : images (`POST /v2beta/stable-image/generate/<service>`,
//! corps `multipart/form-data`, `Accept: image/*` : l’image brute en retour).
//! Le « modèle » est le service : `core` (défaut), `ultra`, `sd3`.

use std::time::{SystemTime, UNIX_EPOCH};

use super::{call, closest_ratio, get_json, image_from_bytes, openai, segment, Ctx, ImageJob, ImageResult, TestOutcome};
use crate::ai::error::{AiError, NBSP};

const RATIOS: &[&str] = &["16:9", "1:1", "21:9", "2:3", "3:2", "4:5", "5:4", "9:16", "9:21"];

/// Corps `multipart/form-data` de champs texte.
fn multipart(boundary: &str, fields: &[(&str, String)]) -> Vec<u8> {
    let mut body = Vec::new();
    for (name, value) in fields {
        body.extend_from_slice(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes(),
        );
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    body
}

pub fn image(ctx: &Ctx, job: &ImageJob) -> Result<ImageResult, AiError> {
    let service = segment(if ctx.model.is_empty() { "core" } else { &ctx.model })?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_nanos());
    let boundary = format!("menu-forge-{stamp:x}");
    let mut fields = vec![
        ("prompt", job.prompt.clone()),
        ("output_format", "png".to_owned()),
        ("aspect_ratio", closest_ratio(job.width, job.height, RATIOS).to_owned()),
    ];
    if let Some(negative) = job.negative.as_ref().filter(|text| !text.trim().is_empty()) {
        fields.push(("negative_prompt", negative.clone()));
    }
    let mut headers = openai::bearer(ctx);
    headers.push(("Accept", "image/*".to_owned()));
    headers.push(("Content-Type", format!("multipart/form-data; boundary={boundary}")));
    let url = ctx.url(&format!("/v2beta/stable-image/generate/{service}"));
    let response = call(ctx, "POST", url, headers, Some(multipart(&boundary, &fields)))?;
    image_from_bytes(ctx, response.body)
}

pub fn test(ctx: &Ctx) -> Result<TestOutcome, AiError> {
    let value = get_json(ctx, ctx.url("/v1/user/balance"), openai::bearer(ctx))?;
    let message = match value["credits"].as_f64() {
        Some(credits) => format!("Connexion établie{NBSP}: {credits} crédits restants"),
        None => "Connexion établie".to_owned(),
    };
    Ok(TestOutcome::verified(message))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multipart_body() {
        let body = multipart("b", &[("prompt", "épée".into()), ("output_format", "png".into())]);
        assert_eq!(
            String::from_utf8(body).unwrap(),
            "--b\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\népée\r\n--b\r\nContent-Disposition: form-data; name=\"output_format\"\r\n\r\npng\r\n--b--\r\n"
        );
    }
}
