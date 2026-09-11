import type { ImageBounds } from '../model/compose';

/** Image RGBA 8 bits, non prémultipliée (R, G, B, A ; ligne par ligne, de haut en bas). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Boîte des pixels d’alpha non nul, ou `null` si l’image est entièrement
 * transparente (même règle que `ImageMeasurer` de la lib, et que Minecraft
 * pour l’avance d’un glyphe).
 */
export function measureImage(image: RgbaImage): ImageBounds | null {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { cropX: minX, cropY: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Recadre sur `bounds` puis complète le bas en transparent jusqu’à
 * `targetHeight` ; pixels copiés tels quels, alpha compris (`ImageOps.cropAndPad`).
 */
export function cropAndPad(image: RgbaImage, bounds: ImageBounds, targetHeight: number): RgbaImage {
  const height = Math.max(bounds.height, targetHeight);
  const data = new Uint8Array(bounds.width * height * 4);
  for (let y = 0; y < bounds.height; y++) {
    const from = ((bounds.cropY + y) * image.width + bounds.cropX) * 4;
    data.set(image.data.subarray(from, from + bounds.width * 4), y * bounds.width * 4);
  }
  return { width: bounds.width, height, data };
}
