import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Tooltip } from './Tooltip';
import type { ColumnHandle } from './useResizablePanel';

interface ResizeHandleProps {
  /** Colonne réglée : à gauche de la poignée (`left`) ou à droite (`right`). */
  side: 'left' | 'right';
  /** Nom accessible (« Largeur de la colonne de gauche »). */
  label: string;
  handle: ColumnHandle;
}

/** Pas des flèches (Maj : grand pas), en px. */
const STEP = 8;
const BIG_STEP = 32;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Poignée de redimensionnement d’une colonne latérale : fine, visible au
 * survol et au focus. Glisser règle la largeur (la toile suit en direct),
 * double-clic ou Entrée la rétablit ; au clavier, les flèches l’ajustent
 * (Maj : par 32 px), Début et Fin vont aux bornes.
 */
export function ResizeHandle({ side, label, handle }: ResizeHandleProps) {
  const drag = useRef<{ pointerId: number; startX: number; startValue: number; value: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  // Poignée de gauche : tirer vers la droite élargit ; poignée de droite : l’inverse.
  const direction = side === 'left' ? 1 : -1;

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    document.body.classList.remove('is-resizing-columns');
    if (current.value !== current.startValue) handle.commit(current.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = handle.value - step * direction;
    else if (event.key === 'ArrowRight') next = handle.value + step * direction;
    else if (event.key === 'Home') next = handle.min;
    else if (event.key === 'End') next = handle.max;
    else if (event.key === 'Enter') {
      event.preventDefault();
      handle.reset();
      return;
    }
    if (next === null) return;
    // Les flèches ne déplacent pas en plus l’élément sélectionné de l’éditeur.
    event.preventDefault();
    event.stopPropagation();
    handle.commit(clamp(next, handle.min, handle.max));
  };

  return (
    <Tooltip label="Glisser pour redimensionner, double-clic pour rétablir" hint="Au clavier : flèches, Maj pour aller plus vite" placement="right">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={Math.round(handle.value)}
        aria-valuemin={handle.min}
        aria-valuemax={Math.round(handle.max)}
        tabIndex={0}
        className={`resize-handle resize-handle-${side}${dragging ? ' is-active' : ''}`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointerId: event.pointerId, startX: event.clientX, startValue: handle.value, value: handle.value };
          setDragging(true);
          // Curseur de redimensionnement partout, et pas de texte sélectionné en passant.
          document.body.classList.add('is-resizing-columns');
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointerId !== event.pointerId) return;
          const value = Math.round(clamp(current.startValue + (event.clientX - current.startX) * direction, handle.min, handle.max));
          if (value === current.value) return;
          current.value = value;
          handle.preview(value);
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onDoubleClick={handle.reset}
        onKeyDown={onKeyDown}
      />
    </Tooltip>
  );
}
