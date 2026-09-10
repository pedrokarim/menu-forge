/**
 * Palette « Deepslate » de tout ce que la toile dessine par-dessus le menu :
 * sélection, poignées, repères, étiquettes. Elle ne s’applique jamais au fond
 * ni aux couches de l’utilisateur.
 */
export const OVERLAY = {
  gold: '#f2c94c',
  ink: '#000000',
  guide: 'rgba(242, 201, 76, 0.7)',
  hover: 'rgba(242, 201, 76, 0.6)',
  draftFill: 'rgba(242, 201, 76, 0.18)',
  labelText: '#f6f1e3',
} as const;

/** Police des étiquettes (chargée par l’appli), avec repli si elle manque. */
export const LABEL_FONT_FAMILY = '"Pixelify Sans", ui-monospace, Consolas, monospace';

export function labelFont(size: number): string {
  return `${size}px ${LABEL_FONT_FAMILY}`;
}
