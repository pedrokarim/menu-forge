/**
 * Moteur de l’éditeur de pixels : tampons RGBA purs, sans DOM.
 *
 * Un tampon est un `Uint8ClampedArray` de `largeur × hauteur × 4` octets
 * (rouge, vert, bleu, alpha, non prémultipliés), ligne par ligne. Un masque
 * (sélection, remplissage) est un `Uint8Array` de `largeur × hauteur` octets,
 * 1 là où le pixel est pris.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Bitmap {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

export function createBitmap(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function cloneBitmap(bitmap: Bitmap): Bitmap {
  return { width: bitmap.width, height: bitmap.height, data: bitmap.data.slice() };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* ---------- Couleurs ---------- */

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** `#rgb`, `#rgba`, `#rrggbb` ou `#rrggbbaa` (dièse facultatif) ; `null` si la saisie est invalide. */
export function parseHex(text: string): Rgba | null {
  const match = HEX.exec(text.trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length <= 4) hex = [...hex].map((digit) => digit + digit).join('');
  const value = (index: number) => Number.parseInt(hex.slice(index, index + 2), 16);
  return { r: value(0), g: value(2), b: value(4), a: hex.length === 8 ? value(6) : 255 };
}

/** `#rrggbb` si la couleur est opaque, sinon `#rrggbbaa`. */
export function toHex(color: Rgba, withAlpha = color.a !== 255): string {
  const part = (value: number) => Math.round(value).toString(16).padStart(2, '0');
  return `#${part(color.r)}${part(color.g)}${part(color.b)}${withAlpha ? part(color.a) : ''}`;
}

export function cssColor(color: Rgba): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${(color.a / 255).toFixed(3)})`;
}

export function sameColor(a: Rgba, b: Rgba): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

export function readPixel(bitmap: Bitmap, x: number, y: number): Rgba {
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return TRANSPARENT;
  const index = (y * bitmap.width + x) * 4;
  const { data } = bitmap;
  return { r: data[index], g: data[index + 1], b: data[index + 2], a: data[index + 3] };
}

/** Écart entre deux pixels (0 = identiques) ; deux pixels transparents sont toujours égaux. */
function distance(data: Uint8ClampedArray, index: number, target: Rgba): number {
  const alpha = data[index + 3];
  if (alpha === 0 && target.a === 0) return 0;
  return Math.max(
    Math.abs(data[index] - target.r),
    Math.abs(data[index + 1] - target.g),
    Math.abs(data[index + 2] - target.b),
    Math.abs(alpha - target.a),
  );
}

/** Couleurs distinctes d’un tampon (les pixels transparents sont ignorés), au plus `limit`. */
export function distinctColors(data: Uint8ClampedArray, limit: number): Rgba[] {
  const seen = new Set<number>();
  const colors: Rgba[] = [];
  for (let index = 0; index < data.length && colors.length < limit; index += 4) {
    if (data[index + 3] === 0) continue;
    const key = ((data[index] << 24) | (data[index + 1] << 16) | (data[index + 2] << 8) | data[index + 3]) >>> 0;
    if (seen.has(key)) continue;
    seen.add(key);
    colors.push({ r: data[index], g: data[index + 1], b: data[index + 2], a: data[index + 3] });
  }
  return colors;
}

/* ---------- Peinture ---------- */

/** Rectangle modifié pendant un geste (bornes incluses ; vide tant que `maxX < minX`). */
export interface DirtyBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function emptyDirty(): DirtyBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function dirtyRect(dirty: DirtyBox): Rect | null {
  if (dirty.maxX < dirty.minX) return null;
  return { x: dirty.minX, y: dirty.minY, width: dirty.maxX - dirty.minX + 1, height: dirty.maxY - dirty.minY + 1 };
}

export interface Symmetry {
  /** Miroir gauche ↔ droite (axe vertical au centre de l’image). */
  horizontal: boolean;
  /** Miroir haut ↔ bas (axe horizontal au centre de l’image). */
  vertical: boolean;
}

export const NO_SYMMETRY: Symmetry = { horizontal: false, vertical: false };

/**
 * Surface d’un geste de peinture : `data` est modifié, `base` garde le calque
 * d’avant le geste (les couleurs translucides se mélangent à lui une seule
 * fois, même si le pinceau repasse), `clip` limite à la sélection.
 */
export interface PaintSurface {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  base: Uint8ClampedArray;
  clip: Uint8Array | null;
  symmetry: Symmetry;
  dirty: DirtyBox;
}

export function createSurface(bitmap: Bitmap, clip: Uint8Array | null, symmetry: Symmetry): PaintSurface {
  return {
    width: bitmap.width,
    height: bitmap.height,
    data: bitmap.data.slice(),
    base: bitmap.data,
    clip,
    symmetry,
    dirty: emptyDirty(),
  };
}

/** Pixels miroirs de (x, y) selon la symétrie, (x, y) compris, sans doublon. */
export function mirrored(surface: { width: number; height: number; symmetry: Symmetry }, x: number, y: number): Point[] {
  const points = [{ x, y }];
  const { horizontal, vertical } = surface.symmetry;
  const mx = surface.width - 1 - x;
  const my = surface.height - 1 - y;
  if (horizontal && mx !== x) points.push({ x: mx, y });
  if (vertical && my !== y) points.push({ x, y: my });
  if (horizontal && vertical && mx !== x && my !== y) points.push({ x: mx, y: my });
  return points;
}

function touch(dirty: DirtyBox, x: number, y: number) {
  if (x < dirty.minX) dirty.minX = x;
  if (y < dirty.minY) dirty.minY = y;
  if (x > dirty.maxX) dirty.maxX = x;
  if (y > dirty.maxY) dirty.maxY = y;
}

/** Un pixel, sans symétrie : `null` efface, sinon la couleur est posée sur le pixel d’avant le geste. */
function setOne(surface: PaintSurface, x: number, y: number, color: Rgba | null) {
  if (x < 0 || y < 0 || x >= surface.width || y >= surface.height) return;
  const cell = y * surface.width + x;
  if (surface.clip && !surface.clip[cell]) return;
  const index = cell * 4;
  const { data, base } = surface;
  if (color === null || color.a === 0) {
    if (color === null) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
      data[index + 3] = 0;
      touch(surface.dirty, x, y);
    }
    return;
  }
  if (color.a === 255 || base[index + 3] === 0) {
    data[index] = color.r;
    data[index + 1] = color.g;
    data[index + 2] = color.b;
    data[index + 3] = color.a;
  } else {
    // Mélange « par-dessus » (non prémultiplié) avec le pixel d’avant le geste.
    const sourceAlpha = color.a / 255;
    const destinationAlpha = (base[index + 3] / 255) * (1 - sourceAlpha);
    const alpha = sourceAlpha + destinationAlpha;
    data[index] = (color.r * sourceAlpha + base[index] * destinationAlpha) / alpha;
    data[index + 1] = (color.g * sourceAlpha + base[index + 1] * destinationAlpha) / alpha;
    data[index + 2] = (color.b * sourceAlpha + base[index + 2] * destinationAlpha) / alpha;
    data[index + 3] = alpha * 255;
  }
  touch(surface.dirty, x, y);
}

/** Pose un pixel et ses miroirs. */
export function plot(surface: PaintSurface, x: number, y: number, color: Rgba | null) {
  for (const point of mirrored(surface, x, y)) setOne(surface, point.x, point.y, color);
}

/** Remet un pixel (et ses miroirs) dans l’état d’avant le geste. */
export function restore(surface: PaintSurface, x: number, y: number) {
  for (const point of mirrored(surface, x, y)) {
    if (point.x < 0 || point.y < 0 || point.x >= surface.width || point.y >= surface.height) continue;
    const index = (point.y * surface.width + point.x) * 4;
    for (let channel = 0; channel < 4; channel++) surface.data[index + channel] = surface.base[index + channel];
    touch(surface.dirty, point.x, point.y);
  }
}

/** Remet tout un rectangle dans l’état d’avant le geste (aperçu des formes). */
export function restoreRect(surface: PaintSurface, rect: Rect | null) {
  if (!rect) return;
  const x0 = clamp(rect.x, 0, surface.width);
  const x1 = clamp(rect.x + rect.width, 0, surface.width);
  const y0 = clamp(rect.y, 0, surface.height);
  const y1 = clamp(rect.y + rect.height, 0, surface.height);
  if (x1 <= x0 || y1 <= y0) return;
  for (let y = y0; y < y1; y++) {
    const start = (y * surface.width + x0) * 4;
    surface.data.set(surface.base.subarray(start, (y * surface.width + x1) * 4), start);
  }
  touch(surface.dirty, x0, y0);
  touch(surface.dirty, x1 - 1, y1 - 1);
}

/** Rectangle qui couvre des pixels posés avec une brosse de `size` px, miroirs compris. */
export function paintedBounds(points: readonly Point[], size: number, surface: { width: number; height: number; symmetry: Symmetry }): Rect | null {
  if (points.length === 0) return null;
  const offset = brushOffset(size);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x - offset);
    minY = Math.min(minY, point.y - offset);
    maxX = Math.max(maxX, point.x - offset + size - 1);
    maxY = Math.max(maxY, point.y - offset + size - 1);
  }
  const { horizontal, vertical } = surface.symmetry;
  if (horizontal) [minX, maxX] = [Math.min(minX, surface.width - 1 - maxX), Math.max(maxX, surface.width - 1 - minX)];
  if (vertical) [minY, maxY] = [Math.min(minY, surface.height - 1 - maxY), Math.max(maxY, surface.height - 1 - minY)];
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Décalage du coin haut-gauche d’une brosse carrée de `size` px centrée sur un pixel. */
export function brushOffset(size: number): number {
  return Math.floor((size - 1) / 2);
}

/** Tampon carré de `size` px (1 à 4), centré sur (x, y). */
export function stamp(surface: PaintSurface, x: number, y: number, size: number, color: Rgba | null) {
  const offset = brushOffset(size);
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) plot(surface, x - offset + dx, y - offset + dy, color);
  }
}

/** Segment de Bresenham, extrémités comprises : chaque pixel touche le suivant, jamais de doublon (« pixel parfait »). */
export function linePoints(x0: number, y0: number, x1: number, y1: number): Point[] {
  const points: Point[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    points.push({ x, y });
    if (x === x1 && y === y1) return points;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
}

/** Contraint (x1, y1) à l’horizontale, la verticale ou la diagonale depuis (x0, y0) (Maj). */
export function constrainAngle(start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx > ady * 2) return { x: end.x, y: start.y };
  if (ady > adx * 2) return { x: start.x, y: end.y };
  const length = Math.max(adx, ady);
  return { x: start.x + Math.sign(dx) * length, y: start.y + Math.sign(dy) * length };
}

/** Contraint un rectangle à un carré (Maj), côté le plus long. */
export function constrainSquare(start: Point, end: Point): Point {
  const length = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  return { x: start.x + (end.x < start.x ? -length : length), y: start.y + (end.y < start.y ? -length : length) };
}

export function rectFromPoints(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 };
}

/** Pixels d’un rectangle : son contour de `thickness` px (vers l’intérieur), ou tout son intérieur. */
export function rectanglePoints(rect: Rect, filled: boolean, thickness = 1): Point[] {
  const points: Point[] = [];
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const inner =
        x >= rect.x + thickness &&
        x < rect.x + rect.width - thickness &&
        y >= rect.y + thickness &&
        y < rect.y + rect.height - thickness;
      if (filled || !inner) points.push({ x, y });
    }
  }
  return points;
}

/**
 * Ellipse inscrite dans un rectangle (algorithme d’Alois Zingl), tailles
 * paires comprises : le contour, ou toutes les lignes remplies.
 */
export function ellipsePoints(rect: Rect, filled: boolean): Point[] {
  let x0 = rect.x;
  let y0 = rect.y;
  let x1 = rect.x + rect.width - 1;
  let y1 = rect.y + rect.height - 1;
  const rows = new Map<number, { min: number; max: number }>();
  const outline: Point[] = [];
  const put = (x: number, y: number) => {
    outline.push({ x, y });
    const row = rows.get(y);
    if (row) {
      row.min = Math.min(row.min, x);
      row.max = Math.max(row.max, x);
    } else {
      rows.set(y, { min: x, max: x });
    }
  };
  let a = Math.abs(x1 - x0);
  const b = Math.abs(y1 - y0);
  let b1 = b & 1;
  let dx = 4 * (1 - a) * b * b;
  let dy = 4 * (b1 + 1) * a * a;
  let error = dx + dy + b1 * a * a;
  y0 += (b + 1) >> 1;
  y1 = y0 - b1;
  a *= 8 * a;
  b1 = 8 * b * b;
  do {
    put(x1, y0);
    put(x0, y0);
    put(x0, y1);
    put(x1, y1);
    const doubled = 2 * error;
    if (doubled <= dy) {
      y0++;
      y1--;
      dy += a;
      error += dy;
    }
    if (doubled >= dx || 2 * error > dy) {
      x0++;
      x1--;
      dx += b1;
      error += dx;
    }
  } while (x0 <= x1);
  // Ellipses très plates : les extrémités restantes.
  while (y0 - y1 <= b) {
    put(x0 - 1, y0);
    put(x1 + 1, y0++);
    put(x0 - 1, y1);
    put(x1 + 1, y1--);
  }
  if (!filled) return outline;
  const points: Point[] = [];
  for (const [y, { min, max }] of rows) for (let x = min; x <= max; x++) points.push({ x, y });
  return points;
}

/* ---------- Remplissage et sélection par couleur ---------- */

/**
 * Pixels de même couleur que (x, y), à `tolerance` près (0 à 255, écart par
 * canal) : reliés par les côtés (`contiguous`) ou dans toute l’image.
 */
export function floodMask(bitmap: Bitmap, x: number, y: number, tolerance: number, contiguous: boolean): Uint8Array {
  const { width, height, data } = bitmap;
  const mask = new Uint8Array(width * height);
  if (x < 0 || y < 0 || x >= width || y >= height) return mask;
  const target = readPixel(bitmap, x, y);
  if (!contiguous) {
    for (let cell = 0; cell < mask.length; cell++) if (distance(data, cell * 4, target) <= tolerance) mask[cell] = 1;
    return mask;
  }
  const matches = (cell: number) => !mask[cell] && distance(data, cell * 4, target) <= tolerance;
  // Remplissage par lignes : une pile de germes, chaque ligne étendue à gauche et à droite.
  const stack = [y * width + x];
  while (stack.length > 0) {
    const seed = stack.pop() as number;
    if (!matches(seed)) continue;
    const row = Math.floor(seed / width);
    let left = seed % width;
    let right = left;
    while (left > 0 && matches(row * width + left - 1)) left--;
    while (right < width - 1 && matches(row * width + right + 1)) right++;
    for (let column = left; column <= right; column++) mask[row * width + column] = 1;
    for (const next of [row - 1, row + 1]) {
      if (next < 0 || next >= height) continue;
      let inRun = false;
      for (let column = left; column <= right; column++) {
        const cell = next * width + column;
        const open = matches(cell);
        if (open && !inRun) stack.push(cell);
        inRun = open;
      }
    }
  }
  return mask;
}

/** Peint les pixels d’un masque (la sélection et la symétrie restent celles de la surface). */
export function fillMask(surface: PaintSurface, mask: Uint8Array, color: Rgba | null) {
  for (let cell = 0; cell < mask.length; cell++) {
    if (mask[cell]) setOne(surface, cell % surface.width, Math.floor(cell / surface.width), color);
  }
}

/* ---------- Masques de sélection ---------- */

export type SelectionMode = 'replace' | 'add' | 'subtract';

export function rectMask(width: number, height: number, rect: Rect): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = Math.max(0, rect.y); y < Math.min(height, rect.y + rect.height); y++) {
    mask.fill(1, y * width + Math.max(0, rect.x), y * width + Math.min(width, rect.x + rect.width));
  }
  return mask;
}

/** Masque d’un tracé libre (lasso) : l’intérieur du polygone et le tracé lui-même. */
export function polygonMask(width: number, height: number, points: readonly Point[]): Uint8Array {
  const mask = new Uint8Array(width * height);
  const mark = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) mask[y * width + x] = 1;
  };
  for (let index = 0; index < points.length; index++) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    for (const point of linePoints(from.x, from.y, to.x, to.y)) mark(point.x, point.y);
  }
  if (points.length < 3) return mask;
  // Intérieur : règle pair-impair sur le centre des pixels, ligne par ligne.
  for (let y = 0; y < height; y++) {
    const center = y + 0.5;
    const crossings: number[] = [];
    for (let index = 0; index < points.length; index++) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      const ay = a.y + 0.5;
      const by = b.y + 0.5;
      if ((ay <= center && by > center) || (by <= center && ay > center)) {
        crossings.push(a.x + 0.5 + ((center - ay) / (by - ay)) * (b.x - a.x));
      }
    }
    crossings.sort((left, right) => left - right);
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const start = Math.max(0, Math.ceil(crossings[index] - 0.5));
      const end = Math.min(width - 1, Math.floor(crossings[index + 1] - 0.5));
      for (let x = start; x <= end; x++) mask[y * width + x] = 1;
    }
  }
  return mask;
}

/** Combine une nouvelle zone à la sélection actuelle (remplacer, ajouter, retirer). */
export function combineMasks(current: Uint8Array | null, next: Uint8Array, mode: SelectionMode): Uint8Array {
  if (mode === 'replace' || !current) return mode === 'subtract' ? new Uint8Array(next.length) : next;
  const result = current.slice();
  for (let cell = 0; cell < next.length; cell++) {
    if (!next[cell]) continue;
    result[cell] = mode === 'add' ? 1 : 0;
  }
  return result;
}

/** Plus petit rectangle qui contient le masque ; `null` s’il est vide. */
export function maskBounds(mask: Uint8Array, width: number): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let cell = 0; cell < mask.length; cell++) {
    if (!mask[cell]) continue;
    const x = cell % width;
    const y = (cell - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function invertMask(mask: Uint8Array): Uint8Array {
  return mask.map((value) => (value ? 0 : 1));
}

/** Pixel (x, y) dans le masque (hors image : non). */
export function maskHas(mask: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
}

/**
 * Bords d’un masque, en segments fusionnés (coordonnées de coins de pixels),
 * pour tracer la sélection en « fourmis ».
 */
export function maskEdges(mask: Uint8Array, width: number, height: number): Array<[number, number, number, number]> {
  const edges: Array<[number, number, number, number]> = [];
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  // Bords horizontaux : au-dessus de chaque ligne y (0 à height).
  for (let y = 0; y <= height; y++) {
    let start = -1;
    let startKind = 0;
    for (let x = 0; x <= width; x++) {
      const kind = x < width && inside(x, y) !== inside(x, y - 1) ? (inside(x, y) ? 1 : 2) : 0;
      if (kind !== startKind) {
        if (startKind !== 0) edges.push([start, y, x, y]);
        start = x;
        startKind = kind;
      }
    }
  }
  // Bords verticaux : à gauche de chaque colonne x (0 à width).
  for (let x = 0; x <= width; x++) {
    let start = -1;
    let startKind = 0;
    for (let y = 0; y <= height; y++) {
      const kind = y < height && inside(x, y) !== inside(x - 1, y) ? (inside(x, y) ? 1 : 2) : 0;
      if (kind !== startKind) {
        if (startKind !== 0) edges.push([x, start, x, y]);
        start = y;
        startKind = kind;
      }
    }
  }
  return edges;
}

/* ---------- Contenu flottant (déplacer, coller, transformer) ---------- */

/** Pixels détachés de leur calque, posés en (x, y) ; `mask`  pixels qui en font partie. */
export interface Floating {
  x: number;
  y: number;
  bitmap: Bitmap;
  mask: Uint8Array;
}

/** Détache la sélection d’un calque : le contenu flottant, et le calque où la zone est vidée. */
export function lift(layer: Bitmap, selection: Uint8Array): { floating: Floating; layer: Uint8ClampedArray } | null {
  const bounds = maskBounds(selection, layer.width);
  if (!bounds) return null;
  const bitmap = createBitmap(bounds.width, bounds.height);
  const mask = new Uint8Array(bounds.width * bounds.height);
  const rest = layer.data.slice();
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const cell = (bounds.y + y) * layer.width + bounds.x + x;
      if (!selection[cell]) continue;
      const local = y * bounds.width + x;
      mask[local] = 1;
      bitmap.data.set(layer.data.subarray(cell * 4, cell * 4 + 4), local * 4);
      rest.fill(0, cell * 4, cell * 4 + 4);
    }
  }
  return { floating: { x: bounds.x, y: bounds.y, bitmap, mask }, layer: rest };
}

/** Pose le contenu flottant sur un calque (par-dessus, découpé aux bords) ; renvoie le nouveau tampon. */
export function stampFloating(layer: Bitmap, floating: Floating): Uint8ClampedArray {
  const data = layer.data.slice();
  const { bitmap, mask } = floating;
  for (let y = 0; y < bitmap.height; y++) {
    const targetY = floating.y + y;
    if (targetY < 0 || targetY >= layer.height) continue;
    for (let x = 0; x < bitmap.width; x++) {
      const targetX = floating.x + x;
      if (targetX < 0 || targetX >= layer.width || !mask[y * bitmap.width + x]) continue;
      const source = (y * bitmap.width + x) * 4;
      const target = (targetY * layer.width + targetX) * 4;
      const sourceAlpha = bitmap.data[source + 3] / 255;
      if (sourceAlpha === 0) continue;
      const destinationAlpha = (data[target + 3] / 255) * (1 - sourceAlpha);
      const alpha = sourceAlpha + destinationAlpha;
      for (let channel = 0; channel < 3; channel++) {
        data[target + channel] = (bitmap.data[source + channel] * sourceAlpha + data[target + channel] * destinationAlpha) / alpha;
      }
      data[target + 3] = alpha * 255;
    }
  }
  return data;
}

/** Masque de la sélection occupée par le contenu flottant, dans l’image (pixels hors image ignorés). */
export function floatingSelection(floating: Floating, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < floating.bitmap.height; y++) {
    for (let x = 0; x < floating.bitmap.width; x++) {
      if (!floating.mask[y * floating.bitmap.width + x]) continue;
      const targetX = floating.x + x;
      const targetY = floating.y + y;
      if (targetX >= 0 && targetY >= 0 && targetX < width && targetY < height) mask[targetY * width + targetX] = 1;
    }
  }
  return mask;
}

/** Transformation d’un bloc de pixels et de son masque. */
export type Transform = 'flip-h' | 'flip-v' | 'rotate-cw' | 'rotate-ccw';

/** Applique une transformation à un tampon (et à un masque de même taille, facultatif). */
export function transformBitmap(bitmap: Bitmap, transform: Transform, mask?: Uint8Array): { bitmap: Bitmap; mask?: Uint8Array } {
  const { width, height } = bitmap;
  const rotates = transform === 'rotate-cw' || transform === 'rotate-ccw';
  const out = createBitmap(rotates ? height : width, rotates ? width : height);
  const outMask = mask ? new Uint8Array(out.width * out.height) : undefined;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let tx = x;
      let ty = y;
      if (transform === 'flip-h') tx = width - 1 - x;
      else if (transform === 'flip-v') ty = height - 1 - y;
      else if (transform === 'rotate-cw') {
        tx = height - 1 - y;
        ty = x;
      } else {
        tx = y;
        ty = width - 1 - x;
      }
      const source = y * width + x;
      const target = ty * out.width + tx;
      out.data.set(bitmap.data.subarray(source * 4, source * 4 + 4), target * 4);
      if (mask && outMask) outMask[target] = mask[source];
    }
  }
  return { bitmap: out, mask: outMask };
}

/** Transforme le contenu flottant autour de son centre. */
export function transformFloating(floating: Floating, transform: Transform): Floating {
  const { bitmap, mask } = transformBitmap(floating.bitmap, transform, floating.mask);
  const centerX = floating.x + floating.bitmap.width / 2;
  const centerY = floating.y + floating.bitmap.height / 2;
  return {
    bitmap,
    mask: mask ?? new Uint8Array(bitmap.width * bitmap.height).fill(1),
    x: Math.round(centerX - bitmap.width / 2),
    y: Math.round(centerY - bitmap.height / 2),
  };
}

/**
 * Pose `above` (opacité en %) par-dessus `below`, pixel à pixel (mélange
 * « par-dessus » non prémultiplié, exact) ; renvoie un nouveau tampon.
 */
export function composeOver(below: Uint8ClampedArray, above: Uint8ClampedArray, opacity: number): Uint8ClampedArray {
  const out = below.slice();
  const factor = opacity / 100;
  for (let index = 0; index < out.length; index += 4) {
    const sourceAlpha = (above[index + 3] / 255) * factor;
    if (sourceAlpha === 0) continue;
    if (sourceAlpha === 1) {
      out[index] = above[index];
      out[index + 1] = above[index + 1];
      out[index + 2] = above[index + 2];
      out[index + 3] = 255;
      continue;
    }
    const destinationAlpha = (out[index + 3] / 255) * (1 - sourceAlpha);
    const alpha = sourceAlpha + destinationAlpha;
    for (let channel = 0; channel < 3; channel++) {
      out[index + channel] = (above[index + channel] * sourceAlpha + out[index + channel] * destinationAlpha) / alpha;
    }
    out[index + 3] = alpha * 255;
  }
  return out;
}

/* ---------- Toile ---------- */

/** Recopie un tampon dans une toile de nouvelle taille ; `offset`  position de l’ancien coin haut-gauche. */
export function resizeCanvasData(source: Bitmap, width: number, height: number, offset: Point): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < source.height; y++) {
    const targetY = y + offset.y;
    if (targetY < 0 || targetY >= height) continue;
    const x0 = Math.max(0, -offset.x);
    const x1 = Math.min(source.width, width - offset.x);
    if (x1 <= x0) continue;
    const start = (y * source.width + x0) * 4;
    data.set(source.data.subarray(start, (y * source.width + x1) * 4), (targetY * width + x0 + offset.x) * 4);
  }
  return data;
}

/** Mise à l’échelle au plus proche voisin (les pixels restent nets). */
export function scaleNearest(source: Bitmap, width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(source.height - 1, Math.floor((y * source.height) / height));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(source.width - 1, Math.floor((x * source.width) / width));
      const from = (sourceY * source.width + sourceX) * 4;
      data.set(source.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return data;
}

/** Plus petit rectangle qui contient les pixels non transparents ; `null` si tout est transparent. */
export function opaqueBounds(bitmap: Bitmap): Rect | null {
  const mask = new Uint8Array(bitmap.width * bitmap.height);
  for (let cell = 0; cell < mask.length; cell++) mask[cell] = bitmap.data[cell * 4 + 3] > 0 ? 1 : 0;
  return maskBounds(mask, bitmap.width);
}
