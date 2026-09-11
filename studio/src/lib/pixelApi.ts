import type { PixelDocumentFile } from '../pixel/document';
import { withWriteHeader } from './http';

/** Client des images de l’éditeur de pixels (`backend/src/workspace.rs`, format dans `docs/pixels.md`). */

/** Résumé d’une image, sans ses calques (`GET /api/pixels`). */
export interface PixelSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  layers: number;
  /** PNG exporté, relatif à `textures/`. */
  texture: string;
  modified: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, withWriteHeader(init));
  if (!response.ok) throw new Error((await response.text()) || `Erreur ${response.status}`);
  const isJson = response.headers.get('content-type')?.includes('application/json');
  return (isJson ? await response.json() : undefined) as T;
}

export function fetchPixelList(): Promise<PixelSummary[]> {
  return request<PixelSummary[]>('/api/pixels');
}

export function fetchPixel(id: string): Promise<PixelDocumentFile> {
  return request<PixelDocumentFile>(`/api/pixels/${encodeURIComponent(id)}`);
}

export function savePixel(document: PixelDocumentFile): Promise<void> {
  return request<void>(`/api/pixels/${encodeURIComponent(document.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(document, null, 2),
  });
}
