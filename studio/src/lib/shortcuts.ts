/**
 * Lecture des raccourcis clavier, quelle que soit la disposition (AZERTY,
 * QWERTY, BÉPO…).
 *
 * - Lettres : la lettre produite par la touche (`Ctrl+A` = la touche marquée
 *   A, où qu’elle soit sur le clavier) ; si la touche ne produit pas de lettre
 *   latine (disposition cyrillique, Alt Gr…), repli sur la touche physique
 *   (`event.code`).
 * - Chiffres : toujours la touche physique (`event.code`) : sur AZERTY,
 *   `Ctrl` + la touche du 1 produit « & », pas « 1 ».
 */

/** Lettre du raccourci, en minuscule (`a` à `z`), ou `null`. */
export function shortcutLetter(event: KeyboardEvent): string | null {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase();
  const physical = /^Key([A-Z])$/.exec(event.code);
  return physical ? physical[1].toLowerCase() : null;
}

/** Chiffre du raccourci (`0` à `9`), lu sur la touche physique, ou `null`. */
export function shortcutDigit(event: KeyboardEvent): string | null {
  return /^(?:Digit|Numpad)(\d)$/.exec(event.code)?.[1] ?? null;
}

/** Ctrl (ou Cmd sur macOS) enfoncé. */
export function withCommand(event: KeyboardEvent | MouseEvent | PointerEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

/** Clic d’ajout à la sélection : Maj, Ctrl ou Cmd. */
export function isAdditiveClick(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.shiftKey || event.ctrlKey || event.metaKey;
}

/** Touche de suppression (Suppr ou Retour arrière). */
export function isDeleteKey(event: KeyboardEvent): boolean {
  return event.key === 'Delete' || event.key === 'Backspace';
}

/** Déplacement demandé par les flèches (`step` px, ou `big` avec Maj), sinon `null`. */
export function arrowDelta(event: KeyboardEvent, step: number, big: number): { dx: number; dy: number } | null {
  const amount = event.shiftKey ? big : step;
  switch (event.key) {
    case 'ArrowLeft':
      return { dx: -amount, dy: 0 };
    case 'ArrowRight':
      return { dx: amount, dy: 0 };
    case 'ArrowUp':
      return { dx: 0, dy: -amount };
    case 'ArrowDown':
      return { dx: 0, dy: amount };
    default:
      return null;
  }
}
