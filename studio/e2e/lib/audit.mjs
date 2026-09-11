/**
 * Audit de mise en page : à la taille minimale de la fenêtre (1180 × 700),
 * rien ne doit dépasser de son conteneur visible ni faire défiler la page à
 * l’horizontale. Lu dans la page, sans capture d’écran.
 *
 * Règles, pour chaque élément affiché (plus de 2 px de côté, visible) :
 * - s’il a un ancêtre qui le rogne (`overflow` `hidden` ou `clip` sur un axe),
 *   il doit tenir dans la boîte de cet ancêtre sur cet axe ; un ancêtre qui
 *   défile (`auto`, `scroll`) le rend atteignable et arrête la recherche ;
 * - sinon, il doit tenir dans la fenêtre ;
 * - un élément qui rogne son propre contenu (`overflow` `hidden`) sans points
 *   de suspension ne doit pas avoir de contenu plus large que lui.
 * Les éléments à points de suspension (`text-overflow: ellipsis`) et leurs
 * descendants sont exemptés : le texte coupé y est voulu.
 */
export async function auditLayout(page) {
  return page.evaluate(() => {
    const problems = [];
    const TOLERANCE = 1;
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + TOLERANCE) {
      problems.push(`page${String.fromCharCode(160)}: défilement horizontal (${doc.scrollWidth} px pour ${doc.clientWidth} px)`);
    }

    const describe = (element) => {
      const classes = [...element.classList].slice(0, 3).map((name) => `.${name}`).join('');
      const label = element.getAttribute('aria-label') ?? element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 40) ?? '';
      return `${element.tagName.toLowerCase()}${classes}${label ? ` « ${label} »` : ''}`;
    };
    const exempt = (element) => element.closest('[data-audit-exempt]') !== null;
    const ellipsisAncestor = (element) => {
      for (let node = element; node && node !== document.body; node = node.parentElement) {
        if (getComputedStyle(node).textOverflow === 'ellipsis') return true;
      }
      return false;
    };
    /** Ancêtre qui rogne sur un axe, ou `null` (un ancêtre qui défile arrête la recherche : contenu atteignable). */
    const clipperOf = (element, axis) => {
      // Un élément fixe est contenu par la fenêtre, pas par ses ancêtres.
      if (getComputedStyle(element).position === 'fixed') return null;
      for (let node = element.parentElement; node && node !== document.documentElement; node = node.parentElement) {
        const style = getComputedStyle(node);
        const overflow = axis === 'x' ? style.overflowX : style.overflowY;
        if (overflow === 'hidden' || overflow === 'clip') return { node, scrolls: false };
        if (overflow === 'auto' || overflow === 'scroll') return { node, scrolls: true };
        if (style.position === 'fixed') return null;
      }
      return null;
    };

    const reported = new Set();
    for (const element of document.body.querySelectorAll('*')) {
      if (problems.length >= 12) break;
      if (exempt(element) || element.closest('svg') && element.tagName.toLowerCase() !== 'svg') continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 2 || rect.height <= 2) continue;
      const style = getComputedStyle(element);
      if (style.visibility !== 'visible' || Number(style.opacity) === 0) continue;
      if ([...reported].some((node) => node.contains(element))) continue;
      if (ellipsisAncestor(element)) continue;

      for (const axis of ['x', 'y']) {
        const start = axis === 'x' ? rect.left : rect.top;
        const end = axis === 'x' ? rect.right : rect.bottom;
        const clipper = clipperOf(element, axis);
        let limit;
        if (clipper) {
          if (clipper.scrolls) continue;
          const box = clipper.node.getBoundingClientRect();
          limit = axis === 'x' ? [box.left, box.right] : [box.top, box.bottom];
        } else {
          limit = axis === 'x' ? [0, doc.clientWidth] : [0, doc.clientHeight];
        }
        if (start < limit[0] - TOLERANCE || end > limit[1] + TOLERANCE) {
          const where = clipper ? `dépasse de ${describe(clipper.node)}` : 'sort de la fenêtre';
          problems.push(`${describe(element)} ${where} (${axis}${String.fromCharCode(160)}: ${Math.round(start)}–${Math.round(end)} pour ${Math.round(limit[0])}–${Math.round(limit[1])})`);
          reported.add(element);
          break;
        }
      }
      if (reported.has(element)) continue;
      const clipsSelf = style.overflowX === 'hidden' || style.overflowX === 'clip';
      if (clipsSelf && style.textOverflow !== 'ellipsis' && element.scrollWidth > element.clientWidth + TOLERANCE && element.tagName.toLowerCase() !== 'canvas') {
        problems.push(`${describe(element)} rogne son contenu (${element.scrollWidth} px pour ${element.clientWidth} px)`);
        reported.add(element);
      }
    }
    return problems;
  });
}
