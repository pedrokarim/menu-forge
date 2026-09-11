import { useEffect, useEffectEvent, useRef } from 'react';
import { isEditableTarget } from '../canvas/viewport';
import { overlayOpen } from '../ui/overlay';
import { readClipboard, readPasteEvent, writeClipboard } from './clipboard';
import type { ClipboardContent, ClipboardPayload } from './clipboard';
import { shortcutLetter, withCommand } from './shortcuts';

/** Délai d’attente de l’événement `paste` natif avant de lire le presse-papiers soi-même. */
const PASTE_FALLBACK_MS = 100;
/** Un événement `copy` / `cut` qui suit de si près Ctrl+C / Ctrl+X ne fait que poser le texte. */
const KEYBOARD_COPY_WINDOW_MS = 500;

export interface ClipboardHandlers {
  /** Les raccourcis s’appliquent (écran affiché, bon mode…). */
  enabled: () => boolean;
  /** Extrait de la sélection à copier (avec message d’état), ou `null` s’il n’y a rien à copier. */
  copy: () => ClipboardPayload | null;
  /** Retire la sélection, après une copie (Couper). */
  remove: () => void;
  paste: (content: ClipboardContent) => void;
}

/**
 * Vrai si du texte est sélectionné dans la page : Ctrl+C doit alors copier ce
 * texte, pas la sélection du studio. Une sélection « accidentelle » dans les
 * listes, la toile ou les barres d’outils (Maj+clic) ne compte pas.
 */
function hasTextSelection(): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.toString().length === 0) return false;
  const node = selection.anchorNode;
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  return !element?.closest('.outline-list, .stage, .asset-stage, .toolbar, .stage-toolbar, .asset-toolbar');
}

/**
 * Ctrl+C, Ctrl+X, Ctrl+V sur la toile. Les événements natifs `copy` / `cut`
 * / `paste` ne sont pas émis partout quand le focus n’est pas dans un champ :
 * - Ctrl+C / Ctrl+X agissent dès l’appui (mémoire + presse-papiers
 *   asynchrone) ; l’événement natif qui suit éventuellement pose le même
 *   texte, de façon synchrone ;
 * - Ctrl+V attend l’événement `paste` (seul accès sans autorisation aux
 *   images collées) ; faute de quoi, le presse-papiers est lu par l’API
 *   asynchrone, avec repli sur le dernier extrait copié dans le studio.
 * Un champ de saisie, un dialogue ou un menu ouvert gardent leur comportement habituel.
 */
export function useClipboardShortcuts(handlers: ClipboardHandlers) {
  const keyboardCopy = useRef<{ payload: ClipboardPayload; at: number } | null>(null);
  const pendingPaste = useRef<number | null>(null);

  const ready = (event: Event) => handlers.enabled() && !overlayOpen() && !isEditableTarget(event.target);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!withCommand(event) || event.altKey || event.defaultPrevented || !ready(event)) return;
    const letter = shortcutLetter(event);
    if (letter === 'c' || letter === 'x') {
      if (hasTextSelection()) return;
      const payload = handlers.copy();
      if (!payload) return;
      writeClipboard(payload);
      keyboardCopy.current = { payload, at: Date.now() };
      if (letter === 'x') handlers.remove();
    } else if (letter === 'v') {
      if (pendingPaste.current !== null) window.clearTimeout(pendingPaste.current);
      pendingPaste.current = window.setTimeout(() => {
        pendingPaste.current = null;
        void readClipboard().then((content) => handlers.paste(content));
      }, PASTE_FALLBACK_MS);
    }
  });

  const onClipboard = useEffectEvent((event: ClipboardEvent) => {
    if (!ready(event)) return;
    if (event.type === 'paste') {
      if (pendingPaste.current !== null) {
        window.clearTimeout(pendingPaste.current);
        pendingPaste.current = null;
      }
      const content = readPasteEvent(event);
      if (!content.payload && !content.image) return;
      event.preventDefault();
      handlers.paste(content);
      return;
    }
    const recent = keyboardCopy.current;
    keyboardCopy.current = null;
    if (recent && Date.now() - recent.at < KEYBOARD_COPY_WINDOW_MS) {
      writeClipboard(recent.payload, event);
      return;
    }
    if (hasTextSelection()) return;
    const payload = handlers.copy();
    if (!payload) return;
    writeClipboard(payload, event);
    if (event.type === 'cut') handlers.remove();
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => onKeyDown(event);
    const onEvent = (event: ClipboardEvent) => onClipboard(event);
    window.addEventListener('keydown', onKey);
    window.addEventListener('copy', onEvent);
    window.addEventListener('cut', onEvent);
    window.addEventListener('paste', onEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('copy', onEvent);
      window.removeEventListener('cut', onEvent);
      window.removeEventListener('paste', onEvent);
      if (pendingPaste.current !== null) window.clearTimeout(pendingPaste.current);
    };
  }, []);
}
