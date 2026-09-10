import type { LoadedTexture } from '../lib/textures';
import type { Region } from './model';

/**
 * Sprites d’une texture (atlas) : groupes de pixels opaques reliés, en
 * 8-connexité, chacun avec sa boîte englobante. Sert au mode « Sprite » du
 * sélecteur de zone : un clic sur un pixel donne la zone de son sprite.
 */
export interface SpriteMap {
  /** Zone du sprite sous le pixel (x, y) ; `null` sur un pixel transparent. */
  at(x: number, y: number): Region | null;
  /** Nombre de sprites trouvés. */
  count: number;
}

export function findSprites(texture: LoadedTexture): SpriteMap {
  const { width, height, alpha } = texture;
  // Union-find sur les pixels opaques (-1 = transparent).
  const parent = new Int32Array(width * height).fill(-1);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    for (let node = index; parent[node] !== root; ) {
      const next = parent[node];
      parent[node] = root;
      node = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (alpha[index] === 0) continue;
      parent[index] = index;
      if (x > 0 && alpha[index - 1] > 0) union(index, index - 1);
      if (y > 0) {
        const up = index - width;
        if (alpha[up] > 0) union(index, up);
        if (x > 0 && alpha[up - 1] > 0) union(index, up - 1);
        if (x < width - 1 && alpha[up + 1] > 0) union(index, up + 1);
      }
    }
  }

  const boxes = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (parent[index] < 0) continue;
      const root = find(index);
      const box = boxes.get(root);
      if (!box) boxes.set(root, { minX: x, minY: y, maxX: x, maxY: y });
      else {
        if (x < box.minX) box.minX = x;
        if (x > box.maxX) box.maxX = x;
        if (y > box.maxY) box.maxY = y;
      }
    }
  }

  return {
    count: boxes.size,
    at(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return null;
      const index = y * width + x;
      if (parent[index] < 0) return null;
      const box = boxes.get(find(index));
      return box ? { x: box.minX, y: box.minY, width: box.maxX - box.minX + 1, height: box.maxY - box.minY + 1 } : null;
    },
  };
}
