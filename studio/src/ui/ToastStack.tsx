import { useEffect, useRef, useState } from 'react';
import { formatClock, useNow } from '../lib/clock';
import { plural } from '../lib/format';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { PixelSpinner } from './PixelSpinner';
import { dismissToast, useToasts } from './toasts';
import type { Toast, ToastIcon, ToastVariant } from './toasts';
import './feedback.css';

/** Notifications visibles à la fois ; les plus anciennes sont repliées derrière un bouton. */
const MAX_VISIBLE = 4;
/** Pas du compte à rebours. */
const TICK_MS = 200;

const VARIANT_ICONS: Record<Exclude<ToastVariant, 'progress'>, ToastIcon> = {
  info: 'info',
  success: 'check',
  error: 'alert',
};

/** Un dialogue est ouvert : la pile est masquée (CSS) et les comptes à rebours s’arrêtent. */
const dialogOpen = () => document.querySelector('.modal-backdrop') !== null;

/** Toile de l’éditeur affiché : la pile s’y ancre, les panneaux et leurs boutons restent libres. */
const STAGES = '.shell-editor:not([hidden]) :is(.stage, .asset-stage, .pixel-stage)';
/** Toile plus petite : la pile reprend le coin de la fenêtre (règle reprise par l’audit e2e). */
const MIN_STAGE_WIDTH = 280;
const MIN_STAGE_HEIGHT = 200;
const STAGE_MARGIN = 12;
const ANCHOR_POLL_MS = 400;

interface Anchor {
  right: number;
  bottom: number;
  width: number;
  maxHeight: number;
}

/** Plus grande toile visible (hors d’un éditeur : aucune) et le coin où ancrer la pile. */
function stageAnchor(): { element: Element | null; anchor: Anchor | null } {
  let element: Element | null = null;
  let best: DOMRect | null = null;
  for (const candidate of document.querySelectorAll(STAGES)) {
    const rect = candidate.getBoundingClientRect();
    if (rect.width * rect.height > (best ? best.width * best.height : 0)) {
      element = candidate;
      best = rect;
    }
  }
  if (!best || best.width < MIN_STAGE_WIDTH || best.height < MIN_STAGE_HEIGHT) return { element, anchor: null };
  return {
    element,
    anchor: {
      right: Math.round(window.innerWidth - best.right + STAGE_MARGIN),
      bottom: Math.round(window.innerHeight - best.bottom + STAGE_MARGIN),
      width: Math.round(Math.min(360, best.width - 2 * STAGE_MARGIN)),
      maxHeight: Math.round(Math.min(best.height - 2 * STAGE_MARGIN, window.innerHeight * 0.55)),
    },
  };
}

/**
 * Ancre de la pile, tant qu’il y a des notifications : relue quand la toile
 * change de taille (fenêtre, colonnes redimensionnées : `ResizeObserver`,
 * après la mise en page) et régulièrement, pour suivre un changement d’écran
 * ou de mode (une autre toile).
 */
function useStageAnchor(active: boolean): Anchor | null {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  useEffect(() => {
    if (!active) return;
    let last = '';
    let observed: Element | null = null;
    const observer = new ResizeObserver(() => update());
    function update() {
      const { element, anchor: next } = stageAnchor();
      if (element !== observed) {
        if (observed) observer.unobserve(observed);
        if (element) observer.observe(element);
        observed = element;
      }
      const key = JSON.stringify(next);
      if (key === last) return;
      last = key;
      setAnchor(next);
    }
    // oxlint-disable-next-line react/set-state-in-effect
    update();
    const timer = window.setInterval(update, ANCHOR_POLL_MS);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      window.removeEventListener('resize', update);
    };
  }, [active]);
  return anchor;
}

function ToastCard({ toast }: { toast: Toast }) {
  const paused = useRef(false);

  // Disparition automatique : le temps ne compte que si la notification est visible et ni survolée ni focalisée.
  useEffect(() => {
    if (toast.duration === null || toast.leaving) return;
    let remaining = toast.duration;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (!paused.current && !dialogOpen()) remaining -= now - last;
      last = now;
      if (remaining <= 0) dismissToast(toast.id);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [toast.id, toast.duration, toast.leaving, toast.version]);

  const now = useNow(toast.since !== undefined && !toast.leaving);
  const error = toast.variant === 'error';
  const action = toast.action;
  return (
    <div
      className={`toast toast-${toast.variant}${toast.leaving ? ' is-leaving' : ''}`}
      role={error ? 'alert' : 'status'}
      aria-live={error ? undefined : 'polite'}
      aria-atomic="true"
      onPointerEnter={() => {
        paused.current = true;
      }}
      onPointerLeave={() => {
        paused.current = false;
      }}
      onFocus={() => {
        paused.current = true;
      }}
      onBlur={() => {
        paused.current = false;
      }}
    >
      <span className="toast-icon">{toast.variant === 'progress' ? <PixelSpinner /> : <Icon name={toast.icon ?? VARIANT_ICONS[toast.variant]} size={24} />}</span>
      <div className="toast-body">
        <div className="toast-head">
          <p className="toast-title">{toast.title}</p>
          {toast.since !== undefined && (
            <span className="toast-clock" aria-hidden="true">
              {formatClock(now - toast.since)}
            </span>
          )}
        </div>
        {toast.message && <p className="toast-message">{toast.message}</p>}
        {action && (
          <div className="toast-actions">
            <button
              type="button"
              className="sm"
              onClick={() => {
                action.run();
                // Une progression reste tant que sa tâche tourne ; les autres ont servi.
                if (toast.variant !== 'progress') dismissToast(toast.id);
              }}
            >
              {action.label}
            </button>
          </div>
        )}
      </div>
      <IconButton icon="close" label="Fermer la notification" variant="ghost" onClick={() => dismissToast(toast.id)} />
    </div>
  );
}

/**
 * Pile des notifications, en bas à droite au-dessus de la barre d’état ; dans
 * un éditeur, au coin bas droit de la toile (jamais sur les panneaux et leurs
 * boutons) ; masquée tant qu’un dialogue est ouvert (elle ne cache jamais ses boutons).
 * Les plus récentes sont en bas ; au-delà de quatre, les anciennes se replient.
 * Sa hauteur est bornée (les barres d’outils du haut restent libres) : la
 * liste défile alors, en partant du bas, où sont les plus récentes.
 */
export function ToastStack() {
  const toasts = useToasts();
  const [expanded, setExpanded] = useState(false);
  const anchor = useStageAnchor(toasts.length > 0);
  if (toasts.length === 0) return null;
  const hidden = Math.max(0, toasts.length - MAX_VISIBLE);
  const showAll = expanded && hidden > 0;
  const visible = showAll ? toasts : toasts.slice(-MAX_VISIBLE);
  return (
    <section className="toast-stack" aria-label="Notifications" style={anchor ?? undefined}>
      {hidden > 0 && (
        <button type="button" className="sm toast-more" aria-expanded={showAll} onClick={() => setExpanded(!showAll)}>
          <Icon name={showAll ? 'chevron-down' : 'chevron-up'} />
          {showAll ? 'Replier les plus anciennes' : `${plural(hidden, 'notification')} plus ancienne${hidden > 1 ? 's' : ''}`}
        </button>
      )}
      {/* Ordre inversé + `column-reverse` : la plus récente en bas, et le défilement part du bas. */}
      <div className="toast-list">
        {[...visible].reverse().map((toast) => (
          <ToastCard key={toast.id} toast={toast} />
        ))}
      </div>
    </section>
  );
}
