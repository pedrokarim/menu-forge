import { encodePng } from '../export/png';
import type { RgbaImage } from '../export/image';
import { paintPanelStyle } from './generator';
import { SLOT_SIZE, chestCell } from './geometry';
import type { Point } from './geometry';
import { MCRS_COLORS, isMcrsStyle, paintMcrsStyle } from './mcrs';
import type { CellStyle, GeneratorSpec, GeneratorStyle } from './menu';
import { createImage, rasterPainter } from './painter';
import type { Painter } from './painter';

/**
 * Cuisson des textures générées, tous styles confondus : rendu dans un tampon
 * RVBA puis PNG écrit sans canvas. Le résultat ne dépend que de la spécification
 * (mêmes octets à chaque cuisson, dans le studio comme dans les tests) ; chargé
 * à la demande, il n’alourdit pas le paquet principal.
 */

export function paintGeneratorStyle(
  painter: Painter,
  style: GeneratorStyle,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  spec: Partial<GeneratorSpec> = {},
) {
  if (isMcrsStyle(style)) paintMcrsStyle(painter, style, x, y, width, height, color, spec);
  else paintPanelStyle(painter, style, x, y, width, height, color);
}

/** Couleur par défaut des cellules de slots d’un style. */
export function defaultCellColor(style: CellStyle | undefined): string {
  return style === 'mcrs_slot' ? MCRS_COLORS.slot : '#8b8b8b';
}

/**
 * Rend une texture générée. `origin` = position de la couche dans la fenêtre :
 * les cellules demandées sont dessinées à leur place exacte dans la grille.
 */
export function renderGeneratorImage(spec: GeneratorSpec, origin: Point): RgbaImage {
  const image = createImage(spec.width, spec.height);
  const painter = rasterPainter(image);
  paintGeneratorStyle(painter, spec.style, 0, 0, image.width, image.height, spec.color, spec);

  const cellStyle = spec.cellStyle ?? 'cell';
  const cellColor = spec.cellColor ?? defaultCellColor(cellStyle);
  for (const area of spec.cells ?? []) {
    for (let dx = 0; dx < (area.width ?? 1); dx++) {
      for (let dy = 0; dy < (area.height ?? 1); dy++) {
        const cell = chestCell(area.col + dx, area.row + dy);
        paintGeneratorStyle(painter, cellStyle, cell.x - origin.x, cell.y - origin.y, SLOT_SIZE, SLOT_SIZE, cellColor);
      }
    }
  }
  return image;
}

export function renderGeneratorPng(spec: GeneratorSpec, origin: Point): Promise<Uint8Array> {
  return encodePng(renderGeneratorImage(spec, origin));
}

/** PNG de la texture, prêt à téléverser. */
export async function renderGeneratorBlob(spec: GeneratorSpec, origin: Point): Promise<Blob> {
  const bytes = await renderGeneratorPng(spec, origin);
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' });
}

/** Copie un tampon RVBA dans une toile (aperçus). */
export function imageToCanvas(image: RgbaImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return canvas;
}
