import { withWriteHeader } from '../lib/http';
import type { RemotePhase, RemoteProgress } from './jobs';

/**
 * Client des routes `/api/ai` du backend (voir `backend/src/ai/mod.rs`).
 * L’interface n’appelle jamais un fournisseur directement : tout passe par
 * le backend, qui garde les clés dans le trousseau du système.
 */

export type ProviderKind = 'cloud' | 'local' | 'cli';

export interface ProviderValues {
  imageModel: string | null;
  textModel: string | null;
  endpoint: string | null;
}

export interface AiProvider extends ProviderValues {
  id: string;
  name: string;
  kind: ProviderKind;
  image: boolean;
  text: boolean;
  keyRequired: boolean;
  /** `null` : pas de clé pour ce fournisseur, ou trousseau illisible (`keyError`). */
  keyConfigured: boolean | null;
  keyError: string | null;
  enabled: boolean;
  /** Valeurs saisies (`null` : valeur par défaut). */
  custom: ProviderValues;
  defaults: ProviderValues;
  helpUrl: string;
  /** Activé, clé présente, programme trouvé : prêt à générer. */
  ready: boolean;
  issue: string | null;
}

export interface AiProviderList {
  /** Où vivent les clés (« Gestionnaire d’identifiants de Windows »…). */
  secretStore: string;
  providers: AiProvider[];
}

export type ProviderPatch = Partial<{ enabled: boolean } & ProviderValues>;

export interface TestResult {
  ok: boolean;
  /** Faux si rien n’a pu être vérifié sans générer (fal, Codex). */
  verified: boolean;
  message: string;
}

export interface ImageRequest {
  provider: string;
  prompt: string;
  system?: string;
  negativePrompt?: string;
  width: number;
  height: number;
}

export interface ImageReply {
  provider: string;
  model: string;
  mime: string;
  /** Image en base64. */
  data: string;
  size: number;
  elapsedMs: number;
  note: string | null;
}

export interface TextRequest {
  provider: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  json?: boolean;
}

export interface TextReply {
  provider: string;
  model: string;
  text: string;
  elapsedMs: number;
}

async function call<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(
    `/api${path}`,
    withWriteHeader({
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    }),
  );
  if (!response.ok) throw new Error((await response.text()) || `Erreur ${response.status}`);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const idPath = (id: string) => encodeURIComponent(id);

export const fetchProviders = () => call<AiProviderList>('/ai/providers');
export const configureProvider = (id: string, patch: ProviderPatch) => call<AiProvider>(`/ai/providers/${idPath(id)}`, 'PUT', patch);
export const saveProviderKey = (id: string, key: string) => call<AiProvider>(`/ai/keys/${idPath(id)}`, 'PUT', { key });
export const deleteProviderKey = (id: string) => call<AiProvider>(`/ai/keys/${idPath(id)}`, 'DELETE');
export const testProvider = (id: string) => call<TestResult>(`/ai/test/${idPath(id)}`, 'POST');

/** Identifiant d’annulation d’une génération. */
export function newRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Annule côté backend (la requête en cours répond alors « Génération annulée »). */
export function cancelGeneration(requestId: string): void {
  void call<void>('/ai/cancel', 'POST', { requestId }).catch(() => undefined);
}

/** Première lecture de la progression, puis une par seconde. */
const PROGRESS_FIRST_MS = 250;
const PROGRESS_INTERVAL_MS = 1000;

interface ProgressReply {
  active: boolean;
  phase?: RemotePhase;
  events?: number;
}

/**
 * Lance une génération annulable : l’abandon de `signal` prévient aussi le
 * backend. `onProgress` reçoit, chaque seconde tant qu’elle court, la phase
 * vue par le backend (`GET /ai/progress/:id` ; une lecture échouée est ignorée).
 */
function cancellable<T>(path: string, body: object, signal?: AbortSignal, onProgress?: (progress: RemoteProgress) => void): Promise<T> {
  const requestId = newRequestId();
  const onAbort = () => cancelGeneration(requestId);
  signal?.addEventListener('abort', onAbort, { once: true });
  let settled = false;
  let timer = 0;
  if (onProgress) {
    const poll = async () => {
      try {
        const reply = await call<ProgressReply>(`/ai/progress/${idPath(requestId)}`);
        if (!settled && reply.active && reply.phase) onProgress({ phase: reply.phase, events: reply.events ?? 0 });
      } catch {
        // Lecture facultative : la génération continue sans elle.
      }
      if (!settled) timer = window.setTimeout(() => void poll(), PROGRESS_INTERVAL_MS);
    };
    timer = window.setTimeout(() => void poll(), PROGRESS_FIRST_MS);
  }
  return call<T>(path, 'POST', { ...body, requestId }, signal).finally(() => {
    settled = true;
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  });
}

export const generateImage = (request: ImageRequest, signal?: AbortSignal, onProgress?: (progress: RemoteProgress) => void) =>
  cancellable<ImageReply>('/ai/image', request, signal, onProgress);
export const generateText = (request: TextRequest, signal?: AbortSignal, onProgress?: (progress: RemoteProgress) => void) =>
  cancellable<TextReply>('/ai/text', request, signal, onProgress);

export function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Vrai pour une erreur d’annulation (bouton « Arrêter »). */
export function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'Génération annulée');
}
