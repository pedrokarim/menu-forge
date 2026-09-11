import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { ShortcutKeys } from './Keys';
import { ContextMenuContext, isMenuAction } from './menuContext';
import type { MenuEntry, OpenContextMenu } from './menuContext';

interface OpenState {
  x: number;
  y: number;
  entries: MenuEntry[];
}

/** Distance minimale au bord de la fenêtre. */
const EDGE = 8;

function MenuSurface({ state, onClose }: { state: OpenState; onClose: (restoreFocus: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  // Placement mesuré avant l’affichage : au pointeur, retourné s’il sortirait de la fenêtre.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    const viewWidth = document.documentElement.clientWidth;
    const viewHeight = document.documentElement.clientHeight;
    let left = state.x;
    let top = state.y;
    if (left + width > viewWidth - EDGE) left = Math.max(EDGE, state.x - width);
    if (top + height > viewHeight - EDGE) top = Math.max(EDGE, viewHeight - EDGE - height);
    menu.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    menu.style.visibility = 'visible';
    menu.querySelector<HTMLButtonElement>('.context-item:not(:disabled)')?.focus();
  }, [state]);

  // Un clic ailleurs, un défilement, un redimensionnement ou la perte du focus ferment le menu.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose(false);
    };
    const dismiss = () => onClose(false);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [onClose]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('.context-item:not(:disabled)') ?? [])];
    const index = items.findIndex((item) => item === document.activeElement);
    const focus = (next: number) => {
      event.preventDefault();
      items[(next + items.length) % items.length]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        focus(index + 1);
        break;
      case 'ArrowUp':
        focus(index - 1);
        break;
      case 'Home':
        focus(0);
        break;
      case 'End':
        focus(items.length - 1);
        break;
      case 'Escape':
      case 'Tab':
        // Échap ne doit pas atteindre les raccourcis de l’éditeur (désélection).
        event.preventDefault();
        event.stopPropagation();
        onClose(true);
        break;
    }
  };

  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ visibility: 'hidden' }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {state.entries.map((entry, position) => {
        if ('separator' in entry) return <div key={`separator-${position}`} className="context-separator" role="separator" />;
        if ('heading' in entry) {
          return (
            <div key={`heading-${position}`} className="context-heading" role="presentation">
              {entry.heading}
            </div>
          );
        }
        return (
          <button
            key={`action-${position}-${entry.label}`}
            type="button"
            role="menuitem"
            className={entry.danger ? 'context-item is-danger' : 'context-item'}
            disabled={entry.disabled}
            onClick={() => {
              onClose(true);
              entry.onSelect();
            }}
          >
            <span className="context-icon">{entry.icon && <Icon name={entry.icon} />}</span>
            <span className="context-label">{entry.label}</span>
            {entry.shortcut ? <ShortcutKeys shortcut={entry.shortcut} /> : <span />}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/**
 * Menus contextuels (clic droit, touche Menu ou Maj+F10) : un seul menu
 * ouvert à la fois, au style Deepslate, navigable au clavier. Les composants
 * l’ouvrent avec `useContextMenu()`.
 */
export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpenState | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const open = useCallback<OpenContextMenu>((event, entries) => {
    event.preventDefault();
    if (!entries.some(isMenuAction)) return;
    let x = event.clientX;
    let y = event.clientY;
    // Ouvert au clavier : pas de coordonnées de pointeur, le menu se place sous l’élément.
    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (x === 0 && y === 0 && target) {
      const rect = target.getBoundingClientRect();
      x = rect.left + 8;
      y = rect.bottom + 2;
    }
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setState({ x, y, entries });
  }, []);

  const close = useCallback((restoreFocus: boolean) => {
    setState(null);
    if (restoreFocus) openerRef.current?.focus();
  }, []);

  return (
    <ContextMenuContext.Provider value={open}>
      {children}
      {state && <MenuSurface state={state} onClose={close} />}
    </ContextMenuContext.Provider>
  );
}
