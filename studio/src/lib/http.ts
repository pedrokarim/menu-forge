/**
 * En-tête exigé par le backend sur toute écriture (autre que GET ou HEAD) :
 * une page d’un autre site ne peut pas l’ajouter sans requête préalable
 * (CORS), ce qui protège l’API locale des requêtes forgées.
 */
export const WRITE_HEADER = 'X-Menu-Forge';

/** `init` complété de l’en-tête d’écriture quand la méthode n’est pas une lecture. */
export function withWriteHeader(init?: RequestInit): RequestInit | undefined {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return init;
  const headers = new Headers(init?.headers);
  headers.set(WRITE_HEADER, '1');
  return { ...init, headers };
}
