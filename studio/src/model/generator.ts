import type { GeneratorSpec, PanelStyle } from './menu';
import { canvasPainter } from './painter';
import type { Painter, Rgba } from './painter';

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

/** Éclaircit vers le blanc (`amount` de 0 à 1), alpha inchangé. */
export const lighten = (color: Rgba, amount: number) => mix(color, 255, amount);
/** Assombrit vers le noir (`amount` de 0 à 1), alpha inchangé. */
export const darken = (color: Rgba, amount: number) => mix(color, 0, amount);

/** `#rrggbb` d’une couleur (alpha ignoré). */
export function toHex(color: Rgba): string {
  return `#${[color.r, color.g, color.b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/** Couleur `top` posée sur un fond opaque `bottom` (résultat opaque). */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const alpha = top.a / 255;
  const blend = (a: number, b: number) => Math.round(a * alpha + b * (1 - alpha));
  return { r: blend(top.r, bottom.r), g: blend(top.g, bottom.g), b: blend(top.b, bottom.b), a: 255 };
}

/** Luminance relative WCAG 2 (0 = noir, 1 = blanc). */
export function relativeLuminance(color: Rgba): number {
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

/** Rapport de contraste WCAG 2 entre deux couleurs (de 1 à 21). */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(parseColor(a));
  const second = relativeLuminance(parseColor(b));
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/**
 * Contraste minimal d’un libellé ou d’une icône sur son bouton : 3:1, le seuil
 * WCAG des composants d’interface et du grand texte (la police vanilla est
 * affichée au moins ×2).
 */
export const MIN_LABEL_CONTRAST = 3;

/**
 * Couleur lisible sur `background` : `preferred` s’il atteint `minimum`, sinon
 * la plus contrastée de `preferred` et des `alternatives` (une claire, une foncée).
 */
export function readableColor(background: string, preferred: string, alternatives: readonly string[], minimum = MIN_LABEL_CONTRAST): string {
  if (contrastRatio(background, preferred) >= minimum) return preferred;
  return [preferred, ...alternatives].reduce((best, candidate) =>
    contrastRatio(background, candidate) > contrastRatio(background, best) ? candidate : best,
  );
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
  painter: Painter,
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
    painter.fill(x + inset, y, width - 2 * inset, 1, options.border);
    painter.fill(x + inset, y + height - 1, width - 2 * inset, 1, options.border);
    painter.fill(x, y + inset, 1, height - 2 * inset, options.border);
    painter.fill(x + width - 1, y + inset, 1, height - 2 * inset, options.border);
    innerX += 1;
    innerY += 1;
    innerWidth -= 2;
    innerHeight -= 2;
  }

  painter.fill(innerX, innerY, innerWidth, innerHeight, fill);

  for (let step = 0; step < options.bevel; step++) {
    const span = innerWidth - 2 * step - 1;
    const tall = innerHeight - 2 * step - 1;
    if (span <= 0 || tall <= 0) break;
    painter.fill(innerX + step, innerY + step, span, 1, options.light);
    painter.fill(innerX + step, innerY + step, 1, tall, options.light);
    painter.fill(innerX + step + 1, innerY + innerHeight - 1 - step, span, 1, options.dark);
    painter.fill(innerX + innerWidth - 1 - step, innerY + step + 1, 1, tall, options.dark);
  }
}

/** Dessine un élément d’un style donné sur un contexte 2D ; partagé avec la toile du studio. */
export function drawPanelStyle(
  ctx: CanvasRenderingContext2D,
  style: PanelStyle,
  x: number,
  y: number,
  width: number,
  height: number,
  hexColor: string,
) {
  paintPanelStyle(canvasPainter(ctx), style, x, y, width, height, hexColor);
}

/** Même dessin sur n’importe quel peintre (toile, tampon RVBA de la cuisson). */
export function paintPanelStyle(
  painter: Painter,
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
      drawBevel(painter, x, y, width, height, color, {
        border: { r: 0, g: 0, b: 0, a: 255 },
        light: lighten(color, 1),
        dark: darken(color, 0.57),
        bevel: 2,
        cutCorners: true,
      });
      break;
    case 'button':
      drawBevel(painter, x, y, width, height, color, {
        border: darken(color, 0.6),
        light: lighten(color, 0.35),
        dark: darken(color, 0.25),
        bevel: 1,
        cutCorners: true,
      });
      break;
    case 'cell':
      drawBevel(painter, x, y, width, height, color, {
        light: darken(color, 0.6),
        dark: lighten(color, 1),
        bevel: 1,
        cutCorners: false,
      });
      break;
    case 'veil':
    case 'flat':
      painter.fill(x, y, width, height, color);
      break;
  }
}

/*
 * La cuisson d’une texture générée (tous styles, cellules comprises) vit dans
 * `textureRender.ts`, chargé à la demande avec la famille mc-rs : ce module-ci
 * reste dans le paquet principal pour la toile.
 */

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
