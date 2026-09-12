//! Transport des appels aux fournisseurs : HTTP bloquant (`ureq`), échéance
//! et annulation.
//!
//! Aucune nouvelle tentative automatique : une requête échouée devient une
//! erreur claire. Les attentes (sondage d’une génération en cours) passent
//! par [`Budget::sleep`], qui s’arrête à l’échéance ou à l’annulation : il
//! n’y a jamais de boucle sans fin.

use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use super::error::{AiError, NBSP};
use super::progress::{Phase, Progress};

/// Taille maximale d’une réponse lue (une image de 4096 px en PNG tient large).
pub const MAX_BODY: u64 = 64 * 1024 * 1024;
/// Délai d’établissement de la connexion.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Pas de vérification de l’annulation pendant une attente.
const TICK: Duration = Duration::from_millis(100);

/// Drapeau d’annulation partagé entre la route et le fil qui travaille.
#[derive(Clone, Debug, Default)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Échéance, annulation et progression d’une génération.
#[derive(Clone, Debug)]
pub struct Budget {
    deadline: Instant,
    total: Duration,
    cancel: CancelToken,
    progress: Progress,
}

impl Budget {
    pub fn new(total: Duration, cancel: CancelToken) -> Self {
        Self { deadline: Instant::now() + total, total, cancel, progress: Progress::default() }
    }

    /// Même budget, dont la progression est lue par l’interface.
    pub fn with_progress(mut self, progress: Progress) -> Self {
        self.progress = progress;
        self
    }

    pub fn progress(&self) -> &Progress {
        &self.progress
    }

    /// Temps restant ; erreur si la génération est annulée ou l’échéance passée.
    pub fn remaining(&self) -> Result<Duration, AiError> {
        if self.cancel.is_cancelled() {
            return Err(AiError::Cancelled);
        }
        let left = self.deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err(AiError::Timeout(self.total.as_secs()));
        }
        Ok(left)
    }

    /// Attend `duration` (moins s’il reste moins de temps), en surveillant l’annulation.
    pub fn sleep(&self, duration: Duration) -> Result<(), AiError> {
        let until = Instant::now() + duration;
        loop {
            self.remaining()?;
            let now = Instant::now();
            if now >= until {
                return Ok(());
            }
            thread::sleep(TICK.min(until - now));
        }
    }

    pub fn total_seconds(&self) -> u64 {
        self.total.as_secs()
    }
}

/// Requête HTTP vers un fournisseur.
pub struct HttpRequest<'a> {
    pub method: &'a str,
    pub url: String,
    pub headers: Vec<(&'a str, String)>,
    pub body: Option<Vec<u8>>,
}

/// Réponse brute, quel que soit son statut.
#[derive(Debug)]
pub struct HttpResponse {
    pub status: u16,
    pub content_type: String,
    pub body: Vec<u8>,
}

/// `https://hôte:port` d’une adresse, sans chemin ni requête (pour les messages).
pub fn origin(url: &str) -> &str {
    let start = url.find("://").map_or(0, |index| index + 3);
    let end = url[start..].find(['/', '?', '#']).map_or(url.len(), |index| start + index);
    &url[..end]
}

/// Envoie la requête ; tout statut est renvoyé tel quel (c’est l’appelant qui
/// l’interprète). Erreurs : réseau, échéance, annulation.
pub fn send(request: HttpRequest<'_>, budget: &Budget) -> Result<HttpResponse, AiError> {
    let timeout = budget.remaining()?;
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT.min(timeout))
        .timeout(timeout)
        .user_agent(concat!("menu-forge/", env!("CARGO_PKG_VERSION")))
        .build();
    let mut http = agent.request(request.method, &request.url);
    for (name, value) in &request.headers {
        http = http.set(name, value);
    }
    // Requête partie : on attend le fournisseur (l’interface affiche « … réfléchit »).
    budget.progress().set(Phase::Waiting);
    let result = match &request.body {
        Some(body) => http.send_bytes(body),
        None => http.call(),
    };
    let response = match result {
        Ok(response) | Err(ureq::Error::Status(_, response)) => response,
        Err(ureq::Error::Transport(transport)) => return Err(transport_error(&transport, &request.url, budget)),
    };
    budget.progress().set(Phase::Receiving);
    let status = response.status();
    let content_type = response.content_type().to_owned();
    let mut body = Vec::new();
    if let Err(error) = response.into_reader().take(MAX_BODY).read_to_end(&mut body) {
        budget.remaining()?;
        return Err(AiError::Network(format!("Réponse interrompue ({}){NBSP}: {error}", origin(&request.url))));
    }
    Ok(HttpResponse { status, content_type, body })
}

fn transport_error(error: &ureq::Transport, url: &str, budget: &Budget) -> AiError {
    if let Err(expired) = budget.remaining() {
        return expired;
    }
    let host = origin(url);
    let text = error.to_string();
    if text.contains("timed out") || text.contains("Timeout") {
        return AiError::Timeout(budget.total_seconds());
    }
    match error.kind() {
        ureq::ErrorKind::Dns => AiError::Network(format!("Adresse introuvable{NBSP}: {host}")),
        ureq::ErrorKind::ConnectionFailed => AiError::Network(format!(
            "Connexion impossible à {host}{NBSP}: le service est-il lancé et joignable{NBSP}?"
        )),
        _ => AiError::Network(format!("Échec de la connexion à {host}{NBSP}: {text}")),
    }
}

/// Exécute `job` dans un fil à part et attend son résultat en surveillant
/// l’échéance et l’annulation : une génération annulée rend la main tout de
/// suite (le fil abandonné s’arrête seul, à l’échéance de sa requête au plus
/// tard).
pub fn run_job<T: Send + 'static>(
    budget: &Budget,
    job: impl FnOnce() -> Result<T, AiError> + Send + 'static,
) -> Result<T, AiError> {
    let (sender, receiver) = mpsc::channel();
    thread::Builder::new()
        .name("menu-forge-ai".into())
        .spawn(move || {
            let _ = sender.send(job());
        })
        .map_err(|error| AiError::Internal(format!("Génération impossible à lancer{NBSP}: {error}")))?;
    loop {
        match receiver.recv_timeout(TICK) {
            Ok(result) => return result,
            Err(RecvTimeoutError::Timeout) => {
                budget.remaining()?;
            }
            Err(RecvTimeoutError::Disconnected) => {
                return Err(AiError::Internal("La génération s’est interrompue sans résultat".to_owned()));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origins_keep_only_scheme_and_host() {
        assert_eq!(origin("https://api.openai.com/v1/images?x=1"), "https://api.openai.com");
        assert_eq!(origin("http://127.0.0.1:8188"), "http://127.0.0.1:8188");
    }

    #[test]
    fn cancelled_jobs_return_at_once() {
        let cancel = CancelToken::new();
        let budget = Budget::new(Duration::from_secs(30), cancel.clone());
        let started = Instant::now();
        cancel.cancel();
        let result: Result<(), AiError> = run_job(&budget, || {
            thread::sleep(Duration::from_secs(5));
            Ok(())
        });
        assert_eq!(result, Err(AiError::Cancelled));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn budgets_expire() {
        let budget = Budget::new(Duration::from_millis(150), CancelToken::new());
        assert_eq!(budget.sleep(Duration::from_secs(5)), Err(AiError::Timeout(0)));
    }
}
