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
