import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { GeneratorDialog } from './components/GeneratorDialog';
import type { GeneratorResult } from './components/GeneratorDialog';
import { Inspector } from './components/Inspector';
import { MenuCanvas } from './components/MenuCanvas';
import type { BackgroundMode, CanvasTool } from './components/MenuCanvas';
import { NewMenuDialog } from './components/NewMenuDialog';
import type { NewMenuInput } from './components/NewMenuDialog';
import { AssetEditor } from './asset/AssetEditor';
import { createEmptyAsset } from './asset/model';
import type { AssetDefinition } from './asset/model';
import { LibraryPanel } from './components/LibraryPanel';
import { NewAssetDialog } from './components/NewAssetDialog';
import type { NewAssetInput } from './components/NewAssetDialog';
import { OutlinePanel } from './components/OutlinePanel';
import { PreviewPanel } from './components/PreviewPanel';
import { fetchWorkspace, saveAsset, saveMenu, uploadTexture } from './lib/api';
import type { WorkspaceSnapshot } from './lib/api';
import { importFromLibrary } from './lib/libraryApi';
import type { LibraryIndex, LibrarySourceInfo, LibraryTexture } from './lib/libraryApi';
import { buildMenuFromFont } from './lib/libraryImport';
import { useTextures } from './lib/textures';
import { composeTitle } from './model/compose';
import { GENERATOR_PRESETS, canvasToBlob, renderGenerator } from './model/generator';
import { GRID_COLUMNS, SLOT_SIZE, WINDOW_WIDTH, windowHeight } from './model/geometry';
import { Icon } from './ui/Icon';
import { IconButton } from './ui/IconButton';
import { ShortcutKeys } from './ui/Keys';
import { Tooltip } from './ui/Tooltip';
import { fitZoom, stepZoom } from './canvas/viewport';
import type { Point } from './model/geometry';
import { createEmptyMenu, sanitizeId, uniqueId } from './model/menu';
import type { GeneratorSpec, MenuDefinition, SlotArea } from './model/menu';
import { DEFAULT_PREVIEW, buildPreviewContext } from './model/preview';
import type { PreviewValues } from './model/preview';
import { resolveMenu } from './model/resolve';
import { INITIAL_EDITOR, editorReducer } from './state/editor';
import type { Selection } from './state/editor';

type DialogState =
  | { kind: 'new-menu' }
  | { kind: 'new-asset' }
  | { kind: 'generator'; mode: 'create' }
  | { kind: 'generator'; mode: 'edit'; layerId: string }
  | null;

type Recipe = (draft: MenuDefinition) => void;

const ZOOM_LEVELS = [1, 2, 3, 4, 5, 6, 8];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function generatedTexturePath(menuId: string, layerId: string): string {
  return `generated/${menuId}/${layerId}.png`;
}

function removeElement(draft: MenuDefinition, target: Selection) {
  if (target.kind === 'layer') draft.layers = draft.layers.filter((layer) => layer.id !== target.id);
  else if (target.kind === 'text') draft.texts = (draft.texts ?? []).filter((text) => text.id !== target.id);
  else draft.slots = (draft.slots ?? []).filter((slot) => slot.id !== target.id);
}

/** Copie un gabarit sous un nouvel identifiant ; ses textures générées sont rattachées au nouveau menu. */
function instantiateTemplate(template: MenuDefinition, id: string, name: string): MenuDefinition {
  const copy = structuredClone(template);
  copy.id = id;
  copy.name = name;
  copy.layers = copy.layers.map((layer) =>
    layer.generator ? { ...layer, texture: generatedTexturePath(id, layer.id) } : layer,
  );
  return copy;
}

async function bakeTexture(path: string, spec: GeneratorSpec, origin: Point) {
  await uploadTexture(path, await canvasToBlob(renderGenerator(spec, origin)));
}

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editor, dispatch] = useReducer(editorReducer, INITIAL_EDITOR);
  const [textureVersions, setTextureVersions] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<PreviewValues>(DEFAULT_PREVIEW);
  const [zoom, setZoom] = useState(3);
  // Zoom « Ajuster » par défaut : le plus grand palier où tout le coffre tient dans la zone.
  const [zoomMode, setZoomMode] = useState<'fit' | 'manual'>('fit');
  const [stageSize, setStageSize] = useState<{ width: number; height: number } | null>(null);
  const [tool, setTool] = useState<CanvasTool>('select');
  const [background, setBackground] = useState<BackgroundMode>('slots-only');
  const [showSlots, setShowSlots] = useState(true);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [status, setStatus] = useState('');
  const [leftTab, setLeftTab] = useState<'outline' | 'library'>('outline');
  // Mode libre : édition d’assets (compositions exportées en PNG).
  const [mode, setMode] = useState<'menus' | 'assets'>('menus');
  const [assetId, setAssetId] = useState<string | null>(null);
  const [assetDirty, setAssetDirty] = useState(false);
  const [insertRequest, setInsertRequest] = useState<{ texture: string; nonce: number } | null>(null);

  const menu = editor.menu;
  const dirty = menu !== null && JSON.stringify(menu) !== editor.savedJson;

  const refreshWorkspace = useCallback(async () => {
    try {
      const snapshot = await fetchWorkspace();
      setWorkspace(snapshot);
      setLoadError(null);
      return snapshot;
    } catch (error) {
      setLoadError(errorMessage(error));
      return null;
    }
  }, []);

  useEffect(() => {
    // Chargement initial : les setState ont lieu après l’await du fetch, pas pendant l’effet.
    // oxlint-disable-next-line react/set-state-in-effect
    void refreshWorkspace().then((snapshot) => {
      const first = snapshot?.menus.find((candidate) => !candidate.template) ?? snapshot?.menus[0];
      if (first) dispatch({ type: 'load', menu: first });
    });
  }, [refreshWorkspace]);

  const bumpTextures = useCallback((paths: string[]) => {
    setTextureVersions((previous) => {
      const next = { ...previous };
      for (const path of paths) next[path] = (next[path] ?? 0) + 1;
      return next;
    });
  }, []);

  const resolved = useMemo(() => {
    if (!menu) return null;
    const menusById = new Map((workspace?.menus ?? []).map((candidate) => [candidate.id, candidate]));
    menusById.set(menu.id, menu);
    return resolveMenu(menu, (id) => menusById.get(id));
  }, [menu, workspace]);

  const context = useMemo(() => (resolved ? buildPreviewContext(resolved.menu, preview) : null), [resolved, preview]);

  const texturePathsKey = resolved ? [...new Set(resolved.menu.layers.map((layer) => layer.texture))].join('\n') : '';
  const texturePaths = useMemo(() => (texturePathsKey ? texturePathsKey.split('\n') : []), [texturePathsKey]);
  const textures = useTextures(texturePaths, textureVersions);

  const composition = useMemo(() => {
    if (!resolved || !context) return null;
    return composeTitle(resolved.menu, context, (path) => {
      const texture = textures.get(path);
      if (texture === undefined) return undefined;
      return texture === null ? null : texture.bounds;
    });
  }, [resolved, context, textures]);

  const change = useCallback((recipe: Recipe, record = true) => dispatch({ type: 'change', recipe, record }), []);
  const select = useCallback((selection: Selection | null) => dispatch({ type: 'select', selection }), []);

  const save = useCallback(async () => {
    if (!menu) return;
    const json = JSON.stringify(menu);
    try {
      await saveMenu(menu);
      dispatch({ type: 'saved', json });
      setStatus(`« ${menu.id} » enregistré`);
      void refreshWorkspace();
    } catch (error) {
      setStatus(`Échec de l’enregistrement : ${errorMessage(error)}`);
    }
  }, [menu, refreshWorkspace]);

  const deleteElement = useCallback(
    (target: Selection) => {
      change((draft) => removeElement(draft, target));
      select(null);
    },
    [change, select],
  );

  const nudge = useCallback(
    (target: Selection, dx: number, dy: number) =>
      change((draft) => {
        if (target.kind === 'slot') {
          const slot = draft.slots?.find((candidate) => candidate.id === target.id);
          if (!slot) return;
          slot.area.col = clamp(slot.area.col + Math.sign(dx), 0, GRID_COLUMNS - 1);
          slot.area.row = clamp(slot.area.row + Math.sign(dy), 0, draft.container.rows - 1);
          return;
        }
        const element =
          target.kind === 'layer'
            ? draft.layers.find((candidate) => candidate.id === target.id)
            : draft.texts?.find((candidate) => candidate.id === target.id);
        if (element) {
          element.x += dx;
          element.y += dy;
        }
      }),
    [change],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // En mode assets, l’éditeur gère ses propres raccourcis.
      if (mode === 'assets') return;
      const key = event.key.toLowerCase();
      const withModifier = event.ctrlKey || event.metaKey;
      if (withModifier && key === 's') {
        event.preventDefault();
        void save();
        return;
      }
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      if (withModifier && key === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
        return;
      }
      if (withModifier && key === '0') {
        event.preventDefault();
        setZoomMode('fit');
        return;
      }
      if (withModifier && key === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
        return;
      }
      if (withModifier) return;
      if (key === 'v') setTool('select');
      else if (key === 's') setTool('slot');
      else if (key === 'escape') select(null);
      else if ((key === 'delete' || key === 'backspace') && editor.selection) deleteElement(editor.selection);
      else if (key.startsWith('arrow') && editor.selection) {
        event.preventDefault();
        const step = event.shiftKey ? SLOT_SIZE : 1;
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
        nudge(editor.selection, dx, dy);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save, select, deleteElement, nudge, editor.selection, mode]);

  const confirmDiscard = () =>
    !dirty || window.confirm('Des modifications ne sont pas enregistrées. Continuer quand même ?');

  const openMenu = (id: string) => {
    const target = workspace?.menus.find((candidate) => candidate.id === id);
    if (!target || !confirmDiscard()) return;
    dispatch({ type: 'load', menu: target });
    setPreview(DEFAULT_PREVIEW);
  };

  const handleCreateSlot = (area: SlotArea) => {
    if (!menu) return;
    const id = uniqueId('slot', (menu.slots ?? []).map((slot) => slot.id));
    change((draft) => {
      (draft.slots ??= []).push({ id, kind: 'button', area, item: { invisible: true, name: id } });
    });
    select({ kind: 'slot', id });
  };

  const handleAddText = () => {
    if (!menu) return;
    const id = uniqueId('text', (menu.texts ?? []).map((text) => text.id));
    change((draft) => {
      (draft.texts ??= []).push({ id, x: 8, y: 6, value: 'Texte', color: '#404040' });
    });
    select({ kind: 'text', id });
  };

  const handleReorderLayer = (id: string, direction: 1 | -1) =>
    change((draft) => {
      const from = draft.layers.findIndex((layer) => layer.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= draft.layers.length) return;
      [draft.layers[from], draft.layers[to]] = [draft.layers[to], draft.layers[from]];
    });

  const handleImport = async (file: File) => {
    if (!menu) return;
    const base = sanitizeId(file.name.replace(/\.png$/i, ''));
    const texture = `imported/${base}.png`;
    try {
      await uploadTexture(texture, file);
      bumpTextures([texture]);
      const id = uniqueId(base, menu.layers.map((layer) => layer.id));
      change((draft) => {
        draft.layers.push({ id, texture, x: 0, y: 0 });
      });
      select({ kind: 'layer', id });
      setStatus(`Texture importée : ${texture}`);
      void refreshWorkspace();
    } catch (error) {
      setStatus(`Échec de l’import : ${errorMessage(error)}`);
    }
  };

  const handleGenerator = async (result: GeneratorResult) => {
    if (!menu || dialog?.kind !== 'generator') return;
    const editing = dialog.mode === 'edit' ? menu.layers.find((layer) => layer.id === dialog.layerId) : undefined;
    const texture = editing?.texture ?? generatedTexturePath(menu.id, result.layerId);
    await bakeTexture(texture, result.spec, result);
    bumpTextures([texture]);
    if (editing) {
      change((draft) => {
        const layer = draft.layers.find((candidate) => candidate.id === editing.id);
        if (!layer) return;
        layer.x = result.x;
        layer.y = result.y;
        layer.generator = result.spec;
      });
    } else {
      change((draft) => {
        draft.layers.push({ id: result.layerId, texture, x: result.x, y: result.y, generator: result.spec });
      });
      select({ kind: 'layer', id: result.layerId });
    }
    setDialog(null);
    void refreshWorkspace();
  };

  const handleNewMenu = async ({ id, name, rows, template }: NewMenuInput) => {
    if (!confirmDiscard()) return;
    const created = template ? instantiateTemplate(template, id, name) : createEmptyMenu(id, name, rows);
    const baked: string[] = [];
    for (const layer of created.layers) {
      if (!layer.generator) continue;
      await bakeTexture(layer.texture, layer.generator, layer);
      baked.push(layer.texture);
    }
    await saveMenu(created);
    bumpTextures(baked);
    await refreshWorkspace();
    dispatch({ type: 'load', menu: created });
    setPreview(DEFAULT_PREVIEW);
    setDialog(null);
    setStatus(`Menu « ${id} » créé`);
  };

  const handleLibraryLayer = async (source: LibrarySourceInfo, texture: LibraryTexture, top: number | null) => {
    if (!menu) return;
    const imported = await importFromLibrary(source.id, texture.path);
    bumpTextures([imported]);
    const base = sanitizeId(texture.path.split('/').pop()?.replace(/\.png$/i, '') ?? 'layer');
    const id = uniqueId(base, menu.layers.map((layer) => layer.id));
    change((draft) => {
      draft.layers.push({ id, texture: imported, x: 0, y: top ?? 0 });
    });
    select({ kind: 'layer', id });
    setStatus(`Couche « ${id} » ajoutée depuis ${source.name}`);
    void refreshWorkspace();
  };

  const handleImportFont = async (source: LibrarySourceInfo, index: LibraryIndex, fontId: string, menuId: string) => {
    if (workspace?.menus.some((candidate) => candidate.id === menuId)) {
      throw new Error(`Un menu « ${menuId} » existe déjà`);
    }
    if (!confirmDiscard()) return;
    const { menu: created, warnings } = await buildMenuFromFont(source, index, fontId, menuId, fontId);
    await saveMenu(created);
    bumpTextures(created.layers.map((layer) => layer.texture));
    await refreshWorkspace();
    dispatch({ type: 'load', menu: created });
    setPreview(DEFAULT_PREVIEW);
    setLeftTab('outline');
    const notes = warnings.length > 0 ? ` · ${warnings.length} avertissement(s), dont : ${warnings[0]}` : '';
    setStatus(`Menu « ${menuId} » importé (${created.layers.length} couches)${notes}`);
  };

  const confirmLeaveAsset = () =>
    !assetDirty || window.confirm('L’asset a des modifications non enregistrées. Continuer quand même ?');

  const switchMode = (next: 'menus' | 'assets') => {
    if (next === mode || (mode === 'assets' && !confirmLeaveAsset())) return;
    setAssetDirty(false);
    setMode(next);
    if (next === 'assets' && !assetId && workspace?.assets[0]) setAssetId(workspace.assets[0].id);
  };

  const openAsset = (id: string) => {
    if (id === assetId || !confirmLeaveAsset()) return;
    setAssetDirty(false);
    setAssetId(id);
  };

  const handleSaveAsset = async (asset: AssetDefinition, png: Blob) => {
    const texture = `assets/${asset.id}.png`;
    await saveAsset(asset);
    await uploadTexture(texture, png);
    bumpTextures([texture]);
    setStatus(`Asset « ${asset.id} » enregistré et exporté dans textures/${texture}`);
    void refreshWorkspace();
  };

  const handleNewAsset = async ({ id, name, width, height }: NewAssetInput) => {
    if (!confirmLeaveAsset()) return;
    await saveAsset(createEmptyAsset(id, name, width, height));
    await refreshWorkspace();
    setAssetDirty(false);
    setAssetId(id);
    setDialog(null);
    setStatus(`Asset « ${id} » créé`);
  };

  const handleLibraryToAsset = async (source: LibrarySourceInfo, texture: LibraryTexture) => {
    const imported = await importFromLibrary(source.id, texture.path);
    bumpTextures([imported]);
    await refreshWorkspace();
    setInsertRequest({ texture: imported, nonce: Date.now() });
    setStatus(`Image « ${imported} » ajoutée à l’asset`);
  };

  const handleImportFontFromAssets = async (source: LibrarySourceInfo, index: LibraryIndex, fontId: string, menuId: string) => {
    if (!confirmLeaveAsset()) return;
    await handleImportFont(source, index, fontId, menuId);
    setAssetDirty(false);
    setMode('menus');
  };

  /** Zone de slots déplacée ou redimensionnée sur la toile : une seule entrée d’historique. */
  const handleSlotAreaChange = (id: string, area: SlotArea) =>
    change((draft) => {
      const slot = draft.slots?.find((candidate) => candidate.id === id);
      if (slot) slot.area = area;
    });

  const generatorInitial = ((): GeneratorResult | null => {
    if (dialog?.kind !== 'generator' || !menu) return null;
    if (dialog.mode === 'edit') {
      const layer = menu.layers.find((candidate) => candidate.id === dialog.layerId);
      return layer?.generator ? { layerId: layer.id, x: layer.x, y: layer.y, spec: layer.generator } : null;
    }
    return {
      layerId: uniqueId('panel', menu.layers.map((layer) => layer.id)),
      x: 0,
      y: 0,
      spec: structuredClone(GENERATOR_PRESETS[0].spec),
    };
  })();

  // Taille de la zone de la toile, suivie en continu pour le zoom « Ajuster ».
  const observeStage = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const fittedZoom = stageSize ? fitZoom(stageSize, resolved?.menu.container.rows ?? 6, ZOOM_LEVELS) : zoom;
  const effectiveZoom = zoomMode === 'fit' ? fittedZoom : zoom;
  const setManualZoom = (level: number) => {
    setZoomMode('manual');
    setZoom(level);
  };

  const knownMenus = workspace?.menus ?? [];
  const knownAssets = workspace?.assets ?? [];
  const currentAsset = knownAssets.find((candidate) => candidate.id === assetId) ?? null;
  const menuIsOnDisk = menu !== null && knownMenus.some((candidate) => candidate.id === menu.id);
  // Affichage seulement : les messages d’échec passent en rouge dans la barre d’outils.
  const statusIsError = /^(Échec|Impossible)/.test(status);

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">menu-forge</span>
          <span className="brand-sub">studio</span>
        </div>
        <span className="tb-sep" aria-hidden="true" />
        <div className="segmented" role="tablist" aria-label="Type de document">
          <button type="button" role="tab" aria-selected={mode === 'menus'} className={mode === 'menus' ? 'active' : ''} onClick={() => switchMode('menus')}>
            <Icon name="chest" />
            Menus
          </button>
          <button type="button" role="tab" aria-selected={mode === 'assets'} className={mode === 'assets' ? 'active' : ''} onClick={() => switchMode('assets')}>
            <Icon name="image" />
            Assets
          </button>
        </div>
        <span className="tb-sep" aria-hidden="true" />
        {mode === 'menus' ? (
          <>
            <div className="toolbar-group">
              <select
                className="menu-picker"
                value={menu?.id ?? ''}
                onChange={(event) => openMenu(event.target.value)}
                disabled={knownMenus.length === 0}
                aria-label="Menu ouvert"
              >
                {!menu && <option value="">Aucun menu</option>}
                {menu && !menuIsOnDisk && <option value={menu.id}>{menu.name} (non enregistré)</option>}
                {knownMenus.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name} ({candidate.id}){candidate.template ? ' · gabarit' : ''}
                  </option>
                ))}
              </select>
              <Tooltip label="Nouveau menu" hint="Vierge ou à partir d’un gabarit">
                <button type="button" onClick={() => setDialog({ kind: 'new-menu' })}>
                  <Icon name="plus" />
                  Nouveau
                </button>
              </Tooltip>
              <Tooltip label={dirty ? 'Enregistrer le menu' : 'Tout est enregistré'} shortcut="Ctrl+S">
                <button
                  type="button"
                  className="primary"
                  onClick={() => void save()}
                  disabled={!menu || !dirty}
                  aria-keyshortcuts="Control+S"
                >
                  <Icon name={dirty ? 'save' : 'check'} />
                  {dirty ? 'Enregistrer' : 'Enregistré'}
                  {dirty && <span className="dirty-mark" aria-hidden="true" />}
                </button>
              </Tooltip>
            </div>
          </>
        ) : (
          <div className="toolbar-group">
            <select
              className="menu-picker"
              value={assetId ?? ''}
              onChange={(event) => openAsset(event.target.value)}
              disabled={knownAssets.length === 0}
              aria-label="Asset ouvert"
            >
              {!currentAsset && <option value="">Aucun asset</option>}
              {knownAssets.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} ({candidate.id})
                </option>
              ))}
            </select>
            <Tooltip label="Nouvel asset" hint="Composition libre exportée en PNG et en glyphe">
              <button type="button" onClick={() => setDialog({ kind: 'new-asset' })}>
                <Icon name="plus" />
                Nouvel asset
              </button>
            </Tooltip>
            {assetDirty && (
              <span className="dirty-chip">
                <span className="dirty-mark" aria-hidden="true" />
                non enregistré
                <ShortcutKeys shortcut="Ctrl+S" />
              </span>
            )}
          </div>
        )}
        <span className={statusIsError ? 'status is-error' : 'status'} role="status">
          {status && (
            <>
              <Icon name={statusIsError ? 'alert' : 'check'} />
              <span className="status-text">{status}</span>
            </>
          )}
        </span>
      </header>

      {loadError && (
        <div className="banner error" role="alert">
          <Icon name="alert" size={24} />
          <span>
            Impossible de lire l’espace de travail : {loadError}. Le studio doit être lancé avec <code>npm run dev</code>.
          </span>
        </div>
      )}

      {mode === 'menus' ? (
      <main className="workspace">
        <aside className="sidebar">
          <div className="sidebar-tabs" role="tablist" aria-label="Colonne de gauche">
            <button
              type="button"
              role="tab"
              aria-selected={leftTab === 'outline'}
              className={leftTab === 'outline' ? 'active' : ''}
              onClick={() => setLeftTab('outline')}
            >
              <Icon name="list" />
              Éléments
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={leftTab === 'library'}
              className={leftTab === 'library' ? 'active' : ''}
              onClick={() => setLeftTab('library')}
            >
              <Icon name="library" />
              Bibliothèque
            </button>
          </div>
          {/* Les deux onglets restent montés : la bibliothèque garde ses filtres et son index. */}
          <div hidden={leftTab !== 'library'}>
            <LibraryPanel canAddLayer={menu !== null} onAddLayer={handleLibraryLayer} onImportFont={handleImportFont} />
          </div>
          {leftTab === 'outline' && resolved && context && (
            <OutlinePanel
              menu={resolved.menu}
              inherited={resolved.inherited}
              context={context}
              selection={editor.selection}
              onSelect={select}
              onReorderLayer={handleReorderLayer}
              onDelete={deleteElement}
              onAddText={handleAddText}
              onOpenGenerator={() => setDialog({ kind: 'generator', mode: 'create' })}
              onImport={(file) => void handleImport(file)}
            />
          )}
        </aside>

        <section className="stage-area">
          <div className="stage-toolbar" role="toolbar" aria-label="Outils de la toile">
            <div className="segmented" role="group" aria-label="Outil">
              <Tooltip label="Sélection" hint="Choisir et déplacer couches, textes et zones" shortcut="V">
                <button
                  type="button"
                  className={tool === 'select' ? 'active' : ''}
                  aria-pressed={tool === 'select'}
                  aria-keyshortcuts="V"
                  onClick={() => setTool('select')}
                >
                  <Icon name="cursor" />
                  <span className="tool-label">Sélection</span>
                  <kbd aria-hidden="true">V</kbd>
                </button>
              </Tooltip>
              <Tooltip label="Slots" hint="Glisser sur la grille pour créer une zone de slots" shortcut="S">
                <button
                  type="button"
                  className={tool === 'slot' ? 'active' : ''}
                  aria-pressed={tool === 'slot'}
                  aria-keyshortcuts="S"
                  onClick={() => setTool('slot')}
                >
                  <Icon name="grid" />
                  <span className="tool-label">Slots</span>
                  <kbd aria-hidden="true">S</kbd>
                </button>
              </Tooltip>
            </div>
            <div className="toolbar-group">
              <IconButton
                icon="undo"
                label="Annuler"
                shortcut="Ctrl+Z"
                size={24}
                disabled={editor.past.length === 0}
                onClick={() => dispatch({ type: 'undo' })}
              />
              <IconButton
                icon="redo"
                label="Rétablir"
                shortcut="Ctrl+Y"
                size={24}
                disabled={editor.future.length === 0}
                onClick={() => dispatch({ type: 'redo' })}
              />
            </div>
            <span className="tb-sep" aria-hidden="true" />
            <select
              className="background-picker"
              value={background}
              onChange={(event) => setBackground(event.target.value as BackgroundMode)}
              aria-label="Fond"
            >
              <option value="slots-only">Fond&nbsp;: cases</option>
              <option value="vanilla">Fond&nbsp;: vanilla</option>
              <option value="none">Fond&nbsp;: aucun</option>
            </select>
            <label className="checkbox">
              <input type="checkbox" checked={showSlots} onChange={(event) => setShowSlots(event.target.checked)} />
              Zones
            </label>
            <div className="stage-toolbar-end" role="group" aria-label="Zoom">
              <IconButton
                icon="minus"
                label="Zoom arrière"
                shortcut="Ctrl+molette"
                size={24}
                disabled={effectiveZoom <= ZOOM_LEVELS[0]}
                onClick={() => setManualZoom(stepZoom(ZOOM_LEVELS, effectiveZoom, -1))}
              />
              <select
                className="zoom-picker"
                value={zoomMode === 'fit' ? 'fit' : String(zoom)}
                onChange={(event) => {
                  if (event.target.value === 'fit') setZoomMode('fit');
                  else setManualZoom(Number(event.target.value));
                }}
                aria-label="Niveau de zoom"
              >
                <option value="fit">Ajuster (×{fittedZoom})</option>
                {ZOOM_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    ×{level}
                  </option>
                ))}
              </select>
              <IconButton
                icon="plus"
                label="Zoom avant"
                shortcut="Ctrl+molette"
                size={24}
                disabled={effectiveZoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
                onClick={() => setManualZoom(stepZoom(ZOOM_LEVELS, effectiveZoom, 1))}
              />
            </div>
          </div>
          <div className="stage" ref={observeStage}>
          {resolved && context ? (
            <MenuCanvas
              menu={resolved.menu}
              inherited={resolved.inherited}
              context={context}
              textures={textures}
              zoom={effectiveZoom}
              tool={tool}
              background={background}
              showSlots={showSlots}
              selection={editor.selection}
              onSelect={select}
              onBeginMove={() => dispatch({ type: 'checkpoint' })}
              onMove={(target, x, y) =>
                change((draft) => {
                  const element =
                    target.kind === 'layer'
                      ? draft.layers.find((candidate) => candidate.id === target.id)
                      : draft.texts?.find((candidate) => candidate.id === target.id);
                  if (element) {
                    element.x = x;
                    element.y = y;
                  }
                }, false)
              }
              onCreateSlot={handleCreateSlot}
              onSlotAreaChange={handleSlotAreaChange}
              zoomLevels={ZOOM_LEVELS}
              onZoomChange={setManualZoom}
            />
          ) : (
            <div className="empty-state">
              <Icon name="chest" size={48} />
              <h2>Aucun menu ouvert</h2>
              <p className="muted">
                Crée un menu vierge, pars d’un gabarit (coffre, modale, liste paginée…) ou importe-le depuis une police de
                la bibliothèque.
              </p>
              <button type="button" className="primary" onClick={() => setDialog({ kind: 'new-menu' })}>
                <Icon name="plus" />
                Nouveau menu
              </button>
            </div>
          )}
          </div>
        </section>

        <aside className="sidebar">
          {menu && resolved && (
            <Inspector
              menu={menu}
              states={resolved.menu.state ?? {}}
              selection={editor.selection}
              textures={workspace?.textures ?? []}
              onChange={change}
              onSelect={select}
              onEditGenerator={(layerId) => setDialog({ kind: 'generator', mode: 'edit', layerId })}
            />
          )}
          {resolved && (
            <PreviewPanel
              menu={resolved.menu}
              values={preview}
              onChange={setPreview}
              composition={composition}
              errors={resolved.errors}
            />
          )}
        </aside>
      </main>
      ) : (
        <main className="asset-host">
          {currentAsset ? (
            <AssetEditor
              key={currentAsset.id}
              initial={currentAsset}
              textures={workspace?.textures ?? []}
              textureVersions={textureVersions}
              insertRequest={insertRequest}
              librarySlot={
                <LibraryPanel
                  canAddLayer
                  onAddLayer={handleLibraryToAsset}
                  onImportFont={handleImportFontFromAssets}
                />
              }
              onSave={handleSaveAsset}
              onDirtyChange={setAssetDirty}
            />
          ) : (
            <section className="stage">
              <div className="empty-state">
                <Icon name="image" size={48} />
                <h2>Aucun asset ouvert</h2>
                <p className="muted">
                  Compose une image libre (boîtes, images recadrées, texte en police Minecraft), exportée en PNG et en glyphe.
                </p>
                <button type="button" className="primary" onClick={() => setDialog({ kind: 'new-asset' })}>
                  <Icon name="plus" />
                  Nouvel asset
                </button>
              </div>
            </section>
          )}
        </main>
      )}

      <footer className="statusbar">
        <span className="statusbar-path">
          Espace de travail : <code>{workspace?.root ?? '…'}</code>
        </span>
        {mode === 'menus' && resolved && (
          <span className="statusbar-meta">
            <span>
              {resolved.menu.layers.length} couche{resolved.menu.layers.length > 1 ? 's' : ''}
            </span>
            <span>
              {(resolved.menu.slots ?? []).length} slot{(resolved.menu.slots ?? []).length > 1 ? 's' : ''}
            </span>
            <span>
              {WINDOW_WIDTH} × {windowHeight(resolved.menu.container.rows)} px
            </span>
            <span>×{zoom}</span>
          </span>
        )}
        {mode === 'assets' && currentAsset && (
          <span className="statusbar-meta">
            <span>asset {currentAsset.id}</span>
            <span>textures/assets/{currentAsset.id}.png</span>
          </span>
        )}
      </footer>

      {dialog?.kind === 'new-menu' && (
        <NewMenuDialog
          templates={workspace?.templates ?? []}
          existingIds={knownMenus.map((candidate) => candidate.id)}
          onCancel={() => setDialog(null)}
          onCreate={handleNewMenu}
        />
      )}
      {dialog?.kind === 'new-asset' && (
        <NewAssetDialog
          existingIds={knownAssets.map((candidate) => candidate.id)}
          onCancel={() => setDialog(null)}
          onCreate={handleNewAsset}
        />
      )}
      {dialog?.kind === 'generator' && menu && generatorInitial && (
        <GeneratorDialog
          mode={dialog.mode}
          initial={generatorInitial}
          rows={menu.container.rows}
          takenIds={menu.layers.map((layer) => layer.id)}
          onCancel={() => setDialog(null)}
          onConfirm={handleGenerator}
        />
      )}
    </div>
  );
}
