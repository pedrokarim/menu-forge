import { GRID_COLUMNS, SLOT_SIZE, WINDOW_WIDTH, chestCell, playerCell, windowHeight } from '../model/geometry';
import type { Rect } from '../model/geometry';

/**
 * Aimantation des couches et des textes pendant un glisser, en coordonnées
 * fenêtre. Les bords (gauche/droite, haut/bas) s’accrochent aux lignes ; le
 * centre ne s’accroche qu’aux centres (fenêtre, autres éléments).
 */

export type Axis = 'x' | 'y';

export interface SnapGuide {
  axis: Axis;
  /** Coordonnée fenêtre de la ligne de repère. */
  position: number;
}

export interface SnapLines {
  x: number[];
  y: number[];
  centerX: number[];
  centerY: number[];
}

/** Distance, en pixels écran, sous laquelle un bord est attiré (~4 px). */
export const SNAP_SCREEN_DISTANCE = 4;

/** Seuil en pixels fenêtre ; au moins 1 px, sans quoi l’arrondi suffirait. */
export function snapThreshold(zoom: number): number {
  return Math.max(SNAP_SCREEN_DISTANCE / zoom, 1);
}

/** Bords de la fenêtre, bords de cellule et coin de l’item de chaque slot. */
export function gridSnapLines(rows: number): SnapLines {
  const x = [0, WINDOW_WIDTH];
  for (let col = 0; col <= GRID_COLUMNS; col++) x.push(chestCell(col, 0).x);
  for (let col = 0; col < GRID_COLUMNS; col++) x.push(chestCell(col, 0).x + 1);
  const y = [0, windowHeight(rows)];
  for (let row = 0; row <= rows; row++) y.push(chestCell(0, row).y);
  for (let row = 0; row < rows; row++) y.push(chestCell(0, row).y + 1);
  // Inventaire du joueur : utile pour caler un décor sous le coffre.
  for (let row = 0; row < 4; row++) {
    const top = playerCell(0, row, rows).y;
    y.push(top, top + 1, top + SLOT_SIZE);
  }
  return { x, y, centerX: [WINDOW_WIDTH / 2], centerY: [] };
}

/** Ajoute les bords et les centres d’autres éléments aux lignes existantes. */
export function withRects(lines: SnapLines, rects: readonly Rect[]): SnapLines {
  return {
    x: [...lines.x, ...rects.flatMap((rect) => [rect.x, rect.x + rect.width])],
    y: [...lines.y, ...rects.flatMap((rect) => [rect.y, rect.y + rect.height])],
    centerX: [...lines.centerX, ...rects.map((rect) => rect.x + rect.width / 2)],
    centerY: [...lines.centerY, ...rects.map((rect) => rect.y + rect.height / 2)],
  };
}

/** Décalage qui amène la caractéristique la plus proche sur une ligne, ou `null`. */
function snapAxis(start: number, size: number, lines: number[], centers: number[], threshold: number): number | null {
  const candidates: Array<[number, number[]]> = [
    [start, lines],
    [start + size, lines],
    [start + size / 2, centers],
  ];
  let bestDelta: number | null = null;
  let bestDistance = Infinity;
  for (const [feature, targets] of candidates) {
    for (const target of targets) {
      const distance = Math.abs(target - feature);
      if (distance <= threshold && distance < bestDistance) {
        bestDistance = distance;
        bestDelta = target - feature;
      }
    }
  }
  return bestDelta;
}

export function snapRect(rect: Rect, lines: SnapLines, threshold: number): { dx: number | null; dy: number | null } {
  return {
    dx: snapAxis(rect.x, rect.width, lines.x, lines.centerX, threshold),
    dy: snapAxis(rect.y, rect.height, lines.y, lines.centerY, threshold),
  };
}

/** Lignes sur lesquelles le rectangle final est exactement aligné (repères à dessiner). */
export function alignmentGuides(rect: Rect, lines: SnapLines): SnapGuide[] {
  const guides: SnapGuide[] = [];
  const seen = new Set<string>();
  const collect = (axis: Axis, targets: number[], features: number[]) => {
    for (const target of targets) {
      const key = `${axis}:${target}`;
      if (seen.has(key) || !features.some((feature) => Math.abs(feature - target) < 0.01)) continue;
      seen.add(key);
      guides.push({ axis, position: target });
    }
  };
  collect('x', lines.x, [rect.x, rect.x + rect.width]);
  collect('x', lines.centerX, [rect.x + rect.width / 2]);
  collect('y', lines.y, [rect.y, rect.y + rect.height]);
  collect('y', lines.centerY, [rect.y + rect.height / 2]);
  return guides;
}
