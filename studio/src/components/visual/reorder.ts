import { useState } from 'react';
import type { DragEvent } from 'react';

/** Liste où l’élément `from` a été déplacé en `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

const DRAG_TYPE = 'application/x-menu-forge-reorder';

/**
 * Réordonner une liste en glissant sa poignée (glisser-déposer HTML) :
 * `handleProps` va sur la poignée, `rowProps` sur chaque ligne ; `over` est
 * la ligne survolée, pour le repère de dépôt. Chaque liste a son propre
 * état : une ligne d’une liste imbriquée ne se dépose pas dans le parent.
 */
export function useDragReorder(onMove: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  return {
    over: drag && drag.over !== drag.from ? drag.over : null,
    handleProps: (index: number) => ({
      draggable: true,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(DRAG_TYPE, String(index));
        const row = event.currentTarget.closest('[data-reorder-row]');
        if (row instanceof HTMLElement) event.dataTransfer.setDragImage(row, 12, 12);
        setDrag({ from: index, over: index });
      },
      onDragEnd: () => setDrag(null),
    }),
    rowProps: (index: number) => ({
      'data-reorder-row': true,
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!drag) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        if (drag.over !== index) setDrag({ ...drag, over: index });
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!drag) return;
        event.preventDefault();
        event.stopPropagation();
        if (drag.from !== index) onMove(drag.from, index);
        setDrag(null);
      },
    }),
  };
}
