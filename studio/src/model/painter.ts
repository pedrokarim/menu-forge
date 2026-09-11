import type { RgbaImage } from '../export/image';

/**
 * Surface de dessin minimale des textures générées : des rectangles pleins,
 * composés « par-dessus » (source-over). Deux implémentations : un contexte 2D
 * (toile du studio, boxes des assets) et un tampon RVBA non prémultiplié
 * (cuisson des textures, tests), pour que chaque style soit écrit une seule fois.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Painter {
  fill(x: number, y: number, width: number, height: number, color: Rgba): void;
}

export function css(color: Rgba): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;
}

/** Peintre sur un contexte 2D : un `fillRect` par rectangle. */
export function canvasPainter(ctx: CanvasRenderingContext2D): Painter {
  return {
    fill(x, y, width, height, color) {
      if (width <= 0 || height <= 0) return;
      ctx.fillStyle = css(color);
      ctx.fillRect(x, y, width, height);
    },
  };
}

/** Tampon RVBA transparent de la taille donnée (au moins 1 × 1). */
export function createImage(width: number, height: number): RgbaImage {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  return { width: safeWidth, height: safeHeight, data: new Uint8Array(safeWidth * safeHeight * 4) };
}

/**
 * Peintre sur un tampon RVBA : composition source-over en alpha non
 * prémultiplié, arrondie à l’entier, donc exacte et reproductible octet pour
 * octet (le PNG écrit est celui qu’on a calculé).
 */
export function rasterPainter(image: RgbaImage): Painter {
  return {
    fill(x, y, width, height, color) {
      const left = Math.max(0, Math.round(x));
      const top = Math.max(0, Math.round(y));
      const right = Math.min(image.width, Math.round(x + width));
      const bottom = Math.min(image.height, Math.round(y + height));
      if (color.a === 0) return;
      for (let row = top; row < bottom; row++) {
        for (let col = left; col < right; col++) blendPixel(image.data, (row * image.width + col) * 4, color);
      }
    },
  };
}

function blendPixel(data: Uint8Array, offset: number, color: Rgba) {
  const sourceAlpha = color.a / 255;
  if (sourceAlpha >= 1) {
    data[offset] = color.r;
    data[offset + 1] = color.g;
    data[offset + 2] = color.b;
    data[offset + 3] = 255;
    return;
  }
  const destAlpha = data[offset + 3] / 255;
  const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) return;
  const channel = (source: number, dest: number) =>
    Math.round((source * sourceAlpha + dest * destAlpha * (1 - sourceAlpha)) / outAlpha);
  data[offset] = channel(color.r, data[offset]);
  data[offset + 1] = channel(color.g, data[offset + 1]);
  data[offset + 2] = channel(color.b, data[offset + 2]);
  data[offset + 3] = Math.round(outAlpha * 255);
}
