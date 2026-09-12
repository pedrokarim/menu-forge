import { WINDOW_WIDTH, windowHeight } from '../model/geometry';

/** Navigation dans la zone de travail : défilement, taille de la vue et paliers de zoom. */

/** Marges autour de la fenêtre du coffre sur la toile (px GUI), pour voir ce qui déborde (barre d’onglets flottante…). */
export const CANVAS_MARGINS = { x: 32, top: 32, bottom: 8 } as const;

/** Taille de la vue de la toile des menus en px GUI : fenêtre du coffre + marges. */
export function menuViewSize(rows: number): { width: number; height: number } {
  return {
    width: WINDOW_WIDTH + CANVAS_MARGINS.x * 2,
    height: windowHeight(rows) + CANVAS_MARGINS.top + CANVAS_MARGINS.bottom,
  };
}

/**
 * Zoom « Ajuster » : le plus grand palier où toute la vue tient dans la place
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

/**
 * Plus grand palier où une zone (`size`, en unités de la toile) tient dans la
 * place disponible (px écran), sinon le plus petit palier.
 */
export function largestFittingZoom(
  size: { width: number; height: number },
  available: { width: number; height: number },
  levels: readonly number[],
): number {
  const sorted = [...levels].sort((a, b) => a - b);
  const fitting = sorted.filter((level) => size.width * level <= available.width && size.height * level <= available.height);
  return fitting.at(-1) ?? sorted[0];
}

/** Commande de zoom au clavier, la même dans les trois éditeurs. */
export type ZoomCommand = 'in' | 'out' | 'actual' | 'fit' | 'selection';

/**
 * Raccourcis de zoom à une touche : « + » et « - » (rangée du haut ou pavé
 * numérique), Maj+0 (taille réelle, ×1), Maj+1 (ajuster), Maj+2 (zoomer sur
 * la sélection). Chiffres lus sur la touche physique (en AZERTY, Maj + la
 * touche du 0 donne « 0 »). Avec Ctrl, Cmd ou Alt : `null` (Ctrl+0 et
 * Ctrl+molette restent gérés à part). À n’appeler que hors d’un champ de saisie.
 */
export function zoomCommand(event: KeyboardEvent): ZoomCommand | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.code === 'NumpadAdd' || event.key === '+' || (event.key === '=' && !event.shiftKey)) return 'in';
  if (event.code === 'NumpadSubtract' || event.key === '-') return 'out';
  if (!event.shiftKey) return null;
  switch (event.code) {
    case 'Digit0':
      return 'actual';
    case 'Digit1':
      return 'fit';
    case 'Digit2':
      return 'selection';
    default:
      return null;
  }
}
