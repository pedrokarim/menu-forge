import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Plugin Vite qui expose l’espace de travail local (menus + textures) au
 * studio, sous `/api`. Il ne vit que dans le serveur de développement de Vite,
 * qui n’écoute que sur localhost.
 */
export interface WorkspaceOptions {
  /** Dossier contenant `menus/` et `textures/`. */
  workspaceRoot: string;
  /** Dossier des gabarits fournis (lecture seule). */
  templatesRoot: string;
}

const MENU_ID = /^[a-z0-9_]+$/;
const MENU_SUFFIX = '.menu.json';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Résout un chemin relatif en refusant toute sortie de `root`. */
function insideRoot(root: string, relative: string): string {
  const target = path.resolve(root, relative);
  const fromRoot = path.relative(root, target);
  if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) {
    throw new HttpError(400, 'Chemin en dehors de l’espace de travail');
  }
  return target;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function readMenus(dir: string): Promise<unknown[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const menus: unknown[] = [];
  for (const entry of entries.filter((name) => name.endsWith(MENU_SUFFIX)).sort()) {
    try {
      menus.push(JSON.parse(await fs.readFile(path.join(dir, entry), 'utf8')));
    } catch (error) {
      console.warn(`[menu-forge] ${entry} est illisible :`, error);
    }
  }
  return menus;
}

async function listTextures(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { recursive: true });
    return entries
      .filter((entry) => entry.toLowerCase().endsWith('.png'))
      .map((entry) => entry.split(path.sep).join('/'))
      .sort();
  } catch {
    return [];
  }
}

function sendJson(res: ServerResponse, body: unknown) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function workspacePlugin({ workspaceRoot, templatesRoot }: WorkspaceOptions): Plugin {
  const menusDir = path.join(workspaceRoot, 'menus');
  const texturesDir = path.join(workspaceRoot, 'textures');

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    if (pathname === '/workspace' && method === 'GET') {
      sendJson(res, {
        root: workspaceRoot,
        menus: await readMenus(menusDir),
        templates: await readMenus(templatesRoot),
        textures: await listTextures(texturesDir),
      });
      return;
    }

    const menuMatch = /^\/menus\/([^/]+)$/.exec(pathname);
    if (menuMatch && method === 'PUT') {
      const id = decodeURIComponent(menuMatch[1]);
      if (!MENU_ID.test(id)) throw new HttpError(400, `Identifiant de menu invalide : ${id}`);
      let menu: { id?: unknown };
      try {
        menu = JSON.parse((await readBody(req)).toString('utf8'));
      } catch {
        throw new HttpError(400, 'JSON invalide');
      }
      if (menu.id !== id) throw new HttpError(400, 'L’identifiant du menu ne correspond pas à l’URL');
      await fs.mkdir(menusDir, { recursive: true });
      await fs.writeFile(path.join(menusDir, id + MENU_SUFFIX), `${JSON.stringify(menu, null, 2)}\n`, 'utf8');
      res.statusCode = 204;
      res.end();
      return;
    }

    if (pathname.startsWith('/textures/')) {
      const relative = pathname
        .slice('/textures/'.length)
        .split('/')
        .map(decodeURIComponent)
        .join('/');
      if (!relative.toLowerCase().endsWith('.png')) throw new HttpError(400, 'Seuls les PNG sont acceptés');
      const file = insideRoot(texturesDir, relative);

      if (method === 'GET') {
        let data: Buffer;
        try {
          data = await fs.readFile(file);
        } catch {
          throw new HttpError(404, `Texture introuvable : ${relative}`);
        }
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        res.end(data);
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
    },
  };
}
