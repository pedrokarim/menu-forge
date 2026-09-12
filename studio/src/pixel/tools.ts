import type { IconName } from '../ui/Icon';
import type { Symmetry } from './raster';

/** Outils de l’éditeur de pixels, leurs raccourcis et leurs réglages. */

export type PixelTool =
  | 'pencil'
  | 'eraser'
  | 'bucket'
  | 'eyedropper'
  | 'line'
  | 'rectangle'
  | 'ellipse'
  | 'marquee'
  | 'lasso'
  | 'wand'
  | 'move'
  | 'zoom';

export interface ToolInfo {
  label: string;
  /** Raccourci affiché (« B », « Maj+U ») ; lettre lue sur la touche produite, repli sur la touche physique. */
  shortcut: string;
  hint: string;
  icon: IconName;
}

/** Ordre de la palette d’outils. */
export const TOOLS: readonly PixelTool[] = [
  'pencil',
  'eraser',
  'bucket',
  'eyedropper',
  'line',
  'rectangle',
  'ellipse',
  'marquee',
  'lasso',
  'wand',
  'move',
  'zoom',
];

export const TOOL_INFO: Record<PixelTool, ToolInfo> = {
  pencil: { label: 'Crayon', shortcut: 'B', hint: 'Maj+clic : ligne depuis le dernier point ; Alt+clic : pipette', icon: 'pencil' },
  eraser: { label: 'Gomme', shortcut: 'E', hint: 'Rend les pixels transparents', icon: 'eraser' },
  bucket: { label: 'Pot de peinture', shortcut: 'G', hint: 'Remplit la zone de même couleur (contiguë ou globale)', icon: 'bucket' },
  eyedropper: { label: 'Pipette', shortcut: 'I', hint: 'Clic : couleur principale ; Maj+clic : secondaire', icon: 'eyedropper' },
  line: { label: 'Ligne', shortcut: 'L', hint: 'Ligne au pixel près ; Maj : angles de 45°', icon: 'line' },
  rectangle: { label: 'Rectangle', shortcut: 'U', hint: 'Contour ou plein ; Maj : carré', icon: 'box' },
  ellipse: { label: 'Ellipse', shortcut: 'Maj+U', hint: 'Contour ou pleine ; Maj : cercle', icon: 'ellipse' },
  marquee: { label: 'Sélection rectangulaire', shortcut: 'M', hint: 'Maj : ajouter ; Alt : retirer ; glisser dedans : déplacer', icon: 'marquee' },
  lasso: { label: 'Lasso', shortcut: 'Q', hint: 'Sélection à main levée ; Maj : ajouter ; Alt : retirer', icon: 'lasso' },
  wand: { label: 'Baguette magique', shortcut: 'W', hint: 'Sélectionne la zone de même couleur ; Maj : ajouter ; Alt : retirer', icon: 'wand' },
  move: { label: 'Déplacement', shortcut: 'V', hint: 'Déplace la sélection (ou tout le calque) ; Ctrl : en copie', icon: 'drag' },
  zoom: {
    label: 'Zoom',
    shortcut: 'Z',
    hint: 'Clic : zoom avant ; Alt+clic : arrière ; glisser : zoomer sur la zone ; Z maintenu : le temps de l’appui',
    icon: 'zoom-in',
  },
};

/**
 * Lettre du raccourci (sous la forme `KeyX`, voir `shortcutLetter`) → outil, sans modificateur.
 * Z (outil Zoom) n’y est pas : maintenu, il prête l’outil le temps de l’appui (`useHeldTool`).
 */
export const TOOL_CODES: Record<string, PixelTool> = {
  KeyB: 'pencil',
  KeyE: 'eraser',
  KeyG: 'bucket',
  KeyI: 'eyedropper',
  KeyL: 'line',
  KeyU: 'rectangle',
  KeyM: 'marquee',
  KeyQ: 'lasso',
  KeyW: 'wand',
  KeyV: 'move',
};

/** Outils qui peignent avec la brosse (taille réglable). */
export const BRUSH_TOOLS: ReadonlySet<PixelTool> = new Set(['pencil', 'eraser', 'line', 'rectangle', 'ellipse']);
/** Outils qui peignent : Alt+clic y prend la couleur (pipette temporaire). */
export const PAINT_TOOLS: ReadonlySet<PixelTool> = new Set(['pencil', 'eraser', 'bucket', 'line', 'rectangle', 'ellipse']);
/** Outils de sélection. */
export const SELECTION_TOOLS: ReadonlySet<PixelTool> = new Set(['marquee', 'lasso', 'wand']);

export type BrushSize = 1 | 2 | 3 | 4;

export interface ToolOptions {
  /** Côté de la brosse carrée, de 1 à 4 px. */
  brushSize: BrushSize;
  /** Rectangle et ellipse pleins (sinon contour). */
  filled: boolean;
  /** Pot et baguette : zone reliée (sinon toute l’image). */
  contiguous: boolean;
  /** Pot et baguette : écart de couleur accepté par canal, de 0 à 255. */
  tolerance: number;
  /** Crayon de 1 px : supprime les coins en « L » du tracé. */
  pixelPerfect: boolean;
  symmetry: Symmetry;
  /** Pipette : couleur de l’image aplatie (sinon du calque actif). */
  sampleAll: boolean;
}

export const DEFAULT_OPTIONS: ToolOptions = {
  brushSize: 1,
  filled: false,
  contiguous: true,
  tolerance: 0,
  pixelPerfect: true,
  symmetry: { horizontal: false, vertical: false },
  sampleAll: true,
};

/** Paliers de zoom de la toile (×1 à ×64). */
export const ZOOM_LEVELS: readonly number[] = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64];

/** Grille des pixels : dessinée à partir de ce zoom (en dessous, elle cacherait l’image). */
export const GRID_MIN_ZOOM = 4;
