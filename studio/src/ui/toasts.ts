import { useSyncExternalStore } from 'react';

/**
 * Notifications (« toasts ») de tout le studio : une pile en bas à droite,
 * affichée par `ToastStack`. Ce module ne tient que l’état : n’importe quel
 * code (une tâche de fond, un éditeur) peut en montrer une, sans React.
 */

export type ToastVariant = 'info' | 'progress' | 'success' | 'error';

/** Pictos possibles d’une notification (noms de `ui/Icon.tsx`, sans charger ses dessins ici). */
export type ToastIcon = 'info' | 'check' | 'alert' | 'warning' | 'stop';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  message?: string;
  /** Picto ; par défaut celui de la variante. */
  icon?: ToastIcon;
  action?: ToastAction;
  /** Temps d’affichage (ms), compté seulement quand la notification est visible ; `null` : jusqu’à fermeture. */
  duration: number | null;
  /** Chronomètre affiché à côté du titre (début, en ms depuis l’époque). */
  since?: number;
  /** Groupe (une tâche de fond) : ses notifications se retirent ensemble. */
  group?: string;
  /** Change à chaque mise à jour : le compte à rebours repart. */
  version: number;
  /** En train de disparaître (animation de sortie). */
  leaving: boolean;
}

export type ToastInput = Pick<Toast, 'variant' | 'title'> & Partial<Pick<Toast, 'id' | 'message' | 'icon' | 'action' | 'duration' | 'since' | 'group'>>;

/** Durée par défaut des notifications d’information et de succès ; les erreurs et les progressions restent. */
export const TOAST_DURATION = 6000;
/** Durée de l’animation de sortie (voir `feedback.css`). */
export const TOAST_EXIT_MS = 180;

let toasts: readonly Toast[] = [];
let counter = 0;
const listeners = new Set<() => void>();

function commit(next: readonly Toast[]): void {
  toasts = next;
  for (const listener of listeners) listener();
}

function defaultDuration(variant: ToastVariant): number | null {
  return variant === 'info' || variant === 'success' ? TOAST_DURATION : null;
}

/** Montre une notification (ou remplace celle qui porte le même `id`) ; renvoie son identifiant. */
export function showToast(input: ToastInput): string {
  const id = input.id ?? `toast-${++counter}`;
  const existing = toasts.find((toast) => toast.id === id);
  const toast: Toast = {
    ...input,
    id,
    duration: input.duration === undefined ? defaultDuration(input.variant) : input.duration,
    version: (existing?.version ?? 0) + 1,
    leaving: false,
  };
  // Une notification remplacée garde sa place ; une nouvelle s’ajoute en bas de la pile.
  commit(existing ? toasts.map((candidate) => (candidate.id === id ? toast : candidate)) : [...toasts, toast]);
  return id;
}

/** Modifie une notification affichée (sans effet si elle a disparu). */
export function updateToast(id: string, patch: Partial<Omit<ToastInput, 'id'>>): void {
  if (!toasts.some((toast) => toast.id === id && !toast.leaving)) return;
  commit(toasts.map((toast) => (toast.id === id ? { ...toast, ...patch, version: toast.version + 1 } : toast)));
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Retire une notification, après son animation de sortie. */
export function dismissToast(id: string): void {
  if (!toasts.some((toast) => toast.id === id && !toast.leaving)) return;
  if (reducedMotion() || typeof window === 'undefined') {
    commit(toasts.filter((toast) => toast.id !== id));
    return;
  }
  commit(toasts.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)));
  window.setTimeout(() => commit(toasts.filter((toast) => toast.id !== id)), TOAST_EXIT_MS);
}

/** Retire les notifications d’un groupe (sauf `keep`). */
export function dismissGroup(group: string, keep?: string): void {
  for (const toast of toasts) if (toast.group === group && toast.id !== keep) dismissToast(toast.id);
}

export function getToasts(): readonly Toast[] {
  return toasts;
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Notifications affichées, relues à chaque changement. */
export function useToasts(): readonly Toast[] {
  return useSyncExternalStore(subscribeToasts, getToasts, getToasts);
}
