import type { Point, Rect } from './geometry';

/**
 * Aligner et répartir des rectangles (couches, textes, zones de slots,
 * éléments d’asset). Fonctions pures : elles renvoient le décalage entier à
 * appliquer à chaque rectangle, dans l’ordre reçu.
 */

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';
/** Référence d’alignement : la sélection elle-même, ou la toile entière. */
export type AlignReference = 'selection' | 'canvas';

export const ALIGN_LABELS: Record<AlignMode, string> = {
  left: 'Aligner à gauche',
  center: 'Centrer horizontalement',
  right: 'Aligner à droite',
  top: 'Aligner en haut',
  middle: 'Centrer verticalement',
  bottom: 'Aligner en bas',
};

export const DISTRIBUTE_LABELS: Record<DistributeAxis, string> = {
  horizontal: 'Répartir horizontalement',
  vertical: 'Répartir verticalement',
};

/** Rectangle englobant (vide si la liste l’est). */
export function unionRect(rects: readonly Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Décalage de chaque rectangle pour l’aligner sur `reference`. */
export function alignOffsets(rects: readonly Rect[], mode: AlignMode, reference: Rect): Point[] {
  return rects.map((rect) => {
    switch (mode) {
      case 'left':
        return { x: reference.x - rect.x, y: 0 };
      case 'center':
        return { x: reference.x + Math.floor((reference.width - rect.width) / 2) - rect.x, y: 0 };
      case 'right':
        return { x: reference.x + reference.width - rect.width - rect.x, y: 0 };
      case 'top':
        return { x: 0, y: reference.y - rect.y };
      case 'middle':
        return { x: 0, y: reference.y + Math.floor((reference.height - rect.height) / 2) - rect.y };
      case 'bottom':
        return { x: 0, y: reference.y + reference.height - rect.height - rect.y };
    }
  });
}

/**
 * Répartition à espacement égal : le premier et le dernier (dans l’ordre de
 * leur position) restent en place, les autres sont placés pour que les écarts
 * entre bords soient égaux (à 1 px près). Moins de 3 rectangles : rien ne bouge.
 */
export function distributeOffsets(rects: readonly Rect[], axis: DistributeAxis): Point[] {
  const offsets = rects.map(() => ({ x: 0, y: 0 }));
  if (rects.length < 3) return offsets;
  const start = (rect: Rect) => (axis === 'horizontal' ? rect.x : rect.y);
  const size = (rect: Rect) => (axis === 'horizontal' ? rect.width : rect.height);
  const order = rects.map((_, index) => index).sort((a, b) => start(rects[a]) - start(rects[b]) || a - b);
  const first = rects[order[0]];
  const last = rects[order[order.length - 1]];
  const span = start(last) + size(last) - start(first);
  const occupied = order.reduce((total, index) => total + size(rects[index]), 0);
  const gap = (span - occupied) / (order.length - 1);
  let cursor = start(first) + size(first) + gap;
  for (const index of order.slice(1, -1)) {
    const target = Math.round(cursor);
    const delta = target - start(rects[index]);
    offsets[index] = axis === 'horizontal' ? { x: delta, y: 0 } : { x: 0, y: delta };
    cursor += size(rects[index]) + gap;
  }
  return offsets;
}

/** Rectangles qui touchent `area` (sélection au rectangle). */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Rectangle normalisé entre deux points (glisser dans n’importe quel sens). */
export function rectBetween(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}
