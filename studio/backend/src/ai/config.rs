//! Catalogue des fournisseurs d’IA et réglages **non secrets** (section `ai`
//! du fichier de réglages). Les clés d’API n’y figurent jamais : elles vivent
//! dans le trousseau du système (voir [`super::secrets`]).
//!
//! ```json
//! "ai": {
//!   "providers": {
//!     "openai": { "enabled": true, "imageModel": null, "textModel": "gpt-5.6-luna", "endpoint": null },
//!     "ollama": { "enabled": true, "imageModel": null, "textModel": "qwen3", "endpoint": "http://127.0.0.1:11434" }
//!   }
//! }
//! ```
//!
//! Un fournisseur absent de la liste est désactivé, avec ses valeurs par
//! défaut ; `null` (ou un texte vide) revient à la valeur par défaut. La
//! section n’est écrite dans le fichier que si un fournisseur a été réglé.

use std::collections::BTreeMap;
use std::path::Path;

use serde_json::{Map, Value};

/// Ce qu’on demande à un fournisseur.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Capability {
    Image,
    Text,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderKind {
    /// Service en ligne, avec clé d’API.
    Cloud,
    /// Serveur sur ce poste (ou le réseau local), sans clé.
    Local,
    /// Programme en ligne de commande, qui gère sa propre connexion.
    Cli,
}

impl ProviderKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ProviderKind::Cloud => "cloud",
            ProviderKind::Local => "local",
            ProviderKind::Cli => "cli",
        }
    }
}

#[derive(Debug)]
pub struct ProviderInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub kind: ProviderKind,
    pub image: bool,
    pub text: bool,
    pub key_required: bool,
    /// Adresse de l’API par défaut (vide pour une CLI : programme cherché sur le poste).
    pub default_endpoint: &'static str,
    pub default_image_model: Option<&'static str>,
    pub default_text_model: Option<&'static str>,
    /// Où obtenir une clé, ou installer le service.
    pub help_url: &'static str,
}

impl ProviderInfo {
    pub fn supports(&self, capability: Capability) -> bool {
        match capability {
            Capability::Image => self.image,
            Capability::Text => self.text,
        }
    }
}

/// Fournisseurs gérés, dans l’ordre de l’interface. Modèles par défaut :
/// modifiables dans les paramètres (les catalogues changent souvent).
pub const PROVIDERS: &[ProviderInfo] = &[
    ProviderInfo {
        id: "openai",
        name: "OpenAI",
        kind: ProviderKind::Cloud,
        image: true,
        text: true,
        key_required: true,
        default_endpoint: "https://api.openai.com",
        default_image_model: Some("gpt-image-2.5-flare"),
        default_text_model: Some("gpt-5.6-luna"),
        help_url: "https://platform.openai.com/api-keys",
    },
    ProviderInfo {
        id: "google",
        name: "Google Gemini",
        kind: ProviderKind::Cloud,
        image: true,
        text: true,
        key_required: true,
        default_endpoint: "https://generativelanguage.googleapis.com",
        default_image_model: Some("gemini-3.1-flash-image"),
        default_text_model: Some("gemini-3.8-flash"),
        help_url: "https://aistudio.google.com/apikey",
    },
    ProviderInfo {
        id: "anthropic",
        name: "Anthropic",
        kind: ProviderKind::Cloud,
        image: false,
        text: true,
        key_required: true,
        default_endpoint: "https://api.anthropic.com",
        default_image_model: None,
        default_text_model: Some("claude-sonnet-5"),
        help_url: "https://platform.claude.com/settings/keys",
    },
    ProviderInfo {
        id: "mistral",
        name: "Mistral",
        kind: ProviderKind::Cloud,
        image: false,
        text: true,
        key_required: true,
        default_endpoint: "https://api.mistral.ai",
        default_image_model: None,
        default_text_model: Some("mistral-large-latest"),
        help_url: "https://console.mistral.ai/api-keys",
    },
    ProviderInfo {
        id: "stability",
        name: "Stability AI",
        kind: ProviderKind::Cloud,
        image: true,
        text: false,
        key_required: true,
        default_endpoint: "https://api.stability.ai",
        default_image_model: Some("core"),
        default_text_model: None,
        help_url: "https://platform.stability.ai/account/keys",
    },
    ProviderInfo {
        id: "fal",
        name: "fal",
        kind: ProviderKind::Cloud,
        image: true,
        text: false,
        key_required: true,
        default_endpoint: "https://fal.run",
        default_image_model: Some("fal-ai/flux/schnell"),
        default_text_model: None,
        help_url: "https://fal.ai/dashboard/keys",
    },
    ProviderInfo {
        id: "replicate",
        name: "Replicate",
        kind: ProviderKind::Cloud,
        image: true,
        text: false,
        key_required: true,
        default_endpoint: "https://api.replicate.com",
        default_image_model: Some("black-forest-labs/flux-schnell"),
        default_text_model: None,
        help_url: "https://replicate.com/account/api-tokens",
    },
    ProviderInfo {
        id: "comfyui",
        name: "ComfyUI",
        kind: ProviderKind::Local,
        image: true,
        text: false,
        key_required: false,
        default_endpoint: "http://127.0.0.1:8188",
        default_image_model: Some("sd_xl_base_1.0.safetensors"),
        default_text_model: None,
        help_url: "https://github.com/comfyanonymous/ComfyUI",
    },
    ProviderInfo {
        id: "automatic1111",
        name: "Automatic1111",
        kind: ProviderKind::Local,
        image: true,
        text: false,
        key_required: false,
        default_endpoint: "http://127.0.0.1:7860",
        default_image_model: None,
        default_text_model: None,
        help_url: "https://github.com/AUTOMATIC1111/stable-diffusion-webui",
    },
    ProviderInfo {
        id: "ollama",
        name: "Ollama",
        kind: ProviderKind::Local,
        image: false,
        text: true,
        key_required: false,
        default_endpoint: "http://127.0.0.1:11434",
        default_image_model: None,
        default_text_model: Some("llama3.2"),
        help_url: "https://ollama.com/download",
    },
    ProviderInfo {
        id: "codex",
        name: "Codex CLI",
        kind: ProviderKind::Cli,
        image: true,
        text: true,
        key_required: false,
        default_endpoint: "",
        default_image_model: None,
        default_text_model: None,
        help_url: "https://developers.openai.com/codex/cli",
    },
];

pub fn provider(id: &str) -> Option<&'static ProviderInfo> {
    PROVIDERS.iter().find(|info| info.id == id)
}

/// Réglages d’un fournisseur ; `None` : valeur par défaut.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProviderSettings {
    /// Activé explicitement : sans cela, **aucune** requête ne part vers lui.
    pub enabled: bool,
    pub image_model: Option<String>,
    pub text_model: Option<String>,
    /// Adresse de l’API (fournisseurs HTTP) ou chemin absolu du programme (CLI).
    pub endpoint: Option<String>,
}

impl ProviderSettings {
    pub fn model(&self, info: &ProviderInfo, capability: Capability) -> Option<String> {
        match capability {
            Capability::Image => self.image_model.clone().or(info.default_image_model.map(str::to_owned)),
            Capability::Text => self.text_model.clone().or(info.default_text_model.map(str::to_owned)),
        }
    }

    fn to_value(&self) -> Value {
        let text = |value: &Option<String>| value.clone().map(Value::String).unwrap_or(Value::Null);
        let mut map = Map::new();
        map.insert("enabled".into(), Value::Bool(self.enabled));
        map.insert("imageModel".into(), text(&self.image_model));
        map.insert("textModel".into(), text(&self.text_model));
        map.insert("endpoint".into(), text(&self.endpoint));
        Value::Object(map)
    }
}

/// Section `ai` des réglages.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AiSettings {
    pub providers: BTreeMap<String, ProviderSettings>,
}

impl AiSettings {
    /// Rien de réglé : la section n’est pas écrite dans le fichier.
    pub fn is_empty(&self) -> bool {
        self.providers.is_empty()
    }

    pub fn provider(&self, id: &str) -> ProviderSettings {
        self.providers.get(id).cloned().unwrap_or_default()
    }

    pub fn to_value(&self) -> Value {
        let providers = self.providers.iter().map(|(id, settings)| (id.clone(), settings.to_value())).collect();
        let mut map = Map::new();
        map.insert("providers".into(), Value::Object(providers));
        Value::Object(map)
    }
}

fn optional_text(value: &Value, key: &str) -> Result<Option<String>, String> {
    match value {
        Value::Null => Ok(None),
        Value::String(text) if text.trim().is_empty() => Ok(None),
        Value::String(text)
            if text.trim().chars().count() <= 200 && !text.chars().any(char::is_control) =>
        {
            Ok(Some(text.trim().to_owned()))
        }
        _ => Err(format!("« {key} » doit valoir null ou un texte d’une ligne (200 caractères au plus)")),
    }
}

fn endpoint(value: &Value, key: &str, kind: ProviderKind) -> Result<Option<String>, String> {
    let text = match value {
        Value::Null => return Ok(None),
        Value::String(text) if text.trim().is_empty() => return Ok(None),
        Value::String(text) => text.trim(),
        _ => return Err(format!("« {key} » doit valoir null ou un texte")),
    };
    if kind == ProviderKind::Cli {
        if text.chars().count() > 1000 || !Path::new(text).is_absolute() {
            return Err(format!("« {key} » doit être le chemin absolu du programme"));
        }
        return Ok(Some(text.to_owned()));
    }
    let valid = (text.starts_with("http://") || text.starts_with("https://"))
        && text.len() > "https://".len()
        && text.chars().count() <= 500
        && !text.chars().any(|c| c.is_whitespace() || c.is_control())
        && !text.contains(['?', '#']);
    if !valid {
        return Err(format!("« {key} » doit être une adresse http:// ou https:// (sans espace, ni requête)"));
    }
    Ok(Some(text.trim_end_matches('/').to_owned()))
}

/// Applique un document partiel sur la section `ai` : les fournisseurs sont
/// fusionnés un par un, et chacun clé par clé. Clés et fournisseurs inconnus
/// refusés.
pub fn apply_patch(base: &AiSettings, patch: &Value) -> Result<AiSettings, String> {
    let patch = patch.as_object().ok_or("« ai » doit être un objet")?;
    if let Some(key) = patch.keys().find(|key| key.as_str() != "providers") {
        return Err(format!("Réglage inconnu : « ai.{key} »"));
    }
    let mut next = base.clone();
    let Some(providers) = patch.get("providers") else {
        return Ok(next);
    };
    let providers = providers.as_object().ok_or("« ai.providers » doit être un objet")?;
    for (id, value) in providers {
        let info = provider(id).ok_or_else(|| format!("Fournisseur d’IA inconnu : « {id} »"))?;
        let prefix = format!("ai.providers.{id}");
        let map = value.as_object().ok_or_else(|| format!("« {prefix} » doit être un objet"))?;
        let mut entry = next.provider(id);
        for (key, value) in map {
            let field = format!("{prefix}.{key}");
            match key.as_str() {
                "enabled" => entry.enabled = value.as_bool().ok_or_else(|| format!("« {field} » doit valoir true ou false"))?,
                "imageModel" => entry.image_model = optional_text(value, &field)?,
                "textModel" => entry.text_model = optional_text(value, &field)?,
                "endpoint" => entry.endpoint = endpoint(value, &field, info.kind)?,
                _ => return Err(format!("Réglage inconnu : « {field} »")),
            }
        }
        next.providers.insert(info.id.to_owned(), entry);
    }
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn catalogue_is_consistent() {
        for info in PROVIDERS {
            assert!(info.image || info.text, "{}", info.id);
            assert_eq!(info.key_required, info.kind == ProviderKind::Cloud, "{}", info.id);
            assert_eq!(info.default_endpoint.is_empty(), info.kind == ProviderKind::Cli, "{}", info.id);
            if !info.image {
                assert!(info.default_image_model.is_none(), "{}", info.id);
            }
        }
        let ids: Vec<_> = PROVIDERS.iter().map(|info| info.id).collect();
        let mut unique = ids.clone();
        unique.dedup();
        assert_eq!(ids, unique);
    }

    #[test]
    fn patches_merge_provider_by_provider() {
        let next = apply_patch(&AiSettings::default(), &json!({"providers": {"openai": {"enabled": true}}})).unwrap();
        let next = apply_patch(&next, &json!({"providers": {"openai": {"textModel": " gpt-x "}}})).unwrap();
        let openai = next.provider("openai");
        assert!(openai.enabled);
        assert_eq!(openai.text_model.as_deref(), Some("gpt-x"));
        assert_eq!(openai.model(provider("openai").unwrap(), Capability::Image).as_deref(), Some("gpt-image-2.5-flare"));
        let next = apply_patch(&next, &json!({"providers": {"openai": {"textModel": ""}}})).unwrap();
        assert_eq!(next.provider("openai").text_model, None);
        let next = apply_patch(&next, &json!({"providers": {"ollama": {"endpoint": "http://127.0.0.1:11434/"}}})).unwrap();
        assert_eq!(next.provider("ollama").endpoint.as_deref(), Some("http://127.0.0.1:11434"));
        assert_eq!(next.to_value()["providers"]["openai"], json!({"enabled": true, "imageModel": null, "textModel": null, "endpoint": null}));
    }

    #[test]
    fn invalid_patches_are_refused() {
        let base = AiSettings::default();
        for (patch, message) in [
            (json!([]), "« ai » doit être un objet"),
            (json!({"keys": {}}), "Réglage inconnu : « ai.keys »"),
            (json!({"providers": {"acme": {}}}), "Fournisseur d’IA inconnu : « acme »"),
            (json!({"providers": {"openai": {"apiKey": "sk"}}}), "Réglage inconnu : « ai.providers.openai.apiKey »"),
            (json!({"providers": {"openai": {"enabled": "oui"}}}), "doit valoir true ou false"),
            (json!({"providers": {"openai": {"endpoint": "ftp://x"}}}), "doit être une adresse"),
            (json!({"providers": {"openai": {"endpoint": "https://a b"}}}), "doit être une adresse"),
            (json!({"providers": {"openai": {"endpoint": "https://a?key=1"}}}), "doit être une adresse"),
            (json!({"providers": {"codex": {"endpoint": "codex.exe"}}}), "chemin absolu"),
            (json!({"providers": {"openai": {"textModel": "a\nb"}}}), "texte d’une ligne"),
        ] {
            let error = apply_patch(&base, &patch).unwrap_err();
            assert!(error.contains(message), "{patch} : {error}");
        }
    }
}
