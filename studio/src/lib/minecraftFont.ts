import { libraryRawUrl } from './libraryApi';
import type { LoadedTexture } from './textures';
import { alphaAt, loadTexture } from './textures';

/**
 * Moteur de texte Minecraft : reproduit au pixel près le rendu des polices
 * bitmap du jeu (providers `bitmap`, `space`, `reference`).
 */

export interface TextStyle {
  color?: string;
  shadow?: boolean;
  bold?: boolean;
}

export interface MinecraftFont {
  /** Largeur en pixels (avances cumulées) d’un texte sans codes de format. */
  measure(text: string, bold?: boolean): number;
  /** Dessine un texte simple ; renvoie l’avance totale. `y` = haut de la ligne. */
  draw(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, style?: TextStyle): number;
  /** Mesure / dessine un texte avec codes « § » (0-9 a-f couleurs vanilla, l gras, r reset ; k m n o ignorés). */
  measureFormatted(text: string): number;
  drawFormatted(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, style?: TextStyle): number;
  /** Avance de chaque caractère ASCII imprimable (pour comparer avec nos tables). */
  asciiAdvances(): Record<string, number>;
}

/** Couleurs des codes « § » vanilla. */
const LEGACY_COLORS: Record<string, string> = {
  '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
  '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
  '8': '#555555', '9': '#5555FF', a: '#55FF55', b: '#55FFFF',
  c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF',
};
const DEFAULT_COLOR = '#FFFFFF';
/** Options de police du jeu, pour les `filter` des providers (valeurs par défaut). */
const FONT_OPTIONS: Record<string, boolean> = { uniform: false, jp: false };

/** Planche de glyphes, avec ses versions teintées (une par couleur). */
interface Sheet {
  source: CanvasImageSource;
  width: number;
  height: number;
  tints: Map<string, HTMLCanvasElement>;
}

/** Glyphe résolu ; `sheet` nul pour un glyphe d’espacement (rien à dessiner). */
interface Glyph {
  advance: number;
  sheet: Sheet | null;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  width: number;
  height: number;
  /** Décalage du haut du glyphe par rapport au haut de la ligne. */
  top: number;
}

/** Un morceau de texte de style homogène. */
interface Run {
  text: string;
  color: string;
  bold: boolean;
}

interface ProviderJson {
  type?: string;
  id?: string;
  file?: string;
  chars?: string[];
  height?: number;
  ascent?: number;
  advances?: Record<string, number>;
  filter?: Record<string, boolean>;
}

/** `minecraft:font/ascii.png` → namespace + chemin. */
function splitId(id: string): [string, string] {
  const colon = id.indexOf(':');
  return colon < 0 ? ['minecraft', id] : [id.slice(0, colon), id.slice(colon + 1)];
}

function fontPath(id: string): string {
  const [namespace, path] = splitId(id);
  return `assets/${namespace}/font/${path}.json`;
}

function texturePath(id: string): string {
  const [namespace, path] = splitId(id);
  return `assets/${namespace}/textures/${path}`;
}

async function fetchFontJson(sourceId: string, id: string): Promise<ProviderJson[]> {
  const response = await fetch(libraryRawUrl(sourceId, fontPath(id)));
  if (!response.ok) throw new Error(`Police introuvable : ${id} (${response.status})`);
  const json = (await response.json()) as { providers?: ProviderJson[] };
  return json.providers ?? [];
}

function enabledByFilter(filter: Record<string, boolean> | undefined): boolean {
  if (!filter) return true;
  return Object.entries(filter).every(([option, value]) => (FONT_OPTIONS[option] ?? false) === value);
}

/** Normalise une couleur CSS en `#rrggbb` (repli : blanc). */
function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return '#ffffff';
  ctx.fillStyle = color;
  const normalized = ctx.fillStyle;
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toLowerCase() : '#ffffff';
}

/** Ombre du jeu : chaque composante RGB divisée par 4 (arrondi inférieur). */
function shadowOf(color: string): string {
  const value = Number.parseInt(toHex(color).slice(1), 16);
  return `#${((value & 0xfcfcfc) >> 2).toString(16).padStart(6, '0')}`;
}

/** Version teintée d’une planche : texel × couleur, comme le jeu, alpha conservé. */
function tintedSheet(sheet: Sheet, color: string): HTMLCanvasElement {
  const key = toHex(color);
  const cached = sheet.tints.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = sheet.width;
  canvas.height = sheet.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible');
  ctx.drawImage(sheet.source, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = key;
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(sheet.source, 0, 0);
  sheet.tints.set(key, canvas);
  return canvas;
}

/** Glyphe « manquant » du jeu : cadre blanc de 5 × 8, avance 6. */
function missingGlyph(): Glyph {
  const canvas = document.createElement('canvas');
  canvas.width = 5;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 5, 8);
    ctx.clearRect(1, 1, 3, 6);
  }
  const sheet: Sheet = { source: canvas, width: 5, height: 8, tints: new Map() };
  return { advance: 6, sheet, sx: 0, sy: 0, sw: 5, sh: 8, width: 5, height: 8, top: 0 };
}

/** Largeur réelle d’une case : dernière colonne contenant un pixel non transparent, + 1. */
function actualWidth(texture: LoadedTexture, x0: number, y0: number, cellW: number, cellH: number): number {
  for (let x = cellW - 1; x >= 0; x--) {
    for (let y = 0; y < cellH; y++) {
      if (alphaAt(texture, x0 + x, y0 + y) !== 0) return x + 1;
    }
  }
  return 0;
}

/** Construit la table des glyphes d’une police (le premier provider qui définit un caractère gagne). */
async function buildGlyphs(sourceId: string, fontId: string): Promise<Map<number, Glyph>> {
  const glyphs = new Map<number, Glyph>();
  const textures = new Map<string, Promise<LoadedTexture>>();

  const textureOf = (file: string): Promise<LoadedTexture> => {
    let pending = textures.get(file);
    if (!pending) {
      pending = loadTexture(libraryRawUrl(sourceId, texturePath(file)));
      textures.set(file, pending);
    }
    return pending;
  };

  const addBitmap = async (provider: ProviderJson): Promise<void> => {
    const rows = provider.chars ?? [];
    const ascent = provider.ascent;
    if (!provider.file || rows.length === 0 || ascent === undefined) return;
    const texture = await textureOf(provider.file);
    const grid = rows.map((row) => Array.from(row));
    const columns = grid[0].length;
    const cellW = Math.floor(texture.width / columns);
    const cellH = Math.floor(texture.height / grid.length);
    const height = provider.height ?? 8;
    const scale = height / cellH;
    const sheet: Sheet = { source: texture.image, width: texture.width, height: texture.height, tints: new Map() };
    grid.forEach((row, rowIndex) => {
      row.forEach((char, column) => {
        const codePoint = char.codePointAt(0) ?? 0;
        if (codePoint === 0 || glyphs.has(codePoint)) return;
        const sx = column * cellW;
        const sy = rowIndex * cellH;
        const width = actualWidth(texture, sx, sy, cellW, cellH);
        if (width === 0) return;
        glyphs.set(codePoint, {
          advance: Math.floor(0.5 + width * scale) + 1,
          sheet,
          sx,
          sy,
          sw: cellW,
          sh: cellH,
          width: cellW * scale,
          height: cellH * scale,
          // Comme le jeu : l’ascent est en pixels finaux, il ne suit pas `scale`.
          top: 7 - ascent,
        });
      });
    });
  };

  const addProviders = async (id: string, visited: Set<string>): Promise<void> => {
    if (visited.has(id)) return;
    visited.add(id);
    const providers = await fetchFontJson(sourceId, id);
    // Les planches se chargent en parallèle, mais s’appliquent dans l’ordre.
    for (const provider of providers) {
      if (provider.type === 'bitmap' && provider.file) textureOf(provider.file).catch(() => undefined);
    }
    for (const provider of providers) {
      if (!enabledByFilter(provider.filter)) continue;
      if (provider.type === 'bitmap') await addBitmap(provider);
      else if (provider.type === 'space') {
        for (const [char, advance] of Object.entries(provider.advances ?? {})) {
          const codePoint = char.codePointAt(0);
          if (codePoint === undefined || glyphs.has(codePoint)) continue;
          glyphs.set(codePoint, { advance, sheet: null, sx: 0, sy: 0, sw: 0, sh: 0, width: 0, height: 0, top: 0 });
        }
      } else if (provider.type === 'reference' && provider.id) {
        await addProviders(provider.id, new Set(visited));
      }
      // `unihex` et `ttf` : non gérés.
    }
  };

  await addProviders(fontId, new Set());
  return glyphs;
}

/** Découpe un texte « § » en morceaux stylés (règles de `StringDecomposer` du jeu). */
function parseFormatted(text: string, color: string, bold: boolean): Run[] {
  const runs: Run[] = [];
  let current: Run = { text: '', color, bold };
  const chars = Array.from(text);
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    if (char !== '§') {
      current.text += char;
      continue;
    }
    if (index + 1 >= chars.length) break;
    const code = chars[++index].toLowerCase();
    let next: Run | null = null;
    if (code === 'r') next = { text: '', color, bold };
    else if (code === 'l') next = { text: '', color: current.color, bold: true };
    // Une couleur remet aussi à zéro le gras, comme `Style.applyLegacyFormat`.
    else if (LEGACY_COLORS[code]) next = { text: '', color: LEGACY_COLORS[code], bold: false };
    if (!next) continue;
    if (current.text) runs.push(current);
    current = next;
  }
  if (current.text) runs.push(current);
  return runs;
}

function createFont(glyphs: Map<number, Glyph>): MinecraftFont {
  const missing = missingGlyph();
  const glyphOf = (char: string): Glyph => glyphs.get(char.codePointAt(0) ?? 0) ?? missing;

  const measureRuns = (runs: Run[]): number => {
    let total = 0;
    for (const run of runs) {
      for (const char of run.text) total += glyphOf(char).advance + (run.bold ? 1 : 0);
    }
    return total;
  };

  /** Dessine une passe (ombre ou texte) ; renvoie l’avance totale. */
  const drawPass = (
    ctx: CanvasRenderingContext2D,
    runs: Run[],
    x: number,
    y: number,
    colorOf: (run: Run) => string,
  ): number => {
    let cursor = x;
    for (const run of runs) {
      const color = colorOf(run);
      for (const char of run.text) {
        const glyph = glyphOf(char);
        if (glyph.sheet) {
          const tinted = tintedSheet(glyph.sheet, color);
          const top = y + glyph.top;
          ctx.drawImage(tinted, glyph.sx, glyph.sy, glyph.sw, glyph.sh, cursor, top, glyph.width, glyph.height);
          if (run.bold) {
            ctx.drawImage(tinted, glyph.sx, glyph.sy, glyph.sw, glyph.sh, cursor + 1, top, glyph.width, glyph.height);
          }
        }
        cursor += glyph.advance + (run.bold ? 1 : 0);
      }
    }
    return cursor - x;
  };

  const drawRuns = (ctx: CanvasRenderingContext2D, runs: Run[], x: number, y: number, shadow: boolean): number => {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (shadow) drawPass(ctx, runs, x + 1, y + 1, (run) => shadowOf(run.color));
    const advance = drawPass(ctx, runs, x, y, (run) => run.color);
    ctx.restore();
    return advance;
  };

  return {
    measure: (text, bold = false) => measureRuns([{ text, color: DEFAULT_COLOR, bold }]),
    draw: (ctx, text, x, y, style = {}) =>
      drawRuns(
        ctx,
        [{ text, color: style.color ?? DEFAULT_COLOR, bold: style.bold ?? false }],
        x,
        y,
        style.shadow ?? false,
      ),
    measureFormatted: (text) => measureRuns(parseFormatted(text, DEFAULT_COLOR, false)),
    drawFormatted: (ctx, text, x, y, style = {}) =>
      drawRuns(
        ctx,
        parseFormatted(text, style.color ?? DEFAULT_COLOR, style.bold ?? false),
        x,
        y,
        style.shadow ?? false,
      ),
    asciiAdvances: () => {
      const advances: Record<string, number> = {};
      for (let code = 0x20; code <= 0x7e; code++) {
        const char = String.fromCharCode(code);
        advances[char] = glyphOf(char).advance;
      }
      return advances;
    },
  };
}

const fonts = new Map<string, Promise<MinecraftFont>>();

/** Charge une police d’une bibliothèque (une seule fois par police). */
export function loadMinecraftFont(sourceId = 'vanilla', fontId = 'minecraft:default'): Promise<MinecraftFont> {
  const key = `${sourceId}|${fontId}`;
  let pending = fonts.get(key);
  if (!pending) {
    pending = buildGlyphs(sourceId, fontId).then(createFont);
    // Un échec n’est pas mis en cache : un nouvel appel retente.
    pending.catch(() => fonts.delete(key));
    fonts.set(key, pending);
  }
  return pending;
}
