import { INTERFACE_KIND_ORDER } from './interfaceGenerator';
import type { ButtonLayout, InterfaceKind, InterfaceOptions, StyleFamily } from './interfaceGenerator';
import { sanitizeId, uniqueId } from './menu';

/**
 * Exemples du générateur d’interfaces : les 22 réglages de la galerie
 * (type, famille, accent, lignes, boutons, disposition, nom et titre). Rien
 * n’est stocké en image : chaque vignette est rendue en direct par le
 * générateur, avec la même fonction que l’aperçu du dialogue.
 */

export interface InterfaceExample {
  /** Clé stable (numéro de la galerie, type, famille, accent). */
  key: string;
  /** Nom du menu créé, repris comme titre affiché. */
  name: string;
  kind: InterfaceKind;
  family: StyleFamily;
  /** Couleur d’accent `#rrggbb`. */
  accent: string;
  /** Nom de la couleur d’accent, pour la légende. */
  accentLabel: string;
  rows: number;
  buttons: number;
  layout: ButtonLayout;
}

/** Nom court d’une famille de styles, pour les légendes et les filtres. */
export const FAMILY_SHORT_LABELS: Record<StyleFamily, string> = {
  deepslate: 'Deepslate',
  mcrs: 'mc-rs',
  dark: 'Sombre à accent',
};

export const FAMILY_ORDER: readonly StyleFamily[] = ['deepslate', 'mcrs', 'dark'];

const example = (
  key: string,
  kind: InterfaceKind,
  family: StyleFamily,
  accent: string,
  accentLabel: string,
  rows: number,
  buttons: number,
  layout: ButtonLayout,
  name: string,
): InterfaceExample => ({ key, name, kind, family, accent, accentLabel, rows, buttons, layout });

export const INTERFACE_EXAMPLES: readonly InterfaceExample[] = [
  example('01-shop-deepslate-green', 'shop', 'deepslate', '#52a535', 'vert', 6, 2, 'center', 'Boutique'),
  example('02-shop-mcrs-gold', 'shop', 'mcrs', '#ffd933', 'or', 6, 5, 'center', 'Marché'),
  example('03-shop-dark-red', 'shop', 'dark', '#e83820', 'rouge', 5, 3, 'spread', 'Forge'),
  example('04-shop-dark-market-green', 'shop', 'dark', '#58d000', 'vert marché', 4, 4, 'spread', 'Primeur'),
  example('05-shop-mcrs-orange', 'shop', 'mcrs', '#ff9a1e', 'orange', 3, 0, 'center', 'Échoppe'),
  example('06-shop-deepslate-red', 'shop', 'deepslate', '#d04545', 'rouge', 3, 5, 'end', 'Hôtel des ventes du royaume'),
  example('07-grid-mcrs-green', 'grid', 'mcrs', '#49a842', 'vert', 4, 1, 'end', 'Récoltes'),
  example('08-grid-deepslate-blue', 'grid', 'deepslate', '#3a7bd5', 'bleu', 3, 9, 'start', 'Coffre commun'),
  example('09-grid-dark-cyan', 'grid', 'dark', '#20b8e8', 'cyan', 2, 3, 'center', 'Raccourcis'),
  example('10-grid-mcrs-purple', 'grid', 'mcrs', '#a060ff', 'violet', 6, 0, 'end', 'Collection'),
  example('11-confirm-dark-red', 'confirm', 'dark', '#e83820', 'rouge', 3, 2, 'spread', 'Confirmation'),
  example('12-confirm-deepslate-green', 'confirm', 'deepslate', '#52a535', 'vert', 4, 3, 'spread', 'Quitter la guilde'),
  example('13-confirm-mcrs-gold', 'confirm', 'mcrs', '#ffd933', 'or', 3, 1, 'center', 'Avertissement'),
  example('14-confirm-dark-market-green', 'confirm', 'dark', '#58d000', 'vert marché', 5, 3, 'center', 'Achat'),
  example('15-list-mcrs-gold', 'list', 'mcrs', '#ffd933', 'or', 6, 1, 'center', 'Joueurs'),
  example('16-list-deepslate-green', 'list', 'deepslate', '#52a535', 'vert', 5, 3, 'spread', 'Quêtes'),
  example('17-list-dark-violet', 'list', 'dark', '#b048f0', 'violet vif', 3, 5, 'center', 'Historique'),
  example('18-tabs-dark-red', 'tabs', 'dark', '#e83820', 'rouge', 6, 4, 'start', 'Profil'),
  example('19-tabs-mcrs-cyan', 'tabs', 'mcrs', '#33c8ff', 'cyan', 5, 3, 'spread', 'Atelier'),
  example('20-tabs-deepslate-orange', 'tabs', 'deepslate', '#e08a20', 'orange', 4, 9, 'start', 'Catalogue'),
  example('21-tabs-dark-yellow', 'tabs', 'dark', '#f0c020', 'jaune', 2, 2, 'center', 'Mode'),
  example('22-tabs-mcrs-pink', 'tabs', 'mcrs', '#ff5fa0', 'rose', 6, 5, 'center', 'Garde-robe'),
];

/** Options complètes du générateur pour un exemple, sous l’identifiant donné. */
export function exampleOptions(entry: InterfaceExample, id: string): InterfaceOptions {
  return {
    id,
    name: entry.name,
    title: entry.name,
    kind: entry.kind,
    rows: entry.rows,
    buttons: entry.buttons,
    layout: entry.layout,
    family: entry.family,
    accent: entry.accent,
  };
}

/** Identifiant proposé pour un exemple : tiré de son nom, jamais pris. */
export function exampleId(entry: InterfaceExample, existingIds: readonly string[]): string {
  return uniqueId(sanitizeId(entry.name), existingIds);
}

/** Exemples d’un type et d’une famille (`null` : tous), dans l’ordre de la galerie. */
export function filterExamples(kind: InterfaceKind | null, family: StyleFamily | null): InterfaceExample[] {
  return INTERFACE_EXAMPLES.filter((entry) => (kind === null || entry.kind === kind) && (family === null || entry.family === family)).sort(
    (a, b) => INTERFACE_KIND_ORDER.indexOf(a.kind) - INTERFACE_KIND_ORDER.indexOf(b.kind),
  );
}
