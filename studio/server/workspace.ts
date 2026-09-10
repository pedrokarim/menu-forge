import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';
import {
  HttpError,
  PNG_SIGNATURE,
  decodePath,
  insideRoot,
  listFiles,
  readBody,
  sendJson,
  sendPng,
} from './http.ts';
import { createLibraryRoutes } from './libraries.ts';
import type { LibrarySource } from './libraries.ts';

/**
 * Plugin Vite qui expose l’espace de travail local (menus + textures) et les
 * bibliothèques d’assets au studio, sous `/api`. Il ne vit que dans le serveur
 * de développement de Vite, qui n’écoute que sur localhost.
 */
export interface WorkspaceOptions {
  /** Dossier contenant `menus/` et `textures/`. */
  workspaceRoot: string;
  /** Dossier des gabarits fournis (lecture seule). */
  templatesRoot: string;
  /** Packs branchés en lecture seule. */
  libraries: LibrarySource[];
  /** Dossier des caches (index des bibliothèques). */
  cacheDir: string;
}

const MENU_ID = /^[a-z0-9_]+$/;
const MENU_SUFFIX = '.menu.json';
const ASSET_SUFFIX = '.asset.json';

/** Lit les documents `*<suffix>` d’un dossier (non récursif). */
async function readDocuments(dir: string, suffix: string): Promise<unknown[]> {
  const menus: unknown[] = [];
  for (const entry of await listFiles(dir, suffix)) {
    if (entry.includes('/')) continue;
    try {
      menus.push(JSON.parse(await fs.readFile(path.join(dir, entry), 'utf8')));
    } catch (error) {
      console.warn(`[menu-forge] ${entry} est illisible :`, error);
    }
  }
  return menus;
}

export function workspacePlugin({ workspaceRoot, templatesRoot, libraries, cacheDir }: WorkspaceOptions): Plugin {
  const menusDir = path.join(workspaceRoot, 'menus');
  const assetsDir = path.join(workspaceRoot, 'assets');
  const texturesDir = path.join(workspaceRoot, 'textures');
  const libraryRoutes = createLibraryRoutes(libraries, texturesDir, path.join(cacheDir, 'libraries'));

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    if (await libraryRoutes(req, res, pathname, method)) return;

    if (pathname === '/workspace' && method === 'GET') {
      sendJson(res, {
        root: workspaceRoot,
        menus: await readDocuments(menusDir, MENU_SUFFIX),
        assets: await readDocuments(assetsDir, ASSET_SUFFIX),
        templates: await readDocuments(templatesRoot, MENU_SUFFIX),
        textures: await listFiles(texturesDir, '.png'),
      });
      return;
    }

    // Enregistrement d’un menu (/menus/:id) ou d’un asset (/assets/:id).
    const documentMatch = /^\/(menus|assets)\/([^/]+)$/.exec(pathname);
    if (documentMatch && method === 'PUT') {
      const isAsset = documentMatch[1] === 'assets';
      const id = decodeURIComponent(documentMatch[2]);
      if (!MENU_ID.test(id)) throw new HttpError(400, `Identifiant invalide : ${id}`);
      let document: { id?: unknown };
      try {
        document = JSON.parse((await readBody(req)).toString('utf8'));
      } catch {
        throw new HttpError(400, 'JSON invalide');
      }
      if (document.id !== id) throw new HttpError(400, 'L’identifiant du document ne correspond pas à l’URL');
      const dir = isAsset ? assetsDir : menusDir;
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, id + (isAsset ? ASSET_SUFFIX : MENU_SUFFIX)),
        `${JSON.stringify(document, null, 2)}\n`,
        'utf8',
      );
      res.statusCode = 204;
      res.end();
      return;
    }

    if (pathname.startsWith('/textures/')) {
      const relative = decodePath(pathname.slice('/textures/'.length));
      if (!relative.toLowerCase().endsWith('.png')) throw new HttpError(400, 'Seuls les PNG sont acceptés');
      const file = insideRoot(texturesDir, relative);

      if (method === 'GET') {
        await sendPng(res, file, relative);
        return;
      }

      if (method === 'PUT') {
        const data = await readBody(req);
        if (!data.subarray(0, 4).equals(PNG_SIGNATURE)) throw new HttpError(400, 'Le fichier n’est pas un PNG');
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, data);
        res.statusCode = 204;
        res.end();
        return;
      }
    }

    throw new HttpError(404, `Route inconnue : ${method} ${pathname}`);
  }

  return {
    name: 'menu-forge-workspace',
    configureServer(server) {
      server.middlewares.use('/api', (req, res) => {
        handle(req, res).catch((error: unknown) => {
          const status = error instanceof HttpError ? error.status : 500;
          if (status === 500) console.error('[menu-forge]', error);
          res.statusCode = status;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(error instanceof Error ? error.message : String(error));
        });
      });
      server.config.logger.info(`  menu-forge : espace de travail ${workspaceRoot}`);
      for (const library of libraries) {
        server.config.logger.info(`  menu-forge : bibliothèque « ${library.name} » (${library.root})`);
      }
    },
  };
}
