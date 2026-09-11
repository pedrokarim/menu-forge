import { floatingSelection, stampFloating } from './raster';
import type { Floating } from './raster';

/**
 * Modèle de l’éditeur de pixels : image en calques, sélection, contenu
 * flottant, et historique d’annulation. Les tampons d’un état ne sont jamais
 * modifiés : une modification crée un nouveau tampon pour le calque touché,
 * les autres calques sont partagés d’un état à l’autre (l’historique reste
 * léger). Format sur disque : `docs/pixels.md`.
 */

/** Côté maximal d’une image, en pixels (comme les assets et le backend). */
export const MAX_PIXEL_SIZE = 1024;
/** Nombre maximal de calques (comme le backend). */
export const MAX_LAYERS = 64;

export interface PixelLayer {
  id: string;
  name: string;
  visible: boolean;
  /** Opacité en pourcentage, de 0 à 100. */
  opacity: number;
  /** `width × height × 4` octets RGBA, jamais modifiés une fois dans un état. */
  data: Uint8ClampedArray;
}

/** Contenu flottant, rattaché à un calque (déplacement, collage). */
export interface FloatingLayer extends Floating {
  layerId: string;
}

export interface PixelState {
  width: number;
  height: number;
  /** Du dessous (premier) au dessus (dernier). */
  layers: PixelLayer[];
  activeLayerId: string;
  /** Masque de la sélection (`width × height`), `null` sans sélection. */
  selection: Uint8Array | null;
  floating: FloatingLayer | null;
  /** Change à chaque modification du contenu (pas pour la sélection seule) : sert à savoir s’il reste à enregistrer. */
  contentVersion: number;
}

let versionCounter = 0;

/** Nouvelle version de contenu, unique pour la session. */
export function nextVersion(): number {
  versionCounter += 1;
  return versionCounter;
}

export function activeLayer(state: PixelState): PixelLayer {
  return state.layers.find((layer) => layer.id === state.activeLayerId) ?? state.layers[state.layers.length - 1];
}

/** Identifiant de calque libre : `calque_1`, `calque_2`… */
export function nextLayerId(layers: readonly { id: string }[]): string {
  const taken = new Set(layers.map((layer) => layer.id));
  let index = layers.length + 1;
  while (taken.has(`calque_${index}`)) index++;
  return `calque_${index}`;
}

/** Nom proposé pour un nouveau calque : « Calque 3 ». */
export function nextLayerName(layers: readonly { name: string }[]): string {
  const taken = new Set(layers.map((layer) => layer.name));
  let index = layers.length + 1;
  while (taken.has(`Calque ${index}`)) index++;
  return `Calque ${index}`;
}

export function createLayer(width: number, height: number, layers: readonly PixelLayer[], data?: Uint8ClampedArray): PixelLayer {
  return {
    id: nextLayerId(layers),
    name: nextLayerName(layers),
    visible: true,
    opacity: 100,
    data: data ?? new Uint8ClampedArray(width * height * 4),
  };
}

/** Image vierge : un calque transparent, ou rempli de `fill` (RGBA). */
export function createState(width: number, height: number, fill?: [number, number, number, number]): PixelState {
  const layer = createLayer(width, height, []);
  if (fill && fill[3] > 0) {
    for (let index = 0; index < layer.data.length; index += 4) layer.data.set(fill, index);
  }
  return { width, height, layers: [layer], activeLayerId: layer.id, selection: null, floating: null, contentVersion: nextVersion() };
}

/** Remplace les données d’un calque (nouvelle version de contenu). */
export function withLayerData(state: PixelState, layerId: string, data: Uint8ClampedArray): PixelState {
  return {
    ...state,
    layers: state.layers.map((layer) => (layer.id === layerId ? { ...layer, data } : layer)),
    contentVersion: nextVersion(),
  };
}

/** Modifie les propriétés d’un calque (nom, visibilité, opacité). */
export function withLayer(state: PixelState, layerId: string, patch: Partial<Omit<PixelLayer, 'id' | 'data'>>): PixelState {
  return {
    ...state,
    layers: state.layers.map((layer) => (layer.id === layerId ? { ...layer, ...patch } : layer)),
    contentVersion: nextVersion(),
  };
}

/** Pose le contenu flottant sur son calque ; la sélection reste là où il a été posé. */
export function dropFloating(state: PixelState): PixelState {
  const floating = state.floating;
  if (!floating) return state;
  const layer = state.layers.find((candidate) => candidate.id === floating.layerId);
  if (!layer) return { ...state, floating: null };
  const data = stampFloating({ width: state.width, height: state.height, data: layer.data }, floating);
  const selection = floatingSelection(floating, state.width, state.height);
  return {
    ...withLayerData(state, layer.id, data),
    floating: null,
    selection: selection.some(Boolean) ? selection : null,
  };
}

/** Calques tels qu’ils seraient enregistrés : le contenu flottant posé, sans toucher à l’état. */
export function layersForSave(state: PixelState): PixelLayer[] {
  return state.floating ? dropFloating(state).layers : state.layers;
}

/* ---------- Historique ---------- */

export interface PixelHistory {
  past: PixelState[];
  present: PixelState;
  future: PixelState[];
  /** Dernière modification regroupable (même clé dans la seconde : une seule entrée). */
  coalesce: { key: string; at: number } | null;
}

export type HistoryAction =
  | { type: 'commit'; state: PixelState; coalesce?: string; at?: number }
  | { type: 'replace'; state: PixelState }
  | { type: 'undo' }
  | { type: 'redo' };

/** Mémoire donnée à l’historique : environ 256 Mo de calques modifiés, entre 16 et 100 pas. */
function historyLimit(state: PixelState): number {
  return Math.max(16, Math.min(100, Math.floor((256 * 1024 * 1024) / Math.max(1, state.width * state.height * 4))));
}

const COALESCE_DELAY = 1000;

export function createHistory(state: PixelState): PixelHistory {
  return { past: [], present: state, future: [], coalesce: null };
}

export function historyReducer(history: PixelHistory, action: HistoryAction): PixelHistory {
  switch (action.type) {
    case 'commit': {
      const at = action.at ?? Date.now();
      const merge =
        action.coalesce !== undefined &&
        history.coalesce?.key === action.coalesce &&
        at - history.coalesce.at < COALESCE_DELAY;
      const past = merge ? history.past : [...history.past, history.present].slice(-historyLimit(action.state));
      return {
        past,
        present: action.state,
        future: [],
        coalesce: action.coalesce === undefined ? null : { key: action.coalesce, at },
      };
    }
    case 'replace':
      return { ...history, present: action.state };
    case 'undo': {
      const previous = history.past[history.past.length - 1];
      if (!previous) return history;
      return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future], coalesce: null };
    }
    case 'redo': {
      const next = history.future[0];
      if (!next) return history;
      return { past: [...history.past, history.present], present: next, future: history.future.slice(1), coalesce: null };
    }
  }
}

/* ---------- Document (fichier) ---------- */

/** Provenance d’une image créée depuis une texture (information seulement). */
export type PixelSource =
  | { kind: 'library'; library: string; path: string }
  | { kind: 'texture'; texture: string };

/** Propriétés du document hors historique : nom, texture d’export, provenance. */
export interface PixelMeta {
  id: string;
  name: string;
  /** PNG aplati, relatif à `textures/` (`pixels/<id>.png` par défaut). */
  texture: string;
  source?: PixelSource;
}

export interface PixelLayerFile {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  /** PNG du calque, en base64 (sans préfixe `data:`). */
  png: string;
}

/** Fichier `pixels/<id>.pixel.json` (version 1). */
export interface PixelDocumentFile {
  formatVersion: 1;
  id: string;
  name: string;
  size: { width: number; height: number };
  layers: PixelLayerFile[];
  export: { texture: string };
  source?: PixelSource;
}

/** Texture d’export par défaut d’une image. */
export function defaultTexture(id: string): string {
  return `pixels/${id}.png`;
}

/**
 * Une texture de l’espace peut-elle être modifiée sur place ? Non pour les
 * copies de bibliothèques (`library/`, réimportables) et pour les PNG
 * régénérés par le studio (`generated/`, `assets/`) : l’image exporte alors
 * dans sa propre copie.
 */
export function editableInPlace(texture: string): boolean {
  return !/^(library|generated|assets)\//.test(texture);
}

/** Chemin de texture d’export acceptable : PNG relatif, sans remontée ni lecteur. */
export function exportPathError(texture: string): string | null {
  if (!/\.png$/i.test(texture)) return 'Le chemin doit finir par .png';
  if (/^[\\/]|^[a-z]:/i.test(texture)) return 'Chemin relatif au dossier textures/ attendu';
  if (texture.split(/[\\/]/).some((part) => part === '..' || part === '')) return 'Pas de « .. » ni de dossier vide';
  return null;
}
