import { VANILLA_SHEETS } from '../model/vanillaFontData';

/**
 * Polices auxiliaires, identiques à celles de la lib : caractères d’espacement
 * (`SpaceFont`) et copies de la police vanilla à un `ascent` donné
 * (`AsciiFont`).
 */

/** Plus grande puissance de 2 disponible (2^10 = 1024). */
const MAX_POWER = 10;
/** Premier caractère négatif (−1) ; −2^p = U+F801 + p. */
const NEGATIVE_BASE = 0xf801;
/** Premier caractère positif (+1) ; +2^p = U+F821 + p. */
const POSITIVE_BASE = 0xf821;

function spaceChar(power: number, negative: boolean): string {
  return String.fromCharCode((negative ? NEGATIVE_BASE : POSITIVE_BASE) + power);
}

/** Suite de caractères dont la somme des avances vaut `shift` (vide pour 0). */
export function encodeShift(shift: number): string {
  if (shift === 0) return '';
  const negative = shift < 0;
  let remaining = Math.abs(shift);
  let out = '';
  const max = 1 << MAX_POWER;
  while (remaining >= max) {
    out += spaceChar(MAX_POWER, negative);
    remaining -= max;
  }
  for (let power = MAX_POWER - 1; power >= 0; power--) {
    if (remaining & (1 << power)) out += spaceChar(power, negative);
  }
  return out;
}

/** Provider `space` de chaque police de menu : négatifs puis positifs, de 1 à 1024. */
export function spaceProvider(): { type: 'space'; advances: Record<string, number> } {
  const advances: Record<string, number> = {};
  for (let power = 0; power <= MAX_POWER; power++) advances[spaceChar(power, true)] = -(1 << power);
  for (let power = 0; power <= MAX_POWER; power++) advances[spaceChar(power, false)] = 1 << power;
  return { type: 'space', advances };
}

/** Avance de l’espace dans les polices de texte. */
const SPACE_ADVANCE = 4;

/**
 * Police de texte complète pour un `ascent`, comme `AsciiFont` de la lib :
 * provider `space` pour l’espace, puis les planches vanilla `ascii.png`,
 * `accented.png` (ascent + 3, même ligne de base) et `nonlatin_european.png`.
 */
export function asciiFont(ascent: number): unknown {
  return {
    providers: [
      { type: 'space', advances: { ' ': SPACE_ADVANCE } },
      ...VANILLA_SHEETS.map((sheet) => ({
        type: 'bitmap',
        file: sheet.file,
        ascent: ascent + sheet.ascentOffset,
        height: sheet.height,
        chars: sheet.chars,
      })),
    ],
  };
}
