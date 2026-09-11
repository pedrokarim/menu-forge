/**
 * Textes à codes `§` tels que Bedrock les affiche : couleurs (dont `§g` et les
 * couleurs de matériaux `§h` à `§v`, où `§m` et `§n` sont des couleurs et non
 * du barré ou du souligné), gras, italique, remise à zéro. Utilisé par
 * l’aperçu des formulaires Bedrock.
 */

export interface LegacySegment {
  text: string;
  /** Couleur `#rrggbb`, ou `null` : couleur par défaut du contrôle. */
  color: string | null;
  bold: boolean;
  italic: boolean;
}

/** Couleurs des codes `§` sur Bedrock. */
export const BEDROCK_COLORS: Readonly<Record<string, string>> = {
  '0': '#000000',
  '1': '#0000aa',
  '2': '#00aa00',
  '3': '#00aaaa',
  '4': '#aa0000',
  '5': '#aa00aa',
  '6': '#ffaa00',
  '7': '#aaaaaa',
  '8': '#555555',
  '9': '#5555ff',
  a: '#55ff55',
  b: '#55ffff',
  c: '#ff5555',
  d: '#ff55ff',
  e: '#ffff55',
  f: '#ffffff',
  g: '#ddd605',
  h: '#e3d4d1',
  i: '#cecaca',
  j: '#443a3b',
  m: '#971607',
  n: '#b4684d',
  p: '#deb12d',
  q: '#47a036',
  s: '#2cbaa8',
  t: '#21497b',
  u: '#9a5cc6',
  v: '#eb7114',
};

/** Découpe un texte en segments de même style ; les codes inconnus sont retirés, comme en jeu. */
export function parseLegacyText(text: string): LegacySegment[] {
  const segments: LegacySegment[] = [];
  let style: Omit<LegacySegment, 'text'> = { color: null, bold: false, italic: false };
  let buffer = '';
  const flush = () => {
    if (buffer !== '') segments.push({ text: buffer, ...style });
    buffer = '';
  };
  const chars = [...text];
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    if (char !== '§') {
      buffer += char;
      continue;
    }
    const code = chars[index + 1]?.toLowerCase();
    index++;
    if (code === undefined) break;
    flush();
    if (code in BEDROCK_COLORS) style = { ...style, color: BEDROCK_COLORS[code] };
    else if (code === 'l') style = { ...style, bold: true };
    else if (code === 'o') style = { ...style, italic: true };
    else if (code === 'r') style = { color: null, bold: false, italic: false };
  }
  flush();
  return segments;
}

/** Texte sans ses codes `§`. */
export function stripLegacy(text: string): string {
  return parseLegacyText(text)
    .map((segment) => segment.text)
    .join('');
}
