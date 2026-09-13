import { darken, parseColor, relativeLuminance } from './generator';
import type { PixelIcon } from './menu';
import type { Painter } from './painter';

/**
 * Icônes pixel des boutons générés : de petites matrices (5 à 9 pixels de
 * côté, traits de 2 pixels comme la croix du bouton « fermer »), dessinées
 * par Menu Forge et peintes dans la texture du bouton. `#` = pixel plein.
 * Une icône claire reçoit l’ombre portée d’un pixel de la police vanilla
 * (même couleur au quart), qui la détache des fonds colorés.
 */

const MATRICES: Record<PixelIcon, readonly string[]> = {
  // Croix : même tracé que `dark_close` (8 × 8, trait de 2).
  close: ['##....##', '###..###', '.######.', '..####..', '..####..', '.######.', '###..###', '##....##'],
  // Flèche de retour : pointe à gauche, trait qui fait le tour par la droite.
  back: [
    '..#......',
    '.##......',
    '########.',
    '#########',
    '.##....##',
    '..#....##',
    '.......##',
    '..#######',
    '..######.',
  ],
  // Sac à pièces fermé par un lien, pour vendre.
  sell: ['..#..#..', '...##...', '..####..', '.######.', '########', '########', '########', '.######.'],
  // Bourse (portefeuille à rabat et fermoir), pour le solde.
  balance: ['.######.', '########', '########', '#####...', '#####.#.', '#####...', '########', '.######.'],
  // Point d’interrogation, pour l’aide.
  help: ['.####.', '##..##', '....##', '...##.', '..##..', '..##..', '......', '..##..'],
  prev: ['...##', '..##.', '.##..', '##...', '##...', '.##..', '..##.', '...##'],
  next: ['##...', '.##..', '..##.', '...##', '...##', '..##.', '.##..', '##...'],
  // Chiffres gras, pour les actions génériques numérotées.
  digit_1: ['..##..', '.###..', '####..', '..##..', '..##..', '..##..', '..##..', '######'],
  digit_2: ['.####.', '##..##', '....##', '...##.', '..##..', '.##...', '##....', '######'],
  digit_3: ['.####.', '##..##', '....##', '..###.', '....##', '....##', '##..##', '.####.'],
  digit_4: ['...##.', '..###.', '.####.', '##.##.', '######', '...##.', '...##.', '...##.'],
  digit_5: ['######', '##....', '#####.', '....##', '....##', '....##', '##..##', '.####.'],
  digit_6: ['..###.', '.##...', '##....', '#####.', '##..##', '##..##', '##..##', '.####.'],
  digit_7: ['######', '....##', '...##.', '...##.', '..##..', '..##..', '..##..', '..##..'],
  digit_8: ['.####.', '##..##', '##..##', '.####.', '##..##', '##..##', '##..##', '.####.'],
  digit_9: ['.####.', '##..##', '##..##', '##..##', '.#####', '....##', '...##.', '.###..'],
};

export const PIXEL_ICONS = Object.keys(MATRICES) as PixelIcon[];

export const PIXEL_ICON_LABELS: Record<PixelIcon, string> = {
  close: 'Croix (fermer)',
  back: 'Flèche de retour',
  sell: 'Sac (vendre)',
  balance: 'Bourse (solde)',
  help: 'Point d’interrogation (aide)',
  prev: 'Chevron gauche',
  next: 'Chevron droit',
  digit_1: 'Chiffre 1',
  digit_2: 'Chiffre 2',
  digit_3: 'Chiffre 3',
  digit_4: 'Chiffre 4',
  digit_5: 'Chiffre 5',
  digit_6: 'Chiffre 6',
  digit_7: 'Chiffre 7',
  digit_8: 'Chiffre 8',
  digit_9: 'Chiffre 9',
};

export function isPixelIcon(value: string): value is PixelIcon {
  return Object.hasOwn(MATRICES, value);
}

/** Icône d’une action générique numérotée (chiffres 1 à 9, au-delà : pas d’icône). */
export function digitIcon(index: number): PixelIcon | undefined {
  const name = `digit_${index}`;
  return isPixelIcon(name) ? name : undefined;
}

/** Taille d’une icône, en pixels. */
export function iconSize(icon: PixelIcon): { width: number; height: number } {
  const rows = MATRICES[icon];
  return { width: Math.max(...rows.map((row) => row.length)), height: rows.length };
}

/** Nombre de pixels pleins d’une icône (sans l’ombre). */
export function iconPixelCount(icon: PixelIcon): number {
  return MATRICES[icon].reduce((count, row) => count + [...row].filter((char) => char === '#').length, 0);
}

/**
 * Peint l’icône centrée dans le rectangle (x, y, width, height) ; l’ombre
 * éventuelle déborde d’un pixel en bas à droite, comme celle d’un texte.
 */
export function paintIcon(painter: Painter, icon: PixelIcon, x: number, y: number, width: number, height: number, hexColor: string) {
  const rows = MATRICES[icon];
  const size = iconSize(icon);
  const left = x + Math.floor((width - size.width) / 2);
  const top = y + Math.floor((height - size.height) / 2);
  const color = parseColor(hexColor);
  const shadow = relativeLuminance(color) > 0.4 ? { ...darken(color, 0.75), a: color.a } : null;
  const plot = (dx: number, dy: number, fill: typeof color) =>
    rows.forEach((row, rowIndex) => {
      for (let col = 0; col < row.length; col++) if (row[col] === '#') painter.fill(left + col + dx, top + rowIndex + dy, 1, 1, fill);
    });
  if (shadow) plot(1, 1, shadow);
  plot(0, 0, color);
}
