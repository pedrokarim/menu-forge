import type { Region } from '../asset/model';
import { canvasToBlob } from '../model/generator';

/** Découpe `region` dans une image et la renvoie en PNG. */
export async function cropToBlob(image: CanvasImageSource, region: Region): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = region.width;
  canvas.height = region.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponible');
  context.imageSmoothingEnabled = false;
  context.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
  return canvasToBlob(canvas);
}

/**
 * Chemin (relatif à textures/) d’une découpe : la zone fait partie du nom, la
 * même découpe réécrit donc le même fichier au lieu d’en créer un nouveau.
 */
export function croppedTexturePath(base: string, region: Region): string {
  return `cropped/${base}_${region.x}_${region.y}_${region.width}x${region.height}.png`;
}

/** Nom de fichier sans dossier ni extension (`a/b/logo.png` → `logo`). */
export function textureBaseName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.png$/i, '');
}
