/** Navigation dans la zone de travail : défilement et paliers de zoom. */

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
