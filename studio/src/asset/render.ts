import { textureUrl } from '../lib/api';
import { loadMinecraftFont } from '../lib/minecraftFont';
import type { MinecraftFont } from '../lib/minecraftFont';
import { loadTexture } from '../lib/textures';
import type { LoadedTexture } from '../lib/textures';
import { charAdvance } from '../model/fontMetrics';
import { drawPanelStyle } from '../model/generator';
import { clamp, clampInsets, clampRegion } from './geometry';
import type { Rect } from './geometry';
import { DEFAULT_LINE_HEIGHT, MAX_ASSET_SIZE } from './model';
import type { AssetDefinition, AssetElement, AssetTextElement, BoxElement, ImageElement } from './model';

/**
 * Rendu d’un asset à l’échelle 1 : fonction pure (hors chargement des
 * ressources), partagée par la toile, l’aperçu d’export et l’export PNG.
 * Jamais de lissage : copies au pixel près, mosaïque pour le nine-slice,
 * plus proche voisin pour les changements d’échelle.
 */

/** Ressources nécessaires au rendu. Texture absente = en chargement, `null` = introuvable. */
export interface RenderResources {
  font: MinecraftFont | null;
  textures: ReadonlyMap<string, LoadedTexture | null>;
}

export interface RenderOptions {
  /** Dessine un repère magenta à la place des textures manquantes (aperçu de l’éditeur). */
  placeholders?: boolean;
}

export interface RenderDeps extends RenderOptions {
  /** Version de chaque texture, pour forcer le rechargement après une écriture. */
  textureVersions?: Record<string, number>;
  /** Police déjà chargée ; sinon la police `vanilla` est chargée (texte approximatif en cas d’échec). */
  font?: MinecraftFont | null;
}

/** Hauteur des glyphes de la police par défaut (sans l’ombre). */
const GLYPH_HEIGHT = 8;

const textureCache = new Map<string, Promise<LoadedTexture | null>>();

/** Charge une texture de l’espace de travail, une seule fois par (chemin, version). */
export function loadAssetTexture(path: string, version = 0): Promise<LoadedTexture | null> {
  const key = `${path}@${version}`;
  let pending = textureCache.get(key);
  if (!pending) {
    pending = loadTexture(textureUrl(path, version)).catch(() => {
      // Un échec n’est pas mis en cache : un nouvel appel retente.
      textureCache.delete(key);
      return null;
    });
    textureCache.set(key, pending);
  }
  return pending;
}

/** Textures utilisées par l’asset, sans doublon. */
export function assetTexturePaths(asset: AssetDefinition): string[] {
  const paths = new Set<string>();
  for (const element of asset.elements) {
    if (element.type === 'image' && element.texture) paths.add(element.texture);
    if (element.type === 'box' && element.style.kind === 'slice' && element.style.texture) paths.add(element.style.texture);
  }
  return [...paths].sort();
}

export async function loadAssetResources(
  asset: AssetDefinition,
  versions: Record<string, number> = {},
  font?: MinecraftFont | null,
): Promise<RenderResources> {
  const paths = assetTexturePaths(asset);
  const fontPromise = font !== undefined ? Promise.resolve(font) : loadMinecraftFont().catch(() => null);
  const [resolvedFont, loaded] = await Promise.all([
    fontPromise,
    Promise.all(paths.map((path) => loadAssetTexture(path, versions[path] ?? 0))),
  ]);
  return { font: resolvedFont, textures: new Map(paths.map((path, index) => [path, loaded[index]])) };
}

/* Texte */

export interface TextLine {
  text: string;
  x: number;
  y: number;
  width: number;
}

/** Retire les codes « § » (repli quand la police du jeu est indisponible). */
function stripFormatting(text: string): string {
  return text.replace(/§./gu, '');
}

function measureLine(line: string, element: AssetTextElement, font: MinecraftFont | null): number {
  const bold = element.bold ?? false;
  // « §l » en tête reproduit exactement le style de départ passé à drawFormatted.
  if (font) return font.measureFormatted(bold ? `§l${line}` : line);
  const plain = stripFormatting(line);
  let width = 0;
  for (const char of plain) width += charAdvance(char) + (bold ? 1 : 0);
  return width;
}

/** Position de chaque ligne (alignée par rapport à `x`) et rectangle englobant. */
export function layoutText(element: AssetTextElement, font: MinecraftFont | null): { lines: TextLine[]; bounds: Rect } {
  const lineHeight = element.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const align = element.align ?? 'left';
  const lines = element.text.split('\n').map((text, index) => {
    const width = measureLine(text, element, font);
    const x = align === 'center' ? element.x - Math.floor(width / 2) : align === 'right' ? element.x - width : element.x;
    return { text, x, y: element.y + index * lineHeight, width };
  });
  const left = Math.min(...lines.map((line) => line.x));
  const right = Math.max(...lines.map((line) => line.x + line.width));
  const height = (lines.length - 1) * lineHeight + GLYPH_HEIGHT + (element.shadow ? 1 : 0);
  return { lines, bounds: { x: left, y: element.y, width: Math.max(2, right - left), height: Math.max(2, height) } };
}

function drawText(ctx: CanvasRenderingContext2D, element: AssetTextElement, font: MinecraftFont | null) {
  const { lines } = layoutText(element, font);
  const color = element.color ?? '#ffffff';
  const shadow = element.shadow ?? false;
  const bold = element.bold ?? false;
  for (const line of lines) {
    if (font) {
      font.drawFormatted(ctx, line.text, line.x, line.y, { color, shadow, bold });
      continue;
    }
    // Repli : police système au pas des avances vanilla (rendu approximatif).
    ctx.save();
    ctx.font = `${GLYPH_HEIGHT}px ui-monospace, Consolas, monospace`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;
    let cursor = line.x;
    for (const char of stripFormatting(line.text)) {
      ctx.fillText(char, cursor, line.y, charAdvance(char));
      cursor += charAdvance(char) + (bold ? 1 : 0);
    }
    ctx.restore();
  }
}

/* Box */

/**
 * Remplit la zone de destination en répétant la zone source, sans jamais
 * l’étirer : la dernière copie de chaque rangée ou colonne est rognée.
 */
function tile(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
  for (let offsetY = 0; offsetY < dh; offsetY += sh) {
    const height = Math.min(sh, dh - offsetY);
    for (let offsetX = 0; offsetX < dw; offsetX += sw) {
      const width = Math.min(sw, dw - offsetX);
      ctx.drawImage(image, sx, sy, width, height, dx + offsetX, dy + offsetY, width, height);
    }
  }
}

/**
 * Nine-slice : coins copiés tels quels, bords et centre en mosaïque. Quand la
 * box est plus petite que ses coins, ils sont rognés (côtés gauche et haut
 * prioritaires), en gardant les pixels du bord extérieur.
 */
function drawSlice(ctx: CanvasRenderingContext2D, element: BoxElement, texture: LoadedTexture) {
  if (element.style.kind !== 'slice') return;
  const source = clampRegion(element.style.source, texture.width, texture.height);
  if (source.width <= 0 || source.height <= 0) return;
  const insets = clampInsets(element.style.insets, source);
  const { x, y, width, height } = element;

  const left = Math.min(insets.left, width);
  const right = Math.min(insets.right, width - left);
  const top = Math.min(insets.top, height);
  const bottom = Math.min(insets.bottom, height - top);
  const centerSourceWidth = source.width - insets.left - insets.right;
  const centerSourceHeight = source.height - insets.top - insets.bottom;
  const centerWidth = width - left - right;
  const centerHeight = height - top - bottom;

  const sourceLeft = source.x;
  const sourceCenterX = source.x + insets.left;
  const sourceRight = source.x + source.width - right;
  const sourceTop = source.y;
  const sourceCenterY = source.y + insets.top;
  const sourceBottom = source.y + source.height - bottom;

  const destCenterX = x + left;
  const destRight = x + width - right;
  const destCenterY = y + top;
  const destBottom = y + height - bottom;
  const image = texture.image;

  tile(ctx, image, sourceLeft, sourceTop, left, top, x, y, left, top);
  tile(ctx, image, sourceRight, sourceTop, right, top, destRight, y, right, top);
  tile(ctx, image, sourceLeft, sourceBottom, left, bottom, x, destBottom, left, bottom);
  tile(ctx, image, sourceRight, sourceBottom, right, bottom, destRight, destBottom, right, bottom);

  tile(ctx, image, sourceCenterX, sourceTop, centerSourceWidth, top, destCenterX, y, centerWidth, top);
  tile(ctx, image, sourceCenterX, sourceBottom, centerSourceWidth, bottom, destCenterX, destBottom, centerWidth, bottom);
  tile(ctx, image, sourceLeft, sourceCenterY, left, centerSourceHeight, x, destCenterY, left, centerHeight);
  tile(ctx, image, sourceRight, sourceCenterY, right, centerSourceHeight, destRight, destCenterY, right, centerHeight);

  tile(ctx, image, sourceCenterX, sourceCenterY, centerSourceWidth, centerSourceHeight, destCenterX, destCenterY, centerWidth, centerHeight);
}

function drawProcedural(ctx: CanvasRenderingContext2D, element: BoxElement) {
  if (element.style.kind !== 'procedural') return;
  const { preset, color, border } = element.style;
  const { x, y, width, height } = element;
  drawPanelStyle(ctx, preset, x, y, width, height, color);
  if (!border || width < 1 || height < 1) return;
  // Contour d’1 px par-dessus ; coins coupés comme le générateur pour les panneaux et boutons.
  const inset = (preset === 'panel' || preset === 'button') && width > 2 && height > 2 ? 1 : 0;
  ctx.fillStyle = border;
  ctx.fillRect(x + inset, y, width - 2 * inset, 1);
  if (height > 1) ctx.fillRect(x + inset, y + height - 1, width - 2 * inset, 1);
  ctx.fillRect(x, y + inset, 1, height - 2 * inset);
  if (width > 1) ctx.fillRect(x + width - 1, y + inset, 1, height - 2 * inset);
}

/* Image */

/** Taille rendue d’une image : zone source × échelle (au moins 1 px). */
export function imageSize(element: ImageElement, texture: LoadedTexture): { width: number; height: number; source: Rect } {
  const source = clampRegion(element.source, texture.width, texture.height);
  const scale = element.scale ?? 1;
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
    source,
  };
}

function drawImageElement(ctx: CanvasRenderingContext2D, element: ImageElement, texture: LoadedTexture) {
  const { width, height, source } = imageSize(element, texture);
  if (source.width <= 0 || source.height <= 0) return;
  ctx.drawImage(texture.image, source.x, source.y, source.width, source.height, element.x, element.y, width, height);
}

/* Assemblage */

const PLACEHOLDER_SIZE = 16;

function drawPlaceholder(ctx: CanvasRenderingContext2D, rect: Rect, missing: boolean) {
  ctx.save();
  ctx.fillStyle = missing ? 'rgba(255, 0, 170, 0.6)' : 'rgba(255, 255, 255, 0.15)';
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

/** Rectangle occupé par un élément, en pixels d’asset. */
export function elementBounds(element: AssetElement, resources: RenderResources): Rect {
  switch (element.type) {
    case 'box':
      return { x: element.x, y: element.y, width: element.width, height: element.height };
    case 'image': {
      const texture = resources.textures.get(element.texture);
      if (!texture) return { x: element.x, y: element.y, width: PLACEHOLDER_SIZE, height: PLACEHOLDER_SIZE };
      const { width, height } = imageSize(element, texture);
      return { x: element.x, y: element.y, width, height };
    }
    case 'text':
      return layoutText(element, resources.font).bounds;
  }
}

function drawElement(
  ctx: CanvasRenderingContext2D,
  element: AssetElement,
  resources: RenderResources,
  options: RenderOptions,
) {
  if (element.type === 'text') {
    drawText(ctx, element, resources.font);
    return;
  }
  if (element.type === 'box' && element.style.kind === 'procedural') {
    drawProcedural(ctx, element);
    return;
  }
  const path = element.type === 'image' ? element.texture : element.style.kind === 'slice' ? element.style.texture : '';
  const texture = resources.textures.get(path);
  if (!texture) {
    if (options.placeholders) drawPlaceholder(ctx, elementBounds(element, resources), texture === null);
    return;
  }
  if (element.type === 'image') drawImageElement(ctx, element, texture);
  else drawSlice(ctx, element, texture);
}

/** Dessine l’asset dans un contexte (origine = coin haut-gauche de l’asset). */
export function drawAsset(
  ctx: CanvasRenderingContext2D,
  asset: AssetDefinition,
  resources: RenderResources,
  options: RenderOptions = {},
) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (asset.background) {
    ctx.fillStyle = asset.background;
    ctx.fillRect(0, 0, asset.size.width, asset.size.height);
  }
  for (const element of asset.elements) {
    if (!element.hidden) drawElement(ctx, element, resources, options);
  }
  ctx.restore();
}

/** Rendu synchrone à l’échelle 1, avec des ressources déjà chargées. */
export function renderAssetSync(
  asset: AssetDefinition,
  resources: RenderResources,
  options: RenderOptions = {},
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = clamp(Math.round(asset.size.width), 1, MAX_ASSET_SIZE);
  canvas.height = clamp(Math.round(asset.size.height), 1, MAX_ASSET_SIZE);
  const ctx = canvas.getContext('2d');
  if (ctx) drawAsset(ctx, asset, resources, options);
  return canvas;
}

/** Charge les ressources (police, textures) puis rend l’asset à l’échelle 1, fond transparent ou `background`. */
export async function renderAsset(asset: AssetDefinition, deps: RenderDeps = {}): Promise<HTMLCanvasElement> {
  const resources = await loadAssetResources(asset, deps.textureVersions, deps.font);
  return renderAssetSync(asset, resources, { placeholders: deps.placeholders ?? false });
}
