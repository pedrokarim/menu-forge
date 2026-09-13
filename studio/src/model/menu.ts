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

/** Famille « sombre à accent » : fenêtres plates à cadre fin, cases creusées, onglets et boutons plats, un accent vif. */
export type DarkStyle =
  | 'dark_panel'
  | 'dark_slot'
  | 'dark_tab'
  | 'dark_button'
  | 'dark_close'
  | 'dark_awning'
  | 'dark_row'
  | 'dark_badge'
  | 'dark_progress';

export type GeneratorStyle = PanelStyle | McrsStyle | DarkStyle;

/** État dessiné d’un bouton mc-rs (le coffre n’a pas de survol : l’état sert aux variantes de couche). */
export type ButtonState = 'normal' | 'hover' | 'pressed';

/** Style des cellules de slots dessinées dans une texture générée. */
export type CellStyle = 'cell' | 'mcrs_slot' | 'dark_slot';

/** Icône pixel peinte dans une texture de bouton (cf. `pixelIcons.ts`). */
export type PixelIcon =
  | 'close'
  | 'back'
  | 'sell'
  | 'balance'
  | 'help'
  | 'prev'
  | 'next'
  | 'digit_1'
  | 'digit_2'
  | 'digit_3'
  | 'digit_4'
  | 'digit_5'
  | 'digit_6'
  | 'digit_7'
  | 'digit_8'
  | 'digit_9';

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
  /** mc-rs : côté des cases de la grille de chargement ; sombre à accent : largeur des bandes du store (pixels). */
  tile?: number;
  /** Sombre à accent : remplissage d’une barre de progression, en pour cent. */
  progress?: number;
  /** Icône pixel centrée dans le corps du bouton, tous styles. */
  icon?: PixelIcon;
  /** Couleur de l’icône (sinon claire ou foncée selon `color`). */
  iconColor?: string;
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

/**
 * Disposition d’un formulaire Bedrock : une des huit du pack `mcrs_ui`
 * (cf. docs/format.md § Formulaire Bedrock, `model/bedrockForm.ts`).
 */
export type FormLayout = 'grid' | 'image_grid' | 'square_image' | 'store' | 'left_button' | 'bottom_button' | 'motd' | 'wrapped';

/**
 * Image d’un bouton de formulaire : chemin de texture Bedrock (vanilla ou d’un
 * pack du serveur, sans extension), texture de l’espace de travail (PNG
 * exporté dans le pack Menu Forge) ou adresse web.
 */
export type FormIcon = { path: string } | { texture: string } | { url: string };

/** Rôle d’un bouton pour la disposition : entrée « bannière » (`§m§a`) ou bouton spécial (`§m§b`) ; absent = bouton ordinaire. */
export type FormButtonRole = 'banner' | 'special';

export interface FormButton {
  id: string;
  /** Texte du bouton (codes `§`, variables `{…}`). */
  text: string;
  /** Envoyé après une tabulation (`texte\tsous-titre`), lu par certaines dispositions. */
  subtitle?: string;
  role?: FormButtonRole;
  icon?: FormIcon;
  onClick?: Action[];
  /** Le bouton n’est pas envoyé si la condition est fausse. */
  visibleWhen?: Condition;
}

/** Formulaire Bedrock (`ModalFormRequest` de type `form`) : pas de rendu Java. */
export interface BedrockForm {
  layout: FormLayout;
  /** Titre (codes `§`, variables) ; le drapeau de la disposition est ajouté devant à l’envoi. */
  title: string;
  /** Texte de contenu (`#form_text`), selon la disposition : description, lien, nombre d’onglets… */
  content?: string;
  buttons: FormButton[];
}

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
  /**
   * Formulaire Bedrock : présent, le menu n’est pas un coffre. Son fichier n’a
   * alors ni `container` ni `layers` ; en mémoire, le studio lui en donne des
   * valeurs neutres (`normalizeMenu`) retirées à l’enregistrement (`menuForDisk`).
   */
  form?: BedrockForm;
}

export const ID_PATTERN = /^[a-z0-9_]+$/;

/** Vrai pour un formulaire Bedrock (pas de coffre, pas de rendu Java). */
export function isBedrockForm(menu: Pick<MenuDefinition, 'form'>): boolean {
  return menu.form !== undefined;
}

/**
 * Menu lu sur disque → forme en mémoire : un formulaire Bedrock reçoit un
 * coffre et une liste de couches neutres, pour le code commun aux menus.
 */
export function normalizeMenu(raw: MenuDefinition): MenuDefinition {
  if (!raw.form) return raw;
  return { ...raw, container: raw.container ?? { type: 'chest', rows: 6 }, layers: raw.layers ?? [] };
}

/** Menu en mémoire → fichier : un formulaire perd le coffre et les listes vides ajoutés en mémoire. */
export function menuForDisk(menu: MenuDefinition): MenuDefinition {
  if (!menu.form) return menu;
  const copy: Partial<MenuDefinition> = { ...menu };
  delete copy.container;
  if ((copy.layers ?? []).length === 0) delete copy.layers;
  if ((copy.texts ?? []).length === 0) delete copy.texts;
  if ((copy.slots ?? []).length === 0) delete copy.slots;
  if (copy.state && Object.keys(copy.state).length === 0) delete copy.state;
  return copy as MenuDefinition;
}

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
