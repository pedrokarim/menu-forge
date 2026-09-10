import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { HttpError, decodePath, insideRoot, listFiles, readJsonBody, sendJson, sendPng } from './http.ts';

/**
 * Bibliothèques d’assets : des resource packs extraits, branchés en lecture
 * seule. Le studio y pioche des textures (copiées dans l’espace de travail) et
 * peut reconstruire un menu à partir d’une police du pack.
 */

export interface LibrarySource {
  id: string;
  name: string;
  /** Dossier d’un resource pack extrait (celui qui contient `assets/`). */
  root: string;
  /** `own` : assets du projet ; `third-party` : usage local uniquement, jamais publié. */
  ownership: 'own' | 'third-party';
}

/** Utilisation d’une texture par un glyphe de police. */
export interface FontUsage {
  font: string;
  ascent: number;
  height: number;
}

export interface LibraryTexture {
  /** Chemin relatif à la racine du pack, ex. `assets/minecraft/textures/custom_ui/menus/x.png`. */
  path: string;
  width: number;
  height: number;
  usages: FontUsage[];
}

export interface FontGlyph {
  texture: string;
  ascent: number;
  height: number;
  /** La texture existe-t-elle dans le pack ? */
  found: boolean;
}

export interface LibraryFont {
  /** Identifiant de police, ex. `minecraft:menus/badges/home`. */
  id: string;
  glyphs: FontGlyph[];
  references: string[];
}

export interface LibraryIndex {
  textures: LibraryTexture[];
  fonts: LibraryFont[];
}

const LIBRARY_ID = /^[a-z0-9_-]+$/;
/** À incrémenter quand la forme de l’index change (invalide les caches disque). */
const INDEX_VERSION = 1;
/** Lectures de fichiers simultanées pendant l’indexation. */
const READ_CONCURRENCY = 64;

/** Exécute `task` sur chaque élément, avec au plus `limit` opérations en parallèle. */
async function mapPool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const current = next++;
      results[current] = await task(items[current]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Taille d’un PNG lue dans son en-tête IHDR, sans décoder l’image. */
async function readPngSize(file: string): Promise<{ width: number; height: number } | null> {
  const handle = await fs.open(file, 'r');
  try {
    const header = Buffer.alloc(24);
    const { bytesRead } = await handle.read(header, 0, 24, 0);
    if (bytesRead < 24 || header.readUInt32BE(0) !== 0x89504e47) return null;
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    await handle.close();
  }
}

/** Fichier de texture d’un provider `bitmap` (sans espace de noms = `minecraft`). */
function textureOfFile(file: string): string {
  const [namespace, relative] = file.includes(':') ? file.split(':', 2) : ['minecraft', file];
  return `assets/${namespace}/textures/${relative.endsWith('.png') ? relative : `${relative}.png`}`;
}

function withNamespace(id: string): string {
  return id.includes(':') ? id : `minecraft:${id}`;
}

interface RawProvider {
  type?: unknown;
  file?: unknown;
  ascent?: unknown;
  height?: unknown;
  chars?: unknown;
  id?: unknown;
}

async function parseFont(file: string, id: string): Promise<LibraryFont | null> {
  let data: { providers?: RawProvider[] };
  try {
    data = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
  const glyphs: FontGlyph[] = [];
  const references: string[] = [];
  for (const provider of Array.isArray(data.providers) ? data.providers : []) {
    if (provider.type === 'reference' && typeof provider.id === 'string') {
      references.push(withNamespace(provider.id));
    }
    if (provider.type !== 'bitmap' || typeof provider.file !== 'string') continue;
    // Seuls les glyphes-images (un caractère) nous intéressent, pas les grilles de police.
    const chars = Array.isArray(provider.chars) ? provider.chars : [];
    const count = chars.reduce((total: number, row: unknown) => total + (typeof row === 'string' ? [...row].length : 0), 0);
    if (count !== 1) continue;
    glyphs.push({
      texture: textureOfFile(provider.file),
      ascent: typeof provider.ascent === 'number' ? provider.ascent : 7,
      height: typeof provider.height === 'number' ? provider.height : 8,
      found: false,
    });
  }
  return { id, glyphs, references };
}

/**
 * Indexe un pack : taille de chaque PNG, glyphes-images de chaque police, et
 * pour chaque texture les polices qui l’utilisent. Le résultat est mis en cache
 * sur disque, invalidé si le nombre de fichiers du pack change.
 */
async function buildIndex(source: LibrarySource, cacheDir: string): Promise<LibraryIndex> {
  const assetsDir = path.join(source.root, 'assets');
  let namespaces: string[];
  try {
    namespaces = (await fs.readdir(assetsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    throw new HttpError(404, `Pack introuvable : ${assetsDir}`);
  }

  const listing = await Promise.all(
    namespaces.map(async (namespace) => ({
      namespace,
      textures: await listFiles(path.join(assetsDir, namespace, 'textures'), '.png'),
      fonts: await listFiles(path.join(assetsDir, namespace, 'font'), '.json'),
    })),
  );
  const signature = listing.map((entry) => `${entry.namespace}:${entry.textures.length}:${entry.fonts.length}`).join('|');
  const cacheFile = path.join(cacheDir, `${source.id}.json`);
  try {
    const cached = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
    if (cached.version === INDEX_VERSION && cached.root === source.root && cached.signature === signature) {
      return cached.index as LibraryIndex;
    }
  } catch {
    // Pas de cache exploitable : on reconstruit.
  }

  const textureJobs = listing.flatMap((entry) =>
    entry.textures.map((relative) => ({
      key: `assets/${entry.namespace}/textures/${relative}`,
      file: path.join(assetsDir, entry.namespace, 'textures', relative),
    })),
  );
  const fontJobs = listing.flatMap((entry) =>
    entry.fonts.map((relative) => ({
      id: `${entry.namespace}:${relative.replace(/\.json$/i, '')}`,
      file: path.join(assetsDir, entry.namespace, 'font', relative),
    })),
  );

  const sizes = await mapPool(textureJobs, READ_CONCURRENCY, (job) => readPngSize(job.file).catch(() => null));
  const textures = new Map<string, LibraryTexture>();
  textureJobs.forEach((job, position) => {
    const size = sizes[position];
    if (size) textures.set(job.key, { path: job.key, ...size, usages: [] });
  });
  const fonts = (await mapPool(fontJobs, READ_CONCURRENCY, (job) => parseFont(job.file, job.id))).filter(
    (font): font is LibraryFont => font !== null,
  );

  for (const font of fonts) {
    for (const glyph of font.glyphs) {
      const texture = textures.get(glyph.texture);
      glyph.found = texture !== undefined;
      texture?.usages.push({ font: font.id, ascent: glyph.ascent, height: glyph.height });
    }
  }

  const index: LibraryIndex = {
    textures: [...textures.values()].sort((a, b) => a.path.localeCompare(b.path)),
    fonts: fonts.sort((a, b) => a.id.localeCompare(b.id)),
  };
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify({ version: INDEX_VERSION, root: source.root, signature, index }));
  } catch (error) {
    console.warn(`[menu-forge] cache d’index non écrit pour « ${source.id} » :`, error);
  }
  return index;
}

/**
 * Routes `/libraries/*` : liste des sources, index d’un pack, lecture d’un
 * fichier (PNG, JSON), copie d’une texture dans l’espace de travail.
 */
export function createLibraryRoutes(sources: LibrarySource[], workspaceTextures: string, cacheDir: string) {
  const byId = new Map(sources.filter((source) => LIBRARY_ID.test(source.id)).map((source) => [source.id, source]));
  const indexes = new Map<string, Promise<LibraryIndex>>();

  const indexOf = (source: LibrarySource) => {
    let index = indexes.get(source.id);
    if (!index) {
      index = buildIndex(source, cacheDir);
      index.catch(() => indexes.delete(source.id));
      indexes.set(source.id, index);
    }
    return index;
  };

  const sourceOf = (id: string) => {
    const source = byId.get(id);
    if (!source) throw new HttpError(404, `Bibliothèque inconnue : ${id}`);
    return source;
  };

  /** Traite la requête si elle concerne les bibliothèques ; renvoie `false` sinon. */
  return async function handle(req: IncomingMessage, res: ServerResponse, pathname: string, method: string): Promise<boolean> {
    if (pathname === '/libraries' && method === 'GET') {
      sendJson(res, [...byId.values()].map(({ id, name, ownership }) => ({ id, name, ownership })));
      return true;
    }

    const match = /^\/libraries\/([^/]+)\/(index|raw|import)(?:\/(.*))?$/.exec(pathname);
    if (!match) return false;
    const source = sourceOf(decodeURIComponent(match[1]));
    const action = match[2];

    if (action === 'index' && method === 'GET') {
      sendJson(res, await indexOf(source));
      return true;
    }

    if (action === 'raw' && method === 'GET') {
      const relative = decodePath(match[3] ?? '');
      const file = insideRoot(source.root, relative);
      if (relative.toLowerCase().endsWith('.png')) {
        await sendPng(res, file, relative);
        return true;
      }
      // Les JSON (polices, modèles) servent au moteur de texte et aux imports.
      if (relative.toLowerCase().endsWith('.json')) {
        let content: string;
        try {
          content = await fs.readFile(file, 'utf8');
        } catch {
          throw new HttpError(404, `Fichier introuvable : ${relative}`);
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(content);
        return true;
      }
      throw new HttpError(400, 'Seuls les PNG et les JSON sont servis');
    }

    if (action === 'import' && method === 'POST') {
      const { path: relative } = await readJsonBody<{ path?: unknown }>(req);
      if (typeof relative !== 'string' || !relative.toLowerCase().endsWith('.png')) {
        throw new HttpError(400, 'Chemin de texture attendu');
      }
      const from = insideRoot(source.root, relative);
      const target = `library/${source.id}/${relative.replace(/^assets\//, '')}`;
      const to = insideRoot(workspaceTextures, target);
      await fs.mkdir(path.dirname(to), { recursive: true });
      try {
        await fs.copyFile(from, to);
      } catch {
        throw new HttpError(404, `Texture introuvable dans la bibliothèque : ${relative}`);
      }
      sendJson(res, { texture: target });
      return true;
    }

    throw new HttpError(405, `Méthode non prise en charge : ${method} ${pathname}`);
  };
}

/** Lit la liste des bibliothèques (fichier JSON local, facultatif). */
export async function loadLibrarySources(file: string): Promise<LibrarySource[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const baseDir = path.dirname(file);
  return raw.flatMap((entry): LibrarySource[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { id, name, root, ownership } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !LIBRARY_ID.test(id) || typeof root !== 'string') return [];
    return [{
      id,
      name: typeof name === 'string' ? name : id,
      root: path.resolve(baseDir, root),
      ownership: ownership === 'own' ? 'own' : 'third-party',
    }];
  });
}
