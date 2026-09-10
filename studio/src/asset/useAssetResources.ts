import { useEffect, useMemo, useRef, useState } from 'react';
import { loadMinecraftFont } from '../lib/minecraftFont';
import type { MinecraftFont } from '../lib/minecraftFont';
import type { LoadedTexture } from '../lib/textures';
import { loadAssetTexture } from './render';
import type { RenderResources } from './render';

function cacheKey(path: string, versions: Record<string, number>): string {
  return `${path}@${versions[path] ?? 0}`;
}

/**
 * Charge la police du jeu et les textures demandées pour l’éditeur.
 * Incrémenter `versions[path]` force le rechargement d’une texture.
 */
export function useAssetResources(
  paths: readonly string[],
  versions: Record<string, number>,
): { resources: RenderResources; fontError: string | null } {
  const [font, setFont] = useState<MinecraftFont | null>(null);
  const [fontError, setFontError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(() => new Map<string, LoadedTexture | null>());
  const pending = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    loadMinecraftFont().then(
      (result) => {
        if (!cancelled) setFont(result);
      },
      (error: unknown) => {
        if (!cancelled) setFontError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    for (const path of paths) {
      const key = cacheKey(path, versions);
      if (loaded.has(key) || pending.current.has(key)) continue;
      pending.current.add(key);
      void loadAssetTexture(path, versions[path] ?? 0).then((result) => {
        pending.current.delete(key);
        setLoaded((previous) => new Map(previous).set(key, result));
      });
    }
  }, [paths, versions, loaded]);

  const resources = useMemo<RenderResources>(() => {
    const textures = new Map<string, LoadedTexture | null>();
    for (const path of paths) {
      const key = cacheKey(path, versions);
      if (loaded.has(key)) textures.set(path, loaded.get(key) ?? null);
    }
    return { font, textures };
  }, [paths, versions, loaded, font]);

  return { resources, fontError };
}
