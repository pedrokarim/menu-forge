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
}

export interface Confirmations {
  delete: boolean;
  discardChanges: boolean;
}

export interface UiSettings {
  /** 0 = « Ajuster » (le plus grand palier qui tient). */
  defaultZoom: number;
  showGrid: boolean;
  confirmations: Confirmations;
}

export interface ExportSettings {
  enderiumResources: string | null;
  namespace: string;
  packFormat: number;
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

export interface StudioSettings {
  version: 1;
  activeWorkspace: string;
  workspaces: KnownWorkspace[];
  libraries: LibrarySetting[];
  ui: UiSettings;
  export: ExportSettings;
}

/** Document partiel pour `PUT /settings` (fusion clé par clé côté serveur). */
export interface SettingsPatch {
  activeWorkspace?: string;
  libraries?: LibrarySetting[];
  ui?: Partial<Omit<UiSettings, 'confirmations'>> & { confirmations?: Partial<Confirmations> };
  export?: Partial<ExportSettings>;
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
  type: 'menu' | 'asset';
  id: string;
  name: string;
  modified: string;
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
  const response = await fetch(`/api${url}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
export const addLibrary = (library: LibrarySetting) => call<LibrarySetting>('/libraries', 'POST', library);
export const removeLibrary = (id: string) => call<void>(`/libraries/${encodeURIComponent(id)}`, 'DELETE');
export const reindexLibrary = (id: string) =>
  call<LibraryCounts>(`/libraries/${encodeURIComponent(id)}/reindex`, 'POST');
