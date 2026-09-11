//! Ollama (local) : texte par `POST /api/chat` (`stream: false`,
//! `format: "json"` : décodage contraint à un JSON valide).

use serde_json::{json, Value};

use super::{get_json, post_json, Ctx, TestOutcome, TextJob};
use crate::ai::error::{AiError, NBSP};

pub fn text(ctx: &Ctx, job: &TextJob) -> Result<String, AiError> {
    let mut messages = vec![json!({ "role": "system", "content": job.system })];
    messages.extend(job.messages.iter().map(|message| json!({ "role": message.role.as_str(), "content": message.content })));
    let mut body = json!({ "model": ctx.model, "messages": messages, "stream": false, "options": { "temperature": 0.2 } });
    if job.json {
        body["format"] = json!("json");
    }
    let value = post_json(ctx, ctx.url("/api/chat"), Vec::new(), &body)?;
    Ok(value.pointer("/message/content").and_then(Value::as_str).unwrap_or_default().to_owned())
}

/// Vérifie qu’Ollama répond et que le modèle réglé est installé.
pub fn test(ctx: &Ctx) -> Result<TestOutcome, AiError> {
    let value = get_json(ctx, ctx.url("/api/tags"), Vec::new())?;
    let names: Vec<&str> = value["models"]
        .as_array()
        .map(|models| models.iter().filter_map(|model| model["name"].as_str()).collect())
        .unwrap_or_default();
    let installed = names.iter().any(|name| *name == ctx.model || name.strip_prefix(&ctx.model).is_some_and(|rest| rest.starts_with(':')));
    let message = if installed {
        format!("Ollama répond{NBSP}: modèle «{NBSP}{}{NBSP}» installé", ctx.model)
    } else {
        format!(
            "Ollama répond, mais le modèle «{NBSP}{}{NBSP}» n’est pas installé (ollama pull {}){NBSP}; modèles présents{NBSP}: {}",
            ctx.model,
            ctx.model,
            if names.is_empty() { "aucun".to_owned() } else { names.join(", ") }
        )
    };
    Ok(TestOutcome { message, verified: installed })
}
