import { useEffect, useSyncExternalStore } from 'react';
import { formatSpan } from '../lib/clock';
import { NBSP, plural } from '../lib/format';
import { dismissGroup, dismissToast, showToast, updateToast } from '../ui/toasts';

/**
 * Générations par IA en tâches de fond, au niveau de l’application : elles
 * survivent à la fermeture de leur dialogue et aux changements d’écran, et
 * seul « Annuler » les arrête. Ce module ne tient que l’état (léger, dans le
 * paquet principal : l’indicateur et les notifications le lisent) ; le travail
 * lui-même est fourni par les dialogues, chargés à la demande
 * (`interfaceJob.ts`, `textureJob.ts`).
 */

export type JobKind = 'interface' | 'texture';

/**
 * Phase d’une tâche : préparation, envoi au fournisseur, attente de la
 * réponse, correction (essai 2 et suivants), vérification par le schéma (ou
 * lecture de l’image), rendu, puis une des trois fins.
 */
export type JobPhase = 'preparing' | 'sending' | 'waiting' | 'correcting' | 'checking' | 'rendering' | 'done' | 'failed' | 'cancelled';

/** Phase vue du backend (`backend/src/ai/progress.rs`), lue chaque seconde. */
export type RemotePhase = 'queued' | 'starting' | 'waiting' | 'thinking' | 'tool' | 'writing' | 'image' | 'receiving';

export interface RemoteProgress {
  phase: RemotePhase;
  events: number;
}

export interface JobAttempt {
  /** 1 pour la première demande. */
  index: number;
  errors: string[];
  /** Durée de l’essai. */
  elapsedMs: number;
}

export interface AiJob {
  id: string;
  kind: JobKind;
  providerId: string;
  providerName: string;
  /** `cli` : Codex, qui « lit la demande » avant de réfléchir. */
  providerKind: string;
  /** Demande saisie par l’utilisateur. */
  prompt: string;
  phase: JobPhase;
  remote: RemoteProgress | null;
  startedAt: number;
  endedAt: number | null;
  /** Essai en cours (0 avant le premier envoi). */
  attempt: number;
  attemptStartedAt: number;
  maxAttempts: number;
  attempts: JobAttempt[];
  /** Résultat (génération d’interface ou de texture), gardé même après un échec. */
  result: unknown;
  error: string | null;
  /** Valeurs du formulaire, pour rouvrir le dialogue tel qu’il était. */
  params: unknown;
  /** Résultat ouvert dans l’éditeur ou rejeté : le dialogue ne le remontre plus de lui-même. */
  consumed: boolean;
}

/** Ce que le travail d’une tâche peut signaler. */
export interface JobControl {
  signal: AbortSignal;
  phase: (phase: JobPhase) => void;
  /** Progression lue au backend pendant l’attente. */
  remote: (progress: RemoteProgress) => void;
  /** Un essai part (1, puis 2 pour la première correction…). */
  attemptStarted: (index: number) => void;
  /** Un essai est jugé (sans erreur : valide). */
  attemptFinished: (errors: string[]) => void;
}

export interface JobOutcome {
  value: unknown;
  /** Motif d’échec, le résultat restant consultable (aucun document valide…). */
  failure?: string | null;
}

export interface JobSpec {
  kind: JobKind;
  providerId: string;
  providerName: string;
  providerKind: string;
  prompt: string;
  maxAttempts: number;
  params: unknown;
}

const JOB_LIMIT = 20;
let jobs: readonly AiJob[] = [];
let counter = 0;
const listeners = new Set<() => void>();
const controllers = new Map<string, AbortController>();
const watchers = new Map<string, number>();
const openListeners = new Set<(job: AiJob) => void>();

function commit(next: readonly AiJob[]): void {
  jobs = next;
  for (const listener of listeners) listener();
}

function patch(id: string, change: Partial<AiJob> | ((job: AiJob) => Partial<AiJob>)): AiJob | null {
  let updated: AiJob | null = null;
  commit(
    jobs.map((job) => {
      if (job.id !== id) return job;
      updated = { ...job, ...(typeof change === 'function' ? change(job) : change) };
      return updated;
    }),
  );
  return updated;
}

export const isRunning = (job: AiJob): boolean => job.endedAt === null;

export function getJobs(): readonly AiJob[] {
  return jobs;
}

export function getJob(id: string | null | undefined): AiJob | null {
  return jobs.find((job) => job.id === id) ?? null;
}

export function subscribeJobs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useJobs(): readonly AiJob[] {
  return useSyncExternalStore(subscribeJobs, getJobs, getJobs);
}

export function useJob(id: string | null): AiJob | null {
  const all = useJobs();
  return all.find((job) => job.id === id) ?? null;
}

/**
 * Tâche que le dialogue d’un type montre à son ouverture : la plus récente
 * qui tourne encore, ou dont le résultat n’a été ni ouvert ni rejeté.
 */
export function latestJob(kind: JobKind): AiJob | null {
  return [...jobs].reverse().find((job) => job.kind === kind && (isRunning(job) || (!job.consumed && job.phase !== 'cancelled'))) ?? null;
}

/** Le dialogue de la tâche est ouvert : ses notifications d’essai et de fin sont superflues. */
export function watchJob(id: string): () => void {
  watchers.set(id, (watchers.get(id) ?? 0) + 1);
  return () => {
    const count = (watchers.get(id) ?? 1) - 1;
    if (count > 0) watchers.set(id, count);
    else watchers.delete(id);
  };
}

export function useWatchJob(id: string | null): void {
  useEffect(() => (id ? watchJob(id) : undefined), [id]);
}

const watched = (id: string) => (watchers.get(id) ?? 0) > 0;

/** Demande l’ouverture du dialogue d’une tâche (notification, indicateur) : l’application l’écoute. */
export function openJob(id: string): void {
  const job = getJob(id);
  if (!job) return;
  for (const listener of openListeners) listener(job);
}

export function onOpenJob(listener: (job: AiJob) => void): () => void {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}

/** Arrête vraiment la tâche : la requête est abandonnée et le backend prévenu. */
export function cancelJob(id: string): void {
  controllers.get(id)?.abort();
}

/** Résultat ouvert dans l’éditeur ou rejeté. */
export function consumeJob(id: string): void {
  patch(id, { consumed: true });
  dismissGroup(id);
}

/* ---------- Textes ---------- */

/** « Codex » plutôt que « Codex CLI » dans les phrases. */
export const shortProviderName = (name: string) => name.replace(/ CLI$/, '');

/** Demande résumée en une ligne. */
export function summarize(prompt: string, limit = 90): string {
  const text = prompt.trim().replace(/\s+/g, ' ');
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

export const elapsedOf = (job: AiJob, now: number) => (job.endedAt ?? now) - job.startedAt;

function remoteLabel(job: AiJob): string | null {
  const name = shortProviderName(job.providerName);
  switch (job.remote?.phase) {
    case 'starting':
      return `Lancement de ${name}…`;
    case 'waiting':
      return job.providerKind === 'cli' ? `${name} lit la demande…` : `${name} réfléchit…`;
    case 'thinking':
      return `${name} réfléchit…`;
    case 'tool':
      return `${name} consulte ses outils…`;
    case 'writing':
      return `${name} rédige sa réponse…`;
    case 'image':
      return `${name} génère l’image…`;
    case 'receiving':
      return 'Réception de la réponse…';
    default:
      return null;
  }
}

/** Correction en cours : essai n sur N, et le nombre d’erreurs de l’essai précédent. */
function correctionLabel(job: AiJob): string {
  const previous = job.attempts.find((attempt) => attempt.index === job.attempt - 1);
  const count = previous?.errors.length ?? 0;
  return `Essai ${job.attempt} sur ${job.maxAttempts}${NBSP}: correction de ${plural(count, 'erreur')}…`;
}

/** Titre et précision de la phase en cours, en clair. */
export function describeJob(job: AiJob): { title: string; detail: string | null } {
  const name = shortProviderName(job.providerName);
  const live = remoteLabel(job);
  const attemptLine = job.kind === 'interface' && job.attempt > 0 ? `Essai ${job.attempt} sur ${job.maxAttempts}` : null;
  switch (job.phase) {
    case 'preparing':
      return { title: 'Préparation de la demande…', detail: job.kind === 'interface' ? 'Schéma, géométrie du coffre, textures de l’espace' : 'Style, taille et palette imposés' };
    case 'sending':
      return { title: live ?? `Envoi à ${name}…`, detail: attemptLine };
    case 'waiting':
      return { title: live ?? `${name} réfléchit…`, detail: attemptLine };
    case 'correcting':
      return { title: correctionLabel(job), detail: live ?? `Envoi à ${name}…` };
    case 'checking':
      return job.kind === 'interface'
        ? { title: 'Vérification du menu par le schéma…', detail: attemptLine }
        : { title: 'Lecture de l’image…', detail: null };
    case 'rendering':
      return job.kind === 'interface'
        ? { title: 'Rendu de l’aperçu…', detail: null }
        : { title: `Mise aux contraintes${NBSP}: grille, palette, transparence…`, detail: null };
    case 'done':
      return { title: job.kind === 'interface' ? 'Interface prête' : 'Texture prête', detail: `${job.providerName} · ${formatSpan(elapsedOf(job, Date.now()))}` };
    case 'failed':
      return { title: 'La génération a échoué', detail: job.error ? friendlyError(job.error) : null };
    case 'cancelled':
      return { title: 'Génération annulée', detail: null };
  }
}

/** Étapes affichées sous la barre de progression, et l’index de l’étape en cours. */
export function jobSteps(job: AiJob): { steps: string[]; current: number } {
  // Libellés courts : un par colonne, sous le segment de la barre qui lui correspond.
  if (job.kind === 'texture') {
    const steps = ['Demande', 'Envoi', 'Image', 'Contraintes'];
    const index = { preparing: 0, sending: 1, waiting: 2, correcting: 2, checking: 3, rendering: 3, done: 4, failed: -1, cancelled: -1 }[job.phase];
    return { steps, current: index };
  }
  const steps = ['Demande', 'Envoi', 'Réponse', 'Schéma', 'Rendu'];
  const waitingIndex = job.remote && job.remote.phase !== 'queued' && job.remote.phase !== 'starting' ? 2 : 1;
  const index = {
    preparing: 0,
    sending: waitingIndex,
    waiting: 2,
    correcting: waitingIndex,
    checking: 3,
    rendering: 4,
    done: 5,
    failed: -1,
    cancelled: -1,
  }[job.phase];
  return { steps, current: index };
}

/**
 * Message d’erreur pour une notification : sans code ni détail technique
 * (statut, chemin, extrait brut), une phrase ; le texte entier reste dans le
 * dialogue.
 */
export function friendlyError(message: string): string {
  if (/Délai dépassé/i.test(message)) return 'Le fournisseur n’a pas répondu à temps.';
  if (/Connexion impossible|injoignable|Adresse introuvable|Échec de la connexion/i.test(message)) return 'Le fournisseur est injoignable.';
  if (/clé.*(refusée|invalide)/i.test(message)) return 'Le fournisseur refuse la clé d’API.';
  if (/limite de débit|rate limit|trop de requêtes/i.test(message)) return 'Trop de demandes : le fournisseur demande d’attendre un peu.';
  if (/crédit|quota|usage limit/i.test(message)) return 'Crédit ou quota épuisé chez le fournisseur.';
  if (/Aucun document valide/i.test(message)) return message.split(`${NBSP}:`)[0].trim();
  const sentence = message
    .replace(/\s*\([^)]*\)/g, '')
    .split(/(?<=[.!?])\s/)[0]
    .split(`${NBSP}:`)[0]
    .trim();
  return sentence.length > 120 ? `${sentence.slice(0, 119).trimEnd()}…` : sentence || 'Erreur inconnue.';
}

/* ---------- Cycle de vie ---------- */

const progressToastId = (id: string) => `job-${id}`;

function syncProgressToast(job: AiJob): void {
  updateToast(progressToastId(job.id), { message: describeJob(job).title });
}

/**
 * Lance une tâche : `run` fait le travail et signale ses phases par
 * `control` ; la tâche vit jusqu’à sa fin, quel que soit le dialogue.
 */
export function startJob(spec: JobSpec, run: (control: JobControl) => Promise<JobOutcome>): string {
  counter += 1;
  const id = `job${counter}`;
  const now = Date.now();
  const job: AiJob = {
    ...spec,
    id,
    phase: 'preparing',
    remote: null,
    startedAt: now,
    endedAt: null,
    attempt: 0,
    attemptStartedAt: now,
    attempts: [],
    result: null,
    error: null,
    consumed: false,
  };
  // Les tâches finies les plus anciennes sont oubliées (les générations restent dans l’historique de la session).
  const finished = jobs.filter((candidate) => !isRunning(candidate));
  const dropped = new Set(finished.slice(0, Math.max(0, jobs.length + 1 - JOB_LIMIT)).map((candidate) => candidate.id));
  commit([...jobs.filter((candidate) => !dropped.has(candidate.id)), job]);
  const controller = new AbortController();
  controllers.set(id, controller);

  showToast({
    id: progressToastId(id),
    group: id,
    variant: 'progress',
    title: `Génération lancée avec ${spec.providerName}…`,
    message: describeJob(job).title,
    since: now,
    action: { label: 'Voir', run: () => openJob(id) },
  });

  const alive = () => !controller.signal.aborted && getJob(id)?.endedAt === null;
  const control: JobControl = {
    signal: controller.signal,
    phase: (phase) => {
      if (!alive()) return;
      const updated = patch(id, { phase, remote: phase === 'sending' || phase === 'correcting' ? null : getJob(id)?.remote ?? null });
      if (updated) syncProgressToast(updated);
    },
    remote: (progress) => {
      if (!alive()) return;
      const current = getJob(id);
      if (current?.remote?.phase === progress.phase && current.remote.events === progress.events) return;
      // Une réponse arrivée fait passer de « envoi » à « attente ».
      const updated = patch(id, (job) => ({ remote: progress, phase: job.phase === 'sending' ? 'waiting' : job.phase }));
      if (updated) syncProgressToast(updated);
    },
    attemptStarted: (index) => {
      if (!alive()) return;
      const updated = patch(id, { attempt: index, attemptStartedAt: Date.now(), phase: index > 1 ? 'correcting' : 'sending', remote: null });
      if (updated) syncProgressToast(updated);
    },
    attemptFinished: (errors) => {
      if (!alive()) return;
      const updated = patch(id, (job) => ({
        attempts: [...job.attempts, { index: job.attempt, errors, elapsedMs: Date.now() - job.attemptStartedAt }],
      }));
      if (!updated || errors.length === 0 || updated.attempt >= updated.maxAttempts || watched(id)) return;
      showToast({
        group: id,
        variant: 'info',
        icon: 'warning',
        title: `Essai ${updated.attempt} sur ${updated.maxAttempts} refusé${NBSP}: ${plural(errors.length, 'erreur')}, correction en cours…`,
        message: `«${NBSP}${summarize(updated.prompt)}${NBSP}»`,
      });
    },
  };

  const finish = (change: Partial<AiJob>) => {
    controllers.delete(id);
    const ended = patch(id, { ...change, endedAt: Date.now(), remote: null });
    dismissToast(progressToastId(id));
    dismissGroup(id, progressToastId(id));
    return ended;
  };

  void run(control).then(
    (outcome) => {
      if (controller.signal.aborted) {
        finishCancelled();
        return;
      }
      const failure = outcome.failure ?? null;
      const ended = finish({ result: outcome.value, phase: failure ? 'failed' : 'done', error: failure });
      if (!ended) return;
      if (failure) announceFailure(ended);
      else if (!watched(id)) {
        showToast({
          group: id,
          variant: 'success',
          title: ended.kind === 'interface' ? 'Interface prête' : 'Texture prête',
          message: `«${NBSP}${summarize(ended.prompt)}${NBSP}» · ${ended.providerName}, ${formatSpan(elapsedOf(ended, Date.now()))}`,
          action: { label: 'Ouvrir', run: () => openJob(id) },
        });
      }
    },
    (error: unknown) => {
      if (controller.signal.aborted || isAbortError(error)) {
        finishCancelled();
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const ended = finish({ phase: 'failed', error: message });
      if (ended) announceFailure(ended);
    },
  );

  function finishCancelled() {
    const ended = finish({ phase: 'cancelled' });
    if (ended) {
      showToast({ group: id, variant: 'info', icon: 'stop', title: 'Génération annulée', message: `«${NBSP}${summarize(ended.prompt)}${NBSP}» · rien n’a été créé` });
    }
  }

  function announceFailure(ended: AiJob) {
    if (watched(id)) return;
    showToast({
      group: id,
      variant: 'error',
      title: ended.kind === 'interface' ? 'L’interface n’a pas pu être générée' : 'La texture n’a pas pu être générée',
      message: friendlyError(ended.error ?? ''),
      action: { label: 'Voir le détail', run: () => openJob(id) },
    });
  }

  return id;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'Génération annulée');
}
