import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
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
import { RenameDocumentDialog } from '../components/DocumentDialogs';
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
import { elementRect } from '../canvas/menuRects';
import { fetchWorkspace, saveAsset, saveMenu, textureUrl, uploadTexture } from '../lib/api';
import type { WorkspaceSnapshot } from '../lib/api';
import type { DocumentType } from '../lib/appApi';
import { menuClipboard, nextPasteShift, readClipboard, writeClipboard } from '../lib/clipboard';
import type { ClipboardContent, MenuClipboard } from '../lib/clipboard';
import { duplicateWithFreeId, renameWithReferences, trashWithConfirmation } from '../lib/documents';
import type { DocumentEvent } from '../lib/documents';
import { plural } from '../lib/format';
import { hasDraggedFiles, imageSizeOf, pastedImageName, pngFiles, uniqueTexturePath } from '../lib/imageImport';
import { importFromLibrary, libraryRawUrl } from '../lib/libraryApi';
import type { LibraryIndex, LibrarySourceInfo, LibraryTexture } from '../lib/libraryApi';
import { buildMenuFromFont } from '../lib/libraryImport';
import { arrowDelta, isDeleteKey, shortcutDigit, shortcutLetter, withCommand } from '../lib/shortcuts';
import { useClipboardShortcuts } from '../lib/useClipboardShortcuts';
import { loadTexture, useTextures } from '../lib/textures';
import { ALIGN_LABELS, DISTRIBUTE_LABELS, alignOffsets, distributeOffsets, unionRect } from '../model/arrange';
import type { AlignMode, AlignReference, DistributeAxis } from '../model/arrange';
import { composeTitle } from '../model/compose';
import { evaluateCondition } from '../model/conditions';
import { GENERATOR_PRESETS, canvasToBlob, renderGenerator } from '../model/generator';
import { SLOT_SIZE, WINDOW_WIDTH, windowHeight } from '../model/geometry';
import type { Point, Rect } from '../model/geometry';
import { createEmptyMenu, hasEditorFlag, sanitizeId, uniqueId } from '../model/menu';
import type { EditorFlag, GeneratorSpec, MenuDefinition, SlotArea } from '../model/menu';
import {
  allTargets,
  applyMoves,
  collectElements,
  duplicatePlan,
  findElement,
  generatedTexturePath,
  insertElements,
  nudgeMoves,
  offsetMoves,
  pastePlan,
  planSelection,
  removeElements,
  setFlagOn,
  takenIds,
  translateMoves,
} from '../model/menuEdit';
import type { ElementMove, NewElement } from '../model/menuEdit';
import { DEFAULT_PREVIEW, buildPreviewContext } from '../model/preview';
import type { PreviewValues } from '../model/preview';
import { menuReferences, rewriteMenuReferences } from '../model/references';
import { resolveMenu } from '../model/resolve';
import { CANVAS_MARGINS, fitZoom, isEditableTarget, stepZoom } from '../canvas/viewport';
import { INITIAL_EDITOR, editorReducer, selectionIncludes } from '../state/editor';
import type { Selection } from '../state/editor';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';

type DialogState =
  | { kind: 'new-menu' }
  | { kind: 'new-asset' }
  | { kind: 'generator'; mode: 'create' }
  | { kind: 'generator'; mode: 'edit'; layerId: string }
  | { kind: 'crop-layer'; layerId: string }
  | { kind: 'rename'; type: DocumentType; id: string; name: string }
  | null;

type Recipe = (draft: MenuDefinition) => void;

const ZOOM_LEVELS = [1, 2, 3, 4, 5, 6, 8];

const ALIGN_ICONS: Record<AlignMode, IconName> = {
  left: 'arrange-left',
  center: 'arrange-center',
  right: 'arrange-right',
  top: 'arrange-top',
  middle: 'arrange-middle',
  bottom: 'arrange-bottom',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  /** Demander avant de mettre un document à la corbeille. */
  confirmDelete: boolean;
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
  /** Document renommé ou mis à la corbeille depuis un autre écran (accueil) : l’éditeur suit. */
  documentEvent?: DocumentEvent | null;
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
  documentEvent = null,
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
  const [alignReference, setAlignReference] = useState<AlignReference>('selection');
  // Fichier glissé au-dessus de la toile (repère de dépôt).
  const [dropActive, setDropActive] = useState(false);
  // Mode libre : édition d’assets (compositions exportées en PNG).
  const [mode, setMode] = useState<'menus' | 'assets'>('menus');
  const [assetId, setAssetId] = useState<string | null>(null);
  const [assetDirty, setAssetDirty] = useState(false);
  // Compteur des demandes d’enregistrement de l’asset (bouton de la barre du haut).
  const [assetSaveRequest, setAssetSaveRequest] = useState(0);
  const [insertRequest, setInsertRequest] = useState<{ texture: string; source?: Region; nonce: number } | null>(null);
  const stageNode = useRef<HTMLDivElement | null>(null);

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
  const select = useCallback((selection: Selection[]) => dispatch({ type: 'select', selection }), []);

  /* Sélection */

  // Seuls les éléments propres au menu (et encore présents) comptent : un élément hérité ne se modifie pas ici.
  const ownSelection = useMemo(
    () => (menu ? editor.selection.filter((target) => findElement(menu, target) !== undefined) : []),
    [menu, editor.selection],
  );
  /** Éléments que l’on peut déplacer (un élément verrouillé reste en place). */
  const movable = (targets: readonly Selection[]) =>
    menu ? targets.filter((target) => !hasEditorFlag(findElement(menu, target) ?? {}, 'locked')) : [];

  const selectionRects = (targets: readonly Selection[]): Array<Rect | null> =>
    resolved && context ? targets.map((target) => elementRect(resolved.menu, target, textures, context)) : targets.map(() => null);

  const selectionBounds = (() => {
    const rects = selectionRects(ownSelection).filter((rect): rect is Rect => rect !== null);
    return rects.length > 0 ? unionRect(rects) : null;
  })();

  /** Ctrl+A : tout ce qui se sélectionne sur la toile (ni verrouillé, ni masqué, visible dans l’état d’aperçu). */
  const selectAll = () => {
    if (!menu || !context) return;
    select(
      allTargets(menu).filter((target) => {
        const element = findElement(menu, target);
        if (!element || hasEditorFlag(element, 'locked') || hasEditorFlag(element, 'hidden')) return false;
        return target.kind === 'slot' ? showSlots : evaluateCondition(element.visibleWhen, context);
      }),
    );
  };

  const save = useCallback(async () => {
    if (!menu) return;
    const json = JSON.stringify(menu);
    try {
      await saveMenu(menu);
      dispatch({ type: 'saved', json });
      setStatus(`« ${menu.id} » enregistré`);
      void refreshWorkspace();
    } catch (error) {
      setStatus(`Échec de l’enregistrement : ${errorMessage(error)}`);
    }
  }, [menu, refreshWorkspace]);

  /* Modifications de la sélection */

  const applyElementMoves = (moves: readonly ElementMove[]) => {
    if (moves.length > 0) change((draft) => applyMoves(draft, moves));
  };

  const deleteTargets = (targets: readonly Selection[]) => {
    if (targets.length === 0) return;
    change((draft) => removeElements(draft, targets));
    select(ownSelection.filter((target) => !selectionIncludes(targets, target)));
  };

  const nudge = (dx: number, dy: number) => {
    if (menu) applyElementMoves(nudgeMoves(menu, movable(ownSelection), dx, dy));
  };

  const moveSelectionBy = (dx: number, dy: number) => {
    if (!menu) return;
    const cells = { col: Math.round(dx / SLOT_SIZE), row: Math.round(dy / SLOT_SIZE) };
    applyElementMoves(translateMoves(menu, movable(ownSelection), { x: dx, y: dy }, cells));
  };

  /** Aligner ou répartir : chaque élément reçoit son décalage (les zones, arrondi à la case). */
  const arrange = (compute: (rects: Rect[]) => Point[], targets: readonly Selection[]) => {
    if (!menu) return;
    const candidates = movable(targets);
    const rects = selectionRects(candidates);
    const placed = candidates.filter((_, index) => rects[index] !== null);
    const offsets = compute(rects.filter((rect): rect is Rect => rect !== null));
    const moves = offsetMoves(menu, placed, offsets);
    applyElementMoves(moves);
    if (moves.length === 0 && placed.length > 0) setStatus('Déjà aligné');
  };
  const canvasRect = (): Rect => ({ x: 0, y: 0, width: WINDOW_WIDTH, height: windowHeight(menu?.container.rows ?? 6) });
  const alignTargets = (mode: AlignMode, targets: readonly Selection[] = ownSelection) =>
    arrange(
      (rects) => alignOffsets(rects, mode, alignReference === 'canvas' || rects.length < 2 ? canvasRect() : unionRect(rects)),
      targets,
    );
  const distributeTargets = (axis: DistributeAxis, targets: readonly Selection[] = ownSelection) =>
    arrange((rects) => distributeOffsets(rects, axis), targets);

  /** Verrouille / masque (ou l’inverse) : si tous portent déjà le drapeau, il est retiré à tous. */
  const toggleFlag = (targets: readonly Selection[], flag: EditorFlag) => {
    if (!menu || targets.length === 0) return;
    const all = targets.every((target) => hasEditorFlag(findElement(menu, target) ?? {}, flag));
    change((draft) => setFlagOn(draft, targets, flag, !all));
  };

  // Identifiants de couche choisis mais pas encore dans le menu (ajouts en cours, qui attendent
  // une texture) : deux ajouts rapides ne tirent jamais le même identifiant.
  const reservedLayerIds = useRef(new Set<string>());
  // Textures écrites pendant la session mais pas encore relues dans l’espace.
  const reservedTextures = useRef(new Set<string>());
  const menuId = menu?.id;
  useEffect(() => {
    reservedLayerIds.current.clear();
  }, [menuId]);
  const reserveLayerId = useCallback((base: string, layers: readonly { id: string }[]) => {
    const id = uniqueId(base, [...layers.map((layer) => layer.id), ...reservedLayerIds.current]);
    reservedLayerIds.current.add(id);
    return id;
  }, []);

  /** Recalcule les textures générées des couches à insérer (une copie ne partage jamais le PNG d’une autre couche). */
  const bakePlan = async (plan: readonly NewElement[]) => {
    const baked: string[] = [];
    for (const entry of plan) {
      if (entry.kind !== 'layer' || !entry.element.generator) continue;
      await bakeTexture(entry.element.texture, entry.element.generator, entry.element);
      baked.push(entry.element.texture);
    }
    if (baked.length > 0) bumpTextures(baked);
  };

  /** Regénère d’abord les textures des couches générées (aucune couche sans image), puis insère : une seule entrée d’historique. */
  const insertPlan = async (plan: NewElement[], verb: string) => {
    if (plan.length === 0) return;
    try {
      await bakePlan(plan);
    } catch (error) {
      setStatus(`Échec de la génération des textures : ${errorMessage(error)}`);
      return;
    }
    change((draft) => insertElements(draft, plan));
    select(planSelection(plan));
    setStatus(`${plural(plan.length, 'élément')} ${verb}`);
  };

  /** Ctrl+D : copies au-dessus des originaux (sur place ; une zone de slots se décale d’une case). */
  const duplicateTargets = (targets: readonly Selection[]) => {
    if (!menu || !resolved || targets.length === 0) return;
    void insertPlan(duplicatePlan(menu, targets, takenIds(resolved.menu)), targets.length > 1 ? 'dupliqués' : 'dupliqué');
  };

  /** Extrait du presse-papiers pour ces éléments (et message d’état), ou `null` s’il n’y a rien. */
  const clipboardFor = (targets: readonly Selection[]): MenuClipboard | null => {
    if (!menu || targets.length === 0) return null;
    const { layers, texts, slots } = collectElements(menu, targets);
    setStatus(`${plural(targets.length, 'élément')} copié${targets.length > 1 ? 's' : ''}`);
    return menuClipboard(`menu:${menu.id}`, layers, texts, slots);
  };

  /** Copier depuis un menu contextuel ou l’inspecteur (le raccourci passe par useClipboardShortcuts). */
  const copyTargets = (targets: readonly Selection[]) => {
    const payload = clipboardFor(targets);
    if (payload) writeClipboard(payload);
  };

  const cutTargets = (targets: readonly Selection[]) => {
    copyTargets(targets);
    deleteTargets(targets);
  };

  const pasteElements = (payload: MenuClipboard) => {
    if (!menu || !resolved) return;
    const shift = nextPasteShift(payload, `menu:${menu.id}`);
    void insertPlan(pastePlan(payload, menu, takenIds(resolved.menu), shift), 'collé(s)');
  };

  /** Nouvelle texture importée dans `textures/imported/` (jamais par-dessus une texture existante). */
  const importTexture = async (blob: Blob, fileName: string): Promise<string> => {
    const base = sanitizeId(fileName.replace(/\.png$/i, '')) || 'image';
    const texture = uniqueTexturePath('imported', base, [...(workspace?.textures ?? []), ...reservedTextures.current]);
    reservedTextures.current.add(texture);
    await uploadTexture(texture, blob);
    bumpTextures([texture]);
    void refreshWorkspace();
    return texture;
  };

  /** Image (fichier déposé, image collée) ajoutée comme couche, centrée sur `at` (sinon en haut à gauche). */
  const importImageAsLayer = async (blob: Blob, fileName: string, at: Point | null) => {
    if (!menu) return null;
    try {
      const texture = await importTexture(blob, fileName);
      const size = await imageSizeOf(blob);
      const id = reserveLayerId(textureBaseName(texture), menu.layers);
      const x = at ? Math.round(at.x - (size?.width ?? 0) / 2) : 0;
      const y = at ? Math.round(at.y - (size?.height ?? 0) / 2) : 0;
      change((draft) => {
        draft.layers.push({ id, texture, x, y });
      });
      setStatus(`Texture importée : textures/${texture} · couche « ${id} »`);
      return { kind: 'layer', id } as const;
    } catch (error) {
      setStatus(`Échec de l’import : ${errorMessage(error)}`);
      return null;
    }
  };

  const pasteContent = async (content: ClipboardContent) => {
    if (content.payload?.kind === 'menu') {
      pasteElements(content.payload);
    } else if (content.payload?.kind === 'asset') {
      setStatus('Le presse-papiers contient des éléments d’asset : colle-les dans un asset.');
    } else if (content.image && menu) {
      const center = { x: WINDOW_WIDTH / 2, y: windowHeight(menu.container.rows) / 2 };
      const added = await importImageAsLayer(content.image, pastedImageName(), center);
      if (added) select([added]);
    } else {
      setStatus('Rien à coller : copie d’abord des éléments (Ctrl+C) ou une image PNG.');
    }
  };

  /* Clavier et presse-papiers */

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    // Écran caché : aucun raccourci. En mode assets, l’éditeur d’assets gère les siens.
    // Menu contextuel ou dialogue ouvert : les touches sont pour lui, pas pour l’élément derrière.
    if (!active || mode === 'assets' || event.defaultPrevented || overlayOpen()) return;
    const letter = shortcutLetter(event);
    const command = withCommand(event);
    if (command && letter === 's') {
      event.preventDefault();
      void save();
      return;
    }
    if (isEditableTarget(event.target)) return;
    if (command && letter === 'z') {
      event.preventDefault();
      dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      return;
    }
    if (command && shortcutDigit(event) === '0') {
      event.preventDefault();
      setZoomMode('fit');
      return;
    }
    if (command && letter === 'y') {
      event.preventDefault();
      dispatch({ type: 'redo' });
      return;
    }
    if (command && letter === 'd') {
      event.preventDefault();
      duplicateTargets(ownSelection);
      return;
    }
    if (command && letter === 'a') {
      event.preventDefault();
      selectAll();
      return;
    }
    // Ctrl+C, Ctrl+X, Ctrl+V : traités par useClipboardShortcuts.
    if (command || event.altKey) return;
    if (letter === 'v') setTool('select');
    else if (letter === 's') setTool('slot');
    else if (event.key === 'Escape') select([]);
    else if (isDeleteKey(event) && ownSelection.length > 0) {
      event.preventDefault();
      deleteTargets(ownSelection);
    } else {
      const delta = arrowDelta(event, 1, SLOT_SIZE);
      if (delta && ownSelection.length > 0) {
        event.preventDefault();
        nudge(delta.dx, delta.dy);
      }
    }
  });

  useClipboardShortcuts({
    enabled: () => active && mode === 'menus' && menu !== null,
    copy: () => clipboardFor(ownSelection),
    remove: () => deleteTargets(ownSelection),
    paste: (content) => void pasteContent(content),
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => handleKeyDown(event);
    // Un fichier lâché hors de la toile n’ouvre pas l’image dans la fenêtre à la place du studio.
    const guardDrop = (event: DragEvent) => {
      if (hasDraggedFiles(event.dataTransfer)) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('dragover', guardDrop);
    window.addEventListener('drop', guardDrop);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('dragover', guardDrop);
      window.removeEventListener('drop', guardDrop);
    };
  }, []);

  const confirmDiscard = () =>
    !dirty ||
    !preferences.confirmDiscard ||
    window.confirm('Des modifications ne sont pas enregistrées. Continuer quand même ?');

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
    const id = uniqueId('slot', (resolved?.menu.slots ?? menu.slots ?? []).map((slot) => slot.id));
    change((draft) => {
      (draft.slots ??= []).push({ id, kind: 'button', area, item: { invisible: true, name: id } });
    });
    select([{ kind: 'slot', id }]);
  };

  const handleAddText = () => {
    if (!menu) return;
    const id = uniqueId('text', (resolved?.menu.texts ?? menu.texts ?? []).map((text) => text.id));
    change((draft) => {
      (draft.texts ??= []).push({ id, x: 8, y: 6, value: 'Texte', color: '#404040' });
    });
    select([{ kind: 'text', id }]);
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
      select([{ kind: 'layer', id }]);
      setStatus(`Texture importée : ${texture}`);
      void refreshWorkspace();
    } catch (error) {
      setStatus(`Échec de l’import : ${errorMessage(error)}`);
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
      select([{ kind: 'layer', id: result.layerId }]);
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
    select([{ kind: 'layer', id }]);
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
    const notes = warnings.length > 0 ? ` · ${warnings.length} avertissement(s), dont : ${warnings[0]}` : '';
    setStatus(`Menu « ${menuId} » importé (${created.layers.length} couches)${notes}`);
  };

  const confirmLeaveAsset = () =>
    !assetDirty ||
    !preferences.confirmDiscard ||
    window.confirm('L’asset a des modifications non enregistrées. Continuer quand même ?');

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

  /* Documents : renommer, dupliquer, corbeille */

  /** Premier document restant, après une mise à la corbeille. */
  const openFallback = (type: DocumentType, snapshot: WorkspaceSnapshot | null) => {
    if (type === 'menu') {
      const next = snapshot?.menus.find((candidate) => !candidate.template) ?? snapshot?.menus[0] ?? null;
      dispatch({ type: 'load', menu: next });
      setPreview(DEFAULT_PREVIEW);
    } else {
      setAssetDirty(false);
      setAssetId(snapshot?.assets[0]?.id ?? null);
    }
  };

  /** Suit un renommage : le document ouvert prend son nouvel identifiant, ses références aussi. */
  const followRename = (
    type: DocumentType,
    from: string,
    to: string,
    name: string,
    snapshot: WorkspaceSnapshot | null,
    updated: readonly string[],
  ) => {
    if (type === 'asset') {
      if (assetId === from) {
        setAssetDirty(false);
        setAssetId(to);
      }
      return;
    }
    if (!menu) return;
    if (menu.id === from) {
      const fresh = snapshot?.menus.find((candidate) => candidate.id === to);
      // Sans modification en cours : relu du disque (chemins des textures générées mis à jour) ;
      // sinon, les modifications sont gardées sous le nouvel identifiant.
      if (!dirty && fresh) dispatch({ type: 'load', menu: fresh });
      else dispatch({ type: 'renamed', id: to, name });
    } else if (updated.includes(menu.id)) {
      const fresh = snapshot?.menus.find((candidate) => candidate.id === menu.id);
      if (!dirty && fresh) dispatch({ type: 'load', menu: fresh });
      else change((draft) => void rewriteMenuReferences(draft, from, to));
    }
  };

  const handleDocumentEvent = useEffectEvent(async (event: DocumentEvent) => {
    const snapshot = await refreshWorkspace();
    if (event.kind === 'renamed' && event.to) {
      followRename(event.type, event.from, event.to, event.name ?? event.to, snapshot, event.updated ?? []);
    } else if (event.kind === 'trashed' && (event.type === 'menu' ? menu?.id === event.from : assetId === event.from)) {
      openFallback(event.type, snapshot);
    }
  });
  const handledEvent = useRef<number | null>(documentEvent?.nonce ?? null);
  useEffect(() => {
    if (!documentEvent || documentEvent.nonce === handledEvent.current) return;
    handledEvent.current = documentEvent.nonce;
    void handleDocumentEvent(documentEvent);
  }, [documentEvent]);

  const knownMenus = workspace?.menus ?? [];
  const knownAssets = workspace?.assets ?? [];
  const currentAsset = knownAssets.find((candidate) => candidate.id === assetId) ?? null;
  const menuIsOnDisk = menu !== null && knownMenus.some((candidate) => candidate.id === menu.id);

  const startRename = (type: DocumentType) => {
    if (type === 'menu' && menu) setDialog({ kind: 'rename', type, id: menu.id, name: menu.name });
    else if (type === 'asset' && currentAsset && confirmLeaveAsset()) {
      setDialog({ kind: 'rename', type, id: currentAsset.id, name: currentAsset.name });
    }
  };

  const handleRename = async (to: string, name: string, updateReferences: boolean) => {
    if (dialog?.kind !== 'rename') return;
    const { type, id } = dialog;
    const { summary, updated } = await renameWithReferences({
      type,
      from: id,
      to,
      name,
      menus: knownMenus,
      updateReferences,
    });
    const snapshot = await refreshWorkspace();
    followRename(type, id, summary.id, summary.name, snapshot, updated);
    setDialog(null);
    const references = updated.length > 0 ? ` · ${plural(updated.length, 'menu')} mis à jour` : '';
    setStatus(id === summary.id ? `« ${summary.name} » renommé` : `« ${id} » renommé en « ${summary.id} »${references}`);
  };

  const duplicateDocumentNow = async (type: DocumentType) => {
    const source = type === 'menu' ? menu : currentAsset;
    if (!source) return;
    try {
      const ids = (type === 'menu' ? knownMenus : knownAssets).map((candidate) => candidate.id);
      const summary = await duplicateWithFreeId(type, source.id, source.name, ids);
      const snapshot = await refreshWorkspace();
      const unsaved = type === 'menu' ? dirty : assetDirty;
      if (type === 'menu' && !unsaved) {
        const created = snapshot?.menus.find((candidate) => candidate.id === summary.id);
        if (created) dispatch({ type: 'load', menu: created });
      } else if (type === 'asset' && !unsaved) {
        setAssetId(summary.id);
      }
      const note = unsaved ? ' (copie de la version enregistrée)' : '';
      setStatus(`« ${summary.id} » créé, copie de « ${source.id} »${note}`);
    } catch (error) {
      setStatus(`Échec de la duplication : ${errorMessage(error)}`);
    }
  };

  const trashDocumentNow = async (type: DocumentType) => {
    const source = type === 'menu' ? menu : currentAsset;
    if (!source) return;
    if (type === 'menu' ? !confirmDiscard() : !confirmLeaveAsset()) return;
    try {
      const trashed = await trashWithConfirmation(type, source.id, source.name, preferences.confirmDelete);
      if (!trashed) return;
      const snapshot = await refreshWorkspace();
      openFallback(type, snapshot);
      setStatus(`« ${source.id} » mis à la corbeille : ${trashed.trashed}`);
    } catch (error) {
      setStatus(`Échec de la mise à la corbeille : ${errorMessage(error)}`);
    }
  };

  const documentMenu = (type: DocumentType): MenuEntry[] => {
    const source = type === 'menu' ? menu : currentAsset;
    const onDisk = type === 'menu' ? menuIsOnDisk : currentAsset !== null;
    const noun = type === 'menu' ? 'Menu' : 'Asset';
    return [
      { heading: source ? `${noun} « ${source.name} »` : noun },
      { label: 'Renommer…', icon: 'pencil', disabled: !onDisk, onSelect: () => startRename(type) },
      { label: 'Dupliquer', icon: 'copy', disabled: !onDisk, onSelect: () => void duplicateDocumentNow(type) },
      { separator: true },
      {
        label: 'Mettre à la corbeille',
        icon: 'trash',
        danger: true,
        disabled: !onDisk,
        onSelect: () => void trashDocumentNow(type),
      },
    ];
  };

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
    select([{ kind: 'layer', id }]);
    setStatus(`Couche « ${id} » ajoutée : ${region.width} × ${region.height} px rognés depuis ${source.name}`);
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

  /** Zone de slots redimensionnée sur la toile : une seule entrée d’historique. */
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

  /* Menus contextuels */

  const clipboardEntries = (targets: readonly Selection[]): MenuEntry[] => [
    { label: 'Couper', icon: 'cut', shortcut: 'Ctrl+X', onSelect: () => cutTargets(targets) },
    { label: 'Copier', icon: 'clipboard', shortcut: 'Ctrl+C', onSelect: () => copyTargets(targets) },
    { label: 'Dupliquer', icon: 'copy', shortcut: 'Ctrl+D', onSelect: () => duplicateTargets(targets) },
  ];

  const flagEntries = (targets: readonly Selection[]): MenuEntry[] => {
    const locked = menu ? targets.every((target) => hasEditorFlag(findElement(menu, target) ?? {}, 'locked')) : false;
    const hidden = menu ? targets.every((target) => hasEditorFlag(findElement(menu, target) ?? {}, 'hidden')) : false;
    return [
      { label: locked ? 'Déverrouiller' : 'Verrouiller', icon: locked ? 'unlock' : 'lock', onSelect: () => toggleFlag(targets, 'locked') },
      {
        label: hidden ? 'Afficher sur la toile' : 'Masquer sur la toile',
        icon: hidden ? 'eye' : 'eye-off',
        onSelect: () => toggleFlag(targets, 'hidden'),
      },
    ];
  };

  /** Actions d’un élément (clic droit dans la liste ou sur la toile) ; sur une sélection multiple, pour toute la sélection. */
  const elementMenu = (target: Selection): MenuEntry[] => {
    const targets = selectionIncludes(ownSelection, target) && ownSelection.length > 1 ? ownSelection : [target];
    const remove: MenuEntry = { label: 'Supprimer', icon: 'trash', shortcut: 'Suppr', danger: true, onSelect: () => deleteTargets(targets) };
    if (targets.length > 1) {
      return [
        { heading: `${plural(targets.length, 'élément')} sélectionnés` },
        ...clipboardEntries(targets),
        { separator: true },
        ...(Object.keys(ALIGN_LABELS) as AlignMode[]).map((alignMode) => ({
          label: ALIGN_LABELS[alignMode],
          icon: ALIGN_ICONS[alignMode],
          onSelect: () => alignTargets(alignMode, targets),
        })),
        ...(['horizontal', 'vertical'] as const).map((axis) => ({
          label: DISTRIBUTE_LABELS[axis],
          icon: axis === 'horizontal' ? ('distribute-horizontal' as const) : ('distribute-vertical' as const),
          disabled: targets.length < 3,
          onSelect: () => distributeTargets(axis, targets),
        })),
        { separator: true },
        ...flagEntries(targets),
        { separator: true },
        remove,
      ];
    }
    if (target.kind === 'layer') {
      const layer = menu?.layers.find((candidate) => candidate.id === target.id);
      return [
        { heading: `Couche « ${target.id} »` },
        ...clipboardEntries(targets),
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
        ...flagEntries(targets),
        { separator: true },
        remove,
      ];
    }
    return [
      { heading: `${target.kind === 'text' ? 'Texte' : 'Slot'} « ${target.id} »` },
      ...clipboardEntries(targets),
      { separator: true },
      ...flagEntries(targets),
      { separator: true },
      remove,
    ];
  };

  /** Clic droit sur une zone vide de la toile. */
  const canvasMenu = (): MenuEntry[] => [
    { heading: menu ? `Menu « ${menu.name} »` : 'Toile' },
    {
      label: 'Coller',
      icon: 'clipboard',
      shortcut: 'Ctrl+V',
      disabled: !menu,
      onSelect: () => void readClipboard().then(pasteContent),
    },
    { label: 'Tout sélectionner', icon: 'marquee', shortcut: 'Ctrl+A', disabled: !menu, onSelect: selectAll },
    { separator: true },
    { label: 'Ajouter un texte', icon: 'text', disabled: !menu, onSelect: handleAddText },
    { label: 'Générer une texture…', icon: 'sparkles', disabled: !menu, onSelect: () => setDialog({ kind: 'generator', mode: 'create' }) },
    { separator: true },
    { label: 'Renommer le menu…', icon: 'pencil', disabled: !menuIsOnDisk, onSelect: () => startRename('menu') },
    { label: 'Ajuster le zoom', icon: 'expand', shortcut: 'Ctrl+0', onSelect: () => setZoomMode('fit') },
  ];

  const openElementMenu = (target: Selection, event: ReactMouseEvent) => openContextMenu(event, elementMenu(target));
  const openCanvasMenu = (target: Selection | null, event: ReactMouseEvent) =>
    openContextMenu(event, target ? elementMenu(target) : canvasMenu());

  // Taille de la zone de la toile, suivie en continu pour le zoom « Ajuster ».
  const observeStage = useCallback((node: HTMLDivElement | null) => {
    stageNode.current = node;
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

  /* Glisser-déposer d’un PNG depuis l’explorateur */

  /** Point de la fenêtre du coffre sous le pointeur (coordonnées écran). */
  const windowPointAt = (clientX: number, clientY: number): Point | null => {
    const canvas = stageNode.current?.querySelector('canvas.menu-canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / effectiveZoom - CANVAS_MARGINS.x,
      y: (clientY - rect.top) / effectiveZoom - CANVAS_MARGINS.top,
    };
  };

  const stageDropHandlers = {
    onDragOver: (event: ReactDragEvent<HTMLDivElement>) => {
      if (!menu || !hasDraggedFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      if (!dropActive) setDropActive(true);
    },
    onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false);
    },
    onDrop: (event: ReactDragEvent<HTMLDivElement>) => {
      if (!hasDraggedFiles(event.dataTransfer)) return;
      event.preventDefault();
      setDropActive(false);
      const files = pngFiles(event.dataTransfer.files);
      if (files.length === 0) {
        setStatus('Seuls les fichiers PNG peuvent être déposés sur la toile.');
        return;
      }
      const at = windowPointAt(event.clientX, event.clientY);
      void (async () => {
        const added: Selection[] = [];
        for (const [index, file] of files.entries()) {
          const point = at ? { x: at.x + index * 4, y: at.y + index * 4 } : null;
          const layer = await importImageAsLayer(file, file.name, point);
          if (layer) added.push(layer);
        }
        if (added.length > 0) select(added);
      })();
    },
  };

  // Affichage seulement : les messages d’échec passent en rouge dans la barre d’outils.
  const statusIsError = /^(Échec|Impossible)/.test(status);

  const documentKind = mode === 'menus' ? (menu ? 'menu' : null) : currentAsset ? 'asset' : null;
  const documentName = mode === 'menus' ? (menu?.name ?? null) : (currentAsset?.name ?? null);
  useEffect(() => {
    if (active) onDocumentChange(documentKind, documentName);
  }, [active, documentKind, documentName, onDocumentChange]);

  const renameDialog = dialog?.kind === 'rename' ? dialog : null;

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
                onContextMenu={(event) => openContextMenu(event, documentMenu('menu'))}
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
              <IconButton
                icon="more"
                label="Actions du menu"
                hint="Renommer, dupliquer, mettre à la corbeille"
                size={24}
                disabled={!menu}
                onClick={(event) => openContextMenu(event, documentMenu('menu'))}
              />
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
              onContextMenu={(event) => openContextMenu(event, documentMenu('asset'))}
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
            <IconButton
              icon="more"
              label="Actions de l’asset"
              hint="Renommer, dupliquer, mettre à la corbeille"
              size={24}
              disabled={!currentAsset}
              onClick={(event) => openContextMenu(event, documentMenu('asset'))}
            />
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
              onDelete={deleteTargets}
              onToggleFlag={(target, flag) => toggleFlag([target], flag)}
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
              <Tooltip label="Sélection" hint="Choisir et déplacer ; Maj+clic ou rectangle pour en prendre plusieurs" shortcut="V">
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
            className={dropActive ? 'stage is-drop-target' : 'stage'}
            ref={observeStage}
            onContextMenu={(event) => {
              // Zone grise autour du coffre : même menu qu’une zone vide de la toile.
              if (event.target === event.currentTarget) openCanvasMenu(null, event);
            }}
            {...stageDropHandlers}
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
              onMoveElements={applyElementMoves}
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
          {dropActive && (
            <div className="drop-hint" aria-hidden="true">
              <Icon name="upload" size={24} />
              Déposer le PNG : il devient une couche
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
              onDuplicate={duplicateTargets}
              onCopy={(targets) => copyTargets(targets)}
              onDelete={deleteTargets}
              selectionBounds={selectionBounds}
              onMoveSelection={moveSelectionBy}
              alignReference={alignReference}
              onAlignReferenceChange={setAlignReference}
              onAlign={(alignMode) => alignTargets(alignMode)}
              onDistribute={(axis) => distributeTargets(axis)}
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
              onImportImage={importTexture}
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
            {ownSelection.length > 1 && <span>{plural(ownSelection.length, 'élément')} sélectionnés</span>}
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
      {renameDialog && (
        <RenameDocumentDialog
          type={renameDialog.type}
          id={renameDialog.id}
          name={renameDialog.name}
          existingIds={(renameDialog.type === 'menu' ? knownMenus : knownAssets).map((candidate) => candidate.id)}
          references={renameDialog.type === 'menu' ? menuReferences(knownMenus, renameDialog.id) : []}
          onCancel={() => setDialog(null)}
          onConfirm={handleRename}
        />
      )}
    </div>
  );
}
