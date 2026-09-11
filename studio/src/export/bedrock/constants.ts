/**
 * Constantes du contrat entre l’exporteur Bedrock et le serveur qui exécute
 * les menus (voir `docs/bedrock.md`). Toute modification ici doit être
 * reportée côté serveur (mc-rs : `crates/mc-rs-server/src/menu_forge/`) et
 * dans l’accroche de `server_form.json`.
 */

/** Nom du format du descripteur d’exécution (`runtime.json`). */
export const RUNTIME_FORMAT = 'menu-forge-bedrock';
/** Version du contrat. */
export const RUNTIME_FORMAT_VERSION = 1;

/** Drapeau de titre : aiguille `server_form` vers `menu_forge_router.main_panel`. */
export const MENU_FORGE_FLAG = '§m§v';

/** Namespace JSON UI du routeur (cité par l’accroche de `server_form.json`). */
export const ROUTER_NAMESPACE = 'menu_forge_router';
/** Dossier des dispositions dans le pack. */
export const UI_DIR = 'ui/menu_forge';
/** Dossier des textures dans le pack (chemins JSON UI sans extension). */
export const TEXTURE_ROOT = 'textures/menu_forge';
/** Texture blanche (voile, surbrillance), teintée par `color` et `alpha`. */
export const WHITE_TEXTURE = `${TEXTURE_ROOT}/_white`;

/** Dossier du pack et fichier du descripteur, relatifs au dossier cible de l’export. */
export const PACK_DIR = 'pack';
export const RUNTIME_FILE = 'runtime.json';

/** Grille du coffre (cf. `model/geometry`) : 9 colonnes, cases de 18 px, première en (7, 17). */
export const COLUMNS = 9;
export const CELL = 18;
export const GRID_X = 7;
export const GRID_Y = 17;
export const MAX_ROWS = 6;

/** Marqueur d’une entrée inerte : icône affichée, pas de bouton. */
export const INERT_MARKER = '{x}';
/** Début du marqueur d’une entrée de texte dynamique (`{t<k>}`). */
export const TEXT_MARKER = '{t';

/** Couleur vanilla des titres de coffre, celle d’un texte sans `color`. */
export const DEFAULT_TEXT_COLOR = '#404040';

/** Namespace JSON UI de la disposition d’un menu. */
export function menuNamespace(menuId: string): string {
  return `menu_forge_${menuId}`;
}

/** Jeton du menu dans le titre. */
export function menuToken(menuId: string): string {
  return `[mf:${menuId}]`;
}

/** Jeton d’une couche conditionnelle (rang dans les couches du menu résolu). */
export function layerToken(index: number): string {
  return `(${index})`;
}

/** Jeton d’un texte figé conditionnel (rang dans les textes du menu résolu). */
export function textToken(index: number): string {
  return `(t${index})`;
}

/** Préfixe de l’entrée du k-ième texte dynamique. */
export function textEntryPrefix(k: number): string {
  return `${TEXT_MARKER}${k}}`;
}
