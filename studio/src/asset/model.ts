import type { PanelStyle } from '../model/menu';

/**
 * Types du format `*.asset.json` (version 1) – mode libre.
 * Spécification lisible : `docs/assets.md`.
 */

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type BoxStyle =
  | { kind: 'procedural'; preset: PanelStyle; color: string; border?: string }
  | { kind: 'slice'; texture: string; source?: Region; insets: Insets };

interface ElementBase {
  id: string;
  x: number;
  y: number;
  hidden?: boolean;
}

export interface BoxElement extends ElementBase {
  type: 'box';
  width: number;
  height: number;
  style: BoxStyle;
}

export interface ImageElement extends ElementBase {
  type: 'image';
  texture: string;
  source?: Region;
  scale?: number;
}

export interface AssetTextElement extends ElementBase {
  type: 'text';
  text: string;
  color?: string;
  shadow?: boolean;
  bold?: boolean;
  lineHeight?: number;
  align?: 'left' | 'center' | 'right';
}

export type AssetElement = BoxElement | ImageElement | AssetTextElement;

export interface AssetDefinition {
  formatVersion: 1;
  id: string;
  name: string;
  size: { width: number; height: number };
  /** Couleur de fond `#rrggbbaa`, ou `null` pour un fond transparent (cas normal). */
  background: string | null;
  elements: AssetElement[];
  export: { ascent: number };
}

export const IMAGE_SCALES = [0.125, 0.25, 0.5, 1, 2, 3, 4] as const;
export const MAX_ASSET_SIZE = 1024;
export const DEFAULT_LINE_HEIGHT = 10;

export function createEmptyAsset(id: string, name: string, width = 64, height = 32): AssetDefinition {
  return {
    formatVersion: 1,
    id,
    name,
    size: { width, height },
    background: null,
    elements: [],
    export: { ascent: 7 },
  };
}
