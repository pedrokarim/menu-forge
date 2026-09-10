import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, PointerEvent, ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ShortcutKeys } from './Keys';

/** Gestionnaires que l’infobulle greffe sur son déclencheur (en conservant les siens). */
interface TriggerProps {
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  'aria-describedby'?: string;
}

interface TooltipProps {
  /** Première ligne, en clair (le nom de l’action). */
  label: ReactNode;
  /** Raccourci clavier, touches séparées par « + » : « Ctrl+Z », « V »… */
  shortcut?: string;
  /** Seconde ligne, plus discrète. */
  hint?: ReactNode;
  /** Côté préféré ; l’infobulle bascule de l’autre côté si la place manque (`right` : rail d’écrans). */
  placement?: 'top' | 'bottom' | 'right';
  /** Un seul élément focalisable (bouton, champ…). */
  children: ReactElement<TriggerProps>;
}

/** Délai avant l’apparition, pour ne pas clignoter au simple survol. */
const SHOW_DELAY = 400;
/** Écart entre le déclencheur et l’infobulle. */
const GAP = 8;
/** Distance minimale au bord de la fenêtre. */
const EDGE = 8;

/**
 * Infobulle au style des infobulles d’objet du jeu (fond violet nuit, liseré
 * dégradé). Apparaît au survol après un court délai, et au focus clavier
 * (jamais au simple clic de souris) ; reste dans la fenêtre ; décrit son
 * déclencheur via `aria-describedby`.
 */
export function Tooltip({ label, shortcut, hint, placement = 'bottom', children }: TooltipProps) {
  const id = useId();
  /** Déclencheur survolé ou focalisé, en attente de la fin du délai. */
  const [pending, setPending] = useState<HTMLElement | null>(null);
  /** Position du déclencheur une fois l’infobulle ouverte. */
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  // Délai d’apparition : l’état ne change qu’à l’échéance du minuteur, jamais pendant l’effet.
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setAnchor(pending.getBoundingClientRect()), SHOW_DELAY);
    return () => window.clearTimeout(timer);
  }, [pending]);

  // Placement mesuré avant l’affichage : sous (ou sur) le déclencheur, recadré dans la fenêtre.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip || !anchor) return;
    const { width, height } = tip.getBoundingClientRect();
    const viewWidth = document.documentElement.clientWidth;
    const viewHeight = document.documentElement.clientHeight;
    if (placement === 'right') {
      const middle = anchor.top + anchor.height / 2 - height / 2;
      const sideTop = Math.max(EDGE, Math.min(middle, viewHeight - EDGE - height));
      const sideLeft = Math.min(anchor.right + GAP, viewWidth - EDGE - width);
      tip.style.transform = `translate(${Math.round(sideLeft)}px, ${Math.round(sideTop)}px)`;
      tip.style.visibility = 'visible';
      return;
    }
    const below = anchor.bottom + GAP;
    const above = anchor.top - GAP - height;
    let top = placement === 'top' ? above : below;
    if (placement === 'top' && top < EDGE) top = below;
    if (placement === 'bottom' && top + height > viewHeight - EDGE) top = above;
    top = Math.max(EDGE, Math.min(top, viewHeight - EDGE - height));
    const centered = anchor.left + anchor.width / 2 - width / 2;
    const left = Math.max(EDGE, Math.min(centered, viewWidth - EDGE - width));
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    tip.style.visibility = 'visible';
  }, [anchor, placement]);

  // Échap, un défilement ou un redimensionnement ferment l’infobulle.
  useEffect(() => {
    if (!anchor) return;
    const close = () => {
      setPending(null);
      setAnchor(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [anchor]);

  const hide = () => {
    setPending(null);
    setAnchor(null);
  };

  const own = children.props;
  const trigger = cloneElement(children, {
    'aria-describedby': anchor ? id : own['aria-describedby'],
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      own.onPointerEnter?.(event);
      if (event.pointerType === 'mouse') setPending(event.currentTarget);
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      own.onPointerLeave?.(event);
      hide();
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      own.onPointerDown?.(event);
      hide();
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      own.onFocus?.(event);
      if (event.currentTarget.matches(':focus-visible')) setPending(event.currentTarget);
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      own.onBlur?.(event);
      hide();
    },
  });

  return (
    <>
      {trigger}
      {anchor &&
        createPortal(
          <div ref={tipRef} id={id} role="tooltip" className="tooltip" style={{ visibility: 'hidden' }}>
            <span className="tooltip-head">
              <span className="tooltip-label">{label}</span>
              {shortcut && <ShortcutKeys shortcut={shortcut} />}
            </span>
            {hint && <span className="tooltip-hint">{hint}</span>}
          </div>,
          document.body,
        )}
    </>
  );
}
