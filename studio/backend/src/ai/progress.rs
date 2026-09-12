//! Progression d’une génération en cours, lue par l’interface toutes les
//! secondes (`GET /ai/progress/:id`) : une phase (code stable), le nombre
//! d’évènements reçus du fournisseur et le temps écoulé.
//!
//! Rien de secret n’y passe : ni le prompt, ni la réponse, ni la clé ; seuls
//! des codes que l’interface traduit (`src/ai/jobs.ts`).

use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde_json::{Map, Value};

/// Phase d’une génération vue du backend.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    /// Demande reçue, fournisseur pas encore contacté.
    Queued,
    /// Programme en cours de lancement (Codex CLI).
    Starting,
    /// Requête envoyée, réponse attendue.
    Waiting,
    /// Le modèle raisonne (Codex : évènement `reasoning`).
    Thinking,
    /// Le modèle utilise un outil (commande, recherche…).
    Tool,
    /// Le modèle rédige sa réponse.
    Writing,
    /// Le modèle génère une image.
    Image,
    /// Réponse en cours de réception.
    Receiving,
}

impl Phase {
    /// Code lu par l’interface.
    pub fn as_str(self) -> &'static str {
        match self {
            Phase::Queued => "queued",
            Phase::Starting => "starting",
            Phase::Waiting => "waiting",
            Phase::Thinking => "thinking",
            Phase::Tool => "tool",
            Phase::Writing => "writing",
            Phase::Image => "image",
            Phase::Receiving => "receiving",
        }
    }
}

#[derive(Debug)]
struct State {
    phase: Phase,
    events: u64,
    started: Instant,
    changed: Instant,
}

/// Poignée partagée entre la route, le fil qui travaille et la route de
/// lecture. Sans suivi (`Progress::default()`), chaque appel est sans effet.
#[derive(Clone, Debug, Default)]
pub struct Progress(Option<Arc<Mutex<State>>>);

impl Progress {
    /// Progression suivie, en phase « reçue ».
    pub fn tracked() -> Self {
        let now = Instant::now();
        Self(Some(Arc::new(Mutex::new(State { phase: Phase::Queued, events: 0, started: now, changed: now }))))
    }

    fn with(&self, update: impl FnOnce(&mut State)) {
        if let Some(state) = &self.0 {
            update(&mut state.lock().unwrap_or_else(|poisoned| poisoned.into_inner()));
        }
    }

    /// Change de phase (sans effet si c’est déjà la phase en cours).
    pub fn set(&self, phase: Phase) {
        self.with(|state| {
            if state.phase != phase {
                state.phase = phase;
                state.changed = Instant::now();
            }
        });
    }

    /// Compte un évènement reçu du fournisseur (signe de vie).
    pub fn event(&self) {
        self.with(|state| state.events += 1);
    }

    /// Phase en cours (`None` sans suivi).
    pub fn phase(&self) -> Option<Phase> {
        self.0.as_ref().map(|state| state.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).phase)
    }

    /// `{ active, phase, events, elapsedMs, phaseMs }` pour l’interface.
    pub fn snapshot(&self) -> Value {
        let mut map = Map::new();
        match &self.0 {
            Some(state) => {
                let state = state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                map.insert("active".into(), Value::Bool(true));
                map.insert("phase".into(), Value::String(state.phase.as_str().into()));
                map.insert("events".into(), Value::from(state.events));
                map.insert("elapsedMs".into(), Value::from(state.started.elapsed().as_millis() as u64));
                map.insert("phaseMs".into(), Value::from(state.changed.elapsed().as_millis() as u64));
            }
            None => {
                map.insert("active".into(), Value::Bool(false));
            }
        }
        Value::Object(map)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn untracked_progress_does_nothing() {
        let progress = Progress::default();
        progress.set(Phase::Thinking);
        progress.event();
        assert_eq!(progress.phase(), None);
        assert_eq!(progress.snapshot()["active"], false);
    }

    #[test]
    fn tracked_progress_reports_its_phase_and_events() {
        let progress = Progress::tracked();
        assert_eq!(progress.snapshot()["phase"], "queued");
        let shared = progress.clone();
        shared.set(Phase::Writing);
        shared.event();
        shared.event();
        let snapshot = progress.snapshot();
        assert_eq!(snapshot["active"], true);
        assert_eq!(snapshot["phase"], "writing");
        assert_eq!(snapshot["events"], 2);
        assert!(snapshot["elapsedMs"].as_u64().is_some());
    }
}
