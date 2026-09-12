import { useCallback, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * Liste à points de séparation (« formulaire Bedrock · grid · 4 boutons ») qui
 * passe à la ligne : un point sépare deux éléments d’une même ligne, jamais en
 * début ni en fin de ligne. Chaque enfant qui ouvre une ligne reçoit
 * `data-line-start`, mesuré à chaque changement de taille ou de contenu ; la
 * feuille de style ne dessine pas son point (il vit dans l’écart, hors du flux :
 * le poser ou l’ôter ne change pas la mise en page).
 */
export function DotList({ className, children }: { className?: string; children: ReactNode }) {
  const cleanup = useRef<(() => void) | null>(null);
  const ref = useCallback((node: HTMLSpanElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!node) return;
    const mark = () => {
      let previousBottom = Number.NEGATIVE_INFINITY;
      for (const child of node.children) {
        if (!(child instanceof HTMLElement)) continue;
        child.toggleAttribute('data-line-start', child.offsetTop >= previousBottom - 1);
        previousBottom = child.offsetTop + child.offsetHeight;
      }
    };
    const sizes = new ResizeObserver(mark);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(node);
      for (const child of node.children) sizes.observe(child);
      mark();
    };
    const changes = new MutationObserver(watch);
    changes.observe(node, { childList: true, subtree: true, characterData: true });
    watch();
    cleanup.current = () => {
      sizes.disconnect();
      changes.disconnect();
    };
  }, []);
  return (
    <span ref={ref} className={className ? `dot-list ${className}` : 'dot-list'}>
      {children}
    </span>
  );
}
