/**
 * Client des bibliothèques d’assets (packs branchés en lecture seule).
 * Types en miroir des réponses du backend (`backend/src/libraries.rs`).
 */

export type LibraryOwnership = 'own' | 'third-party';

export interface LibrarySourceInfo {
  id: string;
  name: string;
  ownership: LibraryOwnership;
}

export interface FontUsage {
  font: string;
  ascent: number;
  height: number;
}

export interface LibraryTexture {
  path: string;
  width: number;
  height: number;
  usages: FontUsage[];
}

export interface FontGlyph {
  texture: string;
  ascent: number;
  height: number;
  found: boolean;
}

export interface LibraryFont {
  id: string;
  glyphs: FontGlyph[];
  references: string[];
}

export interface LibraryIndex {
  textures: LibraryTexture[];
  fonts: LibraryFont[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error((await response.text()) || `Erreur ${response.status}`);
  return (await response.json()) as T;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function fetchLibraries(): Promise<LibrarySourceInfo[]> {
  return request<LibrarySourceInfo[]>('/api/libraries');
}

export function fetchLibraryIndex(sourceId: string): Promise<LibraryIndex> {
  return request<LibraryIndex>(`/api/libraries/${encodeURIComponent(sourceId)}/index`);
}

export function libraryRawUrl(sourceId: string, path: string): string {
  return `/api/libraries/${encodeURIComponent(sourceId)}/raw/${encodePath(path)}`;
}

/** Copie une texture de la bibliothèque dans l’espace de travail ; renvoie son chemin de texture. */
export async function importFromLibrary(sourceId: string, path: string): Promise<string> {
  const { texture } = await request<{ texture: string }>(
    `/api/libraries/${encodeURIComponent(sourceId)}/import`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) },
  );
  return texture;
}

/** Heuristique « asset d’interface » sur le chemin (GUI, menus, HUD, boutons…). */
export function looksLikeInterface(path: string): boolean {
  return /(^|\/)(gui|ui|custom_ui|menus?|hud|huds|container|interface|buttons?|icons?|screens?|dialogue)(\/|_|$)/i.test(
    path.replace(/^assets\/[^/]+\/textures\//, ''),
  );
}

/** `y` fenêtre d’une texture utilisée par un glyphe (même formule que le titre : haut = 13 − ascent). */
export function suggestedTop(texture: LibraryTexture): number | null {
  const usage = texture.usages.find((candidate) => candidate.height === texture.height);
  return usage ? 13 - usage.ascent : null;
}
