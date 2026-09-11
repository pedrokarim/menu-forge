import type { MenuDefinition } from '../model/menu';
import type { Bitmap } from '../pixel/raster';

/**
 * Historique des générations de la session : gardé en mémoire tant que le
 * studio est ouvert (le module est chargé une fois), jamais écrit sur disque.
 */

export interface TextureGeneration {
  id: string;
  at: number;
  provider: string;
  providerName: string;
  model: string;
  prompt: string;
  /** Image telle que rendue par le modèle, avant contrainte. */
  raw: Bitmap;
  width: number;
  height: number;
}

export interface InterfaceGeneration {
  id: string;
  at: number;
  provider: string;
  providerName: string;
  model: string;
  prompt: string;
  /** Menu valide, ou `null` si les essais ont échoué. */
  menu: MenuDefinition | null;
  attempts: number;
  errors: string[];
}

const HISTORY_LIMIT = 24;
const textures: TextureGeneration[] = [];
const interfaces: InterfaceGeneration[] = [];
let counter = 0;

export function nextGenerationId(): string {
  counter += 1;
  return `g${counter}`;
}

export function rememberTexture(generation: TextureGeneration): void {
  textures.unshift(generation);
  textures.length = Math.min(textures.length, HISTORY_LIMIT);
}

export function rememberInterface(generation: InterfaceGeneration): void {
  interfaces.unshift(generation);
  interfaces.length = Math.min(interfaces.length, HISTORY_LIMIT);
}

export function textureHistory(): readonly TextureGeneration[] {
  return textures;
}

export function interfaceHistory(): readonly InterfaceGeneration[] {
  return interfaces;
}
