//! Mistral : texte (`POST /v1/chat/completions`, compatible avec OpenAI,
//! `response_format: json_object`).

use super::{openai, Ctx, TestOutcome, TextJob};
use crate::ai::error::AiError;

pub fn text(ctx: &Ctx, job: &TextJob) -> Result<String, AiError> {
    openai::chat_completion(ctx, job, "/v1/chat/completions")
}

pub fn test(ctx: &Ctx) -> Result<TestOutcome, AiError> {
    openai::list_models(ctx)
}
