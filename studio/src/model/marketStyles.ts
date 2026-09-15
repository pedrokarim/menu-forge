import { DARK_COLORS, frame, paintDarkStyle } from './darkStyles';
import { darken, lighten, parseColor, readableColor, toHex } from './generator';
import type { GeneratorSpec, MarketStyle } from './menu';
import type { Painter, Rgba } from './painter';
import { paintIcon } from './pixelIcons';

/**
 * Famille « Marché » : les éléments des écrans d’économie (hôtel des ventes, bourse, boutiques), dans la
 * palette de « sombre à accent » : étiquette de prix à pièce, cadre de graphe, sélecteur de quantité,
 * champ de recherche, ligne de carnet d’ordres, carte d’annonce, temps restant. Dessinée par Menu Forge ;
 * aucune image n’est reprise.
 */

export const MARKET_COLORS = {
  hollow: DARK_COLORS.hollow,
  panel: DARK_COLORS.panel,
  gold: '#f0b429',
  up: '#58d000',
  down: '#e83820',
  text: DARK_COLORS.text,
  muted: '#9a9aa8',
} as const;

export const MARKET_STYLES: readonly MarketStyle[] = [
  'market_price',
  'market_chart',
  'market_stepper',
  'market_search',
  'market_depth',
  'market_listing',
  'market_timer',
];

export function isMarketStyle(style: string): style is MarketStyle {
  return (MARKET_STYLES as readonly string[]).includes(style);
}

export const MARKET_STYLE_LABELS: Record<MarketStyle, string> = {
  market_price: 'Étiquette de prix',
  market_chart: 'Cadre de graphe',
  market_stepper: 'Sélecteur de quantité',
  market_search: 'Champ de recherche',
  market_depth: 'Ligne de carnet d’ordres',
  market_listing: 'Carte d’annonce',
  market_timer: 'Temps restant',
};

export type MarketParam = 'borderWidth' | 'borderColor' | 'accent' | 'state' | 'tile' | 'progress';

/** Paramètres lus par chaque style (les autres sont ignorés). */
export const MARKET_PARAMS: Record<MarketStyle, readonly MarketParam[]> = {
  market_price: ['borderColor', 'accent'],
  market_chart: ['borderColor', 'accent', 'tile'],
  market_stepper: ['borderColor', 'accent', 'state'],
  market_search: ['borderColor', 'accent', 'state'],
  market_depth: ['borderColor', 'accent', 'progress'],
  market_listing: ['borderColor', 'accent', 'state'],
  market_timer: ['borderColor', 'accent', 'progress'],
};

const ACCENT_DEFAULTS: Record<MarketStyle, string> = {
  market_price: MARKET_COLORS.gold,
  market_chart: MARKET_COLORS.up,
  market_stepper: DARK_COLORS.accent,
  market_search: MARKET_COLORS.gold,
  market_depth: MARKET_COLORS.up,
  market_listing: MARKET_COLORS.gold,
  market_timer: MARKET_COLORS.gold,
};

const TILE_DEFAULTS: Partial<Record<MarketStyle, number>> = { market_chart: 12 };
const PROGRESS_DEFAULTS: Partial<Record<MarketStyle, number>> = { market_depth: 60, market_timer: 40 };

export function marketAccent(style: MarketStyle): string {
  return ACCENT_DEFAULTS[style];
}

export type MarketOptions = Pick<GeneratorSpec, MarketParam>;

/** Valeur effective d’un paramètre numérique (défaut du style si absent), bornée. */
export function marketNumber(style: MarketStyle, options: MarketOptions, param: 'borderWidth' | 'tile' | 'progress'): number {
  switch (param) {
    case 'borderWidth':
      return Math.max(0, Math.min(8, Math.round(options.borderWidth ?? 1)));
    case 'tile':
      return Math.max(2, Math.min(64, Math.round(options.tile ?? TILE_DEFAULTS[style] ?? 8)));
    case 'progress':
      return Math.max(0, Math.min(100, Math.round(options.progress ?? PROGRESS_DEFAULTS[style] ?? 50)));
  }
}

const opaque = (color: Rgba): Rgba => ({ ...color, a: 255 });

/** Mélange opaque de deux couleurs (`amount` = part de `top`). */
function blend(bottom: Rgba, top: Rgba, amount: number): Rgba {
  return {
    r: Math.round(bottom.r + (top.r - bottom.r) * amount),
    g: Math.round(bottom.g + (top.g - bottom.g) * amount),
    b: Math.round(bottom.b + (top.b - bottom.b) * amount),
    a: 255,
  };
}

/**
 * Pièce de `size` px de diamètre : bord foncé, dégradé vertical du clair au plus soutenu, reflet en haut à
 * gauche, fente centrale quand la pièce est assez grande.
 */
export function paintCoin(painter: Painter, x: number, y: number, size: number, gold: Rgba) {
  const radius = size / 2;
  const rim = opaque(darken(gold, 0.4));
  const top = opaque(lighten(gold, 0.3));
  const bottom = opaque(darken(gold, 0.12));
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const dx = col + 0.5 - radius;
      const dy = row + 0.5 - radius;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > radius) continue;
      const color = distance > radius - 1.1 ? rim : blend(top, bottom, size > 1 ? row / (size - 1) : 0);
      painter.fill(x + col, y + row, 1, 1, color);
    }
  }
  if (size >= 5) painter.fill(x + Math.floor(size / 3), y + Math.floor(size / 3) - (size >= 8 ? 1 : 0), 1, 1, opaque(lighten(gold, 0.65)));
  if (size >= 7) {
    const slot = Math.max(2, Math.round(size / 3));
    painter.fill(x + Math.floor((size - 1) / 2) + (size % 2 === 0 ? 1 : 0), y + Math.floor((size - slot) / 2), 1, slot, rim);
  }
}

/** Trait horizontal ou vertical centré, d’épaisseur `thickness` (signes − et +). */
function sign(painter: Painter, x: number, y: number, size: number, plus: boolean, color: Rgba) {
  const thickness = Math.max(1, Math.round(size / 8));
  const length = Math.max(3, Math.round(size / 2));
  const left = x + Math.floor((size - length) / 2);
  const middle = y + Math.floor((size - thickness) / 2);
  painter.fill(left, middle, length, thickness, color);
  if (plus) painter.fill(x + Math.floor((size - thickness) / 2), y + Math.floor((size - length) / 2), thickness, length, color);
}

/**
 * Dessine un élément de la famille « Marché ». `hexColor` est le fond ; l’accent colore la pièce, la ligne
 * de base du graphe, le bouton pressé, le champ actif, la barre de profondeur, la bande de rareté et la
 * barre du temps restant.
 */
export function paintMarketStyle(
  painter: Painter,
  style: MarketStyle,
  x: number,
  y: number,
  width: number,
  height: number,
  hexColor: string,
  options: MarketOptions = {},
) {
  const w = Math.round(width);
  const h = Math.round(height);
  if (w <= 0 || h <= 0) return;
  const color = parseColor(hexColor);
  const accent = parseColor(options.accent ?? ACCENT_DEFAULTS[style]);
  const state = options.state ?? 'normal';
  const border = options.borderColor ? parseColor(options.borderColor) : null;
  const edge = border ?? opaque(lighten(color, 0.12));

  switch (style) {
    case 'market_price': {
      // Étiquette de prix : cartouche creusée, pièce à gauche, place du montant à droite.
      painter.fill(x, y, w, h, color);
      frame(painter, x, y, w, h, 1, edge);
      // Même marge à gauche qu’en haut et en bas : la pièce est centrée dans un carré de la hauteur.
      const size = Math.max(3, Math.min(h - 4, 9));
      const inset = Math.floor((h - size) / 2);
      paintCoin(painter, x + inset, y + inset, size, accent);
      break;
    }
    case 'market_chart': {
      // Cadre de graphe : fond creusé, lignes horizontales en pointillé tous les `tile` px depuis le bas,
      // repères sur le bord gauche, lignes verticales plus discrètes, ligne de base à l’accent.
      painter.fill(x, y, w, h, color);
      frame(painter, x, y, w, h, 1, edge);
      const tile = marketNumber(style, options, 'tile');
      const base = y + h - 2;
      const grid = opaque(lighten(color, 0.1));
      const faint = opaque(lighten(color, 0.05));
      for (let column = x + 1 + tile * 2; column < x + w - 1; column += tile * 2) {
        for (let row = y + 1; row < base; row += 2) painter.fill(column, row, 1, 1, faint);
      }
      for (let row = base - tile; row > y + 1; row -= tile) {
        for (let column = x + 3; column < x + w - 1; column += 2) painter.fill(column, row, 1, 1, grid);
        painter.fill(x + 1, row, 2, 1, opaque(lighten(color, 0.28)));
      }
      if (h > 3) painter.fill(x + 1, base, w - 2, 1, opaque(darken(accent, 0.3)));
      break;
    }
    case 'market_stepper': {
      // Sélecteur de quantité : [−] creux [+]. Survol : cadres à l’accent ; pressé : boutons à l’accent.
      const button = Math.max(3, Math.min(h, Math.floor(w / 3)));
      painter.fill(x, y, w, h, color);
      frame(painter, x, y, w, h, 1, edge);
      const buttonFill = state === 'pressed' ? accent : opaque(lighten(color, 0.08));
      const buttonEdge = state === 'normal' ? border ?? opaque(lighten(color, 0.22)) : state === 'hover' ? accent : opaque(darken(accent, 0.25));
      const glyph = parseColor(readableColor(toHex(buttonFill), MARKET_COLORS.text, ['#202020']));
      for (const [left, plus] of [[x, false], [x + w - button, true]] as const) {
        painter.fill(left, y, button, h, buttonFill);
        frame(painter, left, y, button, h, 1, buttonEdge);
        sign(painter, left, y + Math.floor((h - button) / 2), button, plus, glyph);
      }
      break;
    }
    case 'market_search': {
      // Champ de recherche : loupe à gauche ; actif (survol ou pressé) : cadre et loupe à l’accent, curseur.
      const active = state !== 'normal';
      painter.fill(x, y, w, h, color);
      frame(painter, x, y, w, h, 1, active ? accent : edge);
      // Loupe à 2 px du cadre (gauche et haut), centrée en hauteur ; curseur 4 px après la loupe.
      const inset = Math.max(2, Math.floor((h - 8) / 2));
      paintIcon(painter, 'search', x + inset, y + Math.floor((h - 8) / 2), 8, 8, active ? toHex(accent) : MARKET_COLORS.muted);
      if (active && h >= 7 && w > inset + 14) painter.fill(x + inset + 8 + 4, y + 3, 1, h - 6, parseColor(MARKET_COLORS.text));
      break;
    }
    case 'market_depth': {
      // Ligne de carnet d’ordres : fond, séparateur, barre de profondeur depuis la droite (vert : achat,
      // rouge : vente), plus soutenue sur son bord.
      painter.fill(x, y, w, h, color);
      painter.fill(x, y + h - 1, w, 1, border ?? opaque(lighten(color, 0.08)));
      const filled = Math.round((w * marketNumber(style, options, 'progress')) / 100);
      const barHeight = Math.max(1, h - 2);
      if (filled > 0) {
        painter.fill(x + w - filled, y, filled, barHeight, blend(color, accent, 0.28));
        painter.fill(x + w - filled, y, 1, barHeight, blend(color, accent, 0.75));
      }
      break;
    }
    case 'market_listing': {
      // Carte d’annonce : bande de rareté à l’accent, case de l’objet, séparateur, place du nom et du prix.
      // Pressé ou survolé : cadre à l’accent (carte choisie).
      painter.fill(x, y, w, h, color);
      frame(painter, x, y, w, h, 1, state === 'normal' ? edge : accent);
      if (h > 2) painter.fill(x + 1, y + 1, Math.min(2, w - 2), h - 2, accent);
      if (w >= 28 && h >= 20) {
        const slotY = y + Math.floor((h - 18) / 2);
        // 2 px entre la bande de rareté et la case, 2 px entre la case et le séparateur.
        paintDarkStyle(painter, 'dark_slot', x + 5, slotY, 18, 18, MARKET_COLORS.hollow, { borderWidth: 1 });
        painter.fill(x + 25, y + 3, 1, h - 6, opaque(lighten(color, 0.08)));
      }
      break;
    }
    case 'market_timer': {
      // Temps restant : horloge à gauche, barre fine en bas (part du temps qui reste).
      painter.fill(x, y, w, h, color);
      frame(painter, x, y, w, h, 1, edge);
      // Horloge : 2 px sous le cadre et à gauche, 1 px au-dessus de la barre du bas.
      paintIcon(painter, 'clock', x + 2, y + 2, 8, Math.max(8, h - 5), MARKET_COLORS.muted);
      if (h >= 5 && w > 2) {
        const inner = w - 2;
        const filled = Math.round((inner * marketNumber(style, options, 'progress')) / 100);
        painter.fill(x + 1, y + h - 2, inner, 1, opaque(lighten(color, 0.08)));
        if (filled > 0) painter.fill(x + 1, y + h - 2, filled, 1, accent);
      }
      break;
    }
  }
}

export const MARKET_PRESETS: Array<{ label: string; spec: GeneratorSpec }> = [
  { label: 'Prix (petit)', spec: { style: 'market_price', width: 40, height: 12, color: MARKET_COLORS.hollow } },
  { label: 'Prix (grand)', spec: { style: 'market_price', width: 64, height: 16, color: MARKET_COLORS.hollow } },
  { label: 'Pastille de hausse', spec: { style: 'dark_badge', width: 13, height: 13, color: '#14240c', accent: MARKET_COLORS.up, icon: 'trend_up', iconColor: '#8ef04a' } },
  { label: 'Pastille de baisse', spec: { style: 'dark_badge', width: 13, height: 13, color: '#2a1010', accent: MARKET_COLORS.down, icon: 'trend_down', iconColor: '#ff8a70' } },
  { label: 'Graphe de cours (158 × 82)', spec: { style: 'market_chart', width: 158, height: 82, color: MARKET_COLORS.hollow, tile: 12 } },
  { label: 'Petit graphe', spec: { style: 'market_chart', width: 70, height: 34, color: MARKET_COLORS.hollow, tile: 8 } },
  { label: 'Sélecteur de quantité', spec: { style: 'market_stepper', width: 52, height: 16, color: MARKET_COLORS.hollow } },
  { label: 'Sélecteur de quantité pressé', spec: { style: 'market_stepper', width: 52, height: 16, color: MARKET_COLORS.hollow, state: 'pressed', accent: MARKET_COLORS.up } },
  { label: 'Champ de recherche', spec: { style: 'market_search', width: 90, height: 14, color: MARKET_COLORS.hollow } },
  { label: 'Champ de recherche actif', spec: { style: 'market_search', width: 90, height: 14, color: MARKET_COLORS.hollow, state: 'hover' } },
  { label: 'Ordre d’achat (carnet)', spec: { style: 'market_depth', width: 80, height: 10, color: MARKET_COLORS.hollow, accent: MARKET_COLORS.up, progress: 70 } },
  { label: 'Ordre de vente (carnet)', spec: { style: 'market_depth', width: 80, height: 10, color: MARKET_COLORS.hollow, accent: MARKET_COLORS.down, progress: 35 } },
  { label: 'Carte d’annonce', spec: { style: 'market_listing', width: 80, height: 24, color: MARKET_COLORS.panel } },
  { label: 'Carte d’annonce rare', spec: { style: 'market_listing', width: 80, height: 24, color: MARKET_COLORS.panel, accent: '#b070ff', state: 'pressed' } },
  { label: 'Temps restant', spec: { style: 'market_timer', width: 44, height: 14, color: MARKET_COLORS.hollow, progress: 35 } },
  { label: 'Bouton acheter', spec: { style: 'dark_button', width: 16, height: 16, color: '#1c3410', accent: MARKET_COLORS.up, icon: 'coin', iconColor: MARKET_COLORS.gold } },
  { label: 'Bouton enchérir', spec: { style: 'dark_button', width: 16, height: 16, color: DARK_COLORS.panel, icon: 'auction' } },
  { label: 'Bouton retrait', spec: { style: 'dark_button', width: 16, height: 16, color: DARK_COLORS.panel, icon: 'withdraw' } },
];
