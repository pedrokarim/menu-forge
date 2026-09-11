import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { SCREEN_TITLES, describeActivity } from './shell/activity';
import type { OpenDocument } from './shell/activity';
import { TitleBar } from './shell/TitleBar';
import { ContextMenuProvider } from './ui/ContextMenu';
import { AboutScreen } from './screens/AboutScreen';
import { EditorScreen } from './screens/EditorScreen';
import type { EditorPreferences, EditorRequest } from './screens/EditorScreen';
import { HomeScreen } from './screens/HomeScreen';
import type { DocumentAction, QuickAction } from './screens/HomeScreen';
import { RenameDocumentDialog } from './components/DocumentDialogs';
import { duplicateWithFreeId, renameWithReferences, trashWithConfirmation } from './lib/documents';
import type { DocumentEvent } from './lib/documents';
import { menuReferences } from './model/references';
import { LibrariesScreen } from './screens/LibrariesScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { WorkspacesScreen } from './screens/WorkspacesScreen';
import { ScreenRail } from './shell/ScreenRail';
import type { RailScreen } from './shell/ScreenRail';
import { ShortcutsDialog } from './shell/ShortcutsDialog';
import { WorkspacePill } from './shell/WorkspacePill';
import { navigate, parseRoute, useRoute } from './shell/router';
import type { EditorMode } from './shell/router';
import { Icon } from './ui/Icon';
import './shell/shell.css';

const DEFAULT_PREFERENCES: EditorPreferences = { defaultZoom: 0, showGrid: true, confirmDiscard: true, confirmDelete: true };
const SCREEN_ORDER: RailScreen[] = ['home', 'editor', 'libraries', 'settings', 'about'];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select') !== null);
}

/**
 * Coquille de l’application : rail d’écrans, routeur par l’adresse, données
 * partagées (réglages, espaces de travail). L’éditeur reste monté quand on
 * change d’écran : historique, sélection et modifications sont conservés.
 */
export default function App() {
  const route = useRoute();
  const [app, setApp] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceList | null>(null);
  const [recent, setRecent] = useState<RecentDocument[] | null>(null);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorRequest, setEditorRequest] = useState<EditorRequest | null>(null);
  const [editorRoute, setEditorRoute] = useState<{ mode: EditorMode; id: string | null }>({ mode: 'menus', id: null });
  const [librariesVersion, setLibrariesVersion] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [welcomed, setWelcomed] = useState(false);
  const [openDocument, setOpenDocument] = useState<OpenDocument | null>(null);
  // Accueil relu après une action sur un document ; document en cours de renommage ; événement pour l’éditeur.
  const [homeVersion, setHomeVersion] = useState(0);
  const [renaming, setRenaming] = useState<RecentDocument | null>(null);
  const [documentEvent, setDocumentEvent] = useState<DocumentEvent | null>(null);

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

  const routeMode = route?.screen === 'editor' ? route.mode : editorRoute.mode;
  const routeId = route?.screen === 'editor' ? route.id : editorRoute.id;
  const editorTarget = useMemo(() => ({ mode: routeMode, id: routeId }), [routeMode, routeId]);

  /** Document ouvert dans l’éditeur, reflété dans l’adresse sans empiler l’historique. */
  const handleEditorRoute = useCallback((mode: EditorMode, id: string | null) => {
    setEditorRoute({ mode, id });
    if (parseRoute(window.location.hash)?.screen === 'editor') navigate({ screen: 'editor', mode, id }, true);
  }, []);

  const goTo = useCallback(
    (target: RailScreen) => {
      if (target === 'editor') navigate({ screen: 'editor', mode: editorRoute.mode, id: editorRoute.id });
      else navigate({ screen: target });
    },
    [editorRoute],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const withModifier = event.ctrlKey || event.metaKey;
      // Touche physique (event.code) : sur AZERTY, Ctrl + la touche du 1 produit « & », pas « 1 ».
      const digit = /^(?:Digit|Numpad)([1-5])$/.exec(event.code)?.[1];
      if (withModifier && !event.shiftKey && !event.altKey && digit) {
        event.preventDefault();
        goTo(SCREEN_ORDER[Number(digit) - 1]);
      } else if (withModifier && !event.shiftKey && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        navigate({ screen: 'workspaces' });
      } else if (event.key === '?' && !withModifier && !isTypingTarget(event.target)) {
        event.preventDefault();
        setShowShortcuts(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goTo]);

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

  /** Le document est ouvert dans l’éditeur avec des modifications non enregistrées. */
  const openAndDirty = (document: RecentDocument) =>
    editorDirty && editorRoute.id === document.id && editorRoute.mode === (document.type === 'menu' ? 'menus' : document.type === 'asset' ? 'assets' : 'pixels');

  /** Accueil : renommer, dupliquer ou mettre à la corbeille un document récent ; l’éditeur suit. */
  const documentAction = async (document: RecentDocument, action: DocumentAction) => {
    const discardAllowed = () =>
      !openAndDirty(document) ||
      !preferences.confirmDiscard ||
      window.confirm(`« ${document.name} » a des modifications non enregistrées dans l’éditeur. Continuer quand même${NBSP}?`);
    if (action === 'rename') {
      // Un menu renommé garde ses modifications en cours ; un asset ou une image ouverts sont relus du disque.
      if (document.type !== 'menu' && !discardAllowed()) return;
      setRenaming(document);
      return;
    }
    if (action === 'duplicate') {
      const summary = await duplicateWithFreeId(document.type, document.id, document.name, knownIds(document.type));
      setDocumentEvent({ kind: 'duplicated', type: document.type, from: document.id, to: summary.id, name: summary.name, nonce: Date.now() });
      setHomeVersion((version) => version + 1);
      return;
    }
    if (!discardAllowed()) return;
    const trashed = await trashWithConfirmation(document.type, document.id, document.name, confirmRemoval);
    if (!trashed) return;
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
    if (
      editorDirty &&
      preferences.confirmDiscard &&
      !window.confirm(`Des modifications ne sont pas enregistrées dans l’éditeur. Changer d’espace de travail quand même${NBSP}?`)
    ) {
      return;
    }
    await openWorkspace(path);
    setWelcomed(true);
    // Une action rapide en attente ne doit pas être rejouée dans le nouvel espace.
    setEditorRequest(null);
    setEditorDirty(false);
    setEditorRoute({ mode: 'menus', id: null });
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
    setEditorRequest({ kind: action, nonce: Date.now() });
    const mode: EditorMode = action === 'new-asset' ? 'assets' : action === 'new-pixel' ? 'pixels' : 'menus';
    navigate({ screen: 'editor', mode, id: editorRoute.mode === mode ? editorRoute.id : null });
  };

  const activeWorkspace = workspaces?.workspaces.find((candidate) => candidate.active) ?? null;

  // Titre (barre de titre, onglet, barre des tâches) : l’écran, ou le document ouvert dans l’éditeur.
  const titleContext = screen === 'editor' && openDocument ? openDocument.name : SCREEN_TITLES[screen];
  useEffect(() => {
    document.title = `Menu Forge · ${titleContext}`;
  }, [titleContext]);

  // Rich Presence Discord : l’activité suit l’écran et le document (le backend la transmet à Discord).
  const activityKey = JSON.stringify(describeActivity(screen, openDocument, activeWorkspace?.name ?? null));
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
  // (dans l’appli, la barre de titre s’en charge).
  useEffect(() => {
    if (isTauri || !editorDirty || !preferences.confirmDiscard) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editorDirty, preferences.confirmDiscard]);

  const confirmClose = () =>
    !editorDirty ||
    !preferences.confirmDiscard ||
    window.confirm(`Des modifications ne sont pas enregistrées. Quitter quand même${NBSP}?`);
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
      <ScreenRail current={screen} onSelect={goTo} onShowShortcuts={() => setShowShortcuts(true)} />
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
          {(workspaces || loadError) && (
            <EditorScreen
              key={activePath ?? 'workspace'}
              active={screen === 'editor'}
              route={editorTarget}
              onRouteChange={handleEditorRoute}
              request={editorRequest}
              preferences={preferences}
              librariesVersion={librariesVersion}
              workspacePill={pill}
              onDirtyChange={setEditorDirty}
              onDocumentChange={handleDocumentChange}
              documentEvent={documentEvent}
            />
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
            onOpenDocument={(document) =>
              navigate({
                screen: 'editor',
                mode: document.type === 'menu' ? 'menus' : document.type === 'asset' ? 'assets' : 'pixels',
                id: document.id,
              })
            }
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
      </div>
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
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
    </div>
    </ContextMenuProvider>
  );
}
