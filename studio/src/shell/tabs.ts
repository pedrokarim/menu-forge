import type { EditorMode } from './router';

/**
 * Onglets de l’éditeur : chaque onglet garde un document ouvert (menu, asset ou image) avec son propre
 * éditeur, son historique et ses modifications. Ce module ne contient que la logique (sans React), pour
 * être testée : ouvrir, fermer, suivre le document d’un onglet, restaurer la session d’un espace.
 */

export interface EditorTab {
  /** Identifiant stable de l’onglet (clé React de son éditeur). */
  key: string;
  mode: EditorMode;
  /** Document ouvert ; `null` : onglet vide (aucun document de ce type encore choisi). */
  id: string | null;
}

export interface TabsState {
  tabs: EditorTab[];
  active: string | null;
  /** Onglets du plus récemment affiché au plus ancien (pour revenir au précédent à la fermeture). */
  recent: string[];
}

export const EMPTY_TABS: TabsState = { tabs: [], active: null, recent: [] };

/** Création demandée depuis la barre d’onglets (bouton +). */
export type NewDocumentKind = 'new-menu' | 'new-asset' | 'new-pixel';

const EMPTY_LABELS: Record<EditorMode, string> = { menus: 'Menus', assets: 'Assets', pixels: 'Pixels' };

/** Nom affiché d’un onglet : le nom du document, sinon son identifiant, sinon le type (onglet vide). */
export function tabLabel(tab: EditorTab, name: string | null | undefined): string {
  return name ?? tab.id ?? EMPTY_LABELS[tab.mode];
}

let counter = 0;

export function newTabKey(): string {
  counter += 1;
  return `tab-${Date.now().toString(36)}-${counter}`;
}

function touch(recent: readonly string[], key: string): string[] {
  return [key, ...recent.filter((candidate) => candidate !== key)];
}

/** Affiche l’onglet `key`. */
export function activateTab(state: TabsState, key: string): TabsState {
  if (!state.tabs.some((tab) => tab.key === key) || state.active === key) return state;
  return { ...state, active: key, recent: touch(state.recent, key) };
}

/** Onglet qui montre ce document, s’il y en a un. */
export function findTab(state: TabsState, mode: EditorMode, id: string): EditorTab | undefined {
  return state.tabs.find((tab) => tab.mode === mode && tab.id === id);
}

/**
 * Ouvre un document : l’onglet qui le montre déjà est affiché, sinon un onglet est ajouté après
 * l’onglet affiché. `id` absent : le dernier onglet affiché de ce type, sinon un onglet vide de ce type.
 */
export function openTab(state: TabsState, mode: EditorMode, id: string | null, key = newTabKey()): TabsState {
  if (id !== null) {
    const existing = findTab(state, mode, id);
    if (existing) return activateTab(state, existing.key);
  } else {
    const activeTab = state.tabs.find((tab) => tab.key === state.active);
    if (activeTab?.mode === mode) return state;
    const recentKey = state.recent.find((candidate) => state.tabs.some((tab) => tab.key === candidate && tab.mode === mode));
    if (recentKey) return activateTab(state, recentKey);
  }
  const tab: EditorTab = { key, mode, id };
  const index = state.tabs.findIndex((candidate) => candidate.key === state.active);
  const tabs = index < 0 ? [...state.tabs, tab] : [...state.tabs.slice(0, index + 1), tab, ...state.tabs.slice(index + 1)];
  return { tabs, active: key, recent: touch(state.recent, key) };
}

/** Ferme des onglets ; l’onglet affiché, s’il est fermé, laisse la place au plus récemment affiché. */
export function closeTabs(state: TabsState, keys: readonly string[]): TabsState {
  const tabs = state.tabs.filter((tab) => !keys.includes(tab.key));
  const recent = state.recent.filter((key) => tabs.some((tab) => tab.key === key));
  let active = state.active;
  if (active === null || !tabs.some((tab) => tab.key === active)) {
    const closedIndex = state.tabs.findIndex((tab) => tab.key === state.active);
    active = recent[0] ?? tabs[Math.min(Math.max(closedIndex, 0), tabs.length - 1)]?.key ?? null;
  }
  return { tabs, active, recent: active ? touch(recent, active) : recent };
}

/**
 * L’éditeur d’un onglet a changé de document (renommage, document choisi dans un onglet vide) : l’onglet
 * suit. Si un autre onglet montrait déjà ce document, celui-ci est gardé et l’onglet en double est fermé.
 */
export function retargetTab(state: TabsState, key: string, mode: EditorMode, id: string | null): TabsState {
  const tab = state.tabs.find((candidate) => candidate.key === key);
  if (!tab || (tab.mode === mode && tab.id === id)) return state;
  const twin = id === null ? undefined : state.tabs.find((candidate) => candidate.key !== key && candidate.mode === mode && candidate.id === id);
  if (twin) {
    const closed = closeTabs(state, [key]);
    return state.active === key ? activateTab({ ...closed, active: null }, twin.key) : closed;
  }
  return { ...state, tabs: state.tabs.map((candidate) => (candidate.key === key ? { ...candidate, mode, id } : candidate)) };
}

/** Onglet voisin de l’onglet affiché (`step` = 1 : suivant, −1 : précédent), en boucle. */
export function cycleTab(state: TabsState, step: 1 | -1): TabsState {
  if (state.tabs.length < 2) return state;
  const index = state.tabs.findIndex((tab) => tab.key === state.active);
  const next = state.tabs[(index + step + state.tabs.length) % state.tabs.length];
  return activateTab(state, next.key);
}

/** Déplace l’onglet `key` à la position `index` (glisser-déposer). */
export function moveTab(state: TabsState, key: string, index: number): TabsState {
  const from = state.tabs.findIndex((tab) => tab.key === key);
  if (from < 0) return state;
  const tabs = [...state.tabs];
  const [tab] = tabs.splice(from, 1);
  tabs.splice(Math.max(0, Math.min(index, tabs.length)), 0, tab);
  return { ...state, tabs };
}

/** Session d’un espace de travail : documents ouverts et onglet affiché, sans les modifications. */
export interface StoredSession {
  tabs: Array<{ mode: EditorMode; id: string }>;
  active: number;
}

const MODES: readonly EditorMode[] = ['menus', 'assets', 'pixels'];

export function serializeSession(state: TabsState): StoredSession {
  const kept = state.tabs.filter((tab): tab is EditorTab & { id: string } => tab.id !== null);
  return { tabs: kept.map(({ mode, id }) => ({ mode, id })), active: Math.max(0, kept.findIndex((tab) => tab.key === state.active)) };
}

/** Relit une session enregistrée (valeurs inconnues ignorées). */
export function restoreSession(value: unknown): TabsState {
  if (!value || typeof value !== 'object') return EMPTY_TABS;
  const stored = value as Partial<StoredSession>;
  const tabs: EditorTab[] = [];
  for (const entry of Array.isArray(stored.tabs) ? stored.tabs : []) {
    if (!entry || !MODES.includes(entry.mode) || typeof entry.id !== 'string' || entry.id === '') continue;
    if (tabs.some((tab) => tab.mode === entry.mode && tab.id === entry.id)) continue;
    tabs.push({ key: newTabKey(), mode: entry.mode, id: entry.id });
  }
  const active = tabs[typeof stored.active === 'number' ? Math.min(Math.max(stored.active, 0), tabs.length - 1) : 0]?.key ?? null;
  return { tabs, active, recent: active ? [active] : [] };
}

export function sessionStorageKey(workspacePath: string): string {
  return `menu-forge.session:${workspacePath}`;
}
