import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchWorkspace } from './lib/api';
import type { WorkspaceSnapshot } from './lib/api';
import {
  fetchAppInfo,
  fetchRecentDocuments,
  fetchSettings,
  fetchWorkspaces,
  forgetWorkspace,
  openWorkspace,
  reindexLibrary,
  clearPresence,
  updatePresence,
  updateSettings,
} from './lib/appApi';
import type {
  AppInfo,
  LibraryCounts,
  PresenceActivity,
  RecentDocument,
  SettingsPatch,
  StudioSettings,
  WorkspaceList,
} from './lib/appApi';
import type { DocumentType } from './lib/appApi';
import { NBSP } from './lib/format';
import { isTauri } from './lib/native';
import { shortcutLetter } from './lib/shortcuts';
import type { MenuDefinition } from './model/menu';
import { SCREEN_TITLES, describeActivity } from './shell/activity';
import type { OpenDocument } from './shell/activity';
import { TitleBar } from './shell/TitleBar';
import { ContextMenuProvider } from './ui/ContextMenu';
import { EditorScreen } from './screens/EditorScreen';
import type { EditorHandle, EditorPreferences, EditorRequest, EditorSession, OpenDocumentOptions } from './screens/EditorScreen';
import { HomeScreen } from './screens/HomeScreen';
import type { DocumentAction, QuickAction } from './screens/HomeScreen';
import { RenameDocumentDialog } from './components/DocumentDialogs';
import { duplicateWithFreeId, renameWithReferences, trashWithConfirmation } from './lib/documents';
import type { DocumentEvent } from './lib/documents';
import { menuReferences } from './model/references';
import { WorkspacesScreen } from './screens/WorkspacesScreen';
import { EditorTabs } from './shell/EditorTabs';
import { ScreenRail } from './shell/ScreenRail';
import type { RailScreen } from './shell/ScreenRail';
import { WorkspacePill } from './shell/WorkspacePill';
import { navigate, parseRoute, routeHash, useRoute } from './shell/router';
import type { EditorMode, Route } from './shell/router';
import {
  EMPTY_TABS,
  activateTab,
  closeTabs,
  cycleTab,
  moveTab,
  newTabKey,
  openTab,
  restoreSession,
  retargetTab,
  serializeSession,
  sessionStorageKey,
  tabLabel,
} from './shell/tabs';
import type { NewDocumentKind, TabsState } from './shell/tabs';
import { DialogHost } from './ui/DialogHost';
import { askConfirm, askUnsaved } from './ui/dialogs';
import { Icon } from './ui/Icon';
import { overlayOpen } from './ui/overlay';
import { ToastStack } from './ui/ToastStack';
import { JobIndicator } from './ai/JobIndicator';
import { onOpenJob } from './ai/jobs';
import './shell/shell.css';

/** Écrans secondaires et aide-mémoire : chargés à leur première ouverture, hors du paquet principal. */
const AboutScreen = lazy(() => import('./screens/AboutScreen').then((module) => ({ default: module.AboutScreen })));
const LibrariesScreen = lazy(() => import('./screens/LibrariesScreen').then((module) => ({ default: module.LibrariesScreen })));
const ShaderLabScreen = lazy(() => import('./screens/ShaderLabScreen').then((module) => ({ default: module.ShaderLabScreen })));
const SettingsScreen = lazy(() => import('./screens/SettingsScreen').then((module) => ({ default: module.SettingsScreen })));
const ShortcutsDialog = lazy(() => import('./shell/ShortcutsDialog').then((module) => ({ default: module.ShortcutsDialog })));

const DEFAULT_PREFERENCES: EditorPreferences = { defaultZoom: 0, showGrid: true, confirmDiscard: true, confirmDelete: true };
const SCREEN_ORDER: RailScreen[] = ['home', 'editor', 'libraries', 'shaders', 'settings', 'about'];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select') !== null);
}

const modeOf = (type: DocumentType): EditorMode => (type === 'menu' ? 'menus' : type === 'asset' ? 'assets' : 'pixels');

function readSession(workspacePath: string): TabsState {
  try {
    const raw = window.localStorage.getItem(sessionStorageKey(workspacePath));
    return raw ? restoreSession(JSON.parse(raw)) : EMPTY_TABS;
  } catch {
    return EMPTY_TABS;
  }
}

function writeSession(workspacePath: string, state: TabsState) {
  try {
    window.localStorage.setItem(sessionStorageKey(workspacePath), JSON.stringify(serializeSession(state)));
  } catch {
    // Stockage indisponible (navigation privée) : la session ne sera simplement pas rouverte.
  }
}

/** Rappels d’un onglet, créés une fois par onglet (l’éditeur les reçoit stables). */
interface TabCallbacks {
  ref: (handle: EditorHandle | null) => void;
  onRouteChange: (mode: EditorMode, id: string | null) => void;
  onSessionChange: (session: EditorSession) => void;
  onOpenDocument: (mode: EditorMode, id: string | null, options?: OpenDocumentOptions) => void;
  onDocumentTrashed: (mode: EditorMode, id: string) => void;
}

/**
 * Coquille de l’application : rail d’écrans, routeur par l’adresse, données
 * partagées (réglages, espaces de travail). L’éditeur travaille par onglets :
 * chaque document ouvert garde son éditeur monté (historique, sélection et
 * modifications conservés), et la session d’un espace est rouverte au lancement.
 */
export default function App() {
  const route = useRoute();
  const [app, setApp] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceList | null>(null);
  const [recent, setRecent] = useState<RecentDocument[] | null>(null);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editorRequest, setEditorRequest] = useState<{ request: EditorRequest; tab: string } | null>(null);
  const [librariesVersion, setLibrariesVersion] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [welcomed, setWelcomed] = useState(false);
  const [openDocument, setOpenDocument] = useState<OpenDocument | null>(null);
  // Accueil relu après une action sur un document ; document en cours de renommage ; événement pour l’éditeur.
  const [homeVersion, setHomeVersion] = useState(0);
  const [renaming, setRenaming] = useState<RecentDocument | null>(null);
  const [documentEvent, setDocumentEvent] = useState<DocumentEvent | null>(null);
  // Onglets de l’éditeur, document et modifications de chacun, menus pas encore enregistrés à ouvrir.
  const [tabs, setTabs] = useState<TabsState>(EMPTY_TABS);
  const [sessions, setSessions] = useState<Record<string, EditorSession>>({});
  const [initialMenus, setInitialMenus] = useState<Record<string, MenuDefinition>>({});
  // Onglets ouverts pour une création (« Nouveau menu »…) : ils restent vides jusqu’au document créé.
  const [blankTabs, setBlankTabs] = useState<string[]>([]);
  // Message d’état d’un onglet ouvert par un autre (« Menu créé », « copie de… »).
  const [tabStatuses, setTabStatuses] = useState<Record<string, string>>({});
  // Espace dont la session est chargée (onglets relus du stockage local).
  const [sessionFor, setSessionFor] = useState<string | null>(null);
  const handles = useRef(new Map<string, EditorHandle>());
  // Visualiseur de shaders chargé à la première visite, puis gardé monté.
  const [shadersVisited, setShadersVisited] = useState(false);
  const callbacks = useRef(new Map<string, TabCallbacks>());

  const handleDocumentChange = useCallback((kind: OpenDocument['kind'] | null, name: string | null) => {
    setOpenDocument(kind && name ? { kind, name } : null);
  }, []);

  const refreshShell = useCallback(async () => {
    try {
      const [nextApp, nextSettings, nextWorkspaces] = await Promise.all([fetchAppInfo(), fetchSettings(), fetchWorkspaces()]);
      setApp(nextApp);
      setSettings(nextSettings);
      setWorkspaces(nextWorkspaces);
      setLoadError(null);
      return nextApp;
    } catch (error) {
      setLoadError(errorMessage(error));
      return null;
    }
  }, []);

  // Premier chargement, puis écran de départ : la sélection d’espace au premier lancement, sinon l’accueil.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void refreshShell().then((info) => {
      if (parseRoute(window.location.hash) === null) navigate({ screen: info?.firstLaunch ? 'workspaces' : 'home' }, true);
    });
  }, [refreshShell]);

  const screen = route?.screen ?? 'home';
  const activePath = workspaces?.active ?? null;
  if (screen === 'shaders' && !shadersVisited) setShadersVisited(true);

  // Accueil : documents récents et vignettes, relus à chaque visite et à chaque changement d’espace.
  useEffect(() => {
    if (screen !== 'home' || !activePath) return;
    let cancelled = false;
    void Promise.all([fetchRecentDocuments(), fetchWorkspace()]).then(
      ([documents, nextSnapshot]) => {
        if (cancelled) return;
        // oxlint-disable-next-line react/set-state-in-effect
        setRecent(documents);
        setSnapshot(nextSnapshot);
      },
      () => {
        if (!cancelled) setRecent([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [screen, activePath, homeVersion]);

  /* ---------- Onglets ---------- */

  const activeTab = tabs.tabs.find((tab) => tab.key === tabs.active) ?? null;
  const dirtyKeys = tabs.tabs.filter((tab) => sessions[tab.key]?.dirty).map((tab) => tab.key);
  const editorDirty = dirtyKeys.length > 0;
  const nameOf = useCallback(
    (key: string) => {
      const tab = tabs.tabs.find((candidate) => candidate.key === key);
      return tab ? tabLabel(tab, sessions[key]?.name) : key;
    },
    [tabs, sessions],
  );

  // Session de l’espace : relue quand l’espace change, puis écrite à chaque changement d’onglets.
  if (activePath && sessionFor !== activePath) {
    setSessionFor(activePath);
    let restored = readSession(activePath);
    const wanted = parseRoute(window.location.hash);
    if (wanted?.screen === 'editor' && wanted.id) restored = openTab(restored, wanted.mode, wanted.id);
    setTabs(restored);
    setSessions({});
    setInitialMenus({});
  }
  useEffect(() => {
    if (activePath && sessionFor === activePath) writeSession(activePath, tabs);
  }, [activePath, sessionFor, tabs]);

  /** Rappels stables de l’onglet `key` (créés à sa première apparition). */
  const tabCallbacks = (key: string): TabCallbacks => {
    let entry = callbacks.current.get(key);
    if (!entry) {
      entry = {
        ref: (handle) => {
          if (handle) handles.current.set(key, handle);
          else handles.current.delete(key);
        },
        onRouteChange: (mode, id) => setTabs((state) => retargetTab(state, key, mode, id)),
        onSessionChange: (session) =>
          setSessions((previous) => {
            const known = previous[key];
            if (known && known.kind === session.kind && known.name === session.name && known.dirty === session.dirty) return previous;
            return { ...previous, [key]: session };
          }),
        onOpenDocument: (mode, id, options = {}) => {
          const created = newTabKey();
          const { initialMenu, fallbackId = null, status } = options;
          if (initialMenu) setInitialMenus((previous) => ({ ...previous, [created]: initialMenu }));
          if (status) setTabStatuses((previous) => ({ ...previous, [created]: status }));
          setTabs((state) => {
            if (id !== null || state.tabs.some((tab) => tab.mode === mode)) return openTab(state, mode, id, created);
            return openTab(state, mode, fallbackId, created);
          });
        },
        onDocumentTrashed: (mode, id) =>
          setTabs((state) => closeTabs(state, state.tabs.filter((tab) => tab.mode === mode && tab.id === id).map((tab) => tab.key))),
      };
      callbacks.current.set(key, entry);
    }
    return entry;
  };

  /** Retire les onglets fermés (sans rien demander) et ce qui leur appartient. */
  const dropTabs = useCallback((keys: readonly string[]) => {
    if (keys.length === 0) return;
    setTabs((state) => closeTabs(state, keys));
    setSessions((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !keys.includes(key))));
    setInitialMenus((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !keys.includes(key))));
    for (const key of keys) callbacks.current.delete(key);
  }, []);

  /**
   * Règle les modifications non enregistrées des onglets `keys` avant `action` : un dialogue propose
   * d’enregistrer, de ne pas enregistrer ou d’annuler. Vrai si l’action peut continuer.
   */
  const settleTabs = useCallback(
    async (keys: readonly string[], action: string): Promise<boolean> => {
      const dirty = keys.filter((key) => sessions[key]?.dirty);
      if (dirty.length === 0 || !(settings?.ui.confirmations.discardChanges ?? true)) return true;
      const choice = await askUnsaved(dirty.map(nameOf), action);
      if (choice === 'cancel') return false;
      if (choice === 'discard') return true;
      for (const key of dirty) {
        const handle = handles.current.get(key);
        if (!handle || !(await handle.save())) {
          setTabs((state) => activateTab(state, key));
          return false;
        }
      }
      return true;
    },
    [sessions, settings, nameOf],
  );

  const closeTabsAsking = useCallback(
    async (keys: string[]) => {
      if (keys.length === 0) return;
      const action = keys.length === 1 ? `Fermer «${NBSP}${nameOf(keys[0])}${NBSP}»` : `Fermer ${keys.length} onglets`;
      if (await settleTabs(keys, action)) dropTabs(keys);
    },
    [settleTabs, dropTabs, nameOf],
  );

  const saveTab = (key: string) => void handles.current.get(key)?.save();

  /* ---------- Adresse ↔ onglets ---------- */

  // Onglet affiché → adresse (sans empiler l’historique) ; l’adresse ainsi écrite n’ouvre rien en retour.
  // Sans onglet affiché, l’adresse demandée reste telle quelle (elle ouvrira son onglet).
  const writtenHash = useRef('');
  useEffect(() => {
    if (screen !== 'editor' || sessionFor === null || !activeTab) return;
    const next: Route = { screen: 'editor', mode: activeTab.mode, id: activeTab.id };
    writtenHash.current = routeHash(next);
    navigate(next, true);
    // `activeTab` suit ses champs : seuls le type et le document comptent.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, sessionFor, activeTab?.mode, activeTab?.id]);

  // Adresse → onglets (accueil, Précédent / Suivant, lien) : le document demandé s’ouvre dans son onglet.
  const currentHash = route ? routeHash(route) : '';
  useEffect(() => {
    // Adresse déjà remplacée par l’onglet affiché (rendu en retard d’un tour) : rien à ouvrir, sinon
    // l’adresse périmée et l’onglet se renverraient la balle sans fin.
    if (!route || route.screen !== 'editor' || sessionFor === null || currentHash === writtenHash.current) return;
    if (currentHash !== window.location.hash) return;
    writtenHash.current = currentHash;
    const { mode, id } = route;
    // oxlint-disable-next-line react/set-state-in-effect
    setTabs((state) => {
      if (id !== null) return openTab(state, mode, id);
      const shown = state.tabs.find((tab) => tab.key === state.active);
      if (shown?.mode === mode) return state;
      const recentKey = state.recent.find((key) => state.tabs.some((tab) => tab.key === key && tab.mode === mode));
      // Aucun onglet de ce type : un onglet qui montre le premier document du type.
      return recentKey ? activateTab(state, recentKey) : openTab(state, mode, null);
    });
    // `route` suit `currentHash` : seule la chaîne compte.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHash, sessionFor]);

  const goTo = useCallback(
    (target: RailScreen) => {
      if (target === 'editor') navigate({ screen: 'editor', mode: activeTab?.mode ?? 'menus', id: activeTab?.id ?? null });
      else navigate({ screen: target });
    },
    [activeTab],
  );

  /** Onglet qui traite une demande de ce type : l’onglet affiché s’il est du bon type, sinon le dernier de ce type, sinon un nouvel onglet vide. */
  const sendRequest = useCallback(
    (kind: EditorRequest['kind'], mode: EditorMode | null, extra: Partial<EditorRequest> = {}) => {
      let target = tabs.tabs.find((tab) => tab.key === tabs.active && (mode === null || tab.mode === mode));
      if (!target && mode !== null) {
        const recentKey = tabs.recent.find((key) => tabs.tabs.some((tab) => tab.key === key && tab.mode === mode));
        target = tabs.tabs.find((tab) => tab.key === recentKey);
      }
      if (!target) {
        target = { key: newTabKey(), mode: mode ?? 'menus', id: null };
        setBlankTabs((keys) => [...keys, target!.key]);
      }
      const chosen = target;
      setTabs((state) => (state.tabs.some((tab) => tab.key === chosen.key) ? activateTab(state, chosen.key) : openTab(state, chosen.mode, null, chosen.key)));
      setEditorRequest({ request: { kind, nonce: Date.now(), ...extra }, tab: chosen.key });
      navigate({ screen: 'editor', mode: chosen.mode, id: chosen.id });
    },
    [tabs],
  );

  // Notification ou indicateur d’une génération : retour à l’éditeur, qui rouvre le dialogue de la tâche.
  const sendRequestRef = useRef(sendRequest);
  useEffect(() => {
    sendRequestRef.current = sendRequest;
  });
  useEffect(() => onOpenJob((job) => sendRequestRef.current('ai-job', null, { jobId: job.id })), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const withModifier = event.ctrlKey || event.metaKey;
      // Touche physique (event.code) : sur AZERTY, Ctrl + la touche du 1 produit « & », pas « 1 ».
      const digit = /^(?:Digit|Numpad)([1-6])$/.exec(event.code)?.[1];
      if (withModifier && !event.shiftKey && !event.altKey && digit) {
        event.preventDefault();
        goTo(SCREEN_ORDER[Number(digit) - 1]);
      } else if (withModifier && !event.shiftKey && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        navigate({ screen: 'workspaces' });
      } else if (screen === 'editor' && withModifier && !overlayOpen() && (shortcutLetter(event) === 'w' || event.key === 'F4')) {
        // Ctrl+W (Ctrl+F4) : fermer l’onglet affiché. La lettre tapée compte : en AZERTY, Ctrl+Z est sur la touche W.
        event.preventDefault();
        if (tabs.active) void closeTabsAsking([tabs.active]);
      } else if (screen === 'editor' && withModifier && !overlayOpen() && (event.key === 'Tab' || event.key === 'PageDown' || event.key === 'PageUp')) {
        // Ctrl+Tab / Ctrl+Pg. suiv. : onglet suivant ; avec Maj, ou Ctrl+Pg. préc. : précédent.
        event.preventDefault();
        const step = event.key === 'PageUp' || (event.key === 'Tab' && event.shiftKey) ? -1 : 1;
        setTabs((state) => cycleTab(state, step));
      } else if (event.key === '?' && !withModifier && !isTypingTarget(event.target)) {
        event.preventDefault();
        setShowShortcuts(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goTo, screen, tabs.active, closeTabsAsking]);

  const preferences = useMemo<EditorPreferences>(
    () =>
      settings
        ? {
            defaultZoom: settings.ui.defaultZoom,
            showGrid: settings.ui.showGrid,
            confirmDiscard: settings.ui.confirmations.discardChanges,
            confirmDelete: settings.ui.confirmations.delete,
          }
        : DEFAULT_PREFERENCES,
    [settings],
  );
  const confirmRemoval = settings?.ui.confirmations.delete ?? true;

  /** Identifiants déjà pris pour ce type de document (copie ou renommage sans collision). */
  const knownIds = (type: DocumentType): string[] =>
    type === 'menu'
      ? (snapshot?.menus ?? []).map((candidate) => candidate.id)
      : type === 'asset'
        ? (snapshot?.assets ?? []).map((candidate) => candidate.id)
        : (recent ?? []).filter((candidate) => candidate.type === 'pixel').map((candidate) => candidate.id);

  /** Onglets qui montrent ce document. */
  const tabsOf = (document: RecentDocument) =>
    tabs.tabs.filter((tab) => tab.mode === modeOf(document.type) && tab.id === document.id).map((tab) => tab.key);

  /** Accueil : renommer, dupliquer ou mettre à la corbeille un document récent ; ses onglets suivent. */
  const documentAction = async (document: RecentDocument, action: DocumentAction) => {
    if (action === 'rename') {
      // Un menu renommé garde ses modifications en cours ; un asset ou une image ouverts sont relus du disque.
      if (document.type !== 'menu' && !(await settleTabs(tabsOf(document), `Renommer «${NBSP}${document.name}${NBSP}»`))) return;
      setRenaming(document);
      return;
    }
    if (action === 'duplicate') {
      const summary = await duplicateWithFreeId(document.type, document.id, document.name, knownIds(document.type));
      setDocumentEvent({ kind: 'duplicated', type: document.type, from: document.id, to: summary.id, name: summary.name, nonce: Date.now() });
      setHomeVersion((version) => version + 1);
      return;
    }
    const open = tabsOf(document);
    if (
      open.some((key) => sessions[key]?.dirty) &&
      preferences.confirmDiscard &&
      !(await askConfirm({
        title: 'Modifications non enregistrées',
        message: `«${NBSP}${document.name}${NBSP}» est ouvert avec des modifications non enregistrées, qui seront perdues.`,
        confirmLabel: 'Continuer',
        danger: true,
      }))
    ) {
      return;
    }
    const trashed = await trashWithConfirmation(document.type, document.id, document.name, confirmRemoval);
    if (!trashed) return;
    dropTabs(open);
    setDocumentEvent({ kind: 'trashed', type: document.type, from: document.id, nonce: Date.now() });
    setHomeVersion((version) => version + 1);
  };

  const confirmRename = async (to: string, name: string, updateReferences: boolean) => {
    if (!renaming) return;
    const { summary, updated } = await renameWithReferences({
      type: renaming.type,
      from: renaming.id,
      to,
      name,
      menus: snapshot?.menus ?? [],
      updateReferences,
    });
    setDocumentEvent({
      kind: 'renamed',
      type: renaming.type,
      from: renaming.id,
      to: summary.id,
      name: summary.name,
      updated,
      nonce: Date.now(),
    });
    setRenaming(null);
    setHomeVersion((version) => version + 1);
  };

  const switchWorkspace = async (path: string) => {
    if (path !== activePath && !(await settleTabs(dirtyKeys, 'Changer d’espace de travail'))) return;
    await openWorkspace(path);
    setWelcomed(true);
    // Une action rapide en attente ne doit pas être rejouée dans le nouvel espace.
    setEditorRequest(null);
    setRecent(null);
    await refreshShell();
    navigate({ screen: 'home' });
  };

  const forget = async (path: string) => {
    await forgetWorkspace(path);
    await refreshShell();
  };

  const patchSettings = async (patch: SettingsPatch) => {
    setSettings(await updateSettings(patch));
    if (patch.libraries) setLibrariesVersion((version) => version + 1);
  };

  const librariesChanged = async () => {
    await refreshShell();
    setLibrariesVersion((version) => version + 1);
  };

  const reindexAll = async () => {
    const results: LibraryCounts[] = [];
    for (const library of settings?.libraries ?? []) results.push(await reindexLibrary(library.id));
    setLibrariesVersion((version) => version + 1);
    return results;
  };

  const quickAction = (action: QuickAction) => {
    if (action === 'open-workspace') {
      navigate({ screen: 'workspaces' });
      return;
    }
    sendRequest(action, action === 'new-asset' ? 'assets' : action === 'new-pixel' ? 'pixels' : 'menus');
  };

  const newDocument = (kind: NewDocumentKind) => quickAction(kind);

  const activeWorkspace = workspaces?.workspaces.find((candidate) => candidate.active) ?? null;

  // Titre (barre de titre, onglet, barre des tâches) : l’écran, ou le document ouvert dans l’éditeur.
  const titleContext = screen === 'editor' && openDocument && activeTab ? openDocument.name : SCREEN_TITLES[screen];
  useEffect(() => {
    document.title = `Menu Forge · ${titleContext}`;
  }, [titleContext]);

  // Rich Presence Discord : l’activité suit l’écran et le document (le backend la transmet à Discord).
  const activityKey = JSON.stringify(describeActivity(screen, activeTab ? openDocument : null, activeWorkspace?.name ?? null));
  // Renvoyée toutes les 30 s (signe de vie) : sans nouvelles de l’interface, le backend l’efface.
  useEffect(() => {
    const send = () => void updatePresence(JSON.parse(activityKey) as PresenceActivity).catch(() => undefined);
    const timer = window.setTimeout(send, 600);
    const heartbeat = window.setInterval(send, 30_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(heartbeat);
    };
  }, [activityKey]);

  // Onglet ou fenêtre fermés : l’activité Discord disparaît aussitôt.
  useEffect(() => {
    window.addEventListener('pagehide', clearPresence);
    return () => window.removeEventListener('pagehide', clearPresence);
  }, []);

  // Mode navigateur : prévenir avant de fermer ou recharger l’onglet avec des modifications non enregistrées
  // (dans l’appli, la barre de titre ouvre le dialogue du studio).
  useEffect(() => {
    if (isTauri || !editorDirty || !preferences.confirmDiscard) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editorDirty, preferences.confirmDiscard]);

  /** Fermeture de la fenêtre : immédiate sans modification, sinon après le dialogue (vrai : fermer). */
  const confirmClose = (): boolean | Promise<boolean> => {
    if (!editorDirty || !preferences.confirmDiscard) return true;
    navigate({ screen: 'editor', mode: activeTab?.mode ?? 'menus', id: activeTab?.id ?? null });
    return settleTabs(dirtyKeys, 'Quitter Menu Forge');
  };
  const pill = (
    <WorkspacePill
      name={activeWorkspace?.name ?? '…'}
      path={activePath ?? ''}
      onClick={() => navigate({ screen: 'workspaces' })}
    />
  );

  return (
    <ContextMenuProvider>
    <div className={isTauri ? 'app-frame has-titlebar' : 'app-frame'}>
      {isTauri && <TitleBar context={titleContext} confirmClose={confirmClose} />}
      <div className="shell">
      <ScreenRail current={screen} onSelect={goTo} onShowShortcuts={() => setShowShortcuts(true)} status={<JobIndicator />} />
      <div className="shell-main">
        {loadError && (
          <div className="banner error" role="alert">
            <Icon name="alert" size={24} />
            <span>
              Réglages du studio illisibles&nbsp;: {loadError}. Le studio doit être lancé avec <code>npm run dev</code> ou depuis
              l’appli.
            </span>
          </div>
        )}
        <div className="shell-editor" hidden={screen !== 'editor'}>
          {tabs.tabs.length > 0 && (
            <EditorTabs
              tabs={tabs.tabs}
              active={tabs.active}
              sessions={sessions}
              onActivate={(key) => setTabs((state) => activateTab(state, key))}
              onClose={(keys) => void closeTabsAsking(keys)}
              onSave={saveTab}
              onMove={(key, index) => setTabs((state) => moveTab(state, key, index))}
              onNew={newDocument}
            />
          )}
          {/* L’éditeur affiché vient d’abord dans le document (les autres, cachés, suivent) : les recherches
              « premier élément » (ancrage des notifications, tests) visent l’onglet affiché. Les clés
              gardent chaque éditeur monté quand l’ordre change. */}
          {(workspaces || loadError) &&
            [...tabs.tabs].sort((a, b) => Number(b.key === tabs.active) - Number(a.key === tabs.active)).map((tab) => {
              const own = tabCallbacks(tab.key);
              const shown = tab.key === tabs.active;
              return (
                <div key={`${activePath ?? 'workspace'}:${tab.key}`} className="editor-pane" hidden={!shown}>
                  <EditorScreen
                    ref={own.ref}
                    active={screen === 'editor' && shown}
                    route={tab}
                    onRouteChange={own.onRouteChange}
                    onOpenDocument={own.onOpenDocument}
                    onDocumentTrashed={own.onDocumentTrashed}
                    onSessionChange={own.onSessionChange}
                    initialMenu={initialMenus[tab.key] ?? null}
                    startEmpty={blankTabs.includes(tab.key)}
                    initialStatus={tabStatuses[tab.key]}
                    request={editorRequest?.tab === tab.key ? editorRequest.request : null}
                    preferences={preferences}
                    librariesVersion={librariesVersion}
                    workspacePill={pill}
                    onDirtyChange={() => undefined}
                    onDocumentChange={handleDocumentChange}
                    documentEvent={documentEvent}
                  />
                </div>
              );
            })}
          {tabs.tabs.length === 0 && (
            <div className="editor-empty">
              <div className="empty-state">
                <Icon name="chest" size={48} />
                <h2>Aucun document ouvert</h2>
                <p className="muted">
                  Ouvre un document depuis l’accueil, ou crée-en un{NBSP}: chaque document s’ouvre dans son onglet.
                </p>
                <div className="editor-empty-actions">
                  <button type="button" className="primary" onClick={() => quickAction('new-menu')}>
                    <Icon name="plus" />
                    Nouveau menu
                  </button>
                  <button type="button" onClick={() => quickAction('new-asset')}>
                    <Icon name="image" />
                    Nouvel asset
                  </button>
                  <button type="button" onClick={() => quickAction('new-pixel')}>
                    <Icon name="pencil" />
                    Nouvelle image
                  </button>
                  <button type="button" onClick={() => navigate({ screen: 'home' })}>
                    <Icon name="home" />
                    Documents récents
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        {screen === 'home' && (
          <HomeScreen
            pill={pill}
            workspace={activeWorkspace}
            recent={recent}
            snapshot={snapshot}
            workspaces={workspaces?.workspaces ?? []}
            onQuickAction={quickAction}
            onOpenDocument={(document) => navigate({ screen: 'editor', mode: modeOf(document.type), id: document.id })}
            onSwitchWorkspace={switchWorkspace}
            onDocumentAction={documentAction}
          />
        )}
        {screen === 'workspaces' && (
          <WorkspacesScreen
            pill={pill}
            list={workspaces}
            welcome={Boolean(app?.firstLaunch) && !welcomed}
            confirmRemoval={confirmRemoval}
            onOpen={switchWorkspace}
            onForget={forget}
            onContinue={() => {
              setWelcomed(true);
              navigate({ screen: 'home' });
            }}
          />
        )}
        <Suspense fallback={null}>
        {screen === 'libraries' && (
          <LibrariesScreen
            pill={pill}
            settings={settings}
            sessionOverride={app?.overrides.includes('libraries') ?? false}
            confirmRemoval={confirmRemoval}
            onPatch={patchSettings}
            onChanged={librariesChanged}
          />
        )}
        {screen === 'settings' && (
          <SettingsScreen
            pill={pill}
            app={app}
            settings={settings}
            activeWorkspace={activeWorkspace}
            onPatch={patchSettings}
            onReindexAll={reindexAll}
            onBrowseWorkspaces={() => navigate({ screen: 'workspaces' })}
          />
        )}
        {screen === 'about' && <AboutScreen pill={pill} app={app} />}
        </Suspense>
        {/* Visualiseur de shaders : reste monté, ses brouillons et ses onglets survivent au changement d’écran. */}
        {shadersVisited && (
          <div className="shell-shaders" hidden={screen !== 'shaders'}>
            <Suspense fallback={null}>
              <ShaderLabScreen pill={pill} active={screen === 'shaders'} />
            </Suspense>
          </div>
        )}
      </div>
      {showShortcuts && (
        <Suspense fallback={null}>
          <ShortcutsDialog onClose={() => setShowShortcuts(false)} />
        </Suspense>
      )}
      {renaming && (
        <RenameDocumentDialog
          type={renaming.type}
          id={renaming.id}
          name={renaming.name}
          existingIds={knownIds(renaming.type)}
          references={renaming.type === 'menu' ? menuReferences(snapshot?.menus ?? [], renaming.id) : []}
          onCancel={() => setRenaming(null)}
          onConfirm={confirmRename}
        />
      )}
      </div>
      <ToastStack />
      <DialogHost />
    </div>
    </ContextMenuProvider>
  );
}
