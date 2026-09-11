/**
 * Boucle de correction bornée des documents produits par l’IA : on demande,
 * on lit le JSON, on valide ; en cas d’erreurs, on les renvoie au modèle
 * (avec sa réponse précédente) et on redemande, `maxAttempts` fois au plus.
 * Aucun appel réseau ici : `send` est fourni par l’appelant (le backend en
 * vrai, une fonction factice dans `tests/ai-correction.test.ts`).
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type SendChat = (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>;

export interface Attempt {
  /** 1 pour la première demande. */
  index: number;
  raw: string;
  errors: string[];
}

export interface CorrectionResult<T> {
  /** Document valide, ou `null` si aucun essai n’a abouti. */
  value: T | null;
  attempts: Attempt[];
  /** Conversation complète (dernière réponse comprise). */
  messages: ChatMessage[];
}

export interface Validation<T> {
  value?: T;
  errors: string[];
}

/** Essais permis : de 1 à 5 (3 par défaut). */
export const MAX_ATTEMPTS_LIMIT = 5;
export const DEFAULT_ATTEMPTS = 3;
/** Erreurs renvoyées au modèle à chaque correction (les suivantes sont résumées). */
const ERRORS_SENT = 40;
/** Réponse précédente renvoyée telle quelle (tronquée au-delà). */
const ANSWER_LIMIT = 60_000;

/**
 * Lit l’objet JSON d’une réponse : texte brut, bloc de code ```json, ou
 * texte autour d’un objet (on prend du premier `{` au dernier `}`).
 */
export function extractJson(text: string): { value: unknown } | { error: string } {
  // Marque d’ordre des octets (U+FEFF) éventuelle en tête.
  const trimmed = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trim();
  const fenced = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(trimmed);
  const candidates = [trimmed];
  if (fenced) candidates.push(fenced[1].trim());
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));
  let lastError = 'réponse vide';
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const value: unknown = JSON.parse(candidate);
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) return { value };
      lastError = 'un objet JSON est attendu à la racine';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { error: `$ : JSON illisible (${lastError}). Renvoie uniquement l’objet JSON, sans texte autour.` };
}

/** Message de correction envoyé au modèle. */
export function correctionMessage(errors: readonly string[]): string {
  const shown = errors.slice(0, ERRORS_SENT).map((error) => `- ${error}`);
  if (errors.length > ERRORS_SENT) shown.push(`- … et ${errors.length - ERRORS_SENT} autres erreurs du même genre`);
  return [
    'Ce document ne passe pas la validation de Menu Forge. Erreurs (chemin JSON : problème) :',
    ...shown,
    '',
    'Renvoie le document COMPLET corrigé : uniquement l’objet JSON, sans explication, sans bloc de code. Ne change que ce qui est nécessaire.',
  ].join('\n');
}

function abortError(): Error {
  const error = new Error('Génération annulée');
  error.name = 'AbortError';
  return error;
}

export async function generateWithCorrections<T>({
  request,
  send,
  validate,
  maxAttempts = DEFAULT_ATTEMPTS,
  onAttempt,
  signal,
}: {
  /** Demande initiale (message utilisateur). */
  request: string;
  send: SendChat;
  validate: (value: unknown) => Validation<T>;
  maxAttempts?: number;
  onAttempt?: (attempt: Attempt) => void;
  signal?: AbortSignal;
}): Promise<CorrectionResult<T>> {
  const limit = Math.min(MAX_ATTEMPTS_LIMIT, Math.max(1, Math.round(maxAttempts)));
  let messages: ChatMessage[] = [{ role: 'user', content: request }];
  const attempts: Attempt[] = [];
  for (let index = 1; index <= limit; index++) {
    if (signal?.aborted) throw abortError();
    const raw = await send(messages, signal);
    const parsed = extractJson(raw);
    const outcome: Validation<T> = 'error' in parsed ? { errors: [parsed.error] } : validate(parsed.value);
    const attempt: Attempt = { index, raw, errors: outcome.errors };
    attempts.push(attempt);
    onAttempt?.(attempt);
    const answer: ChatMessage = { role: 'assistant', content: raw.length > ANSWER_LIMIT ? `${raw.slice(0, ANSWER_LIMIT)}…` : raw };
    if (outcome.errors.length === 0 && outcome.value !== undefined) {
      return { value: outcome.value, attempts, messages: [...messages, answer] };
    }
    messages = [...messages, answer];
    if (index < limit) messages.push({ role: 'user', content: correctionMessage(outcome.errors) });
  }
  return { value: null, attempts, messages };
}
