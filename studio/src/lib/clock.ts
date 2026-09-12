import { useEffect, useState } from 'react';
import { NBSP } from './format';

/** Chronomètres des tâches de fond : « 0:07 », « 1:12 », « 1:02:03 ». */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}:${seconds}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${seconds}`;
}

/** Durée en toutes lettres : « 42 s », « 1 min 12 s » (arrondie comme le chronomètre, à la seconde inférieure). */
export function formatSpan(ms: number): string {
  const total = Math.max(1, Math.floor(ms / 1000));
  if (total < 60) return `${total}${NBSP}s`;
  const seconds = total % 60;
  return `${Math.floor(total / 60)}${NBSP}min${seconds ? ` ${seconds}${NBSP}s` : ''}`;
}

/** Heure courante, rafraîchie chaque seconde tant que `active` (chronomètres). */
export function useNow(active: boolean, interval = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    // oxlint-disable-next-line react/set-state-in-effect
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(timer);
  }, [active, interval]);
  return now;
}
