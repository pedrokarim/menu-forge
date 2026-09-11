/**
 * Types du format `*.menu.json` (version 1).
 * Source de vérité côté studio ; la spécification lisible est `docs/format.md`.
 */

export type StateValue = string | number | boolean;

/** Condition d’affichage ou d’activation (cf. docs/format.md § Conditions). */
export type Condition =
  | { state: string; is: StateValue }
  | { state: string; in: StateValue[] }
  | { flag: string }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export type PanelStyle = 'panel' | 'button' | 'cell' | 'veil' | 'flat';

/** Paramètres d’une texture générée par le studio (métadonnée ignorée par la lib). */
export interface GeneratorSpec {
  style: PanelStyle;
  width: number;
  height: number;
  color: string;
  /** Cellules de slots à dessiner dans la texture, en coordonnées de grille du coffre. */
  cells?: SlotArea[];
  cellColor?: string;
}

/**
 * État d’un élément dans l’éditeur (métadonnée du studio, ignorée par la lib :
 * l’élément reste exporté et affiché en jeu).
 */
export interface EditorFlags {
  /** Verrouillé : non sélectionnable sur la toile (toujours dans la liste). */
  locked?: boolean;
  /** Masqué sur la toile de l’éditeur seulement. */
  hidden?: boolean;
}

export type EditorFlag = keyof EditorFlags;

export interface Layer {
  id: string;
  texture: string;
  x: number;
  y: number;
  visibleWhen?: Condition;
  generator?: GeneratorSpec;
  editor?: EditorFlags;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextElement {
  id: string;
  x: number;
  y: number;
  align?: TextAlign;
  color?: string;
  value: string;
  visibleWhen?: Condition;
  editor?: EditorFlags;
}

export interface SlotArea {
  col: number;
  row: number;
  width?: number;
  height?: number;
}

export type SlotKind = 'button' | 'list' | 'input' | 'decoration';

export interface ItemSpec {
  invisible?: boolean;
  material?: string;
  name?: string;
  lore?: string[];
  head?: string;
  ref?: string;
}

export interface Action {
  type: string;
  [param: string]: unknown;
}

export interface Slot {
  id: string;
  kind: SlotKind;
  area: SlotArea;
  item?: ItemSpec;
  list?: string;
  onClick?: Action[];
  visibleWhen?: Condition;
  enabledWhen?: Condition;
  editor?: EditorFlags;
}

export type StateDefinition =
  | { type: 'enum'; values: string[]; default: string }
  | { type: 'bool'; default: boolean }
  | { type: 'int'; default: number; min?: number; max?: number }
  | { type: 'page'; list: string };

export interface MenuDefinition {
  formatVersion: 1;
  id: string;
  name: string;
  /** Gabarit partiel destiné à être hérité via `extends`. */
  template?: boolean;
  extends?: string[];
  container: { type: 'chest'; rows: number };
  state?: Record<string, StateDefinition>;
  layers: Layer[];
  texts?: TextElement[];
  slots?: Slot[];
}

export const ID_PATTERN = /^[a-z0-9_]+$/;

export function createEmptyMenu(id: string, name: string, rows = 6): MenuDefinition {
  return {
    formatVersion: 1,
    id,
    name,
    container: { type: 'chest', rows },
    state: {},
    layers: [],
    texts: [],
    slots: [],
  };
}

/** Transforme un libellé libre en identifiant valide (`[a-z0-9_]`). */
export function sanitizeId(label: string): string {
  const cleaned = label
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'element';
}

/** Vrai si l’élément porte le drapeau d’éditeur `flag` (verrouillé, masqué). */
export function hasEditorFlag(element: { editor?: EditorFlags }, flag: EditorFlag): boolean {
  return element.editor?.[flag] === true;
}

/** Pose ou retire un drapeau d’éditeur ; la clé `editor` disparaît quand elle est vide. */
export function setEditorFlag(element: { editor?: EditorFlags }, flag: EditorFlag, value: boolean) {
  if (value) {
    element.editor = { ...element.editor, [flag]: true };
    return;
  }
  if (!element.editor) return;
  const rest = { ...element.editor };
  delete rest[flag];
  if (Object.keys(rest).length > 0) element.editor = rest;
  else delete element.editor;
}

/** Premier identifiant libre de la forme `base`, `base_2`, `base_3`… */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}_${index}`)) index++;
  return `${base}_${index}`;
}
