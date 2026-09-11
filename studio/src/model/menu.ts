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

/** Styles « Deepslate » (biseautés façon vanilla), partagés avec les boxes des assets. */
export type PanelStyle = 'panel' | 'button' | 'cell' | 'veil' | 'flat';

/** Famille « mc-rs » : panneaux sombres et arrondis, boutons plats à états, bandes (cf. docs/format.md). */
export type McrsStyle =
  | 'mcrs_panel'
  | 'mcrs_border'
  | 'mcrs_button'
  | 'mcrs_raised'
  | 'mcrs_strip'
  | 'mcrs_slot'
  | 'mcrs_grid';

export type GeneratorStyle = PanelStyle | McrsStyle;

/** État dessiné d’un bouton mc-rs (le coffre n’a pas de survol : l’état sert aux variantes de couche). */
export type ButtonState = 'normal' | 'hover' | 'pressed';

/** Style des cellules de slots dessinées dans une texture générée. */
export type CellStyle = 'cell' | 'mcrs_slot';

/** Paramètres d’une texture générée par le studio (métadonnée ignorée par la lib). */
export interface GeneratorSpec {
  style: GeneratorStyle;
  width: number;
  height: number;
  color: string;
  /** Cellules de slots à dessiner dans la texture, en coordonnées de grille du coffre. */
  cells?: SlotArea[];
  cellColor?: string;
  /** Style des cellules (défaut `cell`). */
  cellStyle?: CellStyle;
  /** mc-rs : rayon des coins, en pixels. */
  radius?: number;
  /** mc-rs : épaisseur de la bordure, en pixels (0 = sans bordure). */
  borderWidth?: number;
  /** mc-rs : couleur de la bordure (sinon calculée depuis `color`). */
  borderColor?: string;
  /** mc-rs : couleur d’accent des états survol et pressé. */
  accent?: string;
  /** mc-rs : état dessiné d’un bouton. */
  state?: ButtonState;
  /** mc-rs : hauteur de l’ombre portée sous la forme, en pixels. */
  shadow?: number;
  /** mc-rs : côté des cases de la grille de chargement, en pixels. */
  tile?: number;
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

/** Action au clic (cf. docs/format.md § Actions). */
export type Action =
  | { type: 'open'; menu: string; state?: Record<string, StateValue> }
  | { type: 'back' }
  | { type: 'close' }
  | { type: 'setState'; state: string; value: StateValue }
  | { type: 'nextPage'; list: string }
  | { type: 'prevPage'; list: string }
  | { type: 'sound'; sound: string; volume?: number; pitch?: number }
  | { type: 'command'; command: string; as?: 'player' | 'console' }
  | { type: 'custom'; id: string; args?: Record<string, unknown> };

export type ActionType = Action['type'];

/**
 * Instance d’un composant (cf. docs/format.md § Composants) : les couches,
 * textes et slots du menu `component`, décalés et préfixés.
 */
export interface Include {
  /** Identifiant du menu composant (`component: true`). */
  component: string;
  /** Préfixe ajouté aux identifiants des éléments de l’instance (défaut : aucun). */
  prefix?: string;
  /** Décalage en cases : les zones de slots bougent d’autant, couches et textes de 18 px par case. */
  col?: number;
  row?: number;
  /** Décalage supplémentaire en pixels, pour les couches et les textes seulement. */
  x?: number;
  y?: number;
  /** Condition ajoutée à tous les éléments de l’instance. */
  visibleWhen?: Condition;
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
  | { type: 'int'; default?: number; min?: number; max?: number }
  | { type: 'page'; list: string };

export interface MenuDefinition {
  formatVersion: 1;
  id: string;
  name: string;
  /** Gabarit partiel destiné à être hérité via `extends`. */
  template?: boolean;
  /** Composant réutilisable, destiné à être inclus via `includes` (jamais ouvert seul en jeu). */
  component?: boolean;
  extends?: string[];
  /** Instances de composants, sous les éléments propres du menu. */
  includes?: Include[];
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
