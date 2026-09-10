import { evaluateCondition } from './conditions';
import { alignedStart, textWidth } from './fontMetrics';
import { TITLE_X, ascentForTop } from './geometry';
import type { MenuDefinition } from './menu';
import type { PreviewContext } from './preview';
import { interpolate } from './preview';

/** Boîte englobante des pixels non transparents d’une image. */
export interface ImageBounds {
  cropX: number;
  cropY: number;
  width: number;
  height: number;
}

export type TitleToken =
  | { kind: 'shift'; amount: number }
  | {
      kind: 'glyph';
      layerId: string;
      x: number;
      top: number;
      ascent: number;
      height: number;
      advance: number;
      padded: boolean;
    }
  | {
      kind: 'text';
      textId: string;
      value: string;
      x: number;
      top: number;
      ascent: number;
      width: number;
      color: string;
    };

export interface Composition {
  tokens: TitleToken[];
  warnings: string[];
}

/** `undefined` = texture pas encore chargée ; `null` = texture absente ou vide. */
export type BoundsLookup = (texture: string) => ImageBounds | null | undefined;

/**
 * Compose le titre d’un menu résolu : suite de décalages, glyphes et textes.
 * Même algorithme que la lib Java (cf. docs/rendering.md § 3) : chaque couche
 * est recadrée sur ses pixels, son avance vaut largeur + 1, et son `ascent`
 * place le haut de l’image à la bonne hauteur.
 */
export function composeTitle(
  menu: MenuDefinition,
  context: PreviewContext,
  boundsOf: BoundsLookup,
): Composition {
  const tokens: TitleToken[] = [{ kind: 'shift', amount: -TITLE_X }];
  const warnings: string[] = [];
  let cursor = 0;

  const moveTo = (x: number) => {
    const amount = x - cursor;
    if (amount !== 0) tokens.push({ kind: 'shift', amount });
  };

  for (const layer of menu.layers) {
    if (!evaluateCondition(layer.visibleWhen, context)) continue;
    const bounds = boundsOf(layer.texture);
    if (bounds === undefined) {
      warnings.push(`« ${layer.id} » : texture en cours de chargement`);
      continue;
    }
    if (bounds === null) {
      warnings.push(`« ${layer.id} » : texture introuvable ou vide (${layer.texture})`);
      continue;
    }
    const x = layer.x + bounds.cropX;
    const top = layer.y + bounds.cropY;
    const ascent = ascentForTop(top);
    // Minecraft exige ascent ≤ height : la lib complète le bas de l’image si besoin.
    const height = Math.max(bounds.height, ascent);
    const advance = bounds.width + 1;
    moveTo(x);
    tokens.push({
      kind: 'glyph',
      layerId: layer.id,
      x,
      top,
      ascent,
      height,
      advance,
      padded: height > bounds.height,
    });
    cursor = x + advance;
  }

  for (const text of menu.texts ?? []) {
    if (!evaluateCondition(text.visibleWhen, context)) continue;
    const value = interpolate(text.value, context.variables);
    const width = textWidth(value);
    const start = alignedStart(text.x, width, text.align);
    moveTo(start);
    tokens.push({
      kind: 'text',
      textId: text.id,
      value,
      x: start,
      top: text.y,
      ascent: ascentForTop(text.y),
      width,
      color: text.color ?? '#404040',
    });
    cursor = start + width;
  }

  return { tokens, warnings };
}
