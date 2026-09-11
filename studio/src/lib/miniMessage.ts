/**
 * Lecture d’un sous-ensemble de MiniMessage (le format des noms et des
 * descriptions d’items) pour l’aperçu coloré de l’inspecteur : couleurs
 * nommées et hexadécimales, `color:`, décorations (et leur négation `!`),
 * `reset`, `gradient`, `rainbow`, `newline`. Une balise inconnue reste
 * affichée telle quelle, comme le ferait un texte mal formé en jeu.
 */

export interface MiniStyle {
  color: string;
  bold: boolean;
  italic: boolean;
  underlined: boolean;
  strikethrough: boolean;
  obfuscated: boolean;
}

export interface MiniSpan extends MiniStyle {
  text: string;
}

/** Les 16 couleurs du jeu. */
export const NAMED_COLORS: Readonly<Record<string, string>> = {
  black: '#000000',
  dark_blue: '#0000aa',
  dark_green: '#00aa00',
  dark_aqua: '#00aaaa',
  dark_red: '#aa0000',
  dark_purple: '#aa00aa',
  gold: '#ffaa00',
  gray: '#aaaaaa',
  grey: '#aaaaaa',
  dark_gray: '#555555',
  dark_grey: '#555555',
  blue: '#5555ff',
  green: '#55ff55',
  aqua: '#55ffff',
  red: '#ff5555',
  light_purple: '#ff55ff',
  yellow: '#ffff55',
  white: '#ffffff',
};

type Decoration = 'bold' | 'italic' | 'underlined' | 'strikethrough' | 'obfuscated';

const DECORATIONS: Readonly<Record<string, Decoration>> = {
  bold: 'bold',
  b: 'bold',
  italic: 'italic',
  i: 'italic',
  em: 'italic',
  underlined: 'underlined',
  u: 'underlined',
  strikethrough: 'strikethrough',
  st: 'strikethrough',
  obfuscated: 'obfuscated',
  obf: 'obfuscated',
};

/** Couleur d’un argument de balise (`red`, `#ff0000`), ou `null`. */
function parseColor(value: string): string | null {
  const lower = value.toLowerCase();
  if (NAMED_COLORS[lower]) return NAMED_COLORS[lower];
  return /^#[0-9a-f]{6}$/.test(lower) ? lower : null;
}

interface StackEntry {
  name: string;
  apply: (style: MiniStyle) => MiniStyle;
  /** Dégradé ou arc-en-ciel : les caractères couverts sont recolorés à la fin. */
  gradient?: { id: number; stops: string[] | 'rainbow' };
}

interface Char {
  text: string;
  style: MiniStyle;
  gradients: number[];
}

function mix(a: string, b: string, t: number): string {
  const channel = (offset: number) => {
    const from = parseInt(a.slice(offset, offset + 2), 16);
    const to = parseInt(b.slice(offset, offset + 2), 16);
    return Math.round(from + (to - from) * t)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

function gradientColor(stops: string[] | 'rainbow', t: number): string {
  if (stops === 'rainbow') {
    const hue = t * 360;
    const f = (n: number) => {
      const k = (n + hue / 60) % 6;
      return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1))));
    };
    return `#${[f(5), f(3), f(1)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  }
  if (stops.length === 1) return stops[0];
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  return mix(stops[index], stops[index + 1], scaled - index);
}

/**
 * Découpe un texte MiniMessage en lignes de segments stylés. `base` : style
 * de départ (le jeu met les descriptions en violet, les noms en blanc).
 */
export function parseMiniMessage(input: string, base: MiniStyle): MiniSpan[][] {
  const lines: Char[][] = [[]];
  const stack: StackEntry[] = [];
  const gradients = new Map<number, string[] | 'rainbow'>();
  let nextGradient = 0;

  const current = (): { style: MiniStyle; ids: number[] } => {
    let style = base;
    const ids: number[] = [];
    for (const entry of stack) {
      style = entry.apply(style);
      if (entry.gradient) ids.push(entry.gradient.id);
    }
    return { style, ids };
  };
  const emit = (text: string) => {
    const { style, ids } = current();
    for (const char of text) lines[lines.length - 1].push({ text: char, style, gradients: ids });
  };

  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (char === '\\' && (input[index + 1] === '<' || input[index + 1] === '\\')) {
      emit(input[index + 1]);
      index += 2;
      continue;
    }
    if (char !== '<') {
      emit(char);
      index++;
      continue;
    }
    const end = input.indexOf('>', index);
    if (end < 0) {
      emit(input.slice(index));
      break;
    }
    const raw = input.slice(index + 1, end);
    const tag = raw.trim();
    index = end + 1;
    if (tag.startsWith('/')) {
      const name = tag.slice(1).split(':')[0].toLowerCase();
      if (!name) stack.pop();
      else {
        const position = stack.map((entry) => entry.name).lastIndexOf(name);
        if (position >= 0) stack.splice(position, 1);
      }
      continue;
    }
    const [head, ...args] = tag.split(':');
    const name = head.toLowerCase();
    if (name === 'reset') {
      stack.length = 0;
      continue;
    }
    if (name === 'newline' || name === 'br') {
      lines.push([]);
      continue;
    }
    const namedColor = parseColor(tag);
    const color = namedColor ?? (['color', 'colour', 'c'].includes(name) && args[0] ? parseColor(args[0]) : null);
    if (color) {
      stack.push({ name: namedColor ? tag.toLowerCase() : name, apply: (style) => ({ ...style, color }) });
      continue;
    }
    const negated = name.startsWith('!');
    const decoration = DECORATIONS[negated ? name.slice(1) : name];
    if (decoration) {
      const value = !negated && args[0] !== 'false';
      stack.push({ name: negated ? name.slice(1) : name, apply: (style) => ({ ...style, [decoration]: value }) });
      continue;
    }
    if (name === 'gradient' || name === 'rainbow') {
      const stops = name === 'rainbow' ? 'rainbow' : args.map(parseColor).filter((value): value is string => value !== null);
      const id = nextGradient++;
      gradients.set(id, stops.length === 0 ? ['#ffffff', '#000000'] : stops);
      stack.push({ name, apply: (style) => style, gradient: { id, stops } });
      continue;
    }
    // Balise inconnue (ou `lang`, `key`…) : laissée telle quelle.
    emit(`<${raw}>`);
  }

  // Dégradés : chaque caractère prend la couleur de sa position dans le dégradé le plus intérieur.
  for (const [id, stops] of gradients) {
    const covered = lines.flat().filter((char) => char.gradients.at(-1) === id);
    covered.forEach((char, position) => {
      const t = covered.length > 1 ? position / (covered.length - 1) : 0;
      char.style = { ...char.style, color: gradientColor(stops, t) };
    });
  }

  return lines.map((line) => {
    const spans: MiniSpan[] = [];
    for (const char of line) {
      const last = spans.at(-1);
      const same =
        last &&
        last.color === char.style.color &&
        last.bold === char.style.bold &&
        last.italic === char.style.italic &&
        last.underlined === char.style.underlined &&
        last.strikethrough === char.style.strikethrough &&
        last.obfuscated === char.style.obfuscated;
      if (same) last.text += char.text;
      else spans.push({ ...char.style, text: char.text });
    }
    return spans;
  });
}

/** Style des noms d’items (la lib retire l’italique par défaut du jeu). */
export const ITEM_NAME_STYLE: MiniStyle = {
  color: '#ffffff',
  bold: false,
  italic: false,
  underlined: false,
  strikethrough: false,
  obfuscated: false,
};

/** Style des lignes de description (violet du jeu, sans italique grâce à la lib). */
export const ITEM_LORE_STYLE: MiniStyle = { ...ITEM_NAME_STYLE, color: '#aa00aa' };

/** Texte sans balises (pour un résumé ou une infobulle). */
export function plainMiniMessage(input: string): string {
  return parseMiniMessage(input, ITEM_NAME_STYLE)
    .map((line) => line.map((span) => span.text).join(''))
    .join(' ');
}
