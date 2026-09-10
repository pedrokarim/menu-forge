import type { Insets, Region } from './model';

/** Géométrie en pixels de l’asset (coordonnées entières, origine en haut à gauche). */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** `x`, `y` peuvent être fractionnaires (position de la souris en pixels d’asset). */
export function rectContains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

/** Rectangle couvrant deux pixels, bornes incluses, dans n’importe quel ordre. */
export function rectFromPixels(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 };
}

export function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Zone source ramenée dans les limites d’une texture (toute l’image si absente). */
export function clampRegion(region: Region | undefined, width: number, height: number): Region {
  if (!region) return { x: 0, y: 0, width, height };
  const x = clamp(Math.round(region.x), 0, width);
  const y = clamp(Math.round(region.y), 0, height);
  return {
    x,
    y,
    width: clamp(Math.round(region.width), 0, width - x),
    height: clamp(Math.round(region.height), 0, height - y),
  };
}

/** Insets entiers, positifs, qui tiennent dans la zone source (gauche et haut prioritaires). */
export function clampInsets(insets: Insets, region: Region): Insets {
  const left = clamp(Math.round(insets.left), 0, region.width);
  const right = clamp(Math.round(insets.right), 0, region.width - left);
  const top = clamp(Math.round(insets.top), 0, region.height);
  const bottom = clamp(Math.round(insets.bottom), 0, region.height - top);
  return { top, right, bottom, left };
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const RESIZE_HANDLES: readonly ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

/** Position d’une poignée, en pixels d’asset (sur les bords du rectangle). */
export function handlePosition(rect: Rect, handle: ResizeHandle): Point {
  const x = handle.includes('w') ? rect.x : handle.includes('e') ? rect.x + rect.width : rect.x + rect.width / 2;
  const y = handle.includes('n') ? rect.y : handle.includes('s') ? rect.y + rect.height : rect.y + rect.height / 2;
  return { x, y };
}

/**
 * Redimensionne `origin` en amenant le bord tenu par `handle` sur la ligne de
 * pixels la plus proche de `point` ; la taille ne descend jamais sous 1 px.
 */
export function resizeRect(origin: Rect, handle: ResizeHandle, point: Point): Rect {
  let left = origin.x;
  let top = origin.y;
  let right = origin.x + origin.width;
  let bottom = origin.y + origin.height;
  const px = Math.round(point.x);
  const py = Math.round(point.y);
  if (handle.includes('w')) left = Math.min(px, right - 1);
  if (handle.includes('e')) right = Math.max(px, left + 1);
  if (handle.includes('n')) top = Math.min(py, bottom - 1);
  if (handle.includes('s')) bottom = Math.max(py, top + 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
