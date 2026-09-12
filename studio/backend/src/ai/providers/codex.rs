//! Codex CLI (installé sur le poste, connecté par `codex login`) : le studio
//! lance `codex exec` en mode non interactif, bac à sable en lecture seule,
//! dans un dossier temporaire vide, le prompt sur l’entrée standard.
//!
//! - Texte : le dernier message de l’agent (`-o <fichier>`).
//! - Image : Codex génère avec son outil d’images et dépose le fichier dans
//!   `~/.codex/generated_images/<session>/` (ou `$CODEX_HOME`) ; le studio
//!   prend l’image la plus récente créée pendant l’exécution.
//!
//! Le processus est tué à l’échéance ou à l’annulation. Aucune clé : Codex
//! gère sa propre connexion (et sa facturation).
//!
//! `--json` : Codex écrit ses évènements en JSONL sur sa sortie standard
//! (`thread.started`, `turn.started`, `item.*` de type `reasoning`,
//! `command_execution`, `agent_message`…, `turn.completed`). Ils sont lus au
//! fil de l’eau pour la progression (« Codex réfléchit », « Codex rédige… »),
//! sans être gardés ; le dernier message et la dernière erreur servent de
//! repli à `-o` et de message d’échec.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, SystemTime};

use serde_json::Value;

use super::{image_from_bytes, Ctx, ImageJob, ImageResult, Role, TestOutcome, TextJob};
use crate::ai::error::{truncate, AiError, NBSP};
use crate::ai::progress::{Phase, Progress};

/// Sortie gardée d’un flux du processus (le reste est ignoré).
const OUTPUT_LIMIT: u64 = 1024 * 1024;
static WORKDIR_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Programme Codex : chemin réglé s’il existe, sinon `codex` dans le `PATH`,
/// sinon l’installation Windows par défaut.
pub fn locate(configured: Option<&str>) -> Option<PathBuf> {
    if let Some(path) = configured {
        let path = PathBuf::from(path);
        return path.is_file().then_some(path);
    }
    let names: &[&str] = if cfg!(windows) { &["codex.exe", "codex.cmd", "codex"] } else { &["codex"] };
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            for name in names {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    let local = std::env::var_os("LOCALAPPDATA")?;
    let candidate = PathBuf::from(local).join("Programs").join("OpenAI").join("Codex").join("bin").join("codex.exe");
    candidate.is_file().then_some(candidate)
}

/// Dossier des données de Codex (`$CODEX_HOME`, sinon `~/.codex`).
fn codex_home() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("CODEX_HOME").filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(home));
    }
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(".codex"))
}

/// Image (PNG, JPEG, WebP) la plus récente de `dir` et de ses sous-dossiers
/// directs, modifiée à partir de `since`.
pub fn newest_image(dir: &Path, since: SystemTime) -> Option<PathBuf> {
    let mut best: Option<(SystemTime, PathBuf)> = None;
    let mut consider = |path: PathBuf| {
        let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or_default().to_ascii_lowercase();
        if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp") {
            return;
        }
        let Ok(modified) = path.metadata().and_then(|metadata| metadata.modified()) else { return };
        if modified >= since && best.as_ref().is_none_or(|(time, _)| modified > *time) {
            best = Some((modified, path));
        }
    };
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            for inner in std::fs::read_dir(&path).into_iter().flatten().flatten() {
                consider(inner.path());
            }
        } else {
            consider(path);
        }
    }
    best.map(|(_, path)| path)
}

/// Arguments de `codex exec` ; `output` reçoit le dernier message.
pub fn exec_args(model: &str, output: &Path, ephemeral: bool) -> Vec<String> {
    let mut args: Vec<String> = ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "--json"]
        .into_iter()
        .map(str::to_owned)
        .collect();
    if ephemeral {
        args.push("--ephemeral".into());
    }
    args.push("-o".into());
    args.push(output.to_string_lossy().into_owned());
    if !model.is_empty() {
        args.push("-m".into());
        args.push(model.to_owned());
    }
    // Prompt lu sur l’entrée standard.
    args.push("-".into());
    args
}

/// Conversation mise à plat pour une exécution unique de Codex.
pub fn flatten(job: &TextJob) -> String {
    let mut prompt = format!("{}\n\n", job.system);
    for message in &job.messages {
        let label = if message.role == Role::User { "DEMANDE" } else { "TA RÉPONSE PRÉCÉDENTE" };
        prompt.push_str(&format!("### {label}\n{}\n\n", message.content));
    }
    if job.json {
        prompt.push_str("Réponds uniquement par l’objet JSON demandé, sans texte autour, sans bloc de code, sans modifier aucun fichier.\n");
    }
    prompt
}

/// Dossier de travail temporaire vide, supprimé à la fin.
struct WorkDir(PathBuf);

impl WorkDir {
    fn new() -> Result<Self, AiError> {
        let dir = std::env::temp_dir().join(format!(
            "menu-forge-codex-{}-{}",
            std::process::id(),
            WORKDIR_COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&dir)
            .map_err(|error| AiError::Internal(format!("Dossier temporaire impossible à créer{NBSP}: {error}")))?;
        Ok(Self(dir))
    }
}

impl Drop for WorkDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn reader(mut stream: impl Read + Send + 'static) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = (&mut stream).take(OUTPUT_LIMIT).read_to_end(&mut buffer);
        // Le reste est lu et jeté : le processus ne se bloque pas sur un tuyau plein.
        let _ = std::io::copy(&mut stream, &mut std::io::sink());
        buffer
    })
}

/// Ce qu’un évènement JSONL de Codex apprend au studio.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct CodexEvent {
    pub phase: Option<Phase>,
    /// Message final de l’agent (repli si `-o` n’a rien écrit).
    pub message: Option<String>,
    /// Erreur signalée par Codex (message d’échec plus clair que la sortie d’erreur).
    pub error: Option<String>,
}

fn text_at(value: &Value, pointers: &[&str]) -> Option<String> {
    pointers
        .iter()
        .find_map(|pointer| value.pointer(pointer).and_then(Value::as_str))
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

/// Phase d’un élément de travail de Codex, d’après son type.
fn item_phase(kind: &str) -> Option<Phase> {
    if kind.contains("image") {
        Some(Phase::Image)
    } else if kind.contains("reasoning") {
        Some(Phase::Thinking)
    } else if kind.starts_with("agent_message") {
        Some(Phase::Writing)
    } else if ["command", "tool", "search", "file_change", "patch", "todo"].iter().any(|part| kind.contains(part)) {
        Some(Phase::Tool)
    } else {
        None
    }
}

/// Lit une ligne de `codex exec --json` (format actuel `{ type, item? }`, ou
/// ancien `{ id, msg: { type } }`) ; `None` pour une ligne qui n’est pas un
/// évènement.
pub fn classify(line: &str) -> Option<CodexEvent> {
    let value: Value = serde_json::from_str(line.trim()).ok()?;
    let mut event = CodexEvent::default();
    if let Some(kind) = value.get("type").and_then(Value::as_str) {
        match kind {
            "thread.started" => event.phase = Some(Phase::Starting),
            "turn.started" => event.phase = Some(Phase::Waiting),
            "turn.completed" => event.phase = Some(Phase::Receiving),
            "turn.failed" | "error" => event.error = text_at(&value, &["/error/message", "/message"]),
            _ if kind.starts_with("item.") => {
                let item = value.get("item")?;
                let item_kind = ["/type", "/item_type", "/details/type"]
                    .iter()
                    .find_map(|pointer| item.pointer(pointer).and_then(Value::as_str))
                    .unwrap_or_default();
                event.phase = item_phase(item_kind);
                if item_kind == "agent_message" && kind == "item.completed" {
                    event.message = text_at(item, &["/text", "/details/text"]);
                }
                if item_kind == "error" {
                    event.error = text_at(item, &["/message", "/text"]);
                }
            }
            _ => {}
        }
        return Some(event);
    }
    let message = value.get("msg")?;
    let kind = message.get("type").and_then(Value::as_str)?;
    match kind {
        "task_started" => event.phase = Some(Phase::Waiting),
        "task_complete" => {
            event.phase = Some(Phase::Receiving);
            event.message = text_at(message, &["/last_agent_message"]);
        }
        "agent_message" => {
            event.phase = Some(Phase::Writing);
            event.message = text_at(message, &["/message"]);
        }
        "error" | "stream_error" => event.error = text_at(message, &["/message"]),
        _ => event.phase = item_phase(kind),
    }
    Some(event)
}

/// Dernier message et dernière erreur relevés dans les évènements.
#[derive(Debug, Default)]
struct Transcript {
    message: Option<String>,
    error: Option<String>,
}

/// Suit la sortie JSONL : chaque évènement fait avancer la progression ; rien
/// d’autre n’est gardé (une ligne trop longue est lue par morceaux et ignorée).
fn follow(stream: impl Read + Send + 'static, progress: Progress) -> thread::JoinHandle<Transcript> {
    thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        let mut transcript = Transcript::default();
        let mut line = Vec::new();
        loop {
            line.clear();
            match (&mut reader).take(OUTPUT_LIMIT).read_until(b'\n', &mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let Some(event) = classify(&String::from_utf8_lossy(&line)) else { continue };
            progress.event();
            if let Some(phase) = event.phase {
                progress.set(phase);
            }
            if event.message.is_some() {
                transcript.message = event.message;
            }
            if event.error.is_some() {
                transcript.error = event.error;
            }
        }
        transcript
    })
}

/// Lance le programme, lui passe `input` et attend sa fin (tué à l’échéance
/// ou à l’annulation). Renvoie la dernière erreur de Codex (ou la sortie
/// d’erreur) en cas d’échec.
fn run(ctx: &Ctx, program: &Path, args: &[String], input: &str, cwd: &Path) -> Result<Transcript, AiError> {
    ctx.budget.progress().set(Phase::Starting);
    let mut command = Command::new(program);
    command.args(args).current_dir(cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW : pas de console qui s’ouvre depuis l’appli.
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|error| {
        AiError::NotReady(format!("Impossible de lancer Codex CLI ({}){NBSP}: {error}", program.display()))
    })?;
    if let Some(mut stdin) = child.stdin.take() {
        let input = input.to_owned();
        thread::spawn(move || {
            let _ = stdin.write_all(input.as_bytes());
        });
    }
    let stdout = child.stdout.take().map(|stream| follow(stream, ctx.budget.progress().clone()));
    let stderr = child.stderr.take().map(reader);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(error) => return Err(AiError::Internal(format!("Codex CLI{NBSP}: {error}"))),
        }
        if let Err(stop) = ctx.budget.remaining() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(stop);
        }
        thread::sleep(Duration::from_millis(100));
    };
    let transcript = stdout.and_then(|handle| handle.join().ok()).unwrap_or_default();
    let errors = stderr.and_then(|handle| handle.join().ok()).unwrap_or_default();
    if status.success() {
        return Ok(transcript);
    }
    let tail = String::from_utf8_lossy(&errors);
    let tail = transcript
        .error
        .clone()
        .unwrap_or_else(|| tail.lines().rev().find(|line| !line.trim().is_empty()).unwrap_or_default().to_owned());
    Err(AiError::Invalid(format!(
        "Codex CLI s’est arrêté en erreur ({status}){}",
        if tail.trim().is_empty() { String::new() } else { format!("{NBSP}: {}", truncate(tail.trim(), 300)) }
    )))
}

fn program(ctx: &Ctx) -> PathBuf {
    PathBuf::from(&ctx.endpoint)
}

pub fn text(ctx: &Ctx, job: &TextJob) -> Result<String, AiError> {
    let work = WorkDir::new()?;
    let output = work.0.join("last-message.txt");
    let transcript = run(ctx, &program(ctx), &exec_args(&ctx.model, &output, true), &flatten(job), &work.0)?;
    std::fs::read_to_string(&output)
        .ok()
        .filter(|text| !text.trim().is_empty())
        .or(transcript.message)
        .ok_or_else(|| AiError::Invalid("Codex CLI n’a écrit aucune réponse".to_owned()))
}

pub fn image(ctx: &Ctx, job: &ImageJob) -> Result<ImageResult, AiError> {
    let folder = codex_home()
        .map(|home| home.join("generated_images"))
        .ok_or_else(|| AiError::NotReady("Dossier de Codex introuvable (ni CODEX_HOME ni dossier personnel)".to_owned()))?;
    let work = WorkDir::new()?;
    let output = work.0.join("last-message.txt");
    let prompt = format!(
        "Utilise ton outil de génération d’images pour créer exactement UNE image. N’écris aucun code, ne crée ni ne modifie aucun fichier toi-même.\n\nImage demandée{NBSP}:\n{}",
        job.prompt
    );
    // Marge d’une seconde : horloges de fichiers arrondies.
    let started = SystemTime::now() - Duration::from_secs(1);
    // Session conservée (pas `--ephemeral`) : c’est elle qui range l’image.
    run(ctx, &program(ctx), &exec_args(&ctx.model, &output, false), &prompt, &work.0)?;
    let path = newest_image(&folder, started).ok_or_else(|| {
        AiError::Invalid(format!(
            "Codex n’a déposé aucune image dans {}{NBSP}: la génération d’images est-elle disponible pour ce compte{NBSP}?",
            folder.display()
        ))
    })?;
    let bytes = std::fs::read(&path)
        .map_err(|error| AiError::Internal(format!("Image de Codex illisible ({}){NBSP}: {error}", path.display())))?;
    image_from_bytes(ctx, bytes)
}

/// `codex --version` : vérifie que le programme se lance, sans réseau.
pub fn test(ctx: &Ctx) -> Result<TestOutcome, AiError> {
    let work = WorkDir::new()?;
    let mut command = Command::new(program(ctx));
    command.arg("--version").current_dir(&work.0).stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let result = command
        .output()
        .map_err(|error| AiError::NotReady(format!("Impossible de lancer Codex CLI{NBSP}: {error}")))?;
    let version = String::from_utf8_lossy(&result.stdout).trim().to_owned();
    Ok(TestOutcome {
        message: format!(
            "{} trouvé. Codex utilise sa propre connexion (codex login){NBSP}: elle sera vérifiée à la première génération",
            if version.is_empty() { "Codex CLI".to_owned() } else { version }
        ),
        verified: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::providers::Message;

    #[test]
    fn arguments() {
        let args = exec_args("gpt-x", Path::new("C:/tmp/out.txt"), true);
        assert_eq!(
            args,
            ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "--json", "--ephemeral", "-o", "C:/tmp/out.txt", "-m", "gpt-x", "-"]
        );
        assert!(!exec_args("", Path::new("o"), false).contains(&"-m".to_owned()));
    }

    #[test]
    fn json_events_become_phases() {
        let phase = |line: &str| classify(line).and_then(|event| event.phase);
        assert_eq!(phase(r#"{"type":"thread.started","thread_id":"t"}"#), Some(Phase::Starting));
        assert_eq!(phase(r#"{"type":"turn.started"}"#), Some(Phase::Waiting));
        assert_eq!(phase(r#"{"type":"item.started","item":{"id":"i0","type":"reasoning","text":""}}"#), Some(Phase::Thinking));
        assert_eq!(phase(r#"{"type":"item.started","item":{"id":"i1","type":"command_execution","command":"ls"}}"#), Some(Phase::Tool));
        assert_eq!(phase(r#"{"type":"item.started","item":{"id":"i2","item_type":"web_search"}}"#), Some(Phase::Tool));
        assert_eq!(phase(r#"{"type":"item.started","item":{"id":"i3","type":"image_generation"}}"#), Some(Phase::Image));
        assert_eq!(phase(r#"{"type":"turn.completed","usage":{"input_tokens":1}}"#), Some(Phase::Receiving));
        // Ancien format.
        assert_eq!(phase(r#"{"id":"0","msg":{"type":"agent_reasoning_delta","delta":"…"}}"#), Some(Phase::Thinking));
        assert_eq!(phase(r#"{"id":"0","msg":{"type":"exec_command_begin"}}"#), Some(Phase::Tool));
        // Ni évènement ni JSON : ignorés.
        assert_eq!(classify("Reading prompt from stdin..."), None);
        assert_eq!(classify(r#"[1, 2]"#), None);
    }

    #[test]
    fn final_messages_and_errors_are_kept() {
        let event = classify(r#"{"type":"item.completed","item":{"id":"i4","type":"agent_message","text":" {\"id\":\"menu\"} "}}"#).unwrap();
        assert_eq!(event.phase, Some(Phase::Writing));
        assert_eq!(event.message.as_deref(), Some(r#"{"id":"menu"}"#));
        // Un message encore en cours de rédaction n’est pas le message final.
        assert_eq!(classify(r#"{"type":"item.updated","item":{"type":"agent_message","text":"{"}}"#).unwrap().message, None);
        let failed = classify(r#"{"type":"turn.failed","error":{"message":"You've hit your usage limit."}}"#).unwrap();
        assert_eq!(failed.error.as_deref(), Some("You've hit your usage limit."));
        let legacy = classify(r#"{"id":"0","msg":{"type":"task_complete","last_agent_message":"{}"}}"#).unwrap();
        assert_eq!((legacy.phase, legacy.message.as_deref()), (Some(Phase::Receiving), Some("{}")));
    }

    #[test]
    fn events_are_followed_without_keeping_the_output() {
        let progress = Progress::tracked();
        let lines = [
            r#"{"type":"thread.started"}"#,
            "texte parasite",
            r#"{"type":"item.started","item":{"type":"reasoning"}}"#,
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"réponse"}}"#,
        ]
        .join("\n");
        let transcript = follow(std::io::Cursor::new(lines.into_bytes()), progress.clone()).join().unwrap();
        assert_eq!(transcript.message.as_deref(), Some("réponse"));
        assert_eq!(progress.phase(), Some(Phase::Writing));
        assert_eq!(progress.snapshot()["events"], 3);
    }

    #[test]
    fn prompts_are_flattened() {
        let job = TextJob {
            system: "Règles".into(),
            messages: vec![
                Message { role: Role::User, content: "Un menu".into() },
                Message { role: Role::Assistant, content: "{}".into() },
                Message { role: Role::User, content: "Corrige".into() },
            ],
            json: true,
        };
        let text = flatten(&job);
        assert!(text.starts_with("Règles\n\n### DEMANDE\nUn menu"));
        assert!(text.contains("### TA RÉPONSE PRÉCÉDENTE\n{}"));
        assert!(text.ends_with("sans modifier aucun fichier.\n"));
    }

    #[test]
    fn newest_image_is_found() {
        let work = WorkDir::new().unwrap();
        let session = work.0.join("019f");
        std::fs::create_dir_all(&session).unwrap();
        let before = SystemTime::now() - Duration::from_secs(5);
        std::fs::write(work.0.join("notes.txt"), b"x").unwrap();
        std::fs::write(session.join("old.png"), b"x").unwrap();
        thread::sleep(Duration::from_millis(30));
        std::fs::write(session.join("exec-new.png"), b"x").unwrap();
        assert_eq!(newest_image(&work.0, before).unwrap().file_name().unwrap(), "exec-new.png");
        assert_eq!(newest_image(&work.0, SystemTime::now() + Duration::from_secs(60)), None);
    }
}
