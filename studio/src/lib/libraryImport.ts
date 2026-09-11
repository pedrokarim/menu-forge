import { createEmptyMenu, sanitizeId, uniqueId } from '../model/menu';
import type { Layer, MenuDefinition } from '../model/menu';
import { importFromLibrary } from './libraryApi';
import type { FontGlyph, LibraryIndex, LibrarySourceInfo } from './libraryApi';

export interface FontImportResult {
  menu: MenuDefinition;
  warnings: string[];
}

/**
 * Reconstruit un menu à partir d’une police de pack (façon « un menu = une
 * police ») : chaque glyphe-image devient une couche placée à `y = 13 − ascent`
 * (x = 0, les packs de ce type commencent le titre par un recul de −8). Les
 * polices référencées (`reference`) passent en premier, comme dans le jeu.
 * La première image de chaque police est visible (typiquement la barre de
 * navigation partagée et le fond de l’écran) ; les autres dépendent d’un
 * drapeau `show.<id>` à activer dans l’aperçu.
 */
export async function buildMenuFromFont(
  source: LibrarySourceInfo,
  index: LibraryIndex,
  fontId: string,
  menuId: string,
  name: string,
): Promise<FontImportResult> {
  const fonts = new Map(index.fonts.map((font) => [font.id, font]));
  const textures = new Map(index.textures.map((texture) => [texture.path, texture]));
  const warnings: string[] = [];
  const glyphs: Array<FontGlyph & { primary: boolean }> = [];
  const visited = new Set<string>();

  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const font = fonts.get(id);
    if (!font) {
      warnings.push(`Police référencée introuvable : ${id}`);
      return;
    }
    for (const reference of font.references) visit(reference);
    font.glyphs.forEach((glyph, position) => glyphs.push({ ...glyph, primary: position === 0 }));
  };
  visit(fontId);

  const layers: Layer[] = [];
  const seen = new Set<string>();
  for (const glyph of glyphs) {
    const key = `${glyph.texture}@${glyph.ascent}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const texture = textures.get(glyph.texture);
    if (!glyph.found || !texture) {
      warnings.push(`Texture absente du pack : ${glyph.texture}`);
      continue;
    }
    if (texture.height !== glyph.height) {
      warnings.push(`${glyph.texture} : affichée à ${glyph.height} px pour ${texture.height} px d’image (mise à l’échelle non gérée), ignorée`);
      continue;
    }
    const imported = await importFromLibrary(source.id, glyph.texture);
    const base = sanitizeId(glyph.texture.split('/').pop()?.replace(/\.png$/i, '') ?? 'layer');
    const id = uniqueId(base, layers.map((layer) => layer.id));
    layers.push({
      id,
      texture: imported,
      x: 0,
      y: 13 - glyph.ascent,
      visibleWhen: glyph.primary ? undefined : { flag: `show.${id}` },
    });
  }
  if (layers.length === 0) warnings.push('Aucun glyphe-image importable dans cette police.');

  const menu = createEmptyMenu(menuId, name);
  menu.layers = layers;
  return { menu, warnings };
}
