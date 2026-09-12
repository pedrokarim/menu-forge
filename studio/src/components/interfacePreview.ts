import { evaluateCondition } from '../model/conditions';
import { TEXT_HEIGHT, charAdvance } from '../model/fontMetrics';
import { drawPanelStyle } from '../model/generator';
import { GRID_COLUMNS, SLOT_SIZE, WINDOW_WIDTH, areaRect, chestCell, playerCell, windowHeight } from '../model/geometry';
import { textBox } from '../model/interfaceGenerator';
import type { Layer, MenuDefinition } from '../model/menu';
import { buildPreviewContext, interpolate } from '../model/preview';
import type { PreviewValues } from '../model/preview';
import { imageToCanvas, renderGeneratorImage } from '../model/textureRender';
import { SLOT_COLORS } from './slotColors';

/**
 * Aperçu d’un menu généré : coffre vanilla, couches visibles dans l’état
 * d’aperçu, textes, zones de slots. Une seule fonction pour l’aperçu du
 * dialogue « Générer une interface » et les vignettes de ses exemples.
 */

/** Textures générées déjà rendues, par spécification et position. */
export type TextureCache = Map<string, HTMLCanvasElement>;

interface PreviewOptions {
  /** Pixels écran par pixel de la fenêtre (entier). */
  scale: number;
  showSlots: boolean;
  textures: TextureCache;
}

/** Texte au pas de la police vanilla, comme sur la toile de l’éditeur. */
function drawText(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, color: string, scale: number) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${TEXT_HEIGHT * scale}px ui-monospace, Consolas, monospace`;
  ctx.textBaseline = 'top';
  let cursor = x;
  for (const char of value) {
    ctx.fillText(char, cursor, y, charAdvance(char) * scale);
    cursor += charAdvance(char) * scale;
  }
  ctx.restore();
}

/** Coffre vanilla sous le menu : panneau, cases du coffre et de l’inventaire du joueur. */
function drawChest(ctx: CanvasRenderingContext2D, rows: number) {
  drawPanelStyle(ctx, 'panel', 0, 0, WINDOW_WIDTH, windowHeight(rows), '#c6c6c6');
  for (let col = 0; col < GRID_COLUMNS; col++) {
    for (let row = 0; row < rows; row++) {
      const cell = chestCell(col, row);
      drawPanelStyle(ctx, 'cell', cell.x, cell.y, SLOT_SIZE, SLOT_SIZE, '#8b8b8b');
    }
    for (let row = 0; row < 4; row++) {
      const cell = playerCell(col, row, rows);
      drawPanelStyle(ctx, 'cell', cell.x, cell.y, SLOT_SIZE, SLOT_SIZE, '#8b8b8b');
    }
  }
}

/** Dessine l’aperçu du menu dans la toile, redimensionnée à l’échelle demandée. */
export function drawInterfacePreview(canvas: HTMLCanvasElement, menu: MenuDefinition, preview: PreviewValues, options: PreviewOptions) {
  const out = canvas.getContext('2d');
  if (!out) return;
  const { scale, showSlots, textures } = options;
  const height = windowHeight(menu.container.rows);
  const base = document.createElement('canvas');
  base.width = WINDOW_WIDTH;
  base.height = height;
  const ctx = base.getContext('2d');
  if (!ctx) return;
  drawChest(ctx, menu.container.rows);
  const view = buildPreviewContext(menu, preview);
  if (textures.size > 300) textures.clear();
  const textureOf = (layer: Layer & { generator: NonNullable<Layer['generator']> }) => {
    const key = JSON.stringify([layer.generator, layer.x, layer.y]);
    let texture = textures.get(key);
    if (!texture) {
      texture = imageToCanvas(renderGeneratorImage(layer.generator, layer));
      textures.set(key, texture);
    }
    return texture;
  };
  for (const layer of menu.layers) {
    if (!layer.generator || !evaluateCondition(layer.visibleWhen, view)) continue;
    ctx.drawImage(textureOf({ ...layer, generator: layer.generator }), layer.x, layer.y);
  }

  canvas.width = WINDOW_WIDTH * scale;
  canvas.height = height * scale;
  out.imageSmoothingEnabled = false;
  out.drawImage(base, 0, 0, canvas.width, canvas.height);
  for (const text of menu.texts ?? []) {
    if (!evaluateCondition(text.visibleWhen, view)) continue;
    const value = interpolate(text.value, view.variables);
    const box = textBox({ ...text, value });
    drawText(out, value, box.x * scale, box.y * scale, text.color ?? '#404040', scale);
  }
  if (showSlots) {
    out.save();
    out.lineWidth = scale;
    out.setLineDash([2 * scale, 1.5 * scale]);
    for (const slot of menu.slots ?? []) {
      if (!evaluateCondition(slot.visibleWhen, view)) continue;
      const rect = areaRect(slot.area);
      out.strokeStyle = SLOT_COLORS[slot.kind];
      out.strokeRect(rect.x * scale + scale, rect.y * scale + scale, rect.width * scale - 2 * scale, rect.height * scale - 2 * scale);
    }
    out.restore();
  }
}
