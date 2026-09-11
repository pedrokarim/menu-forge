/**
 * Polices auxiliaires, identiques à celles de la lib : caractères d’espacement
 * (`SpaceFont`) et copies de la police ASCII vanilla à un `ascent` donné
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

/** Case vide de la grille (ignorée par Minecraft). */
const EMPTY = String.fromCharCode(0);
const QUOTE = String.fromCharCode(34);
const BACKSLASH = String.fromCharCode(92);
const BACKTICK = String.fromCharCode(96);

/**
 * Grille de `minecraft:font/ascii.png` (16 × 16 cases), même table que
 * `AsciiFont` de la lib (lignes 0–1 et 8–15 à vérifier en jeu).
 */
const ASCII_ROWS: readonly string[] = [
  'ÀÁÂÈÊËÍÓÔÕÚßãõğİ',
  'ıŒœŞşŴŵžȇ' + EMPTY.repeat(7),
  ' !' + QUOTE + "#$%&'()*+,-./",
  '0123456789:;<=>?',
  '@ABCDEFGHIJKLMNO',
  'PQRSTUVWXYZ[' + BACKSLASH + ']^_',
  BACKTICK + 'abcdefghijklmno',
  'pqrstuvwxyz{|}~' + EMPTY,
  'ÇüéâäàåçêëèïîìÄÅ',
  'ÉæÆôöòûùÿÖÜø£Ø×ƒ',
  'áíóúñÑªº¿®¬½¼¡«»',
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐',
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧',
  '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀',
  'αβΓπΣσμτΦΘΩδ∞∅∈∩',
  '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■' + EMPTY,
];

/** Avance de l’espace dans les polices de texte. */
const SPACE_ADVANCE = 4;

/** Police de texte complète pour un `ascent` (provider `space` pour l’espace, puis la grille). */
export function asciiFont(ascent: number): unknown {
  return {
    providers: [
      { type: 'space', advances: { ' ': SPACE_ADVANCE } },
      { type: 'bitmap', file: 'minecraft:font/ascii.png', ascent, height: 8, chars: ASCII_ROWS },
    ],
  };
}
