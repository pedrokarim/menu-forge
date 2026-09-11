/**
 * Images venues de l’extérieur (fichier glissé depuis l’explorateur, image
 * collée depuis le presse-papiers) : elles deviennent des textures de
 * l’espace de travail, sans jamais écraser une texture existante.
 */

/** Vrai si un glisser transporte des fichiers (et pas du texte ou un élément de la page). */
export function hasDraggedFiles(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer !== null && [...dataTransfer.types].includes('Files');
}

/** Fichiers PNG d’une liste (les autres sont ignorés). */
export function pngFiles(list: FileList | null): File[] {
  return [...(list ?? [])].filter((file) => file.type === 'image/png' || /\.png$/i.test(file.name));
}

/** Premier chemin libre `dossier/base.png`, `dossier/base_2.png`… */
export function uniqueTexturePath(folder: string, base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let candidate = `${folder}/${base}.png`;
  for (let index = 2; used.has(candidate); index++) candidate = `${folder}/${base}_${index}.png`;
  return candidate;
}

/** Nom d’une image collée : `pasted_20260911_102233`. */
export function pastedImageName(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `pasted_${day}_${time}`;
}

/** Taille d’une image, ou `null` si elle ne se décode pas. */
export async function imageSizeOf(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}
