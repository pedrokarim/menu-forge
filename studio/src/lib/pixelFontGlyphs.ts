/**
 * Police pixel de Menu Forge : glyphes dessinés pour le projet (licence MIT du
 * dépôt), qui servent d’aperçu quand la police du jeu n’est pas disponible
 * (aucune bibliothèque `vanilla` branchée).
 *
 * Seules les **métriques** suivent Minecraft : ligne de 8 px (capitales sur les
 * rangées 0 à 6, jambages sur la rangée 7), largeur de chaque dessin = avance
 * de `fontMetrics.ts` − 1 et, pour l’ASCII, dernière colonne encrée = avance − 2
 * (la règle du jeu). Les dessins sont les nôtres : aucune copie de `ascii.png`
 * ni d’une autre police. Ils prolongent le mot-symbole de
 * `scripts/discord_assets.py`.
 *
 * Format : un glyphe = ses rangées de haut en bas, séparées par « / »
 * (`#` = pixel encré, `.` = vide). La dernière rangée est toujours la rangée 7.
 * Les lettres accentuées sont composées (lettre de base + accent) ; comme dans
 * le jeu, l’accent d’une capitale dépasse de 3 px au-dessus de la ligne.
 *
 * Module chargé à la demande (`import()` dans `pixelFont.ts`) : il ne pèse pas
 * sur le paquet principal.
 */

/** Rangée du haut d’une case, par rapport au haut de la ligne. */
export const GLYPH_TOP = -3;
/** Rangées d’une case : 3 au-dessus de la ligne, puis les 8 de la ligne. */
export const CELL_ROWS = 11;

export interface PixelGlyph {
  char: string;
  /** Largeur du dessin, en pixels. */
  width: number;
  /** `CELL_ROWS` rangées de `width` cases, la première en `GLYPH_TOP`. */
  rows: string[];
}

const BACKSLASH = String.fromCharCode(92);

/** Caractères sans dessin (espaces) : seule compte leur avance, lue dans `fontMetrics.ts`. */
export const PIXEL_BLANKS: readonly string[] = [
  ' ',
  String.fromCharCode(0xa0),
  String.fromCharCode(0x2009),
  String.fromCharCode(0x202f),
];

/** Glyphes dessinés directement. */
const BASE: Record<string, string> = {
  // Chiffres.
  '0': '.###./#...#/#..##/#.#.#/##..#/#...#/.###./.....',
  '1': '..#../.##../#.#../..#../..#../..#../#####/.....',
  '2': '.###./#...#/....#/..##./.#.../#..../#####/.....',
  '3': '.###./#...#/....#/..##./....#/#...#/.###./.....',
  '4': '...#./..##./.#.#./#..#./#####/...#./...#./.....',
  '5': '#####/#..../####./....#/....#/#...#/.###./.....',
  '6': '..##./.#.../#..../####./#...#/#...#/.###./.....',
  '7': '#####/#...#/....#/...#./..#../..#../..#../.....',
  '8': '.###./#...#/#...#/.###./#...#/#...#/.###./.....',
  '9': '.###./#...#/#...#/.####/....#/...#./.##../.....',

  // Capitales.
  A: '.###./#...#/#...#/#####/#...#/#...#/#...#/.....',
  B: '####./#...#/#...#/####./#...#/#...#/####./.....',
  C: '.###./#...#/#..../#..../#..../#...#/.###./.....',
  D: '###../#..#./#...#/#...#/#...#/#..#./###../.....',
  E: '#####/#..../#..../####./#..../#..../#####/.....',
  F: '#####/#..../#..../####./#..../#..../#..../.....',
  G: '.###./#...#/#..../#.###/#...#/#...#/.####/.....',
  H: '#...#/#...#/#...#/#####/#...#/#...#/#...#/.....',
  I: '###/.#./.#./.#./.#./.#./###/...',
  J: '..###/...#./...#./...#./#..#./#..#./.##../.....',
  K: '#...#/#..#./#.#../##.../#.#../#..#./#...#/.....',
  L: '#..../#..../#..../#..../#..../#..../#####/.....',
  M: '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#/.....',
  N: '#...#/##..#/#.#.#/#..##/#...#/#...#/#...#/.....',
  O: '.###./#...#/#...#/#...#/#...#/#...#/.###./.....',
  P: '####./#...#/#...#/####./#..../#..../#..../.....',
  Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#/.....',
  R: '####./#...#/#...#/####./#.#../#..#./#...#/.....',
  S: '.####/#..../#..../.###./....#/....#/####./.....',
  T: '#####/..#../..#../..#../..#../..#../..#../.....',
  U: '#...#/#...#/#...#/#...#/#...#/#...#/.###./.....',
  V: '#...#/#...#/#...#/#...#/.#.#./.#.#./..#../.....',
  W: '#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#/.....',
  X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#/.....',
  Y: '#...#/#...#/.#.#./..#../..#../..#../..#../.....',
  Z: '#####/....#/...#./..#../.#.../#..../#####/.....',

  // Minuscules : œil sur les rangées 2 à 6, jambage sur la rangée 7.
  a: '...../...../.###./....#/.####/#...#/.####/.....',
  b: '#..../#..../#.##./##..#/#...#/#...#/####./.....',
  c: '...../...../.####/#..../#..../#..../.####/.....',
  d: '....#/....#/.##.#/#..##/#...#/#...#/.####/.....',
  e: '...../...../.###./#...#/#####/#..../.###./.....',
  f: '..##/.#../####/.#../.#../.#../.#../....',
  g: '...../...../.####/#...#/#...#/.####/....#/####.',
  h: '#..../#..../#.##./##..#/#...#/#...#/#...#/.....',
  i: '#/./#/#/#/#/#/.',
  j: '....#/...../....#/....#/....#/....#/#...#/.###.',
  k: '#.../#.../#..#/#.#./##../#.#./#..#/....',
  l: '#./#./#./#./#./#./.#/..',
  m: '...../...../##.#./#.#.#/#.#.#/#.#.#/#.#.#/.....',
  n: '...../...../#.##./##..#/#...#/#...#/#...#/.....',
  o: '...../...../.###./#...#/#...#/#...#/.###./.....',
  p: '...../...../#.##./##..#/#...#/####./#..../#....',
  q: '...../...../.##.#/#..##/#...#/.####/....#/....#',
  r: '...../...../#.##./##..#/#..../#..../#..../.....',
  s: '...../...../.####/#..../.###./....#/####./.....',
  t: '.../.#./###/.#./.#./.#./..#/...',
  u: '...../...../#...#/#...#/#...#/#..##/.##.#/.....',
  v: '...../...../#...#/#...#/#...#/.#.#./..#../.....',
  w: '...../...../#...#/#.#.#/#.#.#/#.#.#/.#.#./.....',
  x: '...../...../#...#/.#.#./..#../.#.#./#...#/.....',
  y: '...../...../#...#/#...#/#...#/.####/....#/####.',
  z: '...../...../#####/...#./..#../.#.../#####/.....',

  // Ponctuation et symboles ASCII.
  '!': '#/#/#/#/#/./#/.',
  '"': '#.#/#.#/.../.../.../.../.../...',
  '#': '.#.#./.#.#./#####/.#.#./#####/.#.#./.#.#./.....',
  $: '..#../.####/#.#../.###./..#.#/####./..#../.....',
  '%': '##..#/##..#/...#./..#../.#.../#..##/#..##/.....',
  '&': '.##../#..#./#.#../.#.../#.#.#/#..#./.##.#/.....',
  "'": '#/#/./././././.',
  '(': '..#/.#./#../#../#../.#./..#/...',
  ')': '#../.#./..#/..#/..#/.#./#../...',
  '*': '.../#.#/.#./#.#/.../.../.../...',
  '+': '...../..#../..#../#####/..#../..#../...../.....',
  ',': './././././#/#/#',
  '-': '...../...../...../#####/...../...../...../.....',
  '.': '././././././#/.',
  '/': '....#/....#/...#./..#../.#.../#..../#..../.....',
  ':': '././#/./././#/.',
  ';': '././#/./././#/#',
  '<': '...#/..#./.#../#.../.#../..#./...#/....',
  '=': '...../...../#####/...../...../#####/...../.....',
  '>': '#.../.#../..#./...#/..#./.#../#.../....',
  '?': '.###./#...#/....#/..##./..#../...../..#../.....',
  '@': '.####./#....#/#.##.#/#.#.##/#.###./#...../.####./......',
  '[': '###/#../#../#../#../#../###/...',
  [BACKSLASH]: '#..../#..../.#.../..#../...#./....#/....#/.....',
  ']': '###/..#/..#/..#/..#/..#/###/...',
  '^': '..#../.#.#./#...#/...../...../...../...../.....',
  _: '...../...../...../...../...../...../...../#####',
  '`': '#./.#/../../../../../..',
  '{': '..#/.#./.#./#../.#./.#./..#/...',
  '|': '#/#/#/#/#/#/#/#',
  '}': '#../.#./.#./..#/.#./.#./#../...',
  '~': '....../....../.##..#/#..##./....../....../....../......',

  // Hors ASCII : lettres et ligatures.
  ı: '...../...../.##../..#../..#../..#../.###./.....',
  ß: '.##../#..#./#.#../#..#./#...#/#...#/#.##./.....',
  œ: '...../...../.#.#./#.#.#/#.###/#.#../.#.##/.....',
  æ: '...../...../##.#./..#.#/.####/#.#../.#.##/.....',
  Œ: '.####/#.#../#.#../#.###/#.#../#.#../.####/.....',
  Æ: '.####/#.#../#.#../#####/#.#../#.#../#.###/.....',
  ø: '...../...../.####/#..##/#.#.#/##..#/####./.....',
  Ø: '.####/#..##/#..##/#.#.#/##..#/##..#/####./.....',

  // Hors ASCII : typographie française et symboles courants.
  '«': '...../...../...../.#.#./#.#../.#.#./...../.....',
  '»': '...../...../...../.#.#./..#.#/.#.#./...../.....',
  '‘': '..#../.#.../.##../...../...../...../...../.....',
  '’': '.##../..#../.#.../...../...../...../...../.....',
  '“': '.#..#/#..#./##.##/...../...../...../...../.....',
  '”': '##.##/.#..#/#..#./...../...../...../...../.....',
  '…': '...../...../...../...../...../...../#.#.#/.....',
  '–': '...../...../...../#####/...../...../...../.....',
  '—': '...../...../...../#####/...../...../...../.....',
  '•': '...../...../.###./.###./.###./...../...../.....',
  '·': '...../...../...../..#../...../...../...../.....',
  '€': '..###/.#.../####./.#.../####./.#.../..###/.....',
  '£': '..##./.#..#/.#.../####./.#.../.#.../#####/.....',
  '§': '.####/#..../.###./#...#/.###./....#/####./.....',
  '°': '..#../.#.#./..#../...../...../...../...../.....',
  '±': '..#../..#../#####/..#../..#../#####/...../.....',
  '×': '...../...../...../.#.#./..#../.#.#./...../.....',
  '÷': '...../..#../...../#####/...../..#../...../.....',
  '²': '##.../..#../.#.../###../...../...../...../.....',
  '³': '###../.##../..#../###../...../...../...../.....',
  '¡': '..#../...../..#../..#../..#../..#../..#../.....',
  '¿': '..#../...../..#../.##../#..../#...#/.###./.....',
};

type Mark = 'acute' | 'grave' | 'circumflex' | 'diaeresis' | 'tilde' | 'caron' | 'dot';

/** Accents : deux rangées, posées en −1 et 0 sur une minuscule, en −3 et −2 sur une capitale. */
const MARKS: Record<Mark, readonly [string, string]> = {
  acute: ['...#.', '..#..'],
  grave: ['.#...', '..#..'],
  circumflex: ['..#..', '.#.#.'],
  diaeresis: ['.....', '.#.#.'],
  tilde: ['.##.#', '#.##.'],
  caron: ['.#.#.', '..#..'],
  dot: ['.....', '..#..'],
};

/** I capital de 5 px : base des I accentués (hors ASCII, l’avance est celle par défaut). */
const WIDE_I = '.###./..#../..#../..#../..#../..#../.###./.....';

/** Lettres accentuées : [lettre de base (ou dessin), accent]. */
const COMPOSED: Record<string, readonly [string, Mark]> = {
  à: ['a', 'grave'], á: ['a', 'acute'], â: ['a', 'circumflex'], ä: ['a', 'diaeresis'], ã: ['a', 'tilde'],
  è: ['e', 'grave'], é: ['e', 'acute'], ê: ['e', 'circumflex'], ë: ['e', 'diaeresis'],
  ì: ['ı', 'grave'], í: ['ı', 'acute'], î: ['ı', 'circumflex'], ï: ['ı', 'diaeresis'],
  ò: ['o', 'grave'], ó: ['o', 'acute'], ô: ['o', 'circumflex'], ö: ['o', 'diaeresis'], õ: ['o', 'tilde'],
  ù: ['u', 'grave'], ú: ['u', 'acute'], û: ['u', 'circumflex'], ü: ['u', 'diaeresis'],
  ý: ['y', 'acute'], ÿ: ['y', 'diaeresis'], ñ: ['n', 'tilde'],
  č: ['c', 'caron'], š: ['s', 'caron'], ž: ['z', 'caron'],
  À: ['A', 'grave'], Á: ['A', 'acute'], Â: ['A', 'circumflex'], Ä: ['A', 'diaeresis'], Ã: ['A', 'tilde'],
  È: ['E', 'grave'], É: ['E', 'acute'], Ê: ['E', 'circumflex'], Ë: ['E', 'diaeresis'],
  Ì: [WIDE_I, 'grave'], Í: [WIDE_I, 'acute'], Î: [WIDE_I, 'circumflex'], Ï: [WIDE_I, 'diaeresis'], İ: [WIDE_I, 'dot'],
  Ò: ['O', 'grave'], Ó: ['O', 'acute'], Ô: ['O', 'circumflex'], Ö: ['O', 'diaeresis'], Õ: ['O', 'tilde'],
  Ù: ['U', 'grave'], Ú: ['U', 'acute'], Û: ['U', 'circumflex'], Ü: ['U', 'diaeresis'],
  Ý: ['Y', 'acute'], Ÿ: ['Y', 'diaeresis'], Ñ: ['N', 'tilde'],
  Č: ['C', 'caron'], Š: ['S', 'caron'], Ž: ['Z', 'caron'],
};

/** Lettres à cédille (sur la rangée 7) et leur base. */
const CEDILLAS: Record<string, string> = { ç: 'c', Ç: 'C' };
const CEDILLA = '..##.';

/** Rangées d’un dessin, complétées par le haut jusqu’à `CELL_ROWS`. */
function cellRows(pattern: string): string[] {
  const rows = pattern.split('/');
  const blank = '.'.repeat(rows[0].length);
  return [...Array.from({ length: Math.max(0, CELL_ROWS - rows.length) }, () => blank), ...rows];
}

/** Superpose une marque à une rangée (les pixels encrés s’ajoutent). */
function overlay(row: string, mark: string): string {
  return Array.from(row, (cell, index) => (mark[index] === '#' ? '#' : cell)).join('');
}

function glyph(char: string, rows: string[]): PixelGlyph {
  return { char, width: rows[0].length, rows };
}

/** Tous les glyphes dessinés, lettres composées comprises. */
export function pixelGlyphs(): PixelGlyph[] {
  const glyphs: PixelGlyph[] = [];
  for (const [char, pattern] of Object.entries(BASE)) glyphs.push(glyph(char, cellRows(pattern)));
  for (const [char, [base, mark]] of Object.entries(COMPOSED)) {
    const rows = cellRows(base.length === 1 ? BASE[base] : base);
    // Minuscule : accent en −1 et 0 (l’œil commence en 2) ; capitale : en −3 et −2.
    const start = char === char.toLowerCase() ? 2 : 0;
    MARKS[mark].forEach((markRow, index) => {
      rows[start + index] = overlay(rows[start + index], markRow);
    });
    glyphs.push(glyph(char, rows));
  }
  for (const [char, base] of Object.entries(CEDILLAS)) {
    const rows = cellRows(BASE[base]);
    rows[CELL_ROWS - 1] = overlay(rows[CELL_ROWS - 1], CEDILLA);
    glyphs.push(glyph(char, rows));
  }
  return glyphs;
}
