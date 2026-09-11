import { useMemo, useSyncExternalStore } from 'react';

/**
 * Petit routeur maison : l’écran courant est reflété dans l’adresse
 * (`#/accueil`, `#/editeur/menus/<id>`, `#/espaces`…) pour pouvoir y revenir
 * directement, avec les boutons Précédent / Suivant.
 */

export type EditorMode = 'menus' | 'assets' | 'pixels';
export type PlainScreen = 'home' | 'workspaces' | 'libraries' | 'settings' | 'about';
export type ScreenId = PlainScreen | 'editor';
export type Route = { screen: PlainScreen } | { screen: 'editor'; mode: EditorMode; id: string | null };

const SLUGS: Record<PlainScreen, string> = {
  home: 'accueil',
  workspaces: 'espaces',
  libraries: 'bibliotheques',
  settings: 'parametres',
  about: 'a-propos',
};

/** Adresse → écran ; `null` pour une adresse vide ou inconnue. */
export function parseRoute(hash: string): Route | null {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts.length === 0) return null;
  if (parts[0] === 'editeur') {
    const mode: EditorMode = parts[1] === 'assets' || parts[1] === 'pixels' ? parts[1] : 'menus';
    let id: string | null = null;
    if (parts[2]) {
      try {
        id = decodeURIComponent(parts[2]);
      } catch {
        id = null;
      }
    }
    return { screen: 'editor', mode, id };
  }
  const screen = (Object.keys(SLUGS) as PlainScreen[]).find((candidate) => SLUGS[candidate] === parts[0]);
  return screen ? { screen } : null;
}

export function routeHash(route: Route): string {
  if (route.screen !== 'editor') return `#/${SLUGS[route.screen]}`;
  return `#/editeur/${route.mode}${route.id ? `/${encodeURIComponent(route.id)}` : ''}`;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('hashchange', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('hashchange', listener);
  };
}

const readHash = () => window.location.hash;

/**
 * Va à `route`. `replace` : sans nouvelle entrée d’historique (l’éditeur
 * reflète ainsi le document ouvert sans empiler un pas par document).
 */
export function navigate(route: Route, replace = false) {
  const hash = routeHash(route);
  if (window.location.hash === hash) return;
  if (replace) {
    window.history.replaceState(null, '', hash);
    for (const listener of listeners) listener();
  } else {
    window.location.hash = hash;
  }
}

/** Écran demandé par l’adresse courante (`null` : adresse vide ou inconnue). */
export function useRoute(): Route | null {
  const hash = useSyncExternalStore(subscribe, readHash);
  return useMemo(() => parseRoute(hash), [hash]);
}
