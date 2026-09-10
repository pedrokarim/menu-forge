import type { TextAlign } from './menu';

/**
 * Largeurs des glyphes de la police ASCII vanilla (avance = largeur + 1).
 * Même table que la lib Java ; à vérifier en jeu.
 */
const GLYPH_WIDTHS: Record<string, number> = {
  '!': 1, '"': 3, "'": 1, '(': 3, ')': 3, '*': 3, ',': 1, '.': 1, ':': 1, ';': 1,
  '<': 4, '>': 4, '@': 6, I: 3, '[': 3, ']': 3, '`': 2, f: 4, i: 1, k: 4, l: 2,
  t: 3, '{': 3, '|': 1, '}': 3, '~': 6,
};
const DEFAULT_WIDTH = 5;
const SPACE_ADVANCE = 4;

/** Hauteur d’une ligne de texte de la police vanilla, en pixels. */
export const TEXT_HEIGHT = 8;

export function charAdvance(char: string): number {
  if (char === ' ') return SPACE_ADVANCE;
  return (GLYPH_WIDTHS[char] ?? DEFAULT_WIDTH) + 1;
}

export function textWidth(text: string): number {
  let width = 0;
  for (const char of text) width += charAdvance(char);
  return width;
}

/** Abscisse de départ d’un texte aligné par rapport à `x`. */
export function alignedStart(x: number, width: number, align: TextAlign = 'left'): number {
  if (align === 'center') return x - Math.floor(width / 2);
  if (align === 'right') return x - width;
  return x;
}
