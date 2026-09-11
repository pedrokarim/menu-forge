//! Tests de l’IA avec des fournisseurs **factices** : un serveur HTTP local
//! (tiny_http, port libre) joue chaque API, et les clés vivent en mémoire.
//! Jamais d’appel réel, jamais de vraie clé, jamais le vrai trousseau.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::{json, Value};
use studio_backend::ai::secrets::MemoryStore;
use studio_backend::{AppMode, Backend, BackendConfig, Request};

/// Clé factice : ne doit apparaître dans aucune réponse ni aucun fichier.
const KEY: &str = "sk-test-0123456789";

static COUNTER: AtomicU32 = AtomicU32::new(0);

struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "studio-ai-{name}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("workspace")).unwrap();
        Self(dir)
    }

    fn text(&self, relative: &str) -> String {
        self.0.join(relative).to_string_lossy().into_owned()
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn backend(dir: &TempDir) -> Backend {
    Backend::new(BackendConfig {
        mode: AppMode::Browser,
        app_version: "0.0.0".into(),
        settings_path: dir.text("config/settings.json"),
        default_workspace: dir.text("workspace"),
        legacy_libraries_file: None,
        templates_root: dir.text("templates"),
        cache_dir: dir.text("cache"),
        workspace_override: None,
        libraries_override: None,
        discord_client_id: None,
        presence: false,
    })
    .with_secret_store(Arc::new(MemoryStore::default()))
}

fn call(backend: &Backend, method: &str, path: &str, body: Value) -> (u16, Value, String) {
    let bytes = if body.is_null() { Vec::new() } else { serde_json::to_vec(&body).unwrap() };
    let response = backend.handle(&Request::new(method, path, bytes));
    let text = String::from_utf8_lossy(&response.body).into_owned();
    (response.status, serde_json::from_str(&text).unwrap_or(Value::Null), text)
}

/// PNG minimal (la signature suffit : le backend ne décode pas l’image).
fn png() -> Vec<u8> {
    let mut data = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R'];
    data.extend_from_slice(&[0, 0, 0, 16, 0, 0, 0, 16, 8, 6, 0, 0, 0]);
    data
}

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn assert_png(value: &Value) {
    assert_eq!(value["mime"], "image/png", "{value}");
    let data = base64::engine::general_purpose::STANDARD.decode(value["data"].as_str().unwrap()).unwrap();
    assert_eq!(data, png());
}

// ---------------------------------------------------------------- faux fournisseur

#[derive(Clone, Debug)]
struct Seen {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Seen {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(field, _)| field.eq_ignore_ascii_case(name)).map(|(_, value)| value.as_str())
    }

    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

type Reply = (u16, &'static str, Vec<u8>);

fn json_reply(value: Value) -> Reply {
    (200, "application/json", serde_json::to_vec(&value).unwrap())
}

/// Serveur HTTP local qui répond par `handler` et garde chaque requête.
struct Fake {
    origin: String,
    seen: Arc<Mutex<Vec<Seen>>>,
    stop: Arc<AtomicBool>,
    server: Arc<tiny_http::Server>,
    worker: Option<JoinHandle<()>>,
}

impl Fake {
    fn start(handler: impl Fn(&Seen, &str) -> Reply + Send + 'static) -> Self {
        let server = Arc::new(tiny_http::Server::http("127.0.0.1:0").unwrap());
        let port = server.server_addr().to_ip().unwrap().port();
        let origin = format!("http://127.0.0.1:{port}");
        let seen = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let worker = {
            let (server, seen, stop, origin) = (Arc::clone(&server), Arc::clone(&seen), Arc::clone(&stop), origin.clone());
            thread::spawn(move || {
                while !stop.load(Ordering::SeqCst) {
                    let mut request = match server.recv_timeout(Duration::from_millis(50)) {
                        Ok(Some(request)) => request,
                        Ok(None) => continue,
                        Err(_) => break,
                    };
                    let mut body = Vec::new();
                    let _ = request.as_reader().read_to_end(&mut body);
                    let record = Seen {
                        method: request.method().to_string(),
                        url: request.url().to_owned(),
                        headers: request.headers().iter().map(|header| (header.field.to_string(), header.value.to_string())).collect(),
                        body,
                    };
                    seen.lock().unwrap().push(record.clone());
                    let (status, content_type, reply) = handler(&record, &origin);
                    let response = tiny_http::Response::from_data(reply)
                        .with_status_code(status)
                        .with_header(tiny_http::Header::from_bytes("Content-Type", content_type).unwrap());
                    let _ = request.respond(response);
                }
            })
        };
        Self { origin, seen, stop, server, worker: Some(worker) }
    }

    fn requests(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }
}

impl Drop for Fake {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.server.unblock();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

/// Active `provider` sur le faux serveur (et range la clé factice s’il en faut une).
fn enable(backend: &Backend, provider: &str, origin: &str, extra: Value) {
    let mut body = json!({ "enabled": true, "endpoint": origin });
    if let Value::Object(extra) = extra {
        body.as_object_mut().unwrap().extend(extra);
    }
    let (status, entry, text) = call(backend, "PUT", &format!("/ai/providers/{provider}"), body);
    assert_eq!(status, 200, "{text}");
    if entry["keyRequired"] == true {
        let (status, _, text) = call(backend, "PUT", &format!("/ai/keys/{provider}"), json!({ "key": KEY }));
        assert_eq!(status, 200, "{text}");
    }
}

fn image_request(provider: &str) -> Value {
    json!({ "provider": provider, "prompt": "une épée", "system": "Pixel art", "width": 16, "height": 16 })
}

fn text_request(provider: &str) -> Value {
    json!({ "provider": provider, "system": "Réponds en JSON", "messages": [{ "role": "user", "content": "un menu" }] })
}

// ---------------------------------------------------------------- réglages et clés

#[test]
fn listing_reports_keys_without_revealing_them() {
    let dir = TempDir::new("keys");
    let backend = backend(&dir);
    let (status, list, _) = call(&backend, "GET", "/ai/providers", Value::Null);
    assert_eq!(status, 200);
    assert_eq!(list["secretStore"], "mémoire de cette session, perdue à la fermeture");
    let providers = list["providers"].as_array().unwrap();
    assert_eq!(providers.len(), 11);
    let openai = &providers[0];
    assert_eq!(openai["id"], "openai");
    assert_eq!((openai["keyConfigured"].clone(), openai["ready"].clone()), (json!(false), json!(false)));
    assert_eq!(openai["issue"], "désactivé");
    assert_eq!(openai["imageModel"], "gpt-image-2.5-flare");
    assert_eq!(providers.iter().find(|entry| entry["id"] == "anthropic").unwrap()["imageModel"], Value::Null);

    let (status, entry, text) = call(&backend, "PUT", "/ai/keys/openai", json!({ "key": format!("  {KEY}  ") }));
    assert_eq!(status, 200, "{text}");
    assert_eq!(entry["keyConfigured"], true);
    assert!(!text.contains(KEY));
    let (_, entry, _) = call(&backend, "PUT", "/ai/providers/openai", json!({ "enabled": true, "textModel": "gpt-test" }));
    assert_eq!((entry["ready"].clone(), entry["textModel"].clone()), (json!(true), json!("gpt-test")));
    assert_eq!(entry["custom"]["textModel"], "gpt-test");

    for path in ["/ai/providers", "/settings"] {
        let (_, _, text) = call(&backend, "GET", path, Value::Null);
        assert!(!text.contains(KEY), "{path}");
    }
    let file = fs::read_to_string(dir.text("config/settings.json")).unwrap();
    assert!(!file.contains(KEY));
    assert!(file.contains("\"textModel\": \"gpt-test\""), "{file}");

    let (_, entry, _) = call(&backend, "DELETE", "/ai/keys/openai", Value::Null);
    assert_eq!((entry["keyConfigured"].clone(), entry["issue"].clone()), (json!(false), json!("clé absente")));

    for (method, path, body, expected) in [
        ("PUT", "/ai/keys/ollama", json!({ "key": KEY }), 400),
        ("PUT", "/ai/keys/openai", json!({ "key": "court" }), 400),
        ("PUT", "/ai/keys/openai", json!({ "key": "sk abc def ghi" }), 400),
        ("PUT", "/ai/providers/acme", json!({ "enabled": true }), 404),
        ("PUT", "/ai/providers/openai", json!({ "apiKey": KEY }), 400),
        ("PUT", "/ai/providers/openai", json!({ "endpoint": "ftp://x" }), 400),
        ("GET", "/ai/nope", Value::Null, 404),
    ] {
        let (status, _, text) = call(&backend, method, path, body);
        assert_eq!(status, expected, "{method} {path} : {text}");
        assert!(!text.contains(KEY));
    }
}

#[test]
fn settings_survive_a_restart_and_a_broken_section_is_ignored_alone() {
    let dir = TempDir::new("reload");
    {
        let backend = backend(&dir);
        enable(&backend, "ollama", "http://127.0.0.1:1", json!({ "textModel": "qwen3" }));
        let (status, _, _) = call(&backend, "PUT", "/settings", json!({ "ui": { "defaultZoom": 3 } }));
        assert_eq!(status, 200);
    }
    let (_, list, _) = call(&backend(&dir), "GET", "/ai/providers", Value::Null);
    let ollama = list["providers"].as_array().unwrap().iter().find(|entry| entry["id"] == "ollama").unwrap().clone();
    assert_eq!((ollama["enabled"].clone(), ollama["textModel"].clone()), (json!(true), json!("qwen3")));

    let path = dir.text("config/settings.json");
    let mut file: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    file["ai"] = json!({ "providers": { "acme": { "enabled": true } } });
    fs::write(&path, serde_json::to_vec(&file).unwrap()).unwrap();
    let backend = backend(&dir);
    let (_, settings, _) = call(&backend, "GET", "/settings", Value::Null);
    assert_eq!(settings["ui"]["defaultZoom"], 3);
    assert!(settings.get("ai").is_none());
}

#[test]
fn nothing_is_sent_until_the_provider_is_enabled_and_keyed() {
    let dir = TempDir::new("gate");
    let backend = backend(&dir);
    let fake = Fake::start(|_, _| json_reply(json!({})));

    let (status, _, _) = call(&backend, "PUT", "/ai/providers/openai", json!({ "endpoint": fake.origin }));
    assert_eq!(status, 200);
    let (status, _, text) = call(&backend, "POST", "/ai/image", image_request("openai"));
    assert_eq!(status, 409);
    assert!(text.contains("n’est pas activé") && text.contains("Rien n’a été envoyé"), "{text}");

    let (status, _, _) = call(&backend, "PUT", "/ai/providers/openai", json!({ "enabled": true }));
    assert_eq!(status, 200);
    let (status, _, text) = call(&backend, "POST", "/ai/text", text_request("openai"));
    assert_eq!(status, 409);
    assert!(text.contains("Aucune clé d’API pour OpenAI"), "{text}");
    let (status, _, _) = call(&backend, "POST", "/ai/test/openai", Value::Null);
    assert_eq!(status, 409);

    let missing = dir.text("missing/codex.exe");
    let (status, _, _) = call(&backend, "PUT", "/ai/providers/codex", json!({ "enabled": true, "endpoint": missing }));
    assert_eq!(status, 200);
    let (status, _, text) = call(&backend, "POST", "/ai/text", text_request("codex"));
    assert_eq!(status, 409);
    assert!(text.contains("Codex CLI introuvable"), "{text}");

    assert!(fake.requests().is_empty(), "{:?}", fake.requests());
}

#[test]
fn requests_are_validated() {
    let dir = TempDir::new("validate");
    let backend = backend(&dir);
    for (path, body, message) in [
        ("/ai/image", json!({ "provider": "openai", "width": 16, "height": 16 }), "prompt"),
        ("/ai/image", json!({ "provider": "openai", "prompt": "a", "width": 0, "height": 16 }), "width"),
        ("/ai/image", json!({ "provider": "openai", "prompt": "a", "width": 16, "height": 2000 }), "height"),
        ("/ai/image", json!({ "provider": "anthropic", "prompt": "a", "width": 16, "height": 16 }), "ne génère pas d’images"),
        ("/ai/image", json!({ "provider": "acme", "prompt": "a", "width": 16, "height": 16 }), "inconnu"),
        ("/ai/text", json!({ "provider": "stability", "system": "s", "messages": [{ "role": "user", "content": "a" }] }), "ne génère pas de texte"),
        ("/ai/text", json!({ "provider": "openai", "system": "s", "messages": [] }), "messages"),
        ("/ai/text", json!({ "provider": "openai", "system": "s", "messages": [{ "role": "assistant", "content": "a" }] }), "dernier message"),
        ("/ai/text", json!({ "provider": "openai", "system": "s", "messages": [{ "role": "system", "content": "a" }] }), "rôle"),
        ("/ai/text", json!({ "provider": "openai", "system": "s", "json": "oui", "messages": [{ "role": "user", "content": "a" }] }), "json"),
        ("/ai/image", json!({ "provider": "openai", "prompt": "a", "width": 16, "height": 16, "requestId": "a b" }), "requestId"),
        ("/ai/cancel", json!({}), "requestId"),
    ] {
        let (status, _, text) = call(&backend, "POST", path, body.clone());
        assert_eq!(status, 400, "{body} : {text}");
        assert!(text.contains(message), "{body} : {text}");
    }
}

// ---------------------------------------------------------------- fournisseurs

#[test]
fn openai_images_and_text() {
    let dir = TempDir::new("openai");
    let backend = backend(&dir);
    let fake = Fake::start(|seen, _| match seen.url.as_str() {
        "/v1/images/generations" => json_reply(json!({ "data": [{ "b64_json": b64(&png()), "revised_prompt": "une épée pixel" }] })),
        "/v1/chat/completions" => json_reply(json!({ "choices": [{ "message": { "content": "{\"id\":\"x\"}" } }] })),
        _ => (404, "text/plain", b"?".to_vec()),
    });
    enable(&backend, "openai", &fake.origin, json!({}));

    let (status, image, text) = call(&backend, "POST", "/ai/image", image_request("openai"));
    assert_eq!(status, 200, "{text}");
    assert_png(&image);
    assert_eq!((image["provider"].clone(), image["model"].clone()), (json!("openai"), json!("gpt-image-2.5-flare")));
    assert_eq!(image["note"], "une épée pixel");

    let (status, reply, text) = call(&backend, "POST", "/ai/text", text_request("openai"));
    assert_eq!(status, 200, "{text}");
    assert_eq!(reply["text"], "{\"id\":\"x\"}");

    let requests = fake.requests();
    assert_eq!(requests[0].header("Authorization"), Some(format!("Bearer {KEY}").as_str()));
    let body = requests[0].json();
    assert_eq!(body["prompt"], "Pixel art\n\nune épée");
    assert_eq!((body["size"].clone(), body["background"].clone(), body["n"].clone()), (json!("1024x1024"), json!("transparent"), json!(1)));
    let body = requests[1].json();
    assert_eq!(body["response_format"], json!({ "type": "json_object" }));
    assert_eq!(body["messages"][0], json!({ "role": "system", "content": "Réponds en JSON" }));
    assert_eq!(body["messages"][1], json!({ "role": "user", "content": "un menu" }));
    assert_eq!(body["model"], "gpt-5.6-luna");
}

#[test]
fn openai_asks_once_more_without_a_transparent_background() {
    let dir = TempDir::new("openai-bg");
    let backend = backend(&dir);
    let fake = Fake::start(|seen, _| {
        if seen.json().get("background").is_some() {
            (400, "application/json", br#"{"error":{"message":"background=transparent is not supported"}}"#.to_vec())
        } else {
            json_reply(json!({ "data": [{ "b64_json": b64(&png()) }] }))
        }
    });
    enable(&backend, "openai", &fake.origin, json!({}));
    let (status, image, text) = call(&backend, "POST", "/ai/image", image_request("openai"));
    assert_eq!(status, 200, "{text}");
    assert_png(&image);
    assert_eq!(fake.requests().len(), 2);
}

#[test]
fn anthropic_text() {
    let dir = TempDir::new("anthropic");
    let backend = backend(&dir);
    let fake = Fake::start(|_, _| {
        json_reply(json!({ "content": [{ "type": "text", "text": "{\"a\":" }, { "type": "text", "text": "1}" }], "stop_reason": "end_turn" }))
    });
    enable(&backend, "anthropic", &fake.origin, json!({}));
    let (status, reply, text) = call(&backend, "POST", "/ai/text", text_request("anthropic"));
    assert_eq!(status, 200, "{text}");
    assert_eq!(reply["text"], "{\"a\":1}");
    let seen = &fake.requests()[0];
    assert_eq!(seen.url, "/v1/messages");
    assert_eq!(seen.header("x-api-key"), Some(KEY));
    assert_eq!(seen.header("anthropic-version"), Some("2023-06-01"));
    assert_eq!(seen.header("Authorization"), None);
    let body = seen.json();
    assert_eq!((body["model"].clone(), body["system"].clone()), (json!("claude-sonnet-5"), json!("Réponds en JSON")));
    assert_eq!(body["messages"], json!([{ "role": "user", "content": "un menu" }]));
    assert!(body["max_tokens"].as_u64().unwrap() >= 4096);
}

#[test]
fn google_images_and_text() {
    let dir = TempDir::new("google");
    let backend = backend(&dir);
    let fake = Fake::start(|seen, _| match seen.url.as_str() {
        "/v1beta/models/gemini-3.1-flash-image:generateContent" => json_reply(json!({ "candidates": [{ "content": { "parts": [
            { "text": "Voici" }, { "inlineData": { "mimeType": "image/png", "data": b64(&png()) } }
        ] } }] })),
        "/v1beta/models/gemini-3.8-flash:generateContent" => json_reply(json!({ "candidates": [{ "content": { "parts": [
            { "text": "réflexion", "thought": true }, { "text": "{}" }
        ] } }] })),
        _ => (404, "text/plain", Vec::new()),
    });
    enable(&backend, "google", &fake.origin, json!({}));
    let (status, image, text) = call(&backend, "POST", "/ai/image", image_request("google"));
    assert_eq!(status, 200, "{text}");
    assert_png(&image);
    let (status, reply, text) = call(&backend, "POST", "/ai/text", text_request("google"));
    assert_eq!(status, 200, "{text}");
    assert_eq!(reply["text"], "{}");

    let requests = fake.requests();
    assert_eq!(requests[0].header("x-goog-api-key"), Some(KEY));
    assert!(!requests[0].url.contains(KEY));
    assert_eq!(requests[0].json()["generationConfig"]["responseModalities"], json!(["TEXT", "IMAGE"]));
    let body = requests[1].json();
    assert_eq!(body["systemInstruction"]["parts"][0]["text"], "Réponds en JSON");
    assert_eq!(body["generationConfig"]["responseMimeType"], "application/json");
    assert_eq!(body["contents"][0]["role"], "user");
}

#[test]
fn google_refusals_are_explained() {
    let dir = TempDir::new("google-block");
    let backend = backend(&dir);
    let fake = Fake::start(|_, _| json_reply(json!({ "promptFeedback": { "blockReason": "SAFETY" } })));
    enable(&backend, "google", &fake.origin, json!({}));
    let (status, _, text) = call(&backend, "POST", "/ai/image", image_request("google"));
    assert_eq!(status, 502);
    assert!(text.contains("Gemini a refusé la demande (SAFETY)"), "{text}");
}

#[test]
fn stability_sends_a_multipart_form() {
    let dir = TempDir::new("stability");
    let backend = backend(&dir);
    let fake = Fake::start(|_, _| (200, "image/png", png()));
    enable(&backend, "stability", &fake.origin, json!({}));
    let mut request = image_request("stability");
    request["negativePrompt"] = json!("flou");
    request["width"] = json!(64);
    request["height"] = json!(20);
    let (status, image, text) = call(&backend, "POST", "/ai/image", request);
    assert_eq!(status, 200, "{text}");
    assert_png(&image);
    let seen = &fake.requests()[0];
    assert_eq!(seen.url, "/v2beta/stable-image/generate/core");
    assert_eq!(seen.header("Accept"), Some("image/*"));
    assert!(seen.header("Content-Type").unwrap().starts_with("multipart/form-data; boundary="));
    let body = seen.text();
    for part in ["name=\"prompt\"\r\n\r\nPixel art\n\nune épée", "name=\"output_format\"\r\n\r\npng", "name=\"aspect_ratio\"\r\n\r\n21:9", "name=\"negative_prompt\"\r\n\r\nflou"] {
        assert!(body.contains(part), "{part} absent de {body}");
    }
}

#[test]
fn fal_returns_data_uris_or_downloads_without_the_key() {
    let dir = TempDir::new("fal");
    let backend = backend(&dir);
    let calls = Arc::new(AtomicU32::new(0));
    let counter = Arc::clone(&calls);
    let fake = Fake::start(move |seen, origin| match seen.url.as_str() {
        "/fal-ai/flux/schnell" if counter.fetch_add(1, Ordering::SeqCst) == 0 => {
            json_reply(json!({ "images": [{ "url": format!("data:image/png;base64,{}", b64(&png())) }] }))
        }
        "/fal-ai/flux/schnell" => json_reply(json!({ "images": [{ "url": format!("{origin}/files/out.png") }] })),
        "/files/out.png" => (200, "image/png", png()),
        _ => (404, "text/plain", Vec::new()),
    });
    enable(&backend, "fal", &fake.origin, json!({}));
    for _ in 0..2 {
        let (status, image, text) = call(&backend, "POST", "/ai/image", image_request("fal"));
        assert_eq!(status, 200, "{text}");
        assert_png(&image);
    }
    let requests = fake.requests();
    assert_eq!(requests.len(), 3);
    assert_eq!(requests[0].header("Authorization"), Some(format!("Key {KEY}").as_str()));
    let body = requests[0].json();
    assert_eq!((body["sync_mode"].clone(), body["image_size"].clone()), (json!(true), json!({ "width": 1024, "height": 1024 })));
    assert_eq!(requests[2].url, "/files/out.png");
    assert_eq!(requests[2].header("Authorization"), None);

    let (status, outcome, _) = call(&backend, "POST", "/ai/test/fal", Value::Null);
    assert_eq!((status, outcome["verified"].clone()), (200, json!(false)));
    assert_eq!(fake.requests().len(), 3, "le test de fal n’envoie rien");
}

#[test]
fn replicate_polls_on_its_own_api_only() {
    let dir = TempDir::new("replicate");
    let backend = backend(&dir);
    let fake = Fake::start(|seen, origin| match (seen.method.as_str(), seen.url.as_str()) {
        ("POST", "/v1/models/black-forest-labs/flux-schnell/predictions") => json_reply(json!({
            "id": "abc123", "status": "processing", "urls": { "get": "https://ailleurs.example/v1/predictions/abc123" }
        })),
        ("GET", "/v1/predictions/abc123") => json_reply(json!({ "id": "abc123", "status": "succeeded", "output": [format!("{origin}/files/r.png")] })),
        ("GET", "/files/r.png") => (200, "image/png", png()),
        _ => (404, "text/plain", Vec::new()),
    });
    enable(&backend, "replicate", &fake.origin, json!({}));
    let (status, image, text) = call(&backend, "POST", "/ai/image", image_request("replicate"));
    assert_eq!(status, 200, "{text}");
    assert_png(&image);
    let requests = fake.requests();
    assert_eq!(requests.len(), 3);
    assert_eq!(requests[0].header("Prefer"), Some("wait=60"));
    assert_eq!(requests[0].json()["input"]["aspect_ratio"], "1:1");
    assert_eq!(requests[1].header("Authorization"), Some(format!("Bearer {KEY}").as_str()));
    assert_eq!(requests[2].header("Authorization"), None);
}

#[test]
fn replicate_failures_are_reported() {
    let dir = TempDir::new("replicate-fail");
    let backend = backend(&dir);
    let fake = Fake::start(|_, _| json_reply(json!({ "id": "a1", "status": "failed", "error": "NSFW" })));
    enable(&backend, "replicate", &fake.origin, json!({}));
    let (status, _, text) = call(&backend, "POST", "/ai/image", image_request("replicate"));
    assert_eq!(status, 502);
    assert!(text.contains("la génération a échoué (NSFW)"), "{text}");
}

#[test]
fn comfyui_queues_polls_and_views() {
    let dir = TempDir::new("comfyui");
    let backend = backend(&dir);
    let polls = Arc::new(AtomicU32::new(0));
    let counter = Arc::clone(&polls);
    let fake = Fake::start(move |seen, _| match (seen.method.as_str(), seen.url.as_str()) {
        ("POST", "/prompt") => json_reply(json!({ "prompt_id": "p-1", "number": 0 })),
        ("GET", "/history/p-1") if counter.fetch_add(1, Ordering::SeqCst) == 0 => json_reply(json!({})),
        ("GET", "/history/p-1") => json_reply(json!({ "p-1": { "outputs": { "9": { "images": [
            { "filename": "menu forge_00001_.png", "subfolder": "", "type": "output" }
        ] } } } })),
        ("GET", "/view?filename=menu%20forge_00001_.png&subfolder=&type=output") => (200, "image/png", png()),
        _ => (404, "text/plain", Vec::new()),
    });
    enable(&backend, "comfyui", &fake.origin, json!({}));
    let (status, image, text) = call(&backend, "POST", "/ai/image", image_request("comfyui"));
    assert_eq!(status, 200, "{text}");
    assert_png(&image);
    let requests = fake.requests();
    assert_eq!(requests.len(), 4);
    let flow = &requests[0].json()["prompt"];
    assert_eq!(flow["4"]["inputs"]["ckpt_name"], "sd_xl_base_1.0.safetensors");
    assert_eq!(flow["6"]["inputs"]["text"], "Pixel art\n\nune épée");
    assert!(requests.iter().all(|seen| seen.header("Authorization").is_none()));
}

#[test]
fn automatic1111_txt2img_with_a_checkpoint() {
    let dir = TempDir::new("a1111");
    let backend = backend(&dir);
    let fake = Fake::start(|_, _| json_reply(json!({ "images": [b64(&png())] })));
    enable(&backend, "automatic1111", &fake.origin, json!({ "imageModel": "pixel.safetensors" }));
    let (status, image, text) = call(&backend, "POST", "/ai/image", image_request("automatic1111"));
    assert_eq!(status, 200, "{text}");
    assert_png(&image);
    let body = fake.requests()[0].json();
    assert_eq!(fake.requests()[0].url, "/sdapi/v1/txt2img");
    assert_eq!(body["override_settings"], json!({ "sd_model_checkpoint": "pixel.safetensors" }));
    assert_eq!((body["width"].clone(), body["height"].clone()), (json!(768), json!(768)));
}

#[test]
fn mistral_and_ollama_text() {
    let dir = TempDir::new("text");
    let backend = backend(&dir);
    let fake = Fake::start(|seen, _| match seen.url.as_str() {
        "/v1/chat/completions" => json_reply(json!({ "choices": [{ "message": { "content": "{\"m\":1}" } }] })),
        "/api/chat" => json_reply(json!({ "message": { "role": "assistant", "content": "{\"o\":1}" }, "done": true })),
        "/api/tags" => json_reply(json!({ "models": [{ "name": "llama3.2:latest" }] })),
        _ => (404, "text/plain", Vec::new()),
    });
    enable(&backend, "mistral", &fake.origin, json!({}));
    enable(&backend, "ollama", &fake.origin, json!({}));
    let (_, reply, _) = call(&backend, "POST", "/ai/text", text_request("mistral"));
    assert_eq!(reply["text"], "{\"m\":1}");
    let (_, reply, _) = call(&backend, "POST", "/ai/text", text_request("ollama"));
    assert_eq!(reply["text"], "{\"o\":1}");
    let (status, outcome, _) = call(&backend, "POST", "/ai/test/ollama", Value::Null);
    assert_eq!((status, outcome["verified"].clone()), (200, json!(true)));

    let requests = fake.requests();
    assert_eq!(requests[0].json()["model"], "mistral-large-latest");
    assert_eq!(requests[0].json()["response_format"], json!({ "type": "json_object" }));
    let body = requests[1].json();
    assert_eq!((body["model"].clone(), body["stream"].clone(), body["format"].clone()), (json!("llama3.2"), json!(false), json!("json")));
    assert_eq!(requests[1].header("Authorization"), None);
}

#[test]
fn connection_tests_list_models() {
    let dir = TempDir::new("test");
    let backend = backend(&dir);
    let fake = Fake::start(|_, _| json_reply(json!({ "data": [{ "id": "a" }, { "id": "b" }] })));
    enable(&backend, "openai", &fake.origin, json!({}));
    let (status, outcome, text) = call(&backend, "POST", "/ai/test/openai", Value::Null);
    assert_eq!(status, 200, "{text}");
    assert_eq!(outcome["verified"], true);
    assert!(outcome["message"].as_str().unwrap().contains("2\u{a0}modèles accessibles"), "{outcome}");
    assert_eq!(fake.requests()[0].url, "/v1/models");
}

// ---------------------------------------------------------------- erreurs et annulation

#[test]
fn errors_are_french_and_never_leak_the_key() {
    let dir = TempDir::new("errors");
    let backend = backend(&dir);
    let status_code = Arc::new(AtomicU32::new(401));
    let current = Arc::clone(&status_code);
    let fake = Fake::start(move |_, _| {
        let status = current.load(Ordering::SeqCst) as u16;
        if status == 200 {
            return json_reply(json!({ "data": [{ "b64_json": b64(b"pas une image") }] }));
        }
        (status, "application/json", format!(r#"{{"error":{{"message":"Invalid key {KEY}"}}}}"#).into_bytes())
    });
    enable(&backend, "openai", &fake.origin, json!({}));
    for (status, expected) in [
        (401, "OpenAI refuse la clé d’API (401)"),
        (429, "limite de débit ou quota atteint (429)"),
        (503, "OpenAI est indisponible pour le moment (503)"),
        (200, "n’est pas une image"),
    ] {
        status_code.store(status, Ordering::SeqCst);
        let (code, _, text) = call(&backend, "POST", "/ai/image", image_request("openai"));
        assert_eq!(code, 502, "{text}");
        assert!(text.contains(expected), "{text}");
        assert!(!text.contains(KEY), "{text}");
    }
    let (_, _, text) = call(&backend, "POST", "/ai/image", image_request("openai"));
    assert!(!text.contains(KEY));
}

#[test]
fn unreachable_services_are_explained() {
    let dir = TempDir::new("offline");
    let backend = backend(&dir);
    // Port fermé : un serveur démarré puis arrêté.
    let origin = {
        let fake = Fake::start(|_, _| json_reply(json!({})));
        fake.origin.clone()
    };
    enable(&backend, "ollama", &origin, json!({}));
    let (status, _, text) = call(&backend, "POST", "/ai/text", text_request("ollama"));
    assert_eq!(status, 502, "{text}");
    assert!(text.contains("Connexion impossible") || text.contains("Échec de la connexion"), "{text}");
}

#[test]
fn generations_can_be_cancelled() {
    let dir = TempDir::new("cancel");
    let backend = Arc::new(backend(&dir));
    let fake = Fake::start(|_, _| {
        thread::sleep(Duration::from_secs(4));
        json_reply(json!({ "data": [{ "b64_json": b64(&png()) }] }))
    });
    enable(&backend, "openai", &fake.origin, json!({}));
    let started = Instant::now();
    let worker = {
        let backend = Arc::clone(&backend);
        thread::spawn(move || {
            let mut request = image_request("openai");
            request["requestId"] = json!("req-1");
            call(&backend, "POST", "/ai/image", request)
        })
    };
    thread::sleep(Duration::from_millis(400));
    let (status, _, _) = call(&backend, "POST", "/ai/cancel", json!({ "requestId": "req-1" }));
    assert_eq!(status, 204);
    let (status, _, text) = worker.join().unwrap();
    assert_eq!(status, 409, "{text}");
    assert_eq!(text, "Génération annulée");
    assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
    // Annuler une génération inconnue ou finie ne fait rien.
    let (status, _, _) = call(&backend, "POST", "/ai/cancel", json!({ "requestId": "req-1" }));
    assert_eq!(status, 204);
}
