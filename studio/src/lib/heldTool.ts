import { useEffect, useRef } from 'react';
import { isEditableTarget } from '../canvas/viewport';
import { shortcutLetter } from './shortcuts';

/** Au-delà de cette durée d’appui (ms), la touche d’outil est « maintenue ». */
export const HOLD_DELAY = 250;

/**
 * Outil « à ressort » (touche Z de l’outil Zoom) : un appui bref choisit
 * l’outil et le garde ; une touche maintenue le prête le temps de l’appui, et
 * l’outil précédent revient au relâchement (ou quand la fenêtre perd le focus).
 *
 * `press` s’appelle depuis le gestionnaire de touches de l’éditeur (qui a déjà
 * écarté les champs de saisie, les dialogues, les modificateurs) ; le
 * relâchement de la lettre `key` est suivi ici.
 */
export function useHeldTool<T>(key: string, setTool: (tool: T) => void) {
  const held = useRef<{ previous: T; since: number } | null>(null);
  const setToolRef = useRef(setTool);
  useEffect(() => {
    setToolRef.current = setTool;
  });

  useEffect(() => {
    const release = () => {
      const current = held.current;
      held.current = null;
      if (current && performance.now() - current.since >= HOLD_DELAY) setToolRef.current(current.previous);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (held.current && !isEditableTarget(event.target) && shortcutLetter(event) === key) release();
    };
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
    };
  }, [key]);

  return {
    /** Touche enfoncée : passe à `tool` (la répétition automatique de la touche est ignorée). */
    press(tool: T, current: T) {
      if (held.current) return;
      held.current = { previous: current, since: performance.now() };
      setToolRef.current(tool);
    },
  };
}
