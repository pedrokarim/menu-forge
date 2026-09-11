import type { PresenceActivity, PresenceImage } from '../lib/appApi';
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

/** Ligne d’activité et petite image Discord de chaque écran hors éditeur. */
const SCREEN_ACTIVITY: Record<PlainScreen, { details: string; image: PresenceImage }> = {
  home: { details: 'Sur l’accueil', image: 'home' },
  workspaces: { details: 'Choisit un espace de travail', image: 'workspace' },
  libraries: { details: 'Parcourt les bibliothèques', image: 'library' },
  settings: { details: 'Règle le studio', image: 'settings' },
  about: { details: 'Lit la page À propos', image: 'about' },
};

/**
 * Activité affichée sur Discord (Rich Presence). `genericDetails` remplace
 * `details` quand l’utilisateur ne veut pas montrer le nom du document ; la
 * petite image et son texte restent génériques.
 */
export function describeActivity(screen: ScreenId, document: OpenDocument | null, workspace: string | null): PresenceActivity {
  const state = workspace ? `Espace « ${workspace} »` : undefined;
  if (screen !== 'editor') {
    const { details, image } = SCREEN_ACTIVITY[screen];
    return { details, state, smallImage: image, smallText: SCREEN_TITLES[screen] };
  }
  if (!document) return { details: 'Dans l’éditeur', state, smallImage: 'menu', smallText: 'Éditeur' };
  return document.kind === 'menu'
    ? {
        details: `Édite le menu « ${document.name} »`,
        genericDetails: 'Édite un menu',
        state,
        smallImage: 'menu',
        smallText: 'Menu',
      }
    : {
        details: `Compose l’asset « ${document.name} »`,
        genericDetails: 'Compose un asset',
        state,
        smallImage: 'asset',
        smallText: 'Asset',
      };
}
