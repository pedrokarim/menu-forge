import { WRITE_HEADER, withWriteHeader } from './http';
import type { LibraryOwnership } from './libraryApi';

/** Client des routes de l’application (réglages, espaces de travail, bibliothèques). */

export interface AppInfo {
  name: string;
  version: string;
  /** `tauri` : appli de bureau ; `browser` : studio ouvert dans un navigateur. */
  mode: 'tauri' | 'browser';
  settingsPath: string;
  platform: string;
  /** Réglages imposés pour la session par la ligne de commande (`activeWorkspace`, `libraries`). */
  overrides: string[];
  /** Vrai si le fichier de réglages n’existait pas au démarrage. */
  firstLaunch?: boolean;
  /** Vrai si le fichier de réglages est illisible : laissé intact, rien n’est enregistré pendant la session. */
  settingsReadOnly?: boolean;
}

export interface Confirmations {
  delete: boolean;
  discardChanges: boolean;
}

export interface UiSettings {
  /** 0 = « Ajuster » (le plus grand palier qui tient). */
  defaultZoom: number;
  showGrid: boolean;
  confirmations: Confirmations;
}

export interface ExportSettings {
  enderiumResources: string | null;
  namespace: string;
  packFormat: number;
  /** Dossier cible de l’export pour Bedrock (pack et `runtime.json`), ou `null`. */
  bedrockDirectory: string | null;
}

export interface LibrarySetting {
  id: string;
  name: string;
  root: string;
  ownership: LibraryOwnership;
}

export interface KnownWorkspace {
  path: string;
  name: string;
  lastOpened: string;
}

/** Rich Presence Discord. */
export interface DiscordSettings {
  enabled: boolean;
  /** Identifiant de l’application Discord (portail développeur) ; `null` = non configuré. */
  clientId: string | null;
  /** Afficher le nom du document ouvert (sinon un texte générique). */
  showDocument: boolean;
}

export interface StudioSettings {
  version: 1;
  activeWorkspace: string;
  workspaces: KnownWorkspace[];
  libraries: LibrarySetting[];
  ui: UiSettings;
  export: ExportSettings;
  discord?: DiscordSettings;
}

/** Document partiel pour `PUT /settings` (fusion clé par clé côté serveur). */
export interface SettingsPatch {
  activeWorkspace?: string;
  libraries?: LibrarySetting[];
  ui?: Partial<Omit<UiSettings, 'confirmations'>> & { confirmations?: Partial<Confirmations> };
  export?: Partial<ExportSettings>;
  discord?: Partial<DiscordSettings>;
}

/** Clés des petites images téléversées dans le portail Discord (voir docs/discord.md). */
export type PresenceImage = 'menu' | 'asset' | 'home' | 'library' | 'settings' | 'workspace' | 'about';

/** Activité envoyée à Discord. */
export interface PresenceActivity {
  details: string;
  state?: string;
  /** Remplace `details` si le nom du document ne doit pas être montré. */
  genericDetails?: string;
  /** Petite image en médaillon sur la grande. */
  smallImage?: PresenceImage;
  /** Texte au survol de la petite image (toujours générique). */
  smallText?: string;
}

export interface PresenceStatus {
  enabled: boolean;
  /** Identifiant d’application défini. */
  configured: boolean;
  connected: boolean;
  error: string | null;
}

export interface WorkspaceSummary extends KnownWorkspace {
  active: boolean;
  /** Faux si le dossier n’existe plus. */
  exists: boolean;
  menus: number;
  assets: number;
  textures: number;
}

export interface WorkspaceList {
  active: string;
  workspaces: WorkspaceSummary[];
}

export interface RecentDocument {
  type: 'menu' | 'asset' | 'pixel';
  id: string;
  name: string;
  modified: string;
  /** Image de pixels : PNG exporté (relatif à `textures/`), pour la vignette. */
  texture?: string;
}

export type DocumentType = RecentDocument['type'];

/** Réponse des routes de documents (renommer, dupliquer). */
export interface DocumentSummary {
  type: DocumentType;
  id: string;
  name: string;
}

export interface TrashedDocument {
  type: DocumentType;
  id: string;
  /** Chemin du fichier dans la corbeille, relatif à l’espace de travail. */
  trashed: string;
}

export interface LibraryCounts {
  id: string;
  textures: number;
  fonts: number;
}

/** Message d’une réponse en erreur : `{ error }` en JSON, sinon le texte brut. */
async function failure(response: Response): Promise<Error> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === 'string') return new Error(parsed.error);
  } catch {
    // Texte brut.
  }
  return new Error(text || `Erreur ${response.status}`);
}

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(
    `/api${url}`,
    withWriteHeader({
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  if (!response.ok) throw await failure(response);
  if (response.status === 204) return undefined as T;
  const isJson = response.headers.get('content-type')?.includes('application/json');
  return (isJson ? await response.json() : undefined) as T;
}

export const fetchAppInfo = () => call<AppInfo>('/app');
export const fetchSettings = () => call<StudioSettings>('/settings');
export const updateSettings = (patch: SettingsPatch) => call<StudioSettings>('/settings', 'PUT', patch);
export const fetchWorkspaces = () => call<WorkspaceList>('/workspaces');
export const openWorkspace = (path: string, name?: string) =>
  call<WorkspaceSummary>('/workspaces/open', 'POST', name ? { path, name } : { path });
export const forgetWorkspace = (path: string) => call<void>('/workspaces', 'DELETE', { path });
export const fetchRecentDocuments = () => call<RecentDocument[]>('/documents/recent');
/** Change l’identifiant d’un document (et son nom si `name` est donné). */
export const renameDocument = (type: DocumentType, from: string, to: string, name?: string) =>
  call<DocumentSummary>('/documents/rename', 'POST', name ? { type, from, to, name } : { type, from, to });
export const duplicateDocument = (type: DocumentType, from: string, to: string, name?: string) =>
  call<DocumentSummary>('/documents/duplicate', 'POST', name ? { type, from, to, name } : { type, from, to });
/** Déplace un document dans la corbeille de l’espace (`.trash/`) : rien n’est supprimé. */
export const trashDocument = (type: DocumentType, id: string) =>
  call<TrashedDocument>('/documents/trash', 'POST', { type, id });
export const addLibrary = (library: LibrarySetting) => call<LibrarySetting>('/libraries', 'POST', library);
export const removeLibrary = (id: string) => call<void>(`/libraries/${encodeURIComponent(id)}`, 'DELETE');
export const updatePresence = (activity: PresenceActivity) => call<void>('/presence', 'PUT', activity);
export const fetchPresence = () => call<PresenceStatus>('/presence');

/**
 * Efface l’activité Discord tout de suite (fermeture de l’onglet) : la requête
 * part même pendant le déchargement de la page (`keepalive`).
 */
export function clearPresence(): void {
  void fetch('/api/presence', { method: 'DELETE', keepalive: true, headers: { [WRITE_HEADER]: '1' } }).catch(() => undefined);
}
export const reindexLibrary = (id: string) =>
  call<LibraryCounts>(`/libraries/${encodeURIComponent(id)}/reindex`, 'POST');
