/** Anneau de huit carrés (ligne, colonne), dans le sens des aiguilles d’une montre. */
const RING = [
  [1, 1],
  [1, 2],
  [1, 3],
  [2, 3],
  [3, 3],
  [3, 2],
  [3, 1],
  [2, 1],
] as const;
/** Décalage entre deux carrés : un tour dure 8 × 120 ms (voir `feedback.css`). */
const STEP_MS = 120;

/**
 * Picto animé au pixel : huit carrés d’or s’allument tour à tour autour d’un
 * centre vide, par paliers nets (pas de fondu). Sans animation
 * (`prefers-reduced-motion`), l’anneau reste allumé, immobile. Décoratif :
 * le texte voisin dit ce qui se passe.
 */
export function PixelSpinner({ size = 24, className }: { size?: 12 | 24; className?: string }) {
  const classes = ['pixel-spinner', size === 12 ? 'pixel-spinner-12' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <span className={classes} aria-hidden="true">
      {RING.map(([row, column], index) => (
        // Délais négatifs : l’animation est déjà en route à l’affichage.
        <i key={index} style={{ gridRow: row, gridColumn: column, animationDelay: `${(index - RING.length) * STEP_MS}ms` }} />
      ))}
    </span>
  );
}
