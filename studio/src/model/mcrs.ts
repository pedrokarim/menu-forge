import { darken, lighten, parseColor } from './generator';
import type { ButtonState, GeneratorSpec, McrsStyle } from './menu';
import type { Painter, Rgba } from './painter';

/**
 * Famille de styles « mc-rs », portée du pack d’interface de mc-rs (MIT, même
 * auteur) : ses textures y sont générées par un script Pillow
 * (`resource_packs/mcrs_ui/generate_assets.py`). Menu Forge ne copie aucun de
 * ces fichiers : il en reprend l’esprit (panneaux bleu nuit, bordure d’un
 * pixel, boutons à trois états, accent or et orange) et les recalcule au pixel
 * près, à n’importe quelle taille.
 *
 * Toutes les formes ont des coins arrondis « pixel » : un pixel de coin est
 * hors de la forme si son centre est à plus de `rayon − ½` du centre de l’arc.
 * Rayon 1 retire le seul pixel du coin, rayon 2 un « L » de trois pixels, etc.
 */

/** Palette de mc-rs (`_global_variables.json` et `generate_assets.py`). */
export const MCRS_COLORS = {
  panel: '#0c0c19f5',
  panelBorder: '#3c3c50',
  button: '#1e1e2ee6',
  gold: '#ffd933',
  orange: '#ff9a1e',
  text: '#f0f0f0',
  slot: '#1b1b2e',
  raised: '#2d2d2d',
  green: '#49a842',
  special: '#6c28a1',
  red: '#b83a3a',
  grid: '#3a3a4e',
} as const;

export const MCRS_STYLES: readonly McrsStyle[] = [
  'mcrs_panel',
  'mcrs_border',
  'mcrs_button',
  'mcrs_raised',
  'mcrs_strip',
  'mcrs_slot',
  'mcrs_grid',
];

export function isMcrsStyle(style: string): style is McrsStyle {
  return (MCRS_STYLES as readonly string[]).includes(style);
}

export const MCRS_STYLE_LABELS: Record<McrsStyle, string> = {
  mcrs_panel: 'Panneau arrondi',
  mcrs_border: 'Bordure arrondie',
  mcrs_button: 'Bouton plat (états)',
  mcrs_raised: 'Bouton en relief',
  mcrs_strip: 'Bande',
  mcrs_slot: 'Case sombre',
  mcrs_grid: 'Grille de chargement',
};

export const BUTTON_STATE_LABELS: Record<ButtonState, string> = {
  normal: 'Normal',
  hover: 'Survol',
  pressed: 'Pressé',
};

/** Paramètres mc-rs lus par chaque style (les autres sont ignorés). */
export type McrsParam = 'radius' | 'borderWidth' | 'borderColor' | 'accent' | 'state' | 'shadow' | 'tile';

export const MCRS_PARAMS: Record<McrsStyle, readonly McrsParam[]> = {
  mcrs_panel: ['radius', 'borderWidth', 'borderColor', 'shadow'],
  mcrs_border: ['radius', 'borderWidth'],
  mcrs_button: ['radius', 'borderWidth', 'borderColor', 'accent', 'state', 'shadow'],
  mcrs_raised: ['radius', 'borderWidth', 'borderColor', 'accent', 'state', 'shadow'],
  mcrs_strip: ['radius'],
  mcrs_slot: ['radius'],
  mcrs_grid: ['radius', 'borderColor', 'tile'],
};

/** Valeurs par défaut des paramètres numériques, style par style. */
const DEFAULTS: Record<McrsStyle, { radius: number; borderWidth: number; shadow: number }> = {
  mcrs_panel: { radius: 2, borderWidth: 1, shadow: 0 },
  mcrs_border: { radius: 2, borderWidth: 1, shadow: 0 },
  mcrs_button: { radius: 1, borderWidth: 1, shadow: 0 },
  mcrs_raised: { radius: 1, borderWidth: 0, shadow: 2 },
  mcrs_strip: { radius: 0, borderWidth: 0, shadow: 0 },
  mcrs_slot: { radius: 1, borderWidth: 1, shadow: 0 },
  mcrs_grid: { radius: 0, borderWidth: 0, shadow: 0 },
};

export const DEFAULT_TILE = 8;

/** Ombre portée de mc-rs : noir à 99/255. */
const SHADOW: Rgba = { r: 0, g: 0, b: 0, a: 99 };

export type McrsOptions = Pick<GeneratorSpec, McrsParam>;

/** Valeur effective d’un paramètre numérique (défaut du style si absent), bornée. */
export function mcrsNumber(style: McrsStyle, options: McrsOptions, param: 'radius' | 'borderWidth' | 'shadow'): number {
  const value = options[param] ?? DEFAULTS[style][param];
  return Math.max(0, Math.min(32, Math.round(value)));
}

/* Formes */

type Span = readonly [start: number, end: number];

function clampRadius(radius: number, width: number, height: number): number {
  return Math.max(0, Math.min(Math.round(radius), Math.floor(Math.min(width, height) / 2)));
}

/** Colonnes [début, fin[ couvertes par la ligne `row` d’un rectangle arrondi, ou `null` hors de la forme. */
export function roundedSpan(row: number, width: number, height: number, radius: number): Span | null {
  if (row < 0 || row >= height || width <= 0) return null;
  const r = clampRadius(radius, width, height);
  if (r === 0) return [0, width];
  let dy = -1;
  if (row < r) dy = r - row - 0.5;
  else if (row >= height - r) dy = row + 0.5 - (height - r);
  if (dy < 0) return [0, width];
  const limit = (r - 0.5) ** 2;
  for (let col = 0; col < r; col++) {
    const dx = r - col - 0.5;
    if (dx * dx + dy * dy <= limit) return [col, width - col];
  }
  return [r, width - r];
}

/** Rayon intérieur d’un anneau : un pixel de coin reste plein, comme la bordure arrondie de mc-rs. */
function innerRadius(radius: number, thickness: number): number {
  return radius > 0 ? Math.max(1, radius - thickness + 1) : 0;
}

/** Portées de l’anneau d’épaisseur `thickness` sur la ligne `row` (zéro, une ou deux). */
function ringSpans(row: number, width: number, height: number, radius: number, thickness: number): Span[] {
  const outer = roundedSpan(row, width, height, radius);
  if (!outer) return [];
  if (thickness <= 0) return [];
  const inner = roundedSpan(row - thickness, width - 2 * thickness, height - 2 * thickness, innerRadius(radius, thickness));
  if (!inner) return [outer];
  const start = inner[0] + thickness;
  const end = inner[1] + thickness;
  const spans: Span[] = [];
  if (start > outer[0]) spans.push([outer[0], start]);
  if (outer[1] > end) spans.push([end, outer[1]]);
  return spans;
}

/** `span` privé de `hole` (zéro, une ou deux portées). */
function subtract(span: Span, hole: Span | null): Span[] {
  if (!hole || hole[1] <= span[0] || hole[0] >= span[1]) return [span];
  const pieces: Span[] = [];
  if (hole[0] > span[0]) pieces.push([span[0], hole[0]]);
  if (hole[1] < span[1]) pieces.push([hole[1], span[1]]);
  return pieces;
}

/** Remplit un rectangle arrondi, une couleur par ligne. */
function fillRounded(
  painter: Painter,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  colorOf: (row: number) => Rgba,
) {
  for (let row = 0; row < height; row++) {
    const span = roundedSpan(row, width, height, radius);
    if (span) painter.fill(x + span[0], y + row, span[1] - span[0], 1, colorOf(row));
  }
}

function strokeRounded(
  painter: Painter,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  thickness: number,
  color: Rgba,
) {
  for (let row = 0; row < height; row++) {
    for (const [from, to] of ringSpans(row, width, height, radius, thickness)) painter.fill(x + from, y + row, to - from, 1, color);
  }
}

/** Ombre portée : la forme décalée de `depth` pixels vers le bas, là où la forme elle-même ne passe pas. */
function dropShadow(painter: Painter, x: number, y: number, width: number, bodyHeight: number, radius: number, depth: number) {
  if (depth <= 0) return;
  for (let row = depth; row < bodyHeight + depth; row++) {
    const shadow = roundedSpan(row - depth, width, bodyHeight, radius);
    if (!shadow) continue;
    for (const [from, to] of subtract(shadow, roundedSpan(row, width, bodyHeight, radius))) {
      painter.fill(x + from, y + row, to - from, 1, SHADOW);
    }
  }
}

/* Couleurs */

function mixColors(from: Rgba, to: Rgba, amount: number): Rgba {
  const blend = (a: number, b: number) => Math.round(a + (b - a) * amount);
  return { r: blend(from.r, to.r), g: blend(from.g, to.g), b: blend(from.b, to.b), a: blend(from.a, to.a) };
}

const opaque = (color: Rgba): Rgba => ({ ...color, a: 255 });

/** Accent « plus chaud » de l’état pressé : l’or de mc-rs (255, 217, 51) donne son orange (255, 154, 30). */
export function warmAccent(accent: Rgba): Rgba {
  return { r: accent.r, g: Math.round(accent.g * 0.71), b: Math.round(accent.b * 0.59), a: 255 };
}

/* Styles */

/**
 * Dessine un élément de la famille mc-rs. `hexColor` est la couleur de base ;
 * `options` porte les paramètres propres à la famille (rayon, bordure, état…).
 */
export function paintMcrsStyle(
  painter: Painter,
  style: McrsStyle,
  x: number,
  y: number,
  width: number,
  height: number,
  hexColor: string,
  options: McrsOptions = {},
) {
  const w = Math.round(width);
  const h = Math.round(height);
  if (w <= 0 || h <= 0) return;
  const color = parseColor(hexColor);
  const radius = mcrsNumber(style, options, 'radius');
  const thickness = mcrsNumber(style, options, 'borderWidth');
  const accent = parseColor(options.accent ?? MCRS_COLORS.gold);
  const state = options.state ?? 'normal';
  const borderOverride = options.borderColor ? parseColor(options.borderColor) : null;

  switch (style) {
    case 'mcrs_panel': {
      const depth = Math.min(mcrsNumber(style, options, 'shadow'), h - 1);
      const body = h - depth;
      dropShadow(painter, x, y, w, body, radius, depth);
      fillRounded(painter, x, y, w, body, radius, () => color);
      strokeRounded(painter, x, y, w, body, radius, thickness, borderOverride ?? opaque(lighten(color, 0.13)));
      break;
    }
    case 'mcrs_border':
      strokeRounded(painter, x, y, w, h, radius, Math.max(1, thickness), color);
      break;
    case 'mcrs_button': {
      // generate_assets.py : fond (30, 30, 46, 230) et bordure (60, 60, 80) ; survol plus clair, bordure or ;
      // pressé : or assombri, bordure orange.
      const depth = Math.min(mcrsNumber(style, options, 'shadow'), h - 1);
      const body = h - depth;
      let fill = color;
      let border = borderOverride ?? opaque(lighten(color, 0.13));
      if (state === 'hover') {
        fill = { ...lighten(color, 0.12), a: Math.min(255, color.a + 20) };
        border = accent;
      } else if (state === 'pressed') {
        fill = opaque(darken(accent, 0.7));
        border = warmAccent(accent);
      }
      dropShadow(painter, x, y, w, body, radius, depth);
      fillRounded(painter, x, y, w, body, radius, () => fill);
      strokeRounded(painter, x, y, w, body, radius, thickness, border);
      break;
    }
    case 'mcrs_raised': {
      // Bouton en relief : reflet d’un pixel en haut, dégradé vers le bas, lèvre sombre, ombre portée.
      // Pressé : le corps descend dans son ombre.
      const depth = Math.min(mcrsNumber(style, options, 'shadow'), h - 2);
      const body = h - depth;
      const top = state === 'pressed' ? y + depth : y;
      const base = state === 'hover' ? lighten(color, 0.08) : state === 'pressed' ? darken(color, 0.12) : color;
      const highlight = lighten(base, 0.3);
      const lip = darken(base, 0.42);
      const low = darken(base, 0.15);
      if (state !== 'pressed') dropShadow(painter, x, y, w, body, radius, depth);
      fillRounded(painter, x, top, w, body, radius, (row) => {
        if (row === 0) return highlight;
        if (row === body - 1 && body > 2) return lip;
        return mixColors(base, low, body > 3 ? (row - 1) / (body - 3) : 0);
      });
      if (state === 'hover') strokeRounded(painter, x, top, w, body, radius, Math.max(1, thickness), accent);
      else if (thickness > 0) strokeRounded(painter, x, top, w, body, radius, thickness, borderOverride ?? opaque(lip));
      break;
    }
    case 'mcrs_strip': {
      // Bande or ou orange : reflet et ombre d’un pixel dès 3 pixels de haut.
      const highlight = lighten(color, 0.35);
      const shade = darken(color, 0.3);
      fillRounded(painter, x, y, w, h, radius, (row) => {
        if (h < 3) return color;
        return row === 0 ? highlight : row === h - 1 ? shade : color;
      });
      break;
    }
    case 'mcrs_slot': {
      // Case creusée : fond uni, ombre en haut à gauche, reflet en bas à droite (coupure en diagonale).
      fillRounded(painter, x, y, w, h, radius, () => color);
      const dark = opaque(darken(color, 0.45));
      const light = opaque(lighten(color, 0.12));
      for (let row = 0; row < h; row++) {
        const split = Math.floor((w + h - 2) / 2 - row) + 1;
        for (const [from, to] of ringSpans(row, w, h, radius, 1)) {
          const cut = Math.max(from, Math.min(to, split));
          if (cut > from) painter.fill(x + from, y + row, cut - from, 1, dark);
          if (to > cut) painter.fill(x + cut, y + row, to - cut, 1, light);
        }
      }
      break;
    }
    case 'mcrs_grid': {
      // Grille de chargement : damier de cases séparées par des lignes d’un pixel.
      const tile = Math.max(2, Math.min(64, Math.round(options.tile ?? DEFAULT_TILE)));
      const line = borderOverride ?? darken(color, 0.35);
      const alternate = lighten(color, 0.12);
      for (let row = 0; row < h; row++) {
        const span = roundedSpan(row, w, h, radius);
        if (!span) continue;
        if (row % tile === 0 || row === h - 1) {
          painter.fill(x + span[0], y + row, span[1] - span[0], 1, line);
          continue;
        }
        for (let start = 0; start < w; start += tile) {
          const tileColor = (Math.floor(start / tile) + Math.floor(row / tile)) % 2 === 0 ? color : alternate;
          const pieces: Array<[number, number, Rgba]> = [
            [start, start + 1, line],
            [start + 1, Math.min(w - 1, start + tile), tileColor],
          ];
          if (start + tile >= w) pieces.push([w - 1, w, line]);
          for (const [from, to, fill] of pieces) {
            const left = Math.max(from, span[0]);
            const right = Math.min(to, span[1]);
            if (right > left) painter.fill(x + left, y + row, right - left, 1, fill);
          }
        }
      }
      break;
    }
  }
}

export const MCRS_PRESETS: Array<{ label: string; spec: GeneratorSpec }> = [
  {
    label: 'Panneau mc-rs',
    spec: { style: 'mcrs_panel', width: 176, height: 127, color: MCRS_COLORS.panel, radius: 2, borderWidth: 1, borderColor: MCRS_COLORS.panelBorder },
  },
  { label: 'Bordure arrondie or', spec: { style: 'mcrs_border', width: 64, height: 32, color: MCRS_COLORS.gold, radius: 2, borderWidth: 1 } },
  { label: 'Bouton mc-rs', spec: { style: 'mcrs_button', width: 34, height: 16, color: MCRS_COLORS.button, state: 'normal' } },
  { label: 'Bouton mc-rs survolé', spec: { style: 'mcrs_button', width: 34, height: 16, color: MCRS_COLORS.button, state: 'hover' } },
  { label: 'Bouton mc-rs pressé', spec: { style: 'mcrs_button', width: 34, height: 16, color: MCRS_COLORS.button, state: 'pressed' } },
  { label: 'Bouton vert en relief', spec: { style: 'mcrs_raised', width: 34, height: 18, color: MCRS_COLORS.green, shadow: 2 } },
  { label: 'Bouton spécial', spec: { style: 'mcrs_raised', width: 52, height: 18, color: MCRS_COLORS.special, shadow: 2 } },
  { label: 'Bouton en relief', spec: { style: 'mcrs_raised', width: 52, height: 18, color: MCRS_COLORS.raised, shadow: 2 } },
  { label: 'Bande or', spec: { style: 'mcrs_strip', width: 160, height: 2, color: MCRS_COLORS.gold } },
  { label: 'Bande orange', spec: { style: 'mcrs_strip', width: 160, height: 4, color: MCRS_COLORS.orange } },
  { label: 'Case sombre', spec: { style: 'mcrs_slot', width: 18, height: 18, color: MCRS_COLORS.slot } },
  { label: 'Grille de chargement', spec: { style: 'mcrs_grid', width: 64, height: 48, color: MCRS_COLORS.grid, tile: 8 } },
];
