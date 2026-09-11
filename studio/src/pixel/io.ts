import { createState, layersForSave, nextVersion } from './document';
import type { PixelDocumentFile, PixelLayer, PixelMeta, PixelState } from './document';
import { base64ToBytes, decodePng, encodePng } from './png';
import { composeOver } from './raster';
import type { Bitmap } from './raster';

/**
 * Passage entre les tampons RGBA de l’éditeur et le reste du monde : PNG,
 * base64, canvas d’affichage. Les pixels enregistrés ou exportés ne passent
 * jamais par un canvas (voir `png.ts`) : aucune perte sur les pixels translucides.
 */

/** Canvas 2D de la taille donnée. */
export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Contexte 2D sans lissage (lecture fréquente activée : pipette). */
export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D indisponible');
  context.imageSmoothingEnabled = false;
  return context;
}

/** Canvas qui montre un tampon RGBA (affichage seulement : vignettes, toile). */
export function dataToCanvas(data: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  context2d(canvas).putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return canvas;
}

/**
 * Image aplatie, calculée exactement : calques visibles de bas en haut, avec
 * leur opacité, contenu flottant posé. C’est le PNG exporté.
 */
export function flattenData(state: PixelState, layers: readonly PixelLayer[] = layersForSave(state)): Uint8ClampedArray {
  let data: Uint8ClampedArray = new Uint8ClampedArray(state.width * state.height * 4);
  for (const layer of layers) {
    if (layer.visible && layer.opacity > 0) data = composeOver(data, layer.data, layer.opacity);
  }
  return data;
}

export function flattenToBlob(state: PixelState): Promise<Blob> {
  return encodePng({ width: state.width, height: state.height, data: flattenData(state) });
}

/** Octets → base64, par blocs (pas de pile d’appel démesurée pour les grandes images). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const block = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += block) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + block));
  }
  return btoa(binary);
}

/** Décodage par le navigateur (PNG 16 bits, entrelacés, autres formats d’image). */
async function decodeWithBrowser(url: string): Promise<Bitmap> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = createCanvas(width, height);
  const context = context2d(canvas);
  context.drawImage(image, 0, 0);
  return { width, height, data: context.getImageData(0, 0, width, height).data };
}

/** Tampon RGBA d’octets d’image : lecture exacte des PNG courants, sinon le navigateur. */
export async function bytesToBitmap(bytes: Uint8Array, type = 'image/png'): Promise<Bitmap> {
  const exact = await decodePng(bytes);
  if (exact) return exact;
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  try {
    return await decodeWithBrowser(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Tampon RGBA d’une image désignée par une URL (texture de l’espace, bibliothèque). */
export async function loadBitmap(url: string): Promise<Bitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error((await response.text()) || `Image introuvable (${response.status})`);
  const blob = await response.blob();
  return bytesToBitmap(new Uint8Array(await blob.arrayBuffer()), blob.type || 'image/png');
}

/** Tampon RGBA d’une image du presse-papiers système. */
export async function blobToBitmap(blob: Blob): Promise<Bitmap> {
  return bytesToBitmap(new Uint8Array(await blob.arrayBuffer()), blob.type || 'image/png');
}

/** Tampon RGBA → PNG (sans perte). */
export function bitmapToBlob(bitmap: Bitmap): Promise<Blob> {
  return encodePng(bitmap);
}

/** Document sur disque → état de l’éditeur (chaque calque est décodé depuis son PNG). */
export async function decodeDocument(file: PixelDocumentFile): Promise<{ meta: PixelMeta; state: PixelState }> {
  const { width, height } = file.size;
  const layers: PixelLayer[] = [];
  for (const layer of file.layers) {
    const bitmap = await bytesToBitmap(base64ToBytes(layer.png));
    if (bitmap.width !== width || bitmap.height !== height) {
      throw new Error(`Le calque « ${layer.name} » ne fait pas ${width} × ${height} px`);
    }
    layers.push({ id: layer.id, name: layer.name, visible: layer.visible, opacity: layer.opacity, data: bitmap.data });
  }
  const state: PixelState = layers.length
    ? { width, height, layers, activeLayerId: layers[layers.length - 1].id, selection: null, floating: null, contentVersion: nextVersion() }
    : createState(width, height);
  const meta: PixelMeta = { id: file.id, name: file.name, texture: file.export.texture };
  if (file.source) meta.source = file.source;
  return { meta, state };
}

/** État de l’éditeur → document sur disque (le contenu flottant est posé, sans changer l’état). */
export async function encodeDocument(meta: PixelMeta, state: PixelState): Promise<PixelDocumentFile> {
  const layers = [];
  for (const layer of layersForSave(state)) {
    const blob = await encodePng({ width: state.width, height: state.height, data: layer.data });
    layers.push({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      png: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
    });
  }
  const file: PixelDocumentFile = {
    formatVersion: 1,
    id: meta.id,
    name: meta.name,
    size: { width: state.width, height: state.height },
    layers,
    export: { texture: meta.texture },
  };
  if (meta.source) file.source = meta.source;
  return file;
}
