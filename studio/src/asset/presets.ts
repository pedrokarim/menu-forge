import { IMAGE_SCALES } from './model';
import type { AssetDefinition, BoxStyle } from './model';

/** Préréglages de box, outils de la toile et extraits d’export. */

export interface BoxPreset {
  id: string;
  label: string;
  /** Taille proposée quand la box est créée d’un simple clic. */
  width: number;
  height: number;
  style: BoxStyle;
}

export const BOX_PRESETS: readonly BoxPreset[] = [
  {
    id: 'button',
    label: 'Bouton Minecraft',
    width: 64,
    height: 20,
    style: { kind: 'procedural', preset: 'button', color: '#8b8b8b' },
  },
  {
    id: 'panel',
    label: 'Panneau vanilla',
    width: 96,
    height: 64,
    style: { kind: 'procedural', preset: 'panel', color: '#c6c6c6' },
  },
  {
    id: 'enderium_frame',
    label: 'Encart turquoise Enderium',
    width: 44,
    height: 44,
    style: { kind: 'procedural', preset: 'flat', color: '#3b2f2a', border: '#2e8b86' },
  },
  {
    id: 'slot',
    label: 'Cellule de slot',
    width: 18,
    height: 18,
    style: { kind: 'procedural', preset: 'cell', color: '#8b8b8b' },
  },
  {
    id: 'veil',
    label: 'Voile',
    width: 64,
    height: 32,
    style: { kind: 'procedural', preset: 'veil', color: '#00000088' },
  },
];

export const DEFAULT_BOX_PRESET = 'enderium_frame';

export function findBoxPreset(id: string): BoxPreset {
  return BOX_PRESETS.find((preset) => preset.id === id) ?? BOX_PRESETS[0];
}

export type AssetTool = 'select' | 'box' | 'text' | 'image';

export const TOOL_LABELS: Record<AssetTool, { label: string; key: string; hint: string }> = {
  select: { label: 'Sélection', key: 'V', hint: 'Clic : sélectionner · glisser : déplacer · flèches : 1 px (Maj : 10 px)' },
  box: { label: 'Box', key: 'B', hint: 'Glisser : dessiner une box · clic : box à la taille du préréglage' },
  text: { label: 'Texte', key: 'T', hint: 'Clic : poser un texte' },
  image: { label: 'Image', key: 'I', hint: 'Choisis une texture, puis clic : poser l’image' },
};

export const ZOOM_LEVELS = [1, 2, 3, 4, 5, 6, 8, 10, 12] as const;
/** Zoom minimal pour afficher la grille de pixels. */
export const GRID_MIN_ZOOM = 6;
/** Marge autour de la toile de l’asset (px écran), comptée aussi par le zoom « Ajuster ». */
export const CANVAS_PAD = 24;

/** Codes « § » reconnus par le rendu (couleurs vanilla, gras, réinitialisation). */
export const FORMAT_CODES: ReadonlyArray<{ code: string; label: string; color?: string }> = [
  { code: '0', label: 'noir', color: '#000000' },
  { code: '1', label: 'bleu foncé', color: '#0000aa' },
  { code: '2', label: 'vert foncé', color: '#00aa00' },
  { code: '3', label: 'cyan foncé', color: '#00aaaa' },
  { code: '4', label: 'rouge foncé', color: '#aa0000' },
  { code: '5', label: 'violet', color: '#aa00aa' },
  { code: '6', label: 'or', color: '#ffaa00' },
  { code: '7', label: 'gris', color: '#aaaaaa' },
  { code: '8', label: 'gris foncé', color: '#555555' },
  { code: '9', label: 'bleu', color: '#5555ff' },
  { code: 'a', label: 'vert', color: '#55ff55' },
  { code: 'b', label: 'cyan', color: '#55ffff' },
  { code: 'c', label: 'rouge', color: '#ff5555' },
  { code: 'd', label: 'rose', color: '#ff55ff' },
  { code: 'e', label: 'jaune', color: '#ffff55' },
  { code: 'f', label: 'blanc', color: '#ffffff' },
  { code: 'l', label: 'gras' },
  { code: 'r', label: 'réinitialiser' },
];
/** Côté maximal de la toile agrandie (au-delà, mémoire et redessin deviennent trop lourds). */
export const MAX_CANVAS_SIDE = 4096;

export function maxZoomFor(width: number, height: number): number {
  return Math.max(1, Math.floor(MAX_CANVAS_SIDE / Math.max(width, height, 1)));
}

/** Zoom par défaut : le plus grand qui fait tenir l’asset dans une toile d’environ 640 × 420. */
export function defaultZoom(width: number, height: number): number {
  const fit = Math.floor(Math.min(640 / Math.max(width, 1), 420 / Math.max(height, 1)));
  const candidates = ZOOM_LEVELS.filter((level) => level <= fit);
  return candidates.at(-1) ?? 1;
}

/** Plus grande échelle (au plus ×1) qui fait tenir une image dans la place disponible. */
export function fitScale(width: number, height: number, maxWidth: number, maxHeight: number): number {
  const fitting = IMAGE_SCALES.filter((scale) => scale <= 1 && width * scale <= maxWidth && height * scale <= maxHeight);
  return fitting.at(-1) ?? IMAGE_SCALES[0];
}

export function scaleLabel(scale: number): string {
  return scale >= 1 ? `×${scale}` : `×1/${Math.round(1 / scale)}`;
}

/** Entrée de glyphe Enderium (`glyphs/*.yml`) pour l’asset exporté. */
export function glyphYaml(asset: AssetDefinition): string {
  return [
    `${asset.id}:`,
    `  texture: menu-forge/assets/${asset.id}`,
    `  ascent: ${asset.export.ascent}`,
    `  height: ${asset.size.height}`,
  ].join('\n');
}

export function glyphUsage(asset: AssetDefinition): string {
  return `<glyph:${asset.id}>`;
}
