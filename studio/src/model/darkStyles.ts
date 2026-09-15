import { darken, lighten, parseColor } from './generator';
import type { DarkStyle, GeneratorSpec } from './menu';
import type { Painter, Rgba } from './painter';

/**
 * Famille « sombre à accent » : fenêtres plates très sombres à cadre fin et
 * coins nets, cases creusées à contour clair sans biseau, onglets et boutons
 * plats, un accent vif (rouge par défaut, vert pour un marché). Dessinée par
 * Menu Forge à partir d’une palette ; aucune image n’est reprise.
 */

export const DARK_COLORS = {
  page: '#181820',
  hollow: '#101018',
  panel: '#282830',
  frame: '#404050',
  band: '#383840',
  accent: '#e83820',
  market: '#58d000',
  text: '#f8f8f8',
  selection: '#6b1f4a',
  muted: '#707080',
} as const;

export const DARK_STYLES: readonly DarkStyle[] = [
  'dark_panel',
  'dark_slot',
  'dark_tab',
  'dark_button',
  'dark_close',
  'dark_awning',
  'dark_row',
  'dark_badge',
  'dark_progress',
];

export function isDarkStyle(style: string): style is DarkStyle {
  return (DARK_STYLES as readonly string[]).includes(style);
}

export const DARK_STYLE_LABELS: Record<DarkStyle, string> = {
  dark_panel: 'Fenêtre plate',
  dark_slot: 'Case creusée',
  dark_tab: 'Onglet plat',
  dark_button: 'Bouton plat',
  dark_close: 'Bouton fermer',
  dark_awning: 'Store rayé',
  dark_row: 'Ligne de liste',
  dark_badge: 'Cartouche de valeur',
  dark_progress: 'Barre de progression',
};

export type DarkParam = 'borderWidth' | 'borderColor' | 'accent' | 'state' | 'shadow' | 'tile' | 'progress';

/** Paramètres lus par chaque style (les autres sont ignorés). */
export const DARK_PARAMS: Record<DarkStyle, readonly DarkParam[]> = {
  dark_panel: ['borderWidth', 'borderColor', 'shadow'],
  dark_slot: ['borderWidth', 'borderColor'],
  dark_tab: ['borderColor', 'accent', 'state'],
  dark_button: ['borderWidth', 'borderColor', 'accent', 'state'],
  dark_close: ['borderColor'],
  dark_awning: ['borderColor', 'tile'],
  dark_row: ['borderColor', 'accent', 'state'],
  dark_badge: ['borderWidth', 'accent'],
  dark_progress: ['borderColor', 'accent', 'progress'],
};

const BORDER_DEFAULTS: Partial<Record<DarkStyle, number>> = { dark_slot: 2 };
const SHADOW_DEFAULTS: Partial<Record<DarkStyle, number>> = { dark_panel: 0 };
export const DARK_DEFAULT_TILE = 4;
export const DARK_DEFAULT_PROGRESS = 60;

export type DarkOptions = Pick<GeneratorSpec, DarkParam>;

/** Valeur effective d’un paramètre numérique (défaut du style si absent), bornée. */
export function darkNumber(style: DarkStyle, options: DarkOptions, param: 'borderWidth' | 'shadow' | 'tile' | 'progress'): number {
  switch (param) {
    case 'borderWidth':
      return Math.max(0, Math.min(8, Math.round(options.borderWidth ?? BORDER_DEFAULTS[style] ?? 1)));
    case 'shadow':
      return Math.max(0, Math.min(8, Math.round(options.shadow ?? SHADOW_DEFAULTS[style] ?? 0)));
    case 'tile':
      return Math.max(2, Math.min(64, Math.round(options.tile ?? DARK_DEFAULT_TILE)));
    case 'progress':
      return Math.max(0, Math.min(100, Math.round(options.progress ?? DARK_DEFAULT_PROGRESS)));
  }
}

const opaque = (color: Rgba): Rgba => ({ ...color, a: 255 });

/** Cadre net d’épaisseur `thickness`, côtés choisis (le bas peut rester ouvert). */
export function frame(
  painter: Painter,
  x: number,
  y: number,
  width: number,
  height: number,
  thickness: number,
  color: Rgba,
  bottom = true,
) {
  const t = Math.min(thickness, Math.floor(width / 2), Math.floor(height / 2));
  if (t <= 0) return;
  painter.fill(x, y, width, t, color);
  if (bottom) painter.fill(x, y + height - t, width, t, color);
  const sideHeight = height - t - (bottom ? t : 0);
  painter.fill(x, y + t, t, sideHeight, color);
  painter.fill(x + width - t, y + t, t, sideHeight, color);
}

/** Croix pleine d’épaisseur `thickness`, dans le carré (x, y, size). */
function cross(painter: Painter, x: number, y: number, size: number, thickness: number, color: Rgba) {
  const span = size - thickness + 1;
  for (let step = 0; step < span; step++) {
    painter.fill(x + step, y + step, thickness, thickness, color);
    painter.fill(x + size - thickness - step, y + step, thickness, thickness, color);
  }
}

/**
 * Dessine un élément de la famille « sombre à accent ». `hexColor` est le
 * fond (ou la première bande du store, ou le fond du bouton fermer) ; l’accent
 * colore l’onglet actif, le bouton pressé, la barre et le contour des cartouches.
 */
export function paintDarkStyle(
  painter: Painter,
  style: DarkStyle,
  x: number,
  y: number,
  width: number,
  height: number,
  hexColor: string,
  options: DarkOptions = {},
) {
  const w = Math.round(width);
  const h = Math.round(height);
  if (w <= 0 || h <= 0) return;
  const color = parseColor(hexColor);
  const accent = parseColor(options.accent ?? DARK_COLORS.accent);
  const state = options.state ?? 'normal';
  const active = state !== 'normal';
  const border = options.borderColor ? parseColor(options.borderColor) : null;
  const thickness = darkNumber(style, options, 'borderWidth');

  switch (style) {
    case 'dark_panel': {
      // Fenêtre plate : léger dégradé vertical, cadre fin et net, ombre portée douce facultative.
      const depth = Math.min(darkNumber(style, options, 'shadow'), h - 1);
      const body = h - depth;
      for (let row = 0; row < depth; row++) {
        const alpha = Math.round(110 * (1 - row / depth));
        painter.fill(x + 1 + row, y + body + row, w - 1 - row, 1, { r: 0, g: 0, b: 0, a: alpha });
      }
      const bottom = lighten(color, 0.03);
      for (let row = 0; row < body; row++) {
        const amount = body > 1 ? row / (body - 1) : 0;
        painter.fill(x, y + row, w, 1, {
          r: Math.round(color.r + (bottom.r - color.r) * amount),
          g: Math.round(color.g + (bottom.g - color.g) * amount),
          b: Math.round(color.b + (bottom.b - color.b) * amount),
          a: color.a,
        });
      }
      frame(painter, x, y, w, body, thickness, border ?? opaque(lighten(color, 0.12)));
      break;
    }
    case 'dark_slot':
      // Case creusée : fond uni très sombre, contour clair de 2 px, aucun biseau.
      painter.fill(x, y, w, h, color);
      frame(painter, x, y, w, h, thickness, border ?? opaque(lighten(color, 0.2)));
      break;
    case 'dark_tab':
      // Onglet plat : inactif = fond sombre et cadre fermé ; actif = accent plein, ouvert vers le panneau.
      if (active) {
        painter.fill(x, y, w, h, accent);
        painter.fill(x, y, w, 1, opaque(lighten(accent, 0.2)));
      } else {
        painter.fill(x, y, w, h, color);
        frame(painter, x, y, w, h, 1, border ?? opaque(lighten(color, 0.12)));
      }
      break;
    case 'dark_button': {
      // Bouton plat : normal = sombre à cadre fin ; survol = cadre accent ; pressé = accent plein.
      const fill = state === 'pressed' ? accent : state === 'hover' ? opaque(lighten(color, 0.05)) : color;
      const edge = state === 'pressed' ? opaque(darken(accent, 0.25)) : state === 'hover' ? accent : border ?? opaque(lighten(color, 0.12));
      painter.fill(x, y, w, h, fill);
      frame(painter, x, y, w, h, Math.max(1, thickness), edge);
      break;
    }
    case 'dark_close': {
      // Petit carré à croix claire ; une ligne plus sombre en bas lui donne du relief.
      painter.fill(x, y, w, h, color);
      if (h > 3) painter.fill(x, y + h - 1, w, 1, opaque(darken(color, 0.3)));
      const size = Math.min(w, h);
      const pad = Math.max(1, Math.round(size / 4));
      const inner = size - 2 * pad;
      if (inner > 0) {
        const line = Math.max(1, Math.round(size / 8));
        cross(painter, x + Math.floor((w - inner) / 2), y + Math.floor((h - inner) / 2), inner, Math.min(line, inner), border ?? parseColor(DARK_COLORS.text));
      }
      break;
    }
    case 'dark_awning': {
      // Store rayé : bandes verticales alternées, tringle plus sombre en haut, festons en bas.
      const tile = darkNumber(style, options, 'tile');
      const second = border ?? parseColor(DARK_COLORS.text);
      const scallop = h >= 4;
      for (let start = 0; start < w; start += tile) {
        const stripe = Math.floor(start / tile) % 2 === 0 ? color : second;
        const stripeWidth = Math.min(tile, w - start);
        painter.fill(x + start, y, stripeWidth, scallop ? h - 1 : h, stripe);
        if (scallop && stripeWidth > 2) painter.fill(x + start + 1, y + h - 1, stripeWidth - 2, 1, stripe);
      }
      painter.fill(x, y, w, 1, opaque(darken(color, 0.35)));
      break;
    }
    case 'dark_row': {
      // Ligne de liste : fond sombre et séparateur ; sélectionnée = violet sombre et cadre en sucre d’orge.
      if (active) {
        painter.fill(x, y, w, h, parseColor(DARK_COLORS.selection));
        const light = parseColor(DARK_COLORS.text);
        const dash = (offset: number) => (Math.floor(offset / 2) % 2 === 0 ? accent : light);
        for (let col = 0; col < w; col++) {
          painter.fill(x + col, y, 1, 1, dash(col));
          painter.fill(x + col, y + h - 1, 1, 1, dash(col + h));
        }
        for (let row = 1; row < h - 1; row++) {
          painter.fill(x, y + row, 1, 1, dash(row));
          painter.fill(x + w - 1, y + row, 1, 1, dash(row + w));
        }
      } else {
        painter.fill(x, y, w, h, color);
        painter.fill(x, y + h - 1, w, 1, border ?? opaque(lighten(color, 0.08)));
      }
      break;
    }
    case 'dark_badge':
      // Cartouche de valeur : fond creusé, contour à l’accent.
      painter.fill(x, y, w, h, color);
      frame(painter, x, y, w, h, Math.max(1, thickness), accent);
      break;
    case 'dark_progress': {
      // Barre de progression : rail sombre, cadre fin, remplissage à l’accent avec reflet et ombre.
      painter.fill(x, y, w, h, color);
      frame(painter, x, y, w, h, 1, border ?? opaque(lighten(color, 0.2)));
      const innerWidth = w - 2;
      const innerHeight = h - 2;
      const filled = Math.round((innerWidth * darkNumber(style, options, 'progress')) / 100);
      if (filled > 0 && innerHeight > 0) {
        painter.fill(x + 1, y + 1, filled, innerHeight, accent);
        if (innerHeight >= 3) {
          painter.fill(x + 1, y + 1, filled, 1, opaque(lighten(accent, 0.3)));
          painter.fill(x + 1, y + h - 2, filled, 1, opaque(darken(accent, 0.25)));
        }
      }
      break;
    }
  }
}

export const DARK_PRESETS: Array<{ label: string; spec: GeneratorSpec }> = [
  { label: 'Fenêtre sombre', spec: { style: 'dark_panel', width: 176, height: 127, color: DARK_COLORS.panel, borderWidth: 1 } },
  { label: 'Case creusée', spec: { style: 'dark_slot', width: 18, height: 18, color: DARK_COLORS.hollow } },
  { label: 'Onglet inactif', spec: { style: 'dark_tab', width: 34, height: 16, color: DARK_COLORS.panel } },
  { label: 'Onglet actif', spec: { style: 'dark_tab', width: 34, height: 16, color: DARK_COLORS.panel, state: 'pressed' } },
  { label: 'Bouton sombre', spec: { style: 'dark_button', width: 34, height: 16, color: DARK_COLORS.panel } },
  { label: 'Bouton sombre pressé', spec: { style: 'dark_button', width: 34, height: 16, color: DARK_COLORS.panel, state: 'pressed' } },
  { label: 'Bouton fermer', spec: { style: 'dark_close', width: 16, height: 16, color: DARK_COLORS.accent } },
  { label: 'Store rayé', spec: { style: 'dark_awning', width: 172, height: 6, color: DARK_COLORS.accent, tile: 4 } },
  { label: 'Store rayé (marché)', spec: { style: 'dark_awning', width: 172, height: 6, color: DARK_COLORS.market, tile: 4 } },
  { label: 'Ligne de liste', spec: { style: 'dark_row', width: 162, height: 18, color: DARK_COLORS.hollow } },
  { label: 'Ligne sélectionnée', spec: { style: 'dark_row', width: 162, height: 18, color: DARK_COLORS.hollow, state: 'pressed' } },
  { label: 'Cartouche de solde', spec: { style: 'dark_badge', width: 40, height: 12, color: DARK_COLORS.hollow, accent: DARK_COLORS.market } },
  { label: 'Barre de progression', spec: { style: 'dark_progress', width: 80, height: 6, color: DARK_COLORS.hollow, progress: 60 } },
];
