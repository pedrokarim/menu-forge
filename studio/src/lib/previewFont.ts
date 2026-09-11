import { useEffect, useState } from 'react';
import { fetchLibraries } from './libraryApi';
import type { MinecraftFont } from './minecraftFont';

/** Bibliothèque qui fournit la police du jeu. */
const VANILLA_LIBRARY = 'vanilla';

/** `vanilla` : police du jeu, lue dans le pack branché ; `menu-forge` : police pixel du projet. */
export type PreviewFontSource = 'vanilla' | 'menu-forge';

export interface PreviewFont {
  font: MinecraftFont;
  source: PreviewFontSource;
}

/**
 * Police des aperçus : celle du jeu quand la bibliothèque `vanilla` est
 * branchée (rendu exact), sinon la police pixel de Menu Forge (mêmes avances,
 * dessin des lettres à nous). Rien n’est demandé à une bibliothèque absente.
 * Les moteurs de police sont chargés à la demande, hors du paquet principal.
 */
export async function loadPreviewFont(): Promise<PreviewFont> {
  const libraries = await fetchLibraries().catch(() => []);
  if (libraries.some((library) => library.id === VANILLA_LIBRARY)) {
    try {
      const { loadMinecraftFont } = await import('./minecraftFont');
      return { font: await loadMinecraftFont(VANILLA_LIBRARY), source: 'vanilla' };
    } catch {
      // Pack incomplet ou illisible : la police pixel prend le relais.
    }
  }
  const { loadPixelFont } = await import('./pixelFont');
  return { font: await loadPixelFont(), source: 'menu-forge' };
}

/** Police des aperçus pour un composant ; `null` pendant le chargement. */
export function usePreviewFont(): PreviewFont | null {
  const [font, setFont] = useState<PreviewFont | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadPreviewFont().then(
      (result) => {
        if (!cancelled) setFont(result);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return font;
}
