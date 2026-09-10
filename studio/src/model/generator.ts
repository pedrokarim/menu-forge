import { SLOT_SIZE, chestCell } from './geometry';
import type { Point } from './geometry';
import type { GeneratorSpec, PanelStyle } from './menu';

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Lit `#rgb`, `#rgba`, `#rrggbb` ou `#rrggbbaa`. */
export function parseColor(hex: string): Rgba {
  const clean = hex.trim().replace(/^#/, '');
  const full = clean.length <= 4 ? [...clean].map((char) => char + char).join('') : clean;
  const channel = (index: number) => {
    const value = parseInt(full.slice(index, index + 2), 16);
    return Number.isNaN(value) ? 0 : value;
  };
  return { r: channel(0), g: channel(2), b: channel(4), a: full.length >= 8 ? channel(6) : 255 };
}

function mix(color: Rgba, target: number, amount: number): Rgba {
  const blend = (value: number) => Math.round(value + (target - value) * amount);
  return { r: blend(color.r), g: blend(color.g), b: blend(color.b), a: color.a };
}

const lighten = (color: Rgba, amount: number) => mix(color, 255, amount);
const darken = (color: Rgba, amount: number) => mix(color, 0, amount);

function css(color: Rgba): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;
}

interface BevelOptions {
  border?: Rgba;
  light: Rgba;
  dark: Rgba;
  bevel: number;
  cutCorners: boolean;
}

/** Rectangle biseauté : bordure, reflet en haut à gauche, ombre en bas à droite. */
function drawBevel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: Rgba,
  options: BevelOptions,
) {
  let innerX = x;
  let innerY = y;
  let innerWidth = width;
  let innerHeight = height;

  if (options.border) {
    const inset = options.cutCorners ? 1 : 0;
    ctx.fillStyle = css(options.border);
    ctx.fillRect(x + inset, y, width - 2 * inset, 1);
    ctx.fillRect(x + inset, y + height - 1, width - 2 * inset, 1);
    ctx.fillRect(x, y + inset, 1, height - 2 * inset);
    ctx.fillRect(x + width - 1, y + inset, 1, height - 2 * inset);
    innerX += 1;
    innerY += 1;
    innerWidth -= 2;
    innerHeight -= 2;
  }

  ctx.fillStyle = css(fill);
  ctx.fillRect(innerX, innerY, innerWidth, innerHeight);

  for (let step = 0; step < options.bevel; step++) {
    const span = innerWidth - 2 * step - 1;
    const tall = innerHeight - 2 * step - 1;
    if (span <= 0 || tall <= 0) break;
    ctx.fillStyle = css(options.light);
    ctx.fillRect(innerX + step, innerY + step, span, 1);
    ctx.fillRect(innerX + step, innerY + step, 1, tall);
    ctx.fillStyle = css(options.dark);
    ctx.fillRect(innerX + step + 1, innerY + innerHeight - 1 - step, span, 1);
    ctx.fillRect(innerX + innerWidth - 1 - step, innerY + step + 1, 1, tall);
  }
}

/** Dessine un élément d’un style donné ; partagé avec la toile du studio. */
export function drawPanelStyle(
  ctx: CanvasRenderingContext2D,
  style: PanelStyle,
  x: number,
  y: number,
  width: number,
  height: number,
  hexColor: string,
) {
  const color = parseColor(hexColor);
  switch (style) {
    case 'panel':
      drawBevel(ctx, x, y, width, height, color, {
        border: { r: 0, g: 0, b: 0, a: 255 },
        light: lighten(color, 1),
        dark: darken(color, 0.57),
        bevel: 2,
        cutCorners: true,
      });
      break;
    case 'button':
      drawBevel(ctx, x, y, width, height, color, {
        border: darken(color, 0.6),
        light: lighten(color, 0.35),
        dark: darken(color, 0.25),
        bevel: 1,
        cutCorners: true,
      });
      break;
    case 'cell':
      drawBevel(ctx, x, y, width, height, color, {
        light: darken(color, 0.6),
        dark: lighten(color, 1),
        bevel: 1,
        cutCorners: false,
      });
      break;
    case 'veil':
    case 'flat':
      ctx.fillStyle = css(color);
      ctx.fillRect(x, y, width, height);
      break;
  }
}

/**
 * Rend une texture générée. `origin` = position de la couche dans la fenêtre :
 * les cellules demandées sont dessinées à leur place exacte dans la grille.
 */
export function renderGenerator(spec: GeneratorSpec, origin: Point): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(spec.width));
  canvas.height = Math.max(1, Math.round(spec.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  drawPanelStyle(ctx, spec.style, 0, 0, canvas.width, canvas.height, spec.color);

  for (const area of spec.cells ?? []) {
    for (let dx = 0; dx < (area.width ?? 1); dx++) {
      for (let dy = 0; dy < (area.height ?? 1); dy++) {
        const cell = chestCell(area.col + dx, area.row + dy);
        drawPanelStyle(
          ctx,
          'cell',
          cell.x - origin.x,
          cell.y - origin.y,
          SLOT_SIZE,
          SLOT_SIZE,
          spec.cellColor ?? '#8b8b8b',
        );
      }
    }
  }
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Échec de l’export PNG'))),
      'image/png',
    );
  });
}

export const GENERATOR_PRESETS: Array<{ label: string; spec: GeneratorSpec }> = [
  { label: 'Panneau vanilla', spec: { style: 'panel', width: 176, height: 127, color: '#c6c6c6' } },
  { label: 'Bouton bleu', spec: { style: 'button', width: 34, height: 34, color: '#3b8fd6' } },
  { label: 'Bouton vert', spec: { style: 'button', width: 34, height: 34, color: '#52a535' } },
  { label: 'Bouton orange', spec: { style: 'button', width: 34, height: 16, color: '#e0892b' } },
  { label: 'Bouton rouge', spec: { style: 'button', width: 34, height: 16, color: '#d04545' } },
  { label: 'Bouton gris', spec: { style: 'button', width: 16, height: 16, color: '#9a9a9a' } },
  { label: 'Cellule de slot', spec: { style: 'cell', width: 18, height: 18, color: '#8b8b8b' } },
  { label: 'Voile de modale', spec: { style: 'veil', width: 176, height: 222, color: '#00000088' } },
  { label: 'Aplat sombre', spec: { style: 'flat', width: 72, height: 72, color: '#3a3a3a' } },
];

export const PANEL_STYLE_LABELS: Record<PanelStyle, string> = {
  panel: 'Panneau biseauté',
  button: 'Bouton',
  cell: 'Cellule de slot',
  veil: 'Voile (avec alpha)',
  flat: 'Aplat',
};
