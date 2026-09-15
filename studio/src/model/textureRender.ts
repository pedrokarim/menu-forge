import { encodePng } from '../export/png';
import type { RgbaImage } from '../export/image';
import { DARK_COLORS, DARK_PARAMS, DARK_PRESETS, DARK_STYLE_LABELS, darkNumber, isDarkStyle, paintDarkStyle } from './darkStyles';
import { GENERATOR_PRESETS, PANEL_STYLE_LABELS, paintPanelStyle, readableColor } from './generator';
import { SLOT_SIZE, chestCell } from './geometry';
import type { Point, Rect } from './geometry';
import { isPixelIcon, paintIcon } from './pixelIcons';
import { MARKET_PARAMS, MARKET_PRESETS, MARKET_STYLE_LABELS, isMarketStyle, marketAccent, marketNumber, paintMarketStyle } from './marketStyles';
import { DEFAULT_TILE, MCRS_COLORS, MCRS_PARAMS, MCRS_PRESETS, MCRS_STYLE_LABELS, isMcrsStyle, mcrsNumber, paintMcrsStyle } from './mcrs';
import type { CellStyle, GeneratorSpec, GeneratorStyle } from './menu';
import { createImage, rasterPainter } from './painter';
import type { Painter } from './painter';

/**
 * Cuisson des textures générées, tous styles confondus : rendu dans un tampon
 * RVBA puis PNG écrit sans canvas. Le résultat ne dépend que de la spécification
 * (mêmes octets à chaque cuisson, dans le studio comme dans les tests) ; chargé
 * à la demande, il n’alourdit pas le paquet principal.
 */

export function paintGeneratorStyle(
  painter: Painter,
  style: GeneratorStyle,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  spec: Partial<GeneratorSpec> = {},
) {
  if (isMcrsStyle(style)) paintMcrsStyle(painter, style, x, y, width, height, color, spec);
  else if (isDarkStyle(style)) paintDarkStyle(painter, style, x, y, width, height, color, spec);
  else if (isMarketStyle(style)) paintMarketStyle(painter, style, x, y, width, height, color, spec);
  else paintPanelStyle(painter, style, x, y, width, height, color);
}

/** Couleur par défaut des cellules de slots d’un style. */
export function defaultCellColor(style: CellStyle | undefined): string {
  if (style === 'mcrs_slot') return MCRS_COLORS.slot;
  if (style === 'dark_slot') return DARK_COLORS.hollow;
  return '#8b8b8b';
}

/**
 * Rend une texture générée. `origin` = position de la couche dans la fenêtre :
 * les cellules demandées sont dessinées à leur place exacte dans la grille.
 */
export function renderGeneratorImage(spec: GeneratorSpec, origin: Point): RgbaImage {
  const image = createImage(spec.width, spec.height);
  const painter = rasterPainter(image);
  paintGeneratorStyle(painter, spec.style, 0, 0, image.width, image.height, spec.color, spec);

  const cellStyle = spec.cellStyle ?? 'cell';
  const cellColor = spec.cellColor ?? defaultCellColor(cellStyle);
  for (const area of spec.cells ?? []) {
    for (let dx = 0; dx < (area.width ?? 1); dx++) {
      for (let dy = 0; dy < (area.height ?? 1); dy++) {
        const cell = chestCell(area.col + dx, area.row + dy);
        paintGeneratorStyle(painter, cellStyle, cell.x - origin.x, cell.y - origin.y, SLOT_SIZE, SLOT_SIZE, cellColor);
      }
    }
  }
  if (spec.icon && isPixelIcon(spec.icon)) {
    const body = buttonBody(spec);
    paintIcon(painter, spec.icon, body.x, body.y, body.width, body.height, spec.iconColor ?? defaultIconColor(spec.color));
  }
  return image;
}

/** Icône sans couleur imposée : claire, ou foncée sur un fond clair. */
export function defaultIconColor(background: string): string {
  return readableColor(background, '#f8f8f8', ['#202020']);
}

/**
 * Corps visible d’un bouton, où l’icône se centre : sans l’ombre portée des
 * boutons mc-rs, et abaissé quand le bouton en relief est pressé.
 */
export function buttonBody(spec: GeneratorSpec): Rect {
  const { style, width, height } = spec;
  if (style === 'mcrs_raised' || style === 'mcrs_button') {
    const depth = Math.min(mcrsNumber(style, spec, 'shadow'), height - (style === 'mcrs_raised' ? 2 : 1));
    const top = style === 'mcrs_raised' && spec.state === 'pressed' ? depth : 0;
    return { x: 0, y: top, width, height: height - depth };
  }
  return { x: 0, y: 0, width, height };
}

export function renderGeneratorPng(spec: GeneratorSpec, origin: Point): Promise<Uint8Array> {
  return encodePng(renderGeneratorImage(spec, origin));
}

/** PNG de la texture, prêt à téléverser. */
export async function renderGeneratorBlob(spec: GeneratorSpec, origin: Point): Promise<Blob> {
  const bytes = await renderGeneratorPng(spec, origin);
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' });
}

/** Copie un tampon RVBA dans une toile (aperçus). */
export function imageToCanvas(image: RgbaImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return canvas;
}

/* Familles de styles (dialogue du générateur de textures) */

export type StyleFamilyId = 'deepslate' | 'mcrs' | 'dark' | 'market';

export const STYLE_FAMILY_ORDER: readonly StyleFamilyId[] = ['deepslate', 'mcrs', 'dark', 'market'];

export const STYLE_FAMILY_NAMES: Record<StyleFamilyId, string> = {
  deepslate: 'Deepslate',
  mcrs: 'mc-rs',
  dark: 'Sombre à accent',
  market: 'Marché',
};

export const STYLE_LABELS: Record<StyleFamilyId, Readonly<Record<string, string>>> = {
  deepslate: PANEL_STYLE_LABELS,
  mcrs: MCRS_STYLE_LABELS,
  dark: DARK_STYLE_LABELS,
  market: MARKET_STYLE_LABELS,
};

export const PRESETS_BY_FAMILY: Record<StyleFamilyId, ReadonlyArray<{ label: string; spec: GeneratorSpec }>> = {
  deepslate: GENERATOR_PRESETS,
  mcrs: MCRS_PRESETS,
  dark: DARK_PRESETS,
  market: MARKET_PRESETS,
};

export function styleFamily(style: GeneratorStyle): StyleFamilyId {
  if (isMcrsStyle(style)) return 'mcrs';
  if (isDarkStyle(style)) return 'dark';
  if (isMarketStyle(style)) return 'market';
  return 'deepslate';
}

/** Paramètres réglables d’un style (aucun pour les styles Deepslate). */
export type StyleParam = 'radius' | 'borderWidth' | 'borderColor' | 'accent' | 'state' | 'shadow' | 'tile' | 'progress';

export function styleParams(style: GeneratorStyle): readonly StyleParam[] {
  if (isMcrsStyle(style)) return MCRS_PARAMS[style];
  if (isDarkStyle(style)) return DARK_PARAMS[style];
  if (isMarketStyle(style)) return MARKET_PARAMS[style];
  return [];
}

/** Valeur effective d’un paramètre numérique : celle de la spécification, sinon le défaut du style. */
export function paramNumber(
  style: GeneratorStyle,
  spec: Partial<GeneratorSpec>,
  param: 'radius' | 'borderWidth' | 'shadow' | 'tile' | 'progress',
): number {
  if (isMcrsStyle(style)) {
    if (param === 'tile') return spec.tile ?? DEFAULT_TILE;
    if (param === 'progress') return 0;
    return mcrsNumber(style, spec, param);
  }
  if (isDarkStyle(style)) return param === 'radius' ? 0 : darkNumber(style, spec, param);
  if (isMarketStyle(style)) return param === 'radius' || param === 'shadow' ? 0 : marketNumber(style, spec, param);
  return 0;
}

export function defaultAccent(style: GeneratorStyle): string {
  if (isMarketStyle(style)) return marketAccent(style);
  return isDarkStyle(style) ? DARK_COLORS.accent : MCRS_COLORS.gold;
}

/** Couleur proposée quand on personnalise la bordure (ou la seconde bande, ou la croix). */
export function defaultBorderColor(style: GeneratorStyle): string {
  if (style === 'dark_awning' || style === 'dark_close') return DARK_COLORS.text;
  return isDarkStyle(style) || isMarketStyle(style) ? DARK_COLORS.frame : MCRS_COLORS.panelBorder;
}
