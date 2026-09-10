import type { SlotArea } from './menu';

/** Géométrie de la fenêtre de coffre vanilla, en pixels GUI (cf. docs/rendering.md § 2). */
export const WINDOW_WIDTH = 176;
export const TITLE_X = 8;
export const TITLE_Y = 6;
export const SLOT_SIZE = 18;
export const GRID_COLUMNS = 9;
export const MAX_ROWS = 6;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridCell {
  col: number;
  row: number;
}

export function windowHeight(rows: number): number {
  return 114 + SLOT_SIZE * rows;
}

/** Coin haut-gauche de la cellule 18×18 d’un slot du coffre. */
export function chestCell(col: number, row: number): Point {
  return { x: 7 + SLOT_SIZE * col, y: 17 + SLOT_SIZE * row };
}

/** Cellule de l’inventaire du joueur : lignes 0 à 2, puis la barre d’action en ligne 3. */
export function playerCell(col: number, row: number, rows: number): Point {
  const y = row < 3 ? 30 + SLOT_SIZE * rows + SLOT_SIZE * row : 88 + SLOT_SIZE * rows;
  return { x: 7 + SLOT_SIZE * col, y };
}

/** Rectangle en pixels couvert par une zone de slots. */
export function areaRect(area: SlotArea): Rect {
  const origin = chestCell(area.col, area.row);
  return {
    x: origin.x,
    y: origin.y,
    width: SLOT_SIZE * (area.width ?? 1),
    height: SLOT_SIZE * (area.height ?? 1),
  };
}

/** Slot du coffre sous un point, ou `null` hors de la grille. */
export function chestCellAt(point: Point, rows: number): GridCell | null {
  const col = Math.floor((point.x - 7) / SLOT_SIZE);
  const row = Math.floor((point.y - 17) / SLOT_SIZE);
  if (col < 0 || col >= GRID_COLUMNS || row < 0 || row >= rows) return null;
  return { col, row };
}

/** Zone rectangulaire couvrant deux cellules, dans n’importe quel ordre. */
export function areaFromCells(a: GridCell, b: GridCell): SlotArea {
  return {
    col: Math.min(a.col, b.col),
    row: Math.min(a.row, b.row),
    width: Math.abs(a.col - b.col) + 1,
    height: Math.abs(a.row - b.row) + 1,
  };
}

/** Slot du coffre le plus proche d’un point, ramené dans la grille. */
export function clampedChestCell(point: Point, rows: number): GridCell {
  return {
    col: clamp(Math.floor((point.x - 7) / SLOT_SIZE), 0, GRID_COLUMNS - 1),
    row: clamp(Math.floor((point.y - 17) / SLOT_SIZE), 0, rows - 1),
  };
}

/** Poignée de redimensionnement d’une zone : bords (n, s, e, w) et coins. */
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function areaSize(area: SlotArea): { width: number; height: number } {
  return { width: area.width ?? 1, height: area.height ?? 1 };
}

export function sameArea(a: SlotArea, b: SlotArea): boolean {
  const sizeA = areaSize(a);
  const sizeB = areaSize(b);
  return a.col === b.col && a.row === b.row && sizeA.width === sizeB.width && sizeA.height === sizeB.height;
}

/**
 * Zone recomposée sans toucher au format : `width`/`height` restent absents
 * quand ils valent 1, sauf s’ils étaient déjà écrits dans la zone d’origine.
 */
function withSpan(original: SlotArea, col: number, row: number, width: number, height: number): SlotArea {
  const area: SlotArea = { col, row };
  if (width !== 1 || original.width !== undefined) area.width = width;
  if (height !== 1 || original.height !== undefined) area.height = height;
  return area;
}

/** Zone décalée d’un nombre entier de cellules, gardée entière dans la grille du coffre. */
export function moveArea(area: SlotArea, deltaCol: number, deltaRow: number, rows: number): SlotArea {
  const { width, height } = areaSize(area);
  const col = clamp(area.col + deltaCol, 0, Math.max(0, GRID_COLUMNS - width));
  const row = clamp(area.row + deltaRow, 0, Math.max(0, rows - height));
  return withSpan(area, col, row, width, height);
}

/**
 * Zone redimensionnée par une poignée : le bord tiré se cale sur la frontière
 * de cellule la plus proche du pointeur ; taille minimale 1×1.
 */
export function resizeArea(area: SlotArea, handle: ResizeHandle, point: Point, rows: number): SlotArea {
  const { width, height } = areaSize(area);
  let left = area.col;
  let top = area.row;
  let right = area.col + width;
  let bottom = area.row + height;
  const boundaryX = clamp(Math.round((point.x - 7) / SLOT_SIZE), 0, GRID_COLUMNS);
  const boundaryY = clamp(Math.round((point.y - 17) / SLOT_SIZE), 0, rows);
  if (handle.includes('w')) left = Math.min(boundaryX, right - 1);
  if (handle.includes('e')) right = Math.max(boundaryX, left + 1);
  if (handle.includes('n')) top = Math.min(boundaryY, bottom - 1);
  if (handle.includes('s')) bottom = Math.max(boundaryY, top + 1);
  return withSpan(area, left, top, right - left, bottom - top);
}

export function rectContains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x < rect.x + rect.width &&
    point.y < rect.y + rect.height
  );
}

/** `ascent` d’un glyphe dont le haut doit tomber à la coordonnée fenêtre `top`. */
export function ascentForTop(top: number): number {
  return TITLE_Y + 7 - top;
}
