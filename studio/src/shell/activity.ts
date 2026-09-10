import type { PresenceActivity } from '../lib/appApi';
import type { PlainScreen, ScreenId } from './router';

/** Nom de chaque écran (barre de titre, onglet du navigateur). */
export const SCREEN_TITLES: Record<ScreenId, string> = {
  home: 'Accueil',
  editor: 'Éditeur',
  workspaces: 'Espaces de travail',
  libraries: 'Bibliothèques',
  settings: 'Paramètres',
  about: 'À propos',
};

/** Document ouvert dans l’éditeur. */
export interface OpenDocument {
  kind: 'menu' | 'asset';
  name: string;
}

const SCREEN_ACTIVITY: Record<PlainScreen, string> = {
  home: 'Sur l’accueil',
  workspaces: 'Choisit un espace de travail',
  libraries: 'Parcourt les bibliothèques',
  settings: 'Règle le studio',
  about: 'Lit la page À propos',
};

/**
 * Activité affichée sur Discord (Rich Presence). `genericDetails` remplace
 * `details` quand l’utilisateur ne veut pas montrer le nom du document.
 */
export function describeActivity(screen: ScreenId, document: OpenDocument | null, workspace: string | null): PresenceActivity {
  const state = workspace ? `Espace « ${workspace} »` : undefined;
  if (screen !== 'editor') return { details: SCREEN_ACTIVITY[screen], state };
  if (!document) return { details: 'Dans l’éditeur', state };
  return document.kind === 'menu'
    ? { details: `Édite le menu « ${document.name} »`, genericDetails: 'Édite un menu', state }
    : { details: `Compose l’asset « ${document.name} »`, genericDetails: 'Compose un asset', state };
}
