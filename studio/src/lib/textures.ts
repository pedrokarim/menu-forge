import { useEffect, useMemo, useRef, useState } from 'react';
import type { ImageBounds } from '../model/compose';
import { textureUrl } from './api';

/** Texture décodée, avec son canal alpha pour la mesure et le clic au pixel près. */
export interface LoadedTexture {
  image: HTMLImageElement;
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
  bounds: ImageBounds | null;
}

/** `null` = texture introuvable ; clé absente = chargement en cours. */
export type TextureMap = ReadonlyMap<string, LoadedTexture | null>;

export async function loadTexture(url: string): Promise<LoadedTexture> {
  const image = new Image();
  image.src = url;
  await image.decode();

  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D indisponible');
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);

  const alpha = new Uint8ClampedArray(width * height);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = data[(y * width + x) * 4 + 3];
      alpha[y * width + x] = value;
      if (value > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const bounds =
    maxX < 0 ? null : { cropX: minX, cropY: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  return { image, width, height, alpha, bounds };
}

export function alphaAt(texture: LoadedTexture, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= texture.width || y >= texture.height) return 0;
  return texture.alpha[y * texture.width + x];
}

function cacheKey(path: string, versions: Record<string, number>): string {
  return `${path}@${versions[path] ?? 0}`;
}

/**
 * Charge les textures demandées. Incrémenter `versions[path]` après une
 * écriture force le rechargement de cette texture.
 */
export function useTextures(paths: readonly string[], versions: Record<string, number>): TextureMap {
  const [cache, setCache] = useState(() => new Map<string, LoadedTexture | null>());
  const pending = useRef(new Set<string>());

  useEffect(() => {
    for (const path of paths) {
      const key = cacheKey(path, versions);
      if (cache.has(key) || pending.current.has(key)) continue;
      pending.current.add(key);
      loadTexture(textureUrl(path, versions[path] ?? 0))
        .catch(() => null)
        .then((result) => {
          pending.current.delete(key);
          setCache((previous) => new Map(previous).set(key, result));
        });
    }
  }, [paths, versions, cache]);

  return useMemo(() => {
    const visible = new Map<string, LoadedTexture | null>();
    for (const path of paths) {
      const key = cacheKey(path, versions);
      if (cache.has(key)) visible.set(path, cache.get(key) ?? null);
    }
    return visible;
  }, [paths, versions, cache]);
}
