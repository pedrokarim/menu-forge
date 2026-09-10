import { WINDOW_WIDTH, windowHeight } from '../model/geometry';

/** Navigation dans la zone de travail : défilement, taille de la vue et paliers de zoom. */

/** Marges autour de la fenêtre du coffre sur la toile (px GUI), pour voir ce qui déborde (barre d’onglets flottante…). */
export const CANVAS_MARGINS = { x: 40, top: 48, bottom: 16 } as const;

/** Taille de la vue de la toile des menus en px GUI : fenêtre du coffre + marges. */
export function menuViewSize(rows: number): { width: number; height: number } {
  return {
    width: WINDOW_WIDTH + CANVAS_MARGINS.x * 2,
    height: windowHeight(rows) + CANVAS_MARGINS.top + CANVAS_MARGINS.bottom,
  };
}

/**
 * Zoom « Ajuster » : le plus grand palier où toute la vue tient dans la place
 * disponible (px écran), sinon le plus petit palier.
 */
export function fitZoom(available: { width: number; height: number }, rows: number, levels: readonly number[]): number {
  const view = menuViewSize(rows);
  const sorted = [...levels].sort((a, b) => a - b);
  const fitting = sorted.filter((level) => view.width * level <= available.width && view.height * level <= available.height);
  return fitting.at(-1) ?? sorted[0];
}

/** Premier ancêtre qui défile (la zone de travail), sinon le document. */
export function scrollParentOf(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(`${style.overflowX} ${style.overflowY}`)) return node;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}

/** Vrai si la touche vise un champ de saisie (on ne lui vole pas l’espace). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest('input, textarea, select') !== null;
}

/** Palier suivant (`direction` = 1) ou précédent (−1) ; reste sur place aux extrémités. */
export function stepZoom(levels: readonly number[], current: number, direction: 1 | -1): number {
  const sorted = [...levels].sort((a, b) => a - b);
  if (direction > 0) return sorted.find((level) => level > current) ?? current;
  return sorted.findLast((level) => level < current) ?? current;
}
