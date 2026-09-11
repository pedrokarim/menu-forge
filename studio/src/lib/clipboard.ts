import type { AssetElement, AssetGroup } from '../asset/model';
import type { Layer, Slot, TextElement } from '../model/menu';

/**
 * Presse-papiers du studio : du JSON **marqué** (`marker`), écrit dans le
 * presse-papiers système (on peut coller d’une fenêtre à l’autre, ou garder un
 * extrait dans un fichier texte) et gardé en mémoire (repli quand le système
 * refuse l’accès). Un texte qui ne porte pas la marque n’est jamais collé.
 */

export const CLIPBOARD_MARKER = 'menu-forge/clipboard';

interface PayloadBase {
  marker: typeof CLIPBOARD_MARKER;
  version: 1;
  /** Change à chaque copie : sert à décaler les collages successifs. */
  nonce: string;
  /** Document copié (`menu:<id>` ou `asset:<id>`). */
  source: string;
}

/** Couches, textes et zones de slots copiés d’un menu. */
export interface MenuClipboard extends PayloadBase {
  kind: 'menu';
  layers: Layer[];
  texts: TextElement[];
  slots: Slot[];
}

/** Éléments (et leurs groupes) copiés d’un asset. */
export interface AssetClipboard extends PayloadBase {
  kind: 'asset';
  elements: AssetElement[];
  groups: AssetGroup[];
}

export type ClipboardPayload = MenuClipboard | AssetClipboard;

/** Ce que contient le presse-papiers au moment de coller. */
export interface ClipboardContent {
  payload: ClipboardPayload | null;
  /** Image PNG (copie d’écran, image copiée dans un navigateur…). */
  image: Blob | null;
}

let memory: ClipboardPayload | null = null;
const pasteCounts = new Map<string, number>();

function nonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function menuClipboard(source: string, layers: Layer[], texts: TextElement[], slots: Slot[]): MenuClipboard {
  return { marker: CLIPBOARD_MARKER, version: 1, nonce: nonce(), source, kind: 'menu', layers, texts, slots };
}

export function assetClipboard(source: string, elements: AssetElement[], groups: AssetGroup[]): AssetClipboard {
  return { marker: CLIPBOARD_MARKER, version: 1, nonce: nonce(), source, kind: 'asset', elements, groups };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const hasIds = (value: unknown): boolean =>
  Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.id === 'string');

/** Relit un texte du presse-papiers ; `null` s’il ne vient pas du studio. */
export function parseClipboard(text: string): ClipboardPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.marker !== CLIPBOARD_MARKER || value.version !== 1) return null;
  if (typeof value.nonce !== 'string' || typeof value.source !== 'string') return null;
  if (value.kind === 'menu' && hasIds(value.layers) && hasIds(value.texts) && hasIds(value.slots)) {
    return value as unknown as MenuClipboard;
  }
  if (value.kind === 'asset' && hasIds(value.elements) && hasIds(value.groups)) return value as unknown as AssetClipboard;
  return null;
}

/**
 * Copie : en mémoire et dans le presse-papiers système. Pendant un
 * événement `copy`/`cut`, le texte est posé directement (synchrone, sans
 * autorisation) ; sinon (menu contextuel) par l’API asynchrone.
 */
export function writeClipboard(payload: ClipboardPayload, event?: ClipboardEvent) {
  memory = payload;
  const text = JSON.stringify(payload, null, 2);
  if (event?.clipboardData) {
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    return;
  }
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

/** Contenu d’un événement `paste` (Ctrl+V). */
export function readPasteEvent(event: ClipboardEvent): ClipboardContent {
  const data = event.clipboardData;
  if (!data) return { payload: memory, image: null };
  const image = [...data.files].find((file) => file.type === 'image/png') ?? null;
  const text = data.getData('text/plain');
  // Un texte étranger (copié ailleurs) remplace le dernier extrait du studio : rien n’est collé.
  return { payload: text ? parseClipboard(text) : image ? null : memory, image };
}

/** Contenu du presse-papiers lu à la demande (menu contextuel « Coller »). */
export async function readClipboard(): Promise<ClipboardContent> {
  try {
    const items = await navigator.clipboard.read();
    let image: Blob | null = null;
    let text = '';
    for (const item of items) {
      if (!image && item.types.includes('image/png')) image = await item.getType('image/png');
      if (!text && item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
    }
    return { payload: text ? parseClipboard(text) : image ? null : memory, image };
  } catch {
    try {
      const text = await navigator.clipboard.readText();
      return { payload: text ? parseClipboard(text) : memory, image: null };
    } catch {
      // Accès refusé (navigateur, réglages) : le dernier extrait copié dans le studio.
      return { payload: memory, image: null };
    }
  }
}

/** Vrai si un extrait du studio a été copié pendant la session. */
export function hasStoredClipboard(): boolean {
  return memory !== null;
}

/**
 * Nombre de décalages à appliquer à un collage : chaque collage du même extrait
 * dans le même document est décalé un cran plus loin ; le premier collage dans
 * un autre document garde la position d’origine.
 */
export function nextPasteShift(payload: ClipboardPayload, target: string): number {
  const key = `${payload.nonce}@${target}`;
  const count = pasteCounts.get(key) ?? (payload.source === target ? 1 : 0);
  pasteCounts.set(key, count + 1);
  return count;
}
