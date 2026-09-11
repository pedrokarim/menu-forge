import { evaluateCondition } from './conditions';
import type { ConditionContext } from './conditions';
import type { BedrockForm, FormButton, FormLayout, MenuDefinition } from './menu';

/**
 * Formulaires Bedrock (cf. docs/format.md § Formulaire Bedrock) : les huit
 * dispositions du pack `mcrs_ui` (drapeau de titre `§m§…`, fichier JSON UI),
 * le texte réellement envoyé pour un bouton, et l’émulation des liaisons du
 * pack qui découpent ce texte (utilisée par l’aperçu du studio).
 *
 * Le drapeau d’une disposition est une constante du contrat avec le serveur
 * (docs/bedrock.md § 9) : toute modification est à reporter dans mc-rs
 * (`menu_forge/catalog.rs`) et dans `server_form.json` du pack.
 */

export interface FormLayoutInfo {
  layout: FormLayout;
  /** Drapeau ajouté devant le titre : aiguille `server_form` vers la disposition. */
  flag: string;
  label: string;
  /** Namespace et fichier JSON UI de la disposition dans `mcrs_ui`. */
  namespace: string;
  file: string;
  description: string;
  /** Ce que la disposition fait du texte de contenu ; `null` : ignoré. */
  content: string | null;
  /** Ce que la disposition fait d’une entrée « bannière » ; `null` : pas de rôle bannière. */
  banner: string | null;
  /** La disposition dessine les boutons spéciaux (violet). */
  special: boolean;
  /** Où la disposition affiche l’image d’un bouton ; `null` : jamais. */
  icon: string | null;
  /** Ce que devient le texte après la tabulation ; `null` : collé au titre. */
  subtitle: string | null;
}

/** Préfixe d’une entrée « bannière » (image, catégorie, en-tête), lu par la disposition. */
export const BANNER_FLAG = '§m§a';
/** Préfixe d’un bouton spécial (violet). */
export const SPECIAL_FLAG = '§m§b';
/** Séparateur du sous-titre dans le texte d’un bouton. */
export const SUBTITLE_SEPARATOR = '\t';
/** Longueur à laquelle les liaisons du pack coupent le texte d’un bouton (`'%.100s'`). */
export const TITLE_CUT = 100;

export const FORM_LAYOUTS: readonly FormLayoutInfo[] = [
  {
    layout: 'grid',
    flag: '§m§a',
    label: 'Grille',
    namespace: 'mcrs_grid_modal',
    file: 'button_grid_panel.json',
    description: 'Grille de grandes cases, trois par ligne : menu d’actions, hub.',
    content: 'Description en bleu au-dessus de la grille (masquée si vide).',
    banner: null,
    special: false,
    icon: 'En haut de la case, texte en dessous.',
    subtitle: 'Ligne dorée sous le titre, au-delà du 100ᵉ caractère.',
  },
  {
    layout: 'image_grid',
    flag: '§m§d',
    label: 'Grille d’images',
    namespace: 'mcrs_image_grid_modal',
    file: 'button_image_grid_panel.json',
    description: 'Grandes vignettes avec titre superposé : sélecteur de carte ou d’arène.',
    content: 'Description en bleu au-dessus de la grille (masquée si vide).',
    banner: null,
    special: false,
    icon: 'Toute la vignette.',
    subtitle: 'Pastille en haut de la vignette, au-delà du 100ᵉ caractère.',
  },
  {
    layout: 'square_image',
    flag: '§m§e',
    label: 'Image carrée',
    namespace: 'mcrs_square_image_modal',
    file: 'square_image_panel.json',
    description: 'Une grande image carrée centrée, description en bas : annonce.',
    content: 'Description centrée en bas de l’écran.',
    banner: 'L’image carrée (seules les bannières s’affichent).',
    special: false,
    icon: 'L’image carrée d’une bannière.',
    subtitle: null,
  },
  {
    layout: 'store',
    flag: '§m§0',
    label: 'Boutique',
    namespace: 'mcrs_store_modal',
    file: 'store_panel.json',
    description: 'Onglets de catégories et grille de produits.',
    content: 'Nombre de catégories, lu dans ses deux premiers caractères : « a3… » pour 3.',
    banner: 'Un onglet de catégorie (bouton vert en haut).',
    special: false,
    icon: 'Visuel du produit.',
    subtitle: 'Prix, au-delà du 100ᵉ caractère.',
  },
  {
    layout: 'left_button',
    flag: '§m§b',
    label: 'Boutons à gauche',
    namespace: 'mcrs_left_button_modal',
    file: 'left_button_panel.json',
    description: 'Liste de boutons à gauche, description à droite : réglages, navigation.',
    content: 'Description en bleu dans le panneau de droite.',
    banner: 'Une vignette avec étiquette, sous la description.',
    special: true,
    icon: 'L’image d’une bannière.',
    subtitle: null,
  },
  {
    layout: 'bottom_button',
    flag: '§m§c',
    label: 'Boutons en bas',
    namespace: 'mcrs_bottom_button_modal',
    file: 'bottom_button_panel.json',
    description: 'Bannière carrée et description en haut, boutons en bas : mode de jeu.',
    content: 'Description en bleu à droite de la bannière.',
    banner: 'La vignette carrée en haut à gauche.',
    special: true,
    icon: 'L’image d’une bannière.',
    subtitle: null,
  },
  {
    layout: 'motd',
    flag: '§m§f',
    label: 'Message du jour',
    namespace: 'mcrs_motd_modal',
    file: 'motd_panel.json',
    description: 'Colonne étroite : bannière, texte défilant, boutons verts côte à côte.',
    content: 'Le message, dans un cadre de 60 px qui défile.',
    banner: 'L’image du haut ; son texte donne sa hauteur en pixels (« 80 »).',
    special: false,
    icon: 'L’image d’une bannière.',
    subtitle: null,
  },
  {
    layout: 'wrapped',
    flag: '§m§1',
    label: 'Récap',
    namespace: 'mcrs_wrapped_modal',
    file: 'wrapped_panel.json',
    description: 'Lien en haut, visuels qui défilent, boutons violets en bas.',
    content: 'Le lien affiché sous le titre (masqué si vide).',
    banner: 'Un visuel de la liste qui défile.',
    special: false,
    icon: 'L’image d’un visuel.',
    subtitle: null,
  },
];

const BY_LAYOUT = new Map(FORM_LAYOUTS.map((info) => [info.layout, info]));

export function isFormLayout(value: unknown): value is FormLayout {
  return typeof value === 'string' && BY_LAYOUT.has(value as FormLayout);
}

export function formLayout(layout: FormLayout): FormLayoutInfo {
  const info = BY_LAYOUT.get(layout);
  if (!info) throw new Error(`Disposition inconnue : ${layout}`);
  return info;
}

/** Texte envoyé pour un bouton : préfixe du rôle, texte, tabulation et sous-titre. */
export function formButtonText(button: Pick<FormButton, 'text' | 'subtitle' | 'role'>): string {
  const prefix = button.role === 'banner' ? `${BANNER_FLAG} ` : button.role === 'special' ? `${SPECIAL_FLAG} ` : '';
  const subtitle = button.subtitle !== undefined && button.subtitle !== '' ? `${SUBTITLE_SEPARATOR}${button.subtitle}` : '';
  return `${prefix}${button.text}${subtitle}`;
}

/** Titre envoyé (`#title_text`) : drapeau de la disposition, une espace, puis le titre. */
export function formWireTitle(layout: FormLayout, title: string): string {
  return `${formLayout(layout).flag} ${title}`;
}

/** Boutons envoyés dans cet état : l’index d’un clic est le rang dans cette liste. */
export function visibleFormButtons(form: BedrockForm, context: ConditionContext): FormButton[] {
  return form.buttons.filter((button) => evaluateCondition(button.visibleWhen, context));
}

/* Émulation des liaisons du pack (aperçu du studio) */

/** `'%.Ns' * texte` : les N premiers caractères. */
export function leading(text: string, count: number): string {
  return [...text].slice(0, count).join('');
}

/** `(texte - 'x')` du JSON UI : retire toutes les occurrences de `x`. */
export function without(text: string, part: string): string {
  return part === '' ? text : text.split(part).join('');
}

/** Vrai si le texte contient le drapeau (test `(t - flag) = t` du pack). */
export function hasFlag(text: string, flag: string): boolean {
  return text.includes(flag);
}

/**
 * Titre et reste d’un texte de bouton, comme les liaisons du pack :
 * `('%.100s' * t) - '\t'` et `t - ('%.100s' * t)`. Le sous-titre n’est à part
 * que si le titre occupe les 100 premiers caractères.
 */
export function splitAtCut(text: string, cut = TITLE_CUT): { head: string; rest: string } {
  const head = leading(text, cut);
  return { head: without(head, SUBTITLE_SEPARATOR), rest: [...text].slice(cut).join('') };
}

/** Nombre de catégories de la boutique : `((('%.2s' * #form_text) - 'a') * 1)`, 0 si ce n’est pas un nombre. */
export function storeCategoryCount(content: string): number {
  const value = Number(without(leading(content, 2), 'a'));
  return Number.isInteger(value) && value > 0 ? value : 0;
}

/** Hauteur de la bannière du message du jour : le texte privé du drapeau, lu comme un nombre (0 sinon). */
export function motdBannerHeight(text: string): number {
  const value = Number.parseInt(without(text, BANNER_FLAG).trim(), 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/* Création */

function starterButtons(layout: FormLayout): FormButton[] {
  const button = (index: number, extra: Partial<FormButton> = {}): FormButton => ({ id: `button_${index}`, text: `Bouton ${index}`, ...extra });
  switch (layout) {
    case 'square_image':
      return [{ id: 'image', text: 'image', role: 'banner' }];
    case 'motd':
      return [{ id: 'banner', text: '80', role: 'banner' }, button(1, { text: 'Continuer' }), button(2, { text: 'Quitter' })];
    case 'wrapped':
      return [{ id: 'image_1', text: 'Image 1', role: 'banner' }, button(1, { text: 'Continuer' })];
    case 'bottom_button':
      return [{ id: 'banner', text: 'Bannière', role: 'banner' }, button(1), button(2)];
    case 'store':
      // Produits d’abord : la grille affiche les premières entrées, les onglets les bannières.
      return [
        button(1, { text: 'Produit 1' }),
        button(2, { text: 'Produit 2' }),
        { id: 'tab_1', text: 'Catégorie 1', role: 'banner' },
        { id: 'tab_2', text: 'Catégorie 2', role: 'banner' },
      ];
    default:
      return [button(1), button(2), button(3)];
  }
}

/** Nouveau formulaire Bedrock (forme en mémoire, cf. `normalizeMenu`). */
export function createEmptyForm(id: string, name: string, layout: FormLayout): MenuDefinition {
  return {
    formatVersion: 1,
    id,
    name,
    container: { type: 'chest', rows: 6 },
    state: {},
    layers: [],
    form: { layout, title: name, content: layout === 'store' ? 'a2' : '', buttons: starterButtons(layout) },
  };
}
