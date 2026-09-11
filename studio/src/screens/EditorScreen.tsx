import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import type { EditorMode } from '../shell/router';
import { useContextMenu } from '../ui/menuContext';
import type { MenuEntry } from '../ui/menuContext';
import { overlayOpen } from '../ui/overlay';
import { GeneratorDialog } from '../components/GeneratorDialog';
import type { GeneratorResult } from '../components/GeneratorDialog';
import { Inspector } from '../components/Inspector';
import { MenuCanvas } from '../components/MenuCanvas';
import type { BackgroundMode, CanvasTool } from '../components/MenuCanvas';
import { NewMenuDialog } from '../components/NewMenuDialog';
import type { NewMenuInput } from '../components/NewMenuDialog';
import { AssetEditor } from '../asset/AssetEditor';
import { createEmptyAsset } from '../asset/model';
import type { AssetDefinition, Region } from '../asset/model';
import { CropDialog } from '../components/CropDialog';
import { cropToBlob, croppedTexturePath, textureBaseName } from '../lib/crop';
import { LibraryPanel } from '../components/LibraryPanel';
import { NewAssetDialog } from '../components/NewAssetDialog';
import type { NewAssetInput } from '../components/NewAssetDialog';
import { OutlinePanel } from '../components/OutlinePanel';
import { PreviewPanel } from '../components/PreviewPanel';
import { fetchWorkspace, saveAsset, saveMenu, textureUrl, uploadTexture } from '../lib/api';
import type { WorkspaceSnapshot } from '../lib/api';
import { importFromLibrary, libraryRawUrl } from '../lib/libraryApi';
import type { LibraryIndex, LibrarySourceInfo, LibraryTexture } from '../lib/libraryApi';
import { buildMenuFromFont } from '../lib/libraryImport';
import { loadTexture, useTextures } from '../lib/textures';
import { composeTitle } from '../model/compose';
import { GENERATOR_PRESETS, canvasToBlob, renderGenerator } from '../model/generator';
import { GRID_COLUMNS, SLOT_SIZE, WINDOW_WIDTH, windowHeight } from '../model/geometry';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import { fitZoom, stepZoom } from '../canvas/viewport';
import type { Point } from '../model/geometry';
import { createEmptyMenu, sanitizeId, uniqueId } from '../model/menu';
import type { GeneratorSpec, MenuDefinition, SlotArea } from '../model/menu';
import { DEFAULT_PREVIEW, buildPreviewContext } from '../model/preview';
import type { PreviewValues } from '../model/preview';
import { resolveMenu } from '../model/resolve';
import { INITIAL_EDITOR, editorReducer } from '../state/editor';
import type { Selection } from '../state/editor';

type DialogState =
  | { kind: 'new-menu' }
  | { kind: 'new-asset' }
  | { kind: 'generator'; mode: 'create' }
  | { kind: 'generator'; mode: 'edit'; layerId: string }
  | { kind: 'crop-layer'; layerId: string }
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

/** Demande venue d’un autre écran (actions rapides de l’accueil) ; `nonce` change à chaque demande. */
export interface EditorRequest {
  kind: 'new-menu' | 'new-asset' | 'import-font';
  nonce: number;
}

/** Préférences de l’éditeur, tirées des réglages. */
export interface EditorPreferences {
  /** Zoom à l’ouverture : 0 = « Ajuster ». */
  defaultZoom: number;
  /** Grille de pixels de l’éditeur d’assets. */
  showGrid: boolean;
  /** Demander avant d’abandonner des modifications non enregistrées. */
  confirmDiscard: boolean;
}

export interface EditorScreenProps {
  /** Écran affiché ; sinon l’éditeur reste monté (historique conservé) mais ignore le clavier. */
  active: boolean;
  /** Document demandé par l’adresse (`#/editeur/<mode>/<id>`). */
  route: { mode: EditorMode; id: string | null };
  /** Document effectivement ouvert, à refléter dans l’adresse. */
  onRouteChange: (mode: EditorMode, id: string | null) => void;
  request: EditorRequest | null;
  preferences: EditorPreferences;
  /** Change quand les bibliothèques branchées changent : la liste du panneau est relue. */
  librariesVersion: number;
  /** Pastille de l’espace de travail, en tête de la barre d’outils. */
  workspacePill: ReactNode;
  onDirtyChange: (dirty: boolean) => void;
  /** Document ouvert (titre de la fenêtre, Rich Presence Discord). */
  onDocumentChange: (kind: 'menu' | 'asset' | null, name: string | null) => void;
}

/** Éditeur : menus (toile, couches, slots, inspecteur) et assets du mode libre. */
export function EditorScreen({
  active,
  route,
  onRouteChange,
  request,
  preferences,
  librariesVersion,
  workspacePill,
  onDirtyChange,
  onDocumentChange,
}: EditorScreenProps) {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const openContextMenu = useContextMenu();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editor, dispatch] = useReducer(editorReducer, INITIAL_EDITOR);
  const [textureVersions, setTextureVersions] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<PreviewValues>(DEFAULT_PREVIEW);
  const [zoom, setZoom] = useState(() => preferences.defaultZoom || 3);
  // Zoom « Ajuster » par défaut : le plus grand palier où tout le coffre tient dans la zone.
  const [zoomMode, setZoomMode] = useState<'fit' | 'manual'>(() => (preferences.defaultZoom === 0 ? 'fit' : 'manual'));
  // Espace lu et premier document ouvert : l’adresse peut dès lors piloter l’éditeur.
  const [ready, setReady] = useState(false);
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
  // Compteur des demandes d’enregistrement de l’asset (bouton de la barre du haut).
  const [assetSaveRequest, setAssetSaveRequest] = useState(0);
  const [insertRequest, setInsertRequest] = useState<{ texture: string; source?: Region; nonce: number } | null>(null);

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

  // L’adresse de départ n’est lue qu’une fois, au premier chargement de l’espace.
  const initialRoute = useRef(route);
  useEffect(() => {
    // Chargement initial : les setState ont lieu après l’await du fetch, pas pendant l’effet.
    // oxlint-disable-next-line react/set-state-in-effect
    void refreshWorkspace().then((snapshot) => {
      const wanted = initialRoute.current;
      if (snapshot && wanted.mode === 'assets') {
        setMode('assets');
        setAssetId(snapshot.assets.find((candidate) => candidate.id === wanted.id)?.id ?? snapshot.assets[0]?.id ?? null);
      }
      const requested = wanted.mode === 'menus' ? snapshot?.menus.find((candidate) => candidate.id === wanted.id) : undefined;
      const first = requested ?? snapshot?.menus.find((candidate) => !candidate.template) ?? snapshot?.menus[0];
      if (first) dispatch({ type: 'load', menu: first });
      setReady(true);
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
      setStatus(`« ${menu.id} » enregistré`);
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

  // Identifiants de couche choisis mais pas encore dans le menu (ajouts en cours, qui attendent
  // une texture) : deux ajouts rapides ne tirent jamais le même identifiant.
  const reservedLayerIds = useRef(new Set<string>());
  const menuId = menu?.id;
  useEffect(() => {
    reservedLayerIds.current.clear();
  }, [menuId]);
  const reserveLayerId = useCallback((base: string, layers: readonly { id: string }[]) => {
    const id = uniqueId(base, [...layers.map((layer) => layer.id), ...reservedLayerIds.current]);
    reservedLayerIds.current.add(id);
    return id;
  }, []);

  /** Duplique une couche juste au-dessus d’elle ; une texture générée est recopiée sous le nouvel identifiant. */
  const duplicateLayer = useCallback(
    async (layerId: string) => {
      if (!menu) return;
      const original = menu.layers.find((candidate) => candidate.id === layerId);
      if (!original) return;
      const id = reserveLayerId(original.id, menu.layers);
      const copy = { ...structuredClone(original), id };
      if (original.generator) {
        copy.texture = generatedTexturePath(menu.id, id);
        await bakeTexture(copy.texture, original.generator, original);
        bumpTextures([copy.texture]);
      }
      change((draft) => {
        const index = draft.layers.findIndex((layer) => layer.id === layerId);
        draft.layers.splice(index < 0 ? draft.layers.length : index + 1, 0, copy);
      });
      select({ kind: 'layer', id });
    },
    [menu, change, select, bumpTextures, reserveLayerId],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Écran caché : aucun raccourci. En mode assets, l’éditeur d’assets gère les siens.
      // Menu contextuel ou dialogue ouvert : les touches sont pour lui, pas pour l’élément derrière.
      if (!active || mode === 'assets' || event.defaultPrevented || overlayOpen()) return;
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
      // Touche physique : sur AZERTY, Ctrl + la touche du 0 produit « à ».
      if (withModifier && (event.code === 'Digit0' || event.code === 'Numpad0')) {
        event.preventDefault();
        setZoomMode('fit');
        return;
      }
      if (withModifier && key === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
        return;
      }
      if (withModifier && key === 'd') {
        event.preventDefault();
        if (editor.selection?.kind === 'layer') void duplicateLayer(editor.selection.id);
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
  }, [save, select, deleteElement, nudge, duplicateLayer, editor.selection, mode, active]);

  const confirmDiscard = () =>
    !dirty ||
    !preferences.confirmDiscard ||
    window.confirm('Des modifications ne sont pas enregistrées. Continuer quand même ?');

  /** Ouvre un menu de l’espace ; faux si l’utilisateur garde le menu en cours (ou si le menu est introuvable). */
  const openMenu = (id: string) => {
    const target = workspace?.menus.find((candidate) => candidate.id === id);
    if (!target || !confirmDiscard()) return false;
    dispatch({ type: 'load', menu: target });
    setPreview(DEFAULT_PREVIEW);
    return true;
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
    setStatus(`Menu « ${id} » créé`);
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
    setStatus(`Couche « ${id} » ajoutée depuis ${source.name}`);
    void refreshWorkspace();
  };

  const handleImportFont = async (source: LibrarySourceInfo, index: LibraryIndex, fontId: string, menuId: string) => {
    if (workspace?.menus.some((candidate) => candidate.id === menuId)) {
      throw new Error(`Un menu « ${menuId} » existe déjà`);
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
    setStatus(`Menu « ${menuId} » importé (${created.layers.length} couches)${notes}`);
  };

  const confirmLeaveAsset = () =>
    !assetDirty ||
    !preferences.confirmDiscard ||
    window.confirm('L’asset a des modifications non enregistrées. Continuer quand même ?');

  /** Change de mode ; faux si l’utilisateur reste sur l’asset en cours. */
  const switchMode = (next: EditorMode) => {
    if (next === mode) return true;
    if (mode === 'assets' && !confirmLeaveAsset()) return false;
    setAssetDirty(false);
    setMode(next);
    if (next === 'assets' && !assetId && workspace?.assets[0]) setAssetId(workspace.assets[0].id);
    return true;
  };

  /** Ouvre un asset ; faux s’il est introuvable ou si l’utilisateur reste sur l’asset en cours. */
  const openAsset = (id: string) => {
    if (id === assetId) return true;
    if (!workspace?.assets.some((candidate) => candidate.id === id) || !confirmLeaveAsset()) return false;
    setAssetDirty(false);
    setAssetId(id);
    return true;
  };

  const currentId = mode === 'menus' ? (menu?.id ?? null) : assetId;

  // Adresse → éditeur : un document demandé par l’adresse (accueil, Précédent / Suivant) est ouvert ;
  // s’il ne l’est pas (refus, introuvable), l’adresse revient au document resté ouvert.
  const syncedRoute = useRef('');
  const applyRoute = () => {
    if (!ready || !active) return;
    const key = `${route.mode}/${route.id ?? ''}`;
    if (key === syncedRoute.current) return;
    syncedRoute.current = key;
    let accepted = switchMode(route.mode);
    if (accepted && route.id) {
      accepted = route.mode === 'menus' ? route.id === menu?.id || openMenu(route.id) : openAsset(route.id);
    }
    if (!accepted) {
      syncedRoute.current = `${mode}/${currentId ?? ''}`;
      onRouteChange(mode, currentId);
    }
  };
  const applyRouteRef = useRef(applyRoute);
  useEffect(() => {
    applyRouteRef.current = applyRoute;
  });
  useEffect(() => {
    applyRouteRef.current();
  }, [route.mode, route.id, ready, active]);

  // Éditeur → adresse : le document ouvert est reflété dans l’adresse.
  useEffect(() => {
    if (!ready || !active) return;
    syncedRoute.current = `${mode}/${currentId ?? ''}`;
    onRouteChange(mode, currentId);
  }, [ready, active, mode, currentId, onRouteChange]);

  // Actions rapides de l’accueil (nouveau menu, nouvel asset, import depuis une police).
  const handleRequest = (kind: EditorRequest['kind']) => {
    if (kind === 'new-asset') {
      if (switchMode('assets')) setDialog({ kind: 'new-asset' });
    } else if (switchMode('menus')) {
      if (kind === 'new-menu') setDialog({ kind: 'new-menu' });
      else setLeftTab('library');
    }
  };
  const handleRequestRef = useRef(handleRequest);
  useEffect(() => {
    handleRequestRef.current = handleRequest;
  });
  // Une demande déjà présente au montage (éditeur recréé par un changement d’espace) est considérée comme traitée.
  const handledRequest = useRef<number | null>(request?.nonce ?? null);
  useEffect(() => {
    if (!request || !ready || request.nonce === handledRequest.current) return;
    handledRequest.current = request.nonce;
    handleRequestRef.current(request.kind);
  }, [request, ready]);

  const anyDirty = dirty || assetDirty;
  useEffect(() => {
    onDirtyChange(anyDirty);
  }, [anyDirty, onDirtyChange]);

  const handleSaveAsset = async (asset: AssetDefinition, png: Blob) => {
    const texture = `assets/${asset.id}.png`;
    await saveAsset(asset);
    await uploadTexture(texture, png);
    bumpTextures([texture]);
    setStatus(`Asset « ${asset.id} » enregistré et exporté dans textures/${texture}`);
    void refreshWorkspace();
  };

  const handleNewAsset = async ({ id, name, width, height }: NewAssetInput) => {
    if (!confirmLeaveAsset()) return;
    await saveAsset(createEmptyAsset(id, name, width, height));
    await refreshWorkspace();
    setAssetDirty(false);
    setAssetId(id);
    setDialog(null);
    setStatus(`Asset « ${id} » créé`);
  };

  const handleLibraryToAsset = async (source: LibrarySourceInfo, texture: LibraryTexture) => {
    const imported = await importFromLibrary(source.id, texture.path);
    bumpTextures([imported]);
    await refreshWorkspace();
    setInsertRequest({ texture: imported, nonce: Date.now() });
    setStatus(`Image « ${imported} » ajoutée à l’asset`);
  };

  /** Découpe `region` dans une image et l’enregistre sous textures/cropped/ ; renvoie son chemin. */
  const bakeCrop = async (url: string, base: string, region: Region) => {
    const loaded = await loadTexture(url);
    const path = croppedTexturePath(sanitizeId(base) || 'sprite', region);
    await uploadTexture(path, await cropToBlob(loaded.image, region));
    bumpTextures([path]);
    return path;
  };

  /** Bibliothèque → menu : une partie seulement de la texture devient une couche (sa propre texture, pour le glyphe). */
  const handleLibraryRegion = async (source: LibrarySourceInfo, texture: LibraryTexture, region: Region) => {
    if (!menu) return;
    const base = textureBaseName(texture.path);
    const id = reserveLayerId(sanitizeId(base) || 'sprite', menu.layers);
    const path = await bakeCrop(libraryRawUrl(source.id, texture.path), base, region);
    change((draft) => {
      draft.layers.push({ id, texture: path, x: 0, y: 0 });
    });
    select({ kind: 'layer', id });
    setStatus(`Couche « ${id} » ajoutée : ${region.width} × ${region.height} px rognés depuis ${source.name}`);
    void refreshWorkspace();
  };

  /** Bibliothèque → asset : la texture est copiée entière, l’image n’en affiche que la zone choisie. */
  const handleLibraryRegionToAsset = async (source: LibrarySourceInfo, texture: LibraryTexture, region: Region) => {
    const imported = await importFromLibrary(source.id, texture.path);
    bumpTextures([imported]);
    await refreshWorkspace();
    setInsertRequest({ texture: imported, source: region, nonce: Date.now() });
    setStatus(`Zone ${region.width} × ${region.height} de « ${imported} » ajoutée à l’asset`);
  };

  /** Rogne la texture d’une couche ; la couche se décale pour que la partie gardée reste en place. */
  const handleCropLayer = async (layerId: string, region: Region) => {
    const layer = menu?.layers.find((candidate) => candidate.id === layerId);
    if (!layer) return;
    const path = await bakeCrop(textureUrl(layer.texture, textureVersions[layer.texture] ?? 0), textureBaseName(layer.texture), region);
    change((draft) => {
      const target = draft.layers.find((candidate) => candidate.id === layerId);
      if (!target) return;
      target.texture = path;
      target.x += region.x;
      target.y += region.y;
    });
    setStatus(`Couche « ${layerId} » rognée à ${region.width} × ${region.height} px`);
    void refreshWorkspace();
  };

  /** Extrait une partie de la texture d’une couche en nouvelle couche, à la même place ; la couche d’origine reste intacte. */
  const handleExtractLayer = async (layerId: string, region: Region) => {
    const layer = menu?.layers.find((candidate) => candidate.id === layerId);
    if (!layer || !menu) return;
    const id = reserveLayerId(`${layer.id}_part`, menu.layers);
    const path = await bakeCrop(textureUrl(layer.texture, textureVersions[layer.texture] ?? 0), textureBaseName(layer.texture), region);
    change((draft) => {
      draft.layers.push({ id, texture: path, x: layer.x + region.x, y: layer.y + region.y });
    });
    setStatus(`Couche « ${id} » extraite de « ${layerId} »`);
    void refreshWorkspace();
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

  const cropLayer = dialog?.kind === 'crop-layer' ? (menu?.layers.find((layer) => layer.id === dialog.layerId) ?? null) : null;

  /** Actions d’un élément du menu (clic droit dans la liste ou sur la toile). */
  const elementMenu = (target: Selection): MenuEntry[] => {
    if (target.kind === 'layer') {
      const layer = menu?.layers.find((candidate) => candidate.id === target.id);
      return [
        { heading: `Couche « ${target.id} »` },
        { label: 'Dupliquer', icon: 'copy', shortcut: 'Ctrl+D', onSelect: () => void duplicateLayer(target.id) },
        {
          label: 'Rogner…',
          icon: 'crop',
          disabled: Boolean(layer?.generator),
          onSelect: () => setDialog({ kind: 'crop-layer', layerId: target.id }),
        },
        ...(layer?.generator
          ? [
              {
                label: 'Modifier la texture générée…',
                icon: 'sparkles' as const,
                onSelect: () => setDialog({ kind: 'generator', mode: 'edit', layerId: target.id }),
              },
            ]
          : []),
        { separator: true },
        { label: 'Monter', icon: 'chevron-up', onSelect: () => handleReorderLayer(target.id, 1) },
        { label: 'Descendre', icon: 'chevron-down', onSelect: () => handleReorderLayer(target.id, -1) },
        { separator: true },
        { label: 'Supprimer', icon: 'trash', shortcut: 'Suppr', danger: true, onSelect: () => deleteElement(target) },
      ];
    }
    return [
      { heading: `${target.kind === 'text' ? 'Texte' : 'Slot'} « ${target.id} »` },
      { label: 'Supprimer', icon: 'trash', shortcut: 'Suppr', danger: true, onSelect: () => deleteElement(target) },
    ];
  };

  /** Clic droit sur une zone vide de la toile. */
  const canvasMenu = (): MenuEntry[] => [
    { heading: menu ? `Menu « ${menu.name} »` : 'Toile' },
    { label: 'Ajouter un texte', icon: 'text', disabled: !menu, onSelect: handleAddText },
    { label: 'Générer une texture…', icon: 'sparkles', disabled: !menu, onSelect: () => setDialog({ kind: 'generator', mode: 'create' }) },
    { separator: true },
    { label: 'Ajuster le zoom', icon: 'expand', shortcut: 'Ctrl+0', onSelect: () => setZoomMode('fit') },
  ];

  const openElementMenu = (target: Selection, event: ReactMouseEvent) => openContextMenu(event, elementMenu(target));
  const openCanvasMenu = (target: Selection | null, event: ReactMouseEvent) =>
    openContextMenu(event, target ? elementMenu(target) : canvasMenu());

  // Taille de la zone de la toile, suivie en continu pour le zoom « Ajuster ».
  const observeStage = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      // Éditeur caché (autre écran) : taille nulle, le zoom « Ajuster » garde la dernière vraie taille.
      if (entry.contentRect.width === 0 || entry.contentRect.height === 0) return;
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

  const documentKind = mode === 'menus' ? (menu ? 'menu' : null) : currentAsset ? 'asset' : null;
  const documentName = mode === 'menus' ? (menu?.name ?? null) : (currentAsset?.name ?? null);
  useEffect(() => {
    if (active) onDocumentChange(documentKind, documentName);
  }, [active, documentKind, documentName, onDocumentChange]);

  return (
    <div className="app">
      <header className="toolbar">
        {workspacePill}
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
            <Tooltip label={assetDirty ? 'Enregistrer et exporter l’asset' : 'Tout est enregistré'} shortcut="Ctrl+S">
              <button
                type="button"
                className="primary"
                disabled={!currentAsset || !assetDirty}
                aria-keyshortcuts="Control+S"
                onClick={() => setAssetSaveRequest((count) => count + 1)}
              >
                <Icon name={assetDirty ? 'save' : 'check'} />
                {assetDirty ? 'Enregistrer' : 'Enregistré'}
                {assetDirty && <span className="dirty-mark" aria-hidden="true" />}
              </button>
            </Tooltip>
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
            <LibraryPanel
              key={librariesVersion}
              canAddLayer={menu !== null}
              onAddLayer={handleLibraryLayer}
              onAddRegion={handleLibraryRegion}
              onImportFont={handleImportFont}
            />
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
              onItemContextMenu={openElementMenu}
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
          <div
            className="stage"
            ref={observeStage}
            onContextMenu={(event) => {
              // Zone grise autour du coffre : même menu qu’une zone vide de la toile.
              if (event.target === event.currentTarget) openCanvasMenu(null, event);
            }}
          >
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
              onContextMenu={openCanvasMenu}
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
              onCropLayer={(layerId) => setDialog({ kind: 'crop-layer', layerId })}
              onDuplicateLayer={(layerId) => void duplicateLayer(layerId)}
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
              active={active}
              defaultShowGrid={preferences.showGrid}
              defaultZoom={preferences.defaultZoom}
              librarySlot={
                <LibraryPanel
                  key={librariesVersion}
                  addLabel="Insérer dans l’asset"
                  canAddLayer
                  onAddLayer={handleLibraryToAsset}
                  onAddRegion={handleLibraryRegionToAsset}
                  onImportFont={handleImportFontFromAssets}
                />
              }
              onSave={handleSaveAsset}
              onDirtyChange={setAssetDirty}
              saveRequest={assetSaveRequest}
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
            <span>×{effectiveZoom}</span>
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
      {dialog?.kind === 'crop-layer' && cropLayer && (
        <CropDialog
          title={`Rogner la couche « ${cropLayer.id} »`}
          url={textureUrl(cropLayer.texture, textureVersions[cropLayer.texture] ?? 0)}
          primary={{ label: 'Rogner la couche', run: (region) => handleCropLayer(cropLayer.id, region) }}
          secondary={{ label: 'Extraire en nouvelle couche', run: (region) => handleExtractLayer(cropLayer.id, region) }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
