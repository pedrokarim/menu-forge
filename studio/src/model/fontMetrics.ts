import type { TextAlign } from './menu';
import { VANILLA_SHEETS } from './vanillaFontData';

/** Avance de l’espace (provider `space` des polices de texte). */
const SPACE_ADVANCE = 4;
/** Avance du glyphe « manquant » (5 px + 1), pour un caractère absent de la police. */
const MISSING_ADVANCE = 6;

let advances: Map<number, number> | null = null;

/**
 * Avances de la police vanilla (`ascii.png`, `accented.png`,
 * `nonlatin_european.png`), lues dans `vanillaFontData.ts` : même table que
 * `CharWidths` de la lib, générée depuis le jar client.
 */
function vanillaAdvances(): Map<number, number> {
  if (advances) return advances;
  const table = new Map<number, number>();
  for (const sheet of VANILLA_SHEETS) {
    sheet.chars.forEach((row, index) => {
      const chars = Array.from(row);
      const digits = sheet.advances[index];
      chars.forEach((char, column) => {
        const codePoint = char.codePointAt(0) ?? 0;
        if (codePoint !== 0 && !table.has(codePoint)) table.set(codePoint, Number.parseInt(digits[column], 36));
      });
    });
  }
  advances = table;
  return table;
}

/** Hauteur d’une ligne de texte de la police vanilla, en pixels. */
export const TEXT_HEIGHT = 8;

export function charAdvance(char: string): number {
  if (char === ' ') return SPACE_ADVANCE;
  return vanillaAdvances().get(char.codePointAt(0) ?? 0) ?? MISSING_ADVANCE;
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
