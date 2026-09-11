import type { AssetDefinition } from '../asset/model';
import { menuForDisk, normalizeMenu } from '../model/menu';
import type { MenuDefinition } from '../model/menu';
import { withWriteHeader } from './http';

/** Contenu de l’espace de travail renvoyé par le serveur local. */
export interface WorkspaceSnapshot {
  root: string;
  menus: MenuDefinition[];
  assets: AssetDefinition[];
  templates: MenuDefinition[];
  textures: string[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, withWriteHeader(init));
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Erreur ${response.status}`);
  }
  const isJson = response.headers.get('content-type')?.includes('application/json');
  return (isJson ? await response.json() : undefined) as T;
}

function encodeTexturePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** Contenu de l’espace ; les formulaires Bedrock reçoivent en mémoire un coffre neutre (`normalizeMenu`). */
export async function fetchWorkspace(): Promise<WorkspaceSnapshot> {
  const snapshot = await request<WorkspaceSnapshot>('/api/workspace');
  return { ...snapshot, menus: snapshot.menus.map(normalizeMenu), templates: snapshot.templates.map(normalizeMenu) };
}

export function saveMenu(menu: MenuDefinition): Promise<void> {
  return request<void>(`/api/menus/${encodeURIComponent(menu.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(menuForDisk(menu), null, 2),
  });
}

export function saveAsset(asset: AssetDefinition): Promise<void> {
  return request<void>(`/api/assets/${encodeURIComponent(asset.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(asset, null, 2),
  });
}

export function uploadTexture(path: string, blob: Blob): Promise<void> {
  return request<void>(`/api/textures/${encodeTexturePath(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    body: blob,
  });
}

export function textureUrl(path: string, version: number): string {
  return `/api/textures/${encodeTexturePath(path)}?v=${version}`;
}
