/** Petits utilitaires de dessin partagés par la toile, le sélecteur de zone et l’aperçu d’export. */

const CHECKER_DARK = '#2a2d34';
const CHECKER_LIGHT = '#33363e';

/** Damier de transparence (cases de `cell` pixels écran), dessiné via un motif pour rester rapide. */
export function fillChecker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  cell = 8,
) {
  const tile = document.createElement('canvas');
  tile.width = cell * 2;
  tile.height = cell * 2;
  const tileCtx = tile.getContext('2d');
  ctx.save();
  if (tileCtx) {
    tileCtx.fillStyle = CHECKER_DARK;
    tileCtx.fillRect(0, 0, cell * 2, cell * 2);
    tileCtx.fillStyle = CHECKER_LIGHT;
    tileCtx.fillRect(0, 0, cell, cell);
    tileCtx.fillRect(cell, cell, cell, cell);
    const pattern = ctx.createPattern(tile, 'repeat');
    ctx.fillStyle = pattern ?? CHECKER_DARK;
  } else {
    ctx.fillStyle = CHECKER_DARK;
  }
  ctx.translate(x, y);
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/** Copie agrandie d’un canvas à l’échelle 1, au plus proche voisin. */
export function drawScaled(target: HTMLCanvasElement, source: HTMLCanvasElement, scale: number, checker = true) {
  target.width = source.width * scale;
  target.height = source.height * scale;
  const ctx = target.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  if (checker) fillChecker(ctx, 0, 0, target.width, target.height, 4 * scale);
  ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, target.width, target.height);
}

/** Vrai si la frappe a lieu dans un champ de saisie (les raccourcis de l’éditeur l’ignorent). */
export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]') !== null;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
