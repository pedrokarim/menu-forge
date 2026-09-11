import type { Bitmap, Rect } from '../pixel/raster';

/**
 * Chaîne de contrainte des textures générées par IA : l’image du modèle
 * (souvent 1024 px, fond uni, pixels flous) devient une texture de la taille
 * visée, sur la grille des pixels, en palette imposée, avec une vraie
 * transparence. Fonctions pures sur des tampons RGBA (aucun canvas : pas de
 * prémultiplication de l’alpha), testées dans `tests/ai-constrain.test.ts`.
 *
 * Étapes, dans l’ordre :
 * 1. détourage du fond (couleur dominante du pourtour, propagée depuis les
 *    bords), sauf si le modèle a déjà rendu une vraie transparence ;
 * 2. alpha nettoyé (seuil : transparent ou opaque, pas de halo) ;
 * 3. recadrage sur le sujet (pixels opaques) et placement « contenu » dans la
 *    taille visée, centré ;
 * 4. réduction au plus proche voisin (échantillon au centre de chaque case) ;
 * 5. quantification sur la palette (distance « redmean », perceptuelle) ;
 * 6. pixels transparents remis à zéro (RVB compris).
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Palette imposée : couleurs fixes, calculée sur l’image (`count` couleurs), ou libre. */
export type PaletteChoice = { kind: 'fixed'; colors: Rgb[] } | { kind: 'auto'; count: number } | { kind: 'free' };

export interface ConstrainOptions {
  width: number;
  height: number;
  removeBackground: boolean;
  /** Distance de couleur tolérée pour le fond (0 à 255 environ). */
  backgroundTolerance: number;
  cropToSubject: boolean;
  /** Seuil d’alpha (1 à 255) : en dessous, transparent ; sinon opaque. `null` : alpha gardé tel quel. */
  alphaThreshold: number | null;
  palette: PaletteChoice;
}

export const DEFAULT_CONSTRAINTS: Omit<ConstrainOptions, 'width' | 'height' | 'palette'> = {
  removeBackground: true,
  backgroundTolerance: 48,
  cropToSubject: true,
  alphaThreshold: 128,
};

export interface ConstrainReport {
  /** Part des pixels de l’image source rendus transparents par le détourage (0 à 1). */
  backgroundRemoved: number;
  /** La source avait déjà une vraie transparence (détourage inutile). */
  sourceHadAlpha: boolean;
  /** Zone de la source gardée (recadrage sur le sujet), `null` si elle est vide. */
  subject: Rect | null;
  /** Couleurs opaques distinctes du résultat. */
  colors: number;
  palette: Rgb[];
}

/* ---------- Couleurs ---------- */

export function parseHexColor(text: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(text.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function toHexColor(color: Rgb): string {
  return `#${[color.r, color.g, color.b].map((part) => Math.round(part).toString(16).padStart(2, '0')).join('')}`;
}

/** Couleurs lues depuis des `#rrggbb`, sans doublon, dans l’ordre. */
export function parsePalette(hexes: readonly string[]): Rgb[] {
  const seen = new Set<string>();
  const colors: Rgb[] = [];
  for (const hex of hexes) {
    const color = parseHexColor(hex);
    if (!color) continue;
    const key = toHexColor(color);
    if (seen.has(key)) continue;
    seen.add(key);
    colors.push(color);
  }
  return colors;
}

/** Distance « redmean » au carré : proche de la perception, sans passer en Lab. */
export function colorDistance(a: Rgb, b: Rgb): number {
  const mean = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return (2 + mean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - mean) / 256) * db * db;
}

export function nearestColor(color: Rgb, palette: readonly Rgb[]): Rgb {
  let best = palette[0];
  let bestDistance = Infinity;
  for (const candidate of palette) {
    const distance = colorDistance(color, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

const pixelAt = (data: Uint8ClampedArray, offset: number): Rgb => ({ r: data[offset], g: data[offset + 1], b: data[offset + 2] });

/** Couleurs opaques de l’image, des plus fréquentes aux plus rares (`limit` au plus). */
export function extractPalette(bitmap: Bitmap, limit: number): Rgb[] {
  const counts = new Map<number, number>();
  for (let offset = 0; offset < bitmap.data.length; offset += 4) {
    if (bitmap.data[offset + 3] < 128) continue;
    const key = (bitmap.data[offset] << 16) | (bitmap.data[offset + 1] << 8) | bitmap.data[offset + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([key]) => ({ r: (key >> 16) & 255, g: (key >> 8) & 255, b: key & 255 }));
}

/**
 * Palette de `count` couleurs au plus, par coupe médiane sur les pixels
 * opaques (déterministe : même image, même palette).
 */
export function medianCutPalette(bitmap: Bitmap, count: number): Rgb[] {
  const pixels: Rgb[] = [];
  for (let offset = 0; offset < bitmap.data.length; offset += 4) {
    if (bitmap.data[offset + 3] >= 128) pixels.push(pixelAt(bitmap.data, offset));
  }
  if (pixels.length === 0 || count <= 0) return [];
  let boxes: Rgb[][] = [pixels];
  const range = (box: Rgb[], channel: keyof Rgb) => {
    let min = 255;
    let max = 0;
    for (const pixel of box) {
      min = Math.min(min, pixel[channel]);
      max = Math.max(max, pixel[channel]);
    }
    return max - min;
  };
  while (boxes.length < count) {
    // Boîte à couper : la plus étendue sur un canal (à égalité, la plus peuplée).
    let target = -1;
    let targetChannel: keyof Rgb = 'r';
    let targetRange = 0;
    boxes.forEach((box, index) => {
      if (box.length < 2) return;
      for (const channel of ['r', 'g', 'b'] as const) {
        const extent = range(box, channel);
        if (extent > targetRange || (extent === targetRange && target >= 0 && box.length > boxes[target].length)) {
          target = index;
          targetChannel = channel;
          targetRange = extent;
        }
      }
    });
    if (target < 0 || targetRange === 0) break;
    const channel = targetChannel;
    const sorted = [...boxes[target]].sort((a, b) => a[channel] - b[channel]);
    const middle = Math.floor(sorted.length / 2);
    boxes = [...boxes.slice(0, target), sorted.slice(0, middle), sorted.slice(middle), ...boxes.slice(target + 1)];
  }
  const colors = boxes.map((box) => {
    const sum = box.reduce((total, pixel) => ({ r: total.r + pixel.r, g: total.g + pixel.g, b: total.b + pixel.b }), { r: 0, g: 0, b: 0 });
    return { r: Math.round(sum.r / box.length), g: Math.round(sum.g / box.length), b: Math.round(sum.b / box.length) };
  });
  return parsePalette(colors.map(toHexColor));
}

/* ---------- Transparence ---------- */

/** Vraie transparence déjà présente : au moins 1 % de pixels translucides. */
export function hasTransparency(bitmap: Bitmap): boolean {
  let translucent = 0;
  const total = bitmap.width * bitmap.height;
  for (let offset = 3; offset < bitmap.data.length; offset += 4) if (bitmap.data[offset] < 250) translucent++;
  return total > 0 && translucent / total >= 0.01;
}

/** Couleur dominante du pourtour (par cases de 8 niveaux par canal), moyenne de sa case. */
export function borderColor(bitmap: Bitmap): Rgb {
  const { width, height, data } = bitmap;
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  const visit = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    const key = ((data[offset] >> 3) << 10) | ((data[offset + 1] >> 3) << 5) | (data[offset + 2] >> 3);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++;
    bucket.r += data[offset];
    bucket.g += data[offset + 1];
    bucket.b += data[offset + 2];
    buckets.set(key, bucket);
  };
  for (let x = 0; x < width; x++) {
    visit(x, 0);
    if (height > 1) visit(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    visit(0, y);
    if (width > 1) visit(width - 1, y);
  }
  let best = { count: 0, r: 0, g: 0, b: 0 };
  for (const bucket of buckets.values()) if (bucket.count > best.count) best = bucket;
  return best.count ? { r: best.r / best.count, g: best.g / best.count, b: best.b / best.count } : { r: 0, g: 0, b: 0 };
}

/**
 * Détoure le fond : les pixels reliés au pourtour (4-voisinage) et proches de
 * sa couleur dominante deviennent transparents. Renvoie une copie et le
 * nombre de pixels détourés.
 */
export function removeBackground(bitmap: Bitmap, tolerance: number): { bitmap: Bitmap; removed: number } {
  const { width, height } = bitmap;
  const data = bitmap.data.slice();
  const background = borderColor(bitmap);
  const limit = colorDistance({ r: 0, g: 0, b: 0 }, { r: tolerance, g: tolerance, b: tolerance });
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const push = (x: number, y: number) => {
    const cell = y * width + x;
    if (visited[cell]) return;
    visited[cell] = 1;
    const offset = cell * 4;
    if (data[offset + 3] < 128 || colorDistance(pixelAt(data, offset), background) <= limit) queue[tail++] = cell;
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }
  let removed = 0;
  while (head < tail) {
    const cell = queue[head++];
    data[cell * 4 + 3] = 0;
    removed++;
    const x = cell % width;
    const y = (cell - x) / width;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }
  return { bitmap: { width, height, data }, removed };
}

/** Alpha tout ou rien : sous le seuil, transparent (RVB à zéro) ; sinon opaque. */
export function cleanAlpha(bitmap: Bitmap, threshold: number): Bitmap {
  const data = bitmap.data.slice();
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] < threshold) data.fill(0, offset, offset + 4);
    else data[offset + 3] = 255;
  }
  return { width: bitmap.width, height: bitmap.height, data };
}

/** Plus petit rectangle des pixels non transparents ; `null` si tout est transparent. */
export function subjectBounds(bitmap: Bitmap): Rect | null {
  let minX = bitmap.width;
  let minY = bitmap.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      if (bitmap.data[(y * bitmap.width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/* ---------- Réduction ---------- */

/**
 * Réduit la zone `source` de l’image vers `width` × `height` au plus proche
 * voisin : chaque pixel d’arrivée prend le pixel source au centre de sa case
 * (pas de mélange de couleurs : les aplats restent des aplats).
 */
export function downscaleNearest(bitmap: Bitmap, source: Rect, width: number, height: number): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(bitmap.height - 1, source.y + Math.floor(((y + 0.5) * source.height) / height));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(bitmap.width - 1, source.x + Math.floor(((x + 0.5) * source.width) / width));
      const from = (sourceY * bitmap.width + sourceX) * 4;
      data.set(bitmap.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** Pose `bitmap` au centre d’une toile transparente de `width` × `height`. */
export function centerOn(bitmap: Bitmap, width: number, height: number): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  const left = Math.floor((width - bitmap.width) / 2);
  const top = Math.floor((height - bitmap.height) / 2);
  for (let y = 0; y < bitmap.height; y++) {
    const start = y * bitmap.width * 4;
    data.set(bitmap.data.subarray(start, start + bitmap.width * 4), ((y + top) * width + left) * 4);
  }
  return { width, height, data };
}

/** Quantifie les pixels visibles sur la palette (l’alpha est gardé). */
export function quantize(bitmap: Bitmap, palette: readonly Rgb[]): Bitmap {
  if (palette.length === 0) return bitmap;
  const data = bitmap.data.slice();
  const cache = new Map<number, Rgb>();
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    const key = (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
    let color = cache.get(key);
    if (!color) {
      color = nearestColor(pixelAt(data, offset), palette);
      cache.set(key, color);
    }
    data[offset] = color.r;
    data[offset + 1] = color.g;
    data[offset + 2] = color.b;
  }
  return { width: bitmap.width, height: bitmap.height, data };
}

function countColors(bitmap: Bitmap): number {
  const seen = new Set<number>();
  for (let offset = 0; offset < bitmap.data.length; offset += 4) {
    if (bitmap.data[offset + 3] > 0) seen.add((bitmap.data[offset] << 16) | (bitmap.data[offset + 1] << 8) | bitmap.data[offset + 2]);
  }
  return seen.size;
}

/** Toute la chaîne (voir l’en-tête du module). */
export function constrainTexture(source: Bitmap, options: ConstrainOptions): { bitmap: Bitmap; report: ConstrainReport } {
  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height));
  const sourceHadAlpha = hasTransparency(source);
  let working = source;
  let removed = 0;
  if (options.removeBackground && !sourceHadAlpha) {
    const result = removeBackground(source, options.backgroundTolerance);
    working = result.bitmap;
    removed = result.removed;
  }
  if (options.alphaThreshold !== null) working = cleanAlpha(working, options.alphaThreshold);

  const whole: Rect = { x: 0, y: 0, width: working.width, height: working.height };
  const subject = options.cropToSubject ? subjectBounds(working) : whole;
  let result: Bitmap;
  if (!subject) {
    result = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  } else if (options.cropToSubject) {
    // « Contenu » : le sujet garde ses proportions et tient dans la taille visée.
    const scale = Math.min(width / subject.width, height / subject.height);
    const fitted = downscaleNearest(
      working,
      subject,
      Math.max(1, Math.min(width, Math.round(subject.width * scale))),
      Math.max(1, Math.min(height, Math.round(subject.height * scale))),
    );
    result = centerOn(fitted, width, height);
  } else {
    result = downscaleNearest(working, whole, width, height);
  }
  if (options.alphaThreshold !== null) result = cleanAlpha(result, options.alphaThreshold);

  const palette =
    options.palette.kind === 'fixed' ? options.palette.colors : options.palette.kind === 'auto' ? medianCutPalette(result, options.palette.count) : [];
  result = quantize(result, palette);
  // Pixels invisibles : RVB à zéro (PNG propre, aucune couleur cachée sous l’alpha).
  const data = result.data;
  for (let offset = 0; offset < data.length; offset += 4) if (data[offset + 3] === 0) data.fill(0, offset, offset + 4);

  return {
    bitmap: result,
    report: {
      backgroundRemoved: source.width * source.height ? removed / (source.width * source.height) : 0,
      sourceHadAlpha,
      subject: options.cropToSubject ? subject : whole,
      colors: countColors(result),
      palette,
    },
  };
}
