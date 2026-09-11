import type { TextureMap } from '../lib/textures';
import { TEXT_HEIGHT, alignedStart, textWidth } from '../model/fontMetrics';
import { areaRect } from '../model/geometry';
import type { Rect } from '../model/geometry';
import type { Layer, MenuDefinition, TextElement } from '../model/menu';
import type { PreviewContext } from '../model/preview';
import { interpolate } from '../model/preview';
import type { Selection } from '../state/editor';

/** Rectangles des éléments d’un menu, en pixels fenêtre (cadres, aimantation, alignement). */

export function textRect(text: TextElement, context: PreviewContext): Rect {
  const width = textWidth(interpolate(text.value, context.variables));
  return { x: alignedStart(text.x, width, text.align), y: text.y, width: Math.max(width, 2), height: TEXT_HEIGHT };
}

/** Partie visible d’une couche (pixels opaques). */
export function layerRect(layer: Layer, textures: TextureMap): Rect {
  const texture = textures.get(layer.texture);
  if (!texture) return { x: layer.x, y: layer.y, width: 16, height: 16 };
  if (!texture.bounds) return { x: layer.x, y: layer.y, width: texture.width, height: texture.height };
  const { cropX, cropY, width, height } = texture.bounds;
  return { x: layer.x + cropX, y: layer.y + cropY, width, height };
}

export function elementRect(
  menu: MenuDefinition,
  target: Selection,
  textures: TextureMap,
  context: PreviewContext,
): Rect | null {
  if (target.kind === 'layer') {
    const layer = menu.layers.find((candidate) => candidate.id === target.id);
    return layer ? layerRect(layer, textures) : null;
  }
  if (target.kind === 'text') {
    const text = menu.texts?.find((candidate) => candidate.id === target.id);
    return text ? textRect(text, context) : null;
  }
  const slot = menu.slots?.find((candidate) => candidate.id === target.id);
  return slot ? areaRect(slot.area) : null;
}
