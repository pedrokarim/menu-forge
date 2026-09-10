import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

/** Utilitaires HTTP partagés par les routes du serveur local du studio. */

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** Résout un chemin relatif en refusant toute sortie de `root`. */
export function insideRoot(root: string, relative: string): string {
  const target = path.resolve(root, relative);
  const fromRoot = path.relative(root, target);
  if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) {
    throw new HttpError(400, 'Chemin en dehors du dossier autorisé');
  }
  return target;
}

export async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  try {
    return JSON.parse((await readBody(req)).toString('utf8')) as T;
  } catch {
    throw new HttpError(400, 'JSON invalide');
  }
}

export function sendJson(res: ServerResponse, body: unknown) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export async function sendPng(res: ServerResponse, file: string, label: string) {
  let data: Buffer;
  try {
    data = await fs.readFile(file);
  } catch {
    throw new HttpError(404, `Texture introuvable : ${label}`);
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.end(data);
}

/** Chemins relatifs (séparateur `/`) des fichiers d’extension `extension` sous `dir`. */
export async function listFiles(dir: string, extension: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { recursive: true });
    return entries
      .filter((entry) => entry.toLowerCase().endsWith(extension))
      .map((entry) => entry.split(path.sep).join('/'))
      .sort();
  } catch {
    return [];
  }
}

/** Décode un segment d’URL par segment (les `/` restent des séparateurs). */
export function decodePath(encoded: string): string {
  return encoded.split('/').map(decodeURIComponent).join('/');
}
