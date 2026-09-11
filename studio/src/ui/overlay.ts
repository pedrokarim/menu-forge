/**
 * Vrai si un dialogue ou un menu contextuel est ouvert : les raccourcis des
 * éditeurs (Suppr, flèches, Ctrl+Z…) ne doivent pas agir sur l’élément caché
 * derrière.
 */
export function overlayOpen(): boolean {
  return document.querySelector('.modal-backdrop, .context-menu') !== null;
}
