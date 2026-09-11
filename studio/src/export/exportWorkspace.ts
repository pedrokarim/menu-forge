import { textureUrl } from '../lib/api';
import type { WorkspaceSnapshot } from '../lib/api';
import { fetchSettings } from '../lib/appApi';
import { withWriteHeader } from '../lib/http';
import type { MenuDefinition } from '../model/menu';
import { resolveMenu } from '../model/resolve';
import type { RgbaImage } from './image';
import { generatePack, packMeta } from './pack';
import { decodePng } from './png';
import { createZip } from './zip';

/**
 * Export de l’espace de travail :
 *
 * - **vers le plugin** : menus résolus (gabarits appliqués) et PNG qu’ils
 *   utilisent, écrits par le backend dans `<dossier d’export>/menuforge/` ;
 *   la lib y génère elle-même les polices au démarrage du serveur ;
 * - **pack ZIP de test** : polices et textures générées ici, avec le même
 *   algorithme que la lib (`pack.ts`), plus `pack.mcmeta`, écrits dans
 *   `<espace>/exports/`.
 */

/** Réponse de `POST /api/export/plugin`. */
export interface PluginExportResult {
  directory: string;
  menus: number;
  textures: number;
  /** Fichiers du précédent export supprimés (chemins relatifs à `menuforge/`). */
  removed: string[];
}

/** Résultat d’un export de pack ZIP. */
export interface PackExportResult {
  path: string;
  size: number;
  menus: number;
  files: number;
}

async function failure(response: Response): Promise<Error> {
  const text = await response.text();
  return new Error(text || `Erreur ${response.status}`);
}

/**
 * Menus de l’espace prêts pour la lib : gabarits appliqués (comme dans
 * l’éditeur), sans `extends` ni `template`, sans la métadonnée `generator` du
 * studio. Les gabarits eux-mêmes ne sont pas exportés.
 *
 * @throws si un menu référence un gabarit introuvable, ou s’il n’y a aucun menu
 */
export function menusForExport(snapshot: WorkspaceSnapshot): MenuDefinition[] {
  const byId = new Map<string, MenuDefinition>();
  for (const template of snapshot.templates) byId.set(template.id, template);
  for (const menu of snapshot.menus) byId.set(menu.id, menu);
  const errors: string[] = [];
  const menus = snapshot.menus
    .filter((menu) => !menu.template)
    .map((menu) => {
      const resolved = resolveMenu(menu, (id) => byId.get(id));
      errors.push(...resolved.errors.map((error) => `${menu.id} : ${error}`));
      const copy = structuredClone(resolved.menu);
      delete copy.extends;
      delete copy.template;
      for (const layer of copy.layers) delete layer.generator;
      return copy;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (errors.length > 0) throw new Error(errors.join(' ; '));
  if (menus.length === 0) throw new Error('Aucun menu à exporter dans cet espace (les gabarits ne le sont pas)');
  return menus;
}

/** Textures utilisées par des menus, sans doublon, triées. */
export function texturesOf(menus: readonly MenuDefinition[]): string[] {
  return [...new Set(menus.flatMap((menu) => menu.layers.map((layer) => layer.texture)))].sort();
}

/** Repli pour les PNG que `decodePng` ne lit pas (entrelacés) : décodage par le navigateur. */
async function decodeWithCanvas(buffer: ArrayBuffer): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(new Blob([buffer]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D indisponible');
  context.drawImage(bitmap, 0, 0);
  const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
  return { width: bitmap.width, height: bitmap.height, data: new Uint8Array(data.buffer.slice(0)) };
}

/** Texture de l’espace actif, ou `null` si elle n’existe pas. */
export async function loadWorkspaceTexture(path: string): Promise<RgbaImage | null> {
  const response = await fetch(textureUrl(path, Date.now()));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Texture illisible : ${path} (${await response.text()})`);
  const buffer = await response.arrayBuffer();
  try {
    return await decodePng(new Uint8Array(buffer));
  } catch {
    return decodeWithCanvas(buffer);
  }
}

/** Exporte les menus de l’espace et leurs textures vers le dossier du plugin. */
export async function exportToPlugin(snapshot: WorkspaceSnapshot): Promise<PluginExportResult> {
  const menus = menusForExport(snapshot);
  const response = await fetch(
    '/api/export/plugin',
    withWriteHeader({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ menus, textures: texturesOf(menus) }),
    }),
  );
  if (!response.ok) throw await failure(response);
  return (await response.json()) as PluginExportResult;
}

/** Génère un pack ZIP autonome (polices, textures, `pack.mcmeta`) et l’écrit dans `exports/` de l’espace. */
export async function exportPackZip(snapshot: WorkspaceSnapshot): Promise<PackExportResult> {
  const { export: settings } = await fetchSettings();
  const menus = menusForExport(snapshot);
  const files = await generatePack(menus, loadWorkspaceTexture, settings.namespace);
  const entries = [
    { path: 'pack.mcmeta', data: packMeta(settings.packFormat, 'Menus de Menu Forge (pack de test)') },
    ...[...files].map(([path, data]) => ({ path, data })),
  ];
  const zip = await createZip(entries);
  const name = `${settings.namespace}-pack.zip`;
  const response = await fetch(
    `/api/exports/${encodeURIComponent(name)}`,
    withWriteHeader({ method: 'PUT', headers: { 'Content-Type': 'application/zip' }, body: new Blob([new Uint8Array(zip)]) }),
  );
  if (!response.ok) throw await failure(response);
  const written = (await response.json()) as { path: string; size: number };
  return { ...written, menus: menus.length, files: entries.length };
}
