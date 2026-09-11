import { Fragment, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, JSX, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { ArrowKeys, ShortcutKeys } from '../ui/Keys';
import { useContextMenu } from '../ui/menuContext';
import type { MenuEntry } from '../ui/menuContext';
import { overlayOpen } from '../ui/overlay';
import { assetClipboard, nextPasteShift, readClipboard, writeClipboard } from '../lib/clipboard';
import type { AssetClipboard, ClipboardContent } from '../lib/clipboard';
import { plural } from '../lib/format';
import { hasDraggedFiles, pastedImageName, pngFiles } from '../lib/imageImport';
import { arrowDelta, isDeleteKey, shortcutDigit, shortcutLetter, withCommand } from '../lib/shortcuts';
import type { LoadedTexture } from '../lib/textures';
import { useClipboardShortcuts } from '../lib/useClipboardShortcuts';
import { alignOffsets, distributeOffsets, unionRect } from '../model/arrange';
import type { AlignMode, AlignReference, DistributeAxis } from '../model/arrange';
import { canvasToBlob } from '../model/generator';
import { sanitizeId, uniqueId } from '../model/menu';
import { AssetCanvas } from './AssetCanvas';
import type { ElementPosition } from './AssetCanvas';
import { Segmented, TextureField } from './AssetFields';
import { AssetInspector } from './AssetInspector';
import { ElementList } from './ElementList';
import { ExportPanel } from './ExportPanel';
import {
  collectForClipboard,
  insertPasted,
  offsetElements,
  pastePlan,
  removeElements,
  setElementFlag,
  translateElements,
} from './assetEdit';
import type { ElementFlag } from './assetEdit';
import { errorMessage, isTypingTarget } from './canvasUtils';
import type { Point, Rect } from './geometry';
import { canMoveBlock, expandToGroups, findGroup, groupElements, groupLabel, moveBlock, selectedGroups, ungroupElements } from './groups';
import { createHistory, historyReducer } from './history';
import type { Recipe } from './history';
import type { AssetDefinition, AssetElement, ImageElement } from './model';
import {
  BOX_PRESETS,
  DEFAULT_BOX_PRESET,
  GRID_MIN_ZOOM,
  TOOL_LABELS,
  ZOOM_LEVELS,
  defaultZoom,
  findBoxPreset,
  fitScale,
  maxZoomFor,
  CANVAS_PAD,
} from './presets';
import type { AssetTool } from './presets';
import { assetTexturePaths, elementBounds, loadAssetTexture, renderAsset, renderAssetSync } from './render';
import { useAssetResources } from './useAssetResources';
import './asset.css';

export interface AssetEditorProps {
  /** Asset chargé à l’ouverture (l’éditeur gère ensuite son propre état, annuler / rétablir compris). */
  initial: AssetDefinition;
  /** Textures de l’espace de travail disponibles (chemins relatifs à textures/). */
  textures: string[];
  /** Version de chaque texture (à passer à textureUrl pour forcer le rechargement). */
  textureVersions: Record<string, number>;
  /**
   * Demande d’insertion d’une image venue de l’extérieur (bibliothèque) ; `nonce` change à chaque demande.
   * La demande présente au montage est considérée comme déjà traitée.
   */
  insertRequest: { texture: string; source?: ImageElement['source']; nonce: number } | null;
  /** Contenu à afficher dans l’onglet « Bibliothèque » de la colonne de gauche (fourni par l’application). */
  librarySlot: ReactNode;
  /** Enregistre le JSON et le PNG exporté (échelle 1). Lève une erreur en cas d’échec. */
  onSave: (asset: AssetDefinition, png: Blob) => Promise<void>;
  /** Signale au parent s’il y a des changements non enregistrés. */
  onDirtyChange: (dirty: boolean) => void;
  /** Écran affiché ; sinon l’éditeur ignore le clavier. */
  active?: boolean;
  /** Grille de pixels à l’ouverture (réglage de l’éditeur). */
  defaultShowGrid?: boolean;
  /** Zoom à l’ouverture : 0 ou absent = « Ajuster ». */
  defaultZoom?: number;
  /** Demande d’enregistrement venue de la barre du haut ; change à chaque demande. */
  saveRequest?: number;
  /**
   * Importe une image venue de l’extérieur (fichier déposé, image collée) dans
   * `textures/` ; renvoie le chemin de la nouvelle texture.
   */
  onImportImage?: (blob: Blob, fileName: string) => Promise<string>;
}

const TOOLS: readonly AssetTool[] = ['select', 'box', 'text', 'image'];
const TOOL_ICONS: Record<AssetTool, IconName> = { select: 'cursor', box: 'box', text: 'text', image: 'image' };
const TOOL_KEYS: Record<string, AssetTool> = { v: 'select', b: 'box', t: 'text', i: 'image' };
const TYPE_NOUNS: Record<AssetElement['type'], string> = { box: 'Box', image: 'Image', text: 'Texte' };

/** Recette qui modifie un élément par son identifiant. */
function onElement(id: string, mutate: (element: AssetElement) => void): Recipe {
  return (draft) => {
    const element = draft.elements.find((candidate) => candidate.id === id);
    if (element) mutate(element);
  };
}

/** Où poser une image insérée : coin haut-gauche, ou centre (dépôt, collage). */
interface ImagePlacement {
  x: number;
  y: number;
  centered?: boolean;
}

/**
 * Éditeur d’assets (« mode libre ») : box, images et textes composés
 * librement puis exportés en un PNG, à insérer comme glyphe. Occupe toute la
 * zone de travail : éléments / bibliothèque à gauche, toile au centre,
 * inspecteur et export à droite.
 */
export function AssetEditor(props: AssetEditorProps): JSX.Element {
  const {
    initial,
    textures,
    textureVersions,
    insertRequest,
    librarySlot,
    onSave,
    onDirtyChange,
    active = true,
    defaultShowGrid = true,
    defaultZoom: openingZoom = 0,
    saveRequest = 0,
    onImportImage,
  } = props;
  const [history, dispatch] = useReducer(historyReducer, initial, createHistory);
  const asset = history.present;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tool, setTool] = useState<AssetTool>('select');
  const [boxPresetId, setBoxPresetId] = useState(DEFAULT_BOX_PRESET);
  const [imageTexture, setImageTexture] = useState('');
  const [zoom, setZoom] = useState(() => openingZoom || defaultZoom(initial.size.width, initial.size.height));
  // Zoom « Ajuster » par défaut, comme pour les menus : le plus grand palier où l’asset tient dans la zone.
  const [zoomMode, setZoomMode] = useState<'fit' | 'manual'>(openingZoom === 0 ? 'fit' : 'manual');
  const [stageSize, setStageSize] = useState<{ width: number; height: number } | null>(null);
  const stageNode = useRef<HTMLDivElement | null>(null);
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
  const [showGrid, setShowGrid] = useState(defaultShowGrid);
  const [leftTab, setLeftTab] = useState<'elements' | 'library'>('elements');
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initial));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [alignReference, setAlignReference] = useState<AlignReference>('selection');
  // Groupes repliés dans la liste : état d’affichage, hors du document.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [dropActive, setDropActive] = useState(false);

  const dirty = JSON.stringify(asset) !== savedJson;
  // Sélection encore présente dans l’asset (après annuler, supprimer…), dans l’ordre du fichier.
  const selected = asset.elements.filter((element) => selectedIds.includes(element.id));
  const selection = selected.map((element) => element.id);
  const movableIds = selected.filter((element) => !element.locked).map((element) => element.id);

  /* Ressources et rendus */

  const pathsKey = [
    ...new Set([...assetTexturePaths(asset), ...(tool === 'image' && imageTexture ? [imageTexture] : [])]),
  ].join('\n');
  const texturePaths = useMemo(() => (pathsKey ? pathsKey.split('\n') : []), [pathsKey]);
  const { resources, fontSource } = useAssetResources(texturePaths, textureVersions);
  const preview = useMemo(() => renderAssetSync(asset, resources, { placeholders: true }), [asset, resources]);
  const exportCanvas = useMemo(() => renderAssetSync(asset, resources), [asset, resources]);
  const bounds = useMemo(
    () => new Map(asset.elements.map((element) => [element.id, elementBounds(element, resources)])),
    [asset, resources],
  );
  const missingTextures = assetTexturePaths(asset).filter((path) => resources.textures.get(path) === null);
  const selectedRects = selection.map((id) => bounds.get(id)).filter((rect): rect is Rect => rect !== undefined);
  const selectionBounds = selectedRects.length > 0 ? unionRect(selectedRects) : null;

  /* Liens avec le parent */

  const assetRef = useRef(asset);
  const onDirtyRef = useRef(onDirtyChange);
  useEffect(() => {
    assetRef.current = asset;
    onDirtyRef.current = onDirtyChange;
  });
  useEffect(() => {
    onDirtyRef.current(dirty);
  }, [dirty]);

  /* Modifications */

  const change = useCallback(
    (recipe: Recipe, coalesce?: string) => dispatch({ type: 'change', recipe, coalesce, at: Date.now() }),
    [],
  );
  const live = useCallback((recipe: Recipe) => dispatch({ type: 'change', recipe, record: false }), []);
  const checkpoint = useCallback(() => dispatch({ type: 'checkpoint' }), []);

  const addElement = useCallback((element: AssetElement) => {
    dispatch({ type: 'change', recipe: (draft) => void draft.elements.push(structuredClone(element)), at: Date.now() });
    setSelectedIds([element.id]);
    setTool('select');
  }, []);

  const takenIds = () => assetRef.current.elements.map((element) => element.id);
  const expand = useCallback((ids: string[]) => expandToGroups(assetRef.current, ids), []);

  /**
   * Ajoute une image (au point donné, ou centrée), à une échelle qui tient dans l’asset.
   * `source` : zone de la texture à afficher (sprite rogné dans un atlas).
   */
  const insertImage = useCallback(
    (texture: string, loaded: LoadedTexture | null, at: ImagePlacement | null, source?: ImageElement['source']) => {
      const current = assetRef.current;
      const base = sanitizeId(texture.split('/').pop()?.replace(/\.png$/i, '') ?? 'image');
      const id = uniqueId(base, current.elements.map((element) => element.id));
      const sourceWidth = source?.width ?? loaded?.width ?? 16;
      const sourceHeight = source?.height ?? loaded?.height ?? 16;
      const scale = loaded ? fitScale(sourceWidth, sourceHeight, current.size.width, current.size.height) : 1;
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const x = at ? (at.centered ? Math.round(at.x - width / 2) : at.x) : Math.floor((current.size.width - width) / 2);
      const y = at ? (at.centered ? Math.round(at.y - height / 2) : at.y) : Math.floor((current.size.height - height) / 2);
      const element: ImageElement = { id, type: 'image', x, y, texture };
      if (source) element.source = source;
      if (scale !== 1) element.scale = scale;
      addElement(element);
    },
    [addElement],
  );

  // Insertion demandée par la bibliothèque : la texture est chargée d’abord pour centrer l’image.
  const handledNonce = useRef(insertRequest?.nonce ?? null);
  useEffect(() => {
    if (!insertRequest || insertRequest.nonce === handledNonce.current) return;
    handledNonce.current = insertRequest.nonce;
    const { texture, source } = insertRequest;
    void loadAssetTexture(texture, textureVersions[texture] ?? 0).then((loaded) => {
      insertImage(texture, loaded, null, source);
      setStatus(loaded ? `Image insérée : ${texture}` : `Texture introuvable : ${texture}`);
    });
  }, [insertRequest, textureVersions, insertImage]);

  /** Image venue de l’extérieur (fichier déposé, image collée) : nouvelle texture, puis nouvel élément image. */
  const importImage = async (blob: Blob, fileName: string, at: ImagePlacement | null) => {
    if (!onImportImage) return;
    try {
      const texture = await onImportImage(blob, fileName);
      const loaded = await loadAssetTexture(texture, 0);
      insertImage(texture, loaded, at);
      setStatus(`Texture importée : textures/${texture}`);
    } catch (error) {
      setStatus(`Échec de l’import : ${errorMessage(error)}`);
    }
  };

  const createBox = (rect: Rect, clicked: boolean) => {
    const preset = findBoxPreset(boxPresetId);
    const area = clicked ? { x: rect.x, y: rect.y, width: preset.width, height: preset.height } : rect;
    addElement({ id: uniqueId('box', takenIds()), type: 'box', ...area, style: structuredClone(preset.style) });
  };

  const addBoxPreset = (presetId: string) => {
    const preset = findBoxPreset(presetId);
    addElement({
      id: uniqueId('box', takenIds()),
      type: 'box',
      x: Math.max(0, Math.floor((asset.size.width - preset.width) / 2)),
      y: Math.max(0, Math.floor((asset.size.height - preset.height) / 2)),
      width: preset.width,
      height: preset.height,
      style: structuredClone(preset.style),
    });
  };

  const createText = (pixel: Point) =>
    addElement({ id: uniqueId('text', takenIds()), type: 'text', x: pixel.x, y: pixel.y, text: 'Texte', color: '#ffffff' });

  const placeImage = (pixel: Point) => {
    if (!imageTexture || !textures.includes(imageTexture)) {
      setStatus('Choisis d’abord la texture à poser (barre d’outils).');
      return;
    }
    insertImage(imageTexture, resources.textures.get(imageTexture) ?? null, pixel);
  };

  /* Sélection et opérations groupées */

  const selectAll = () => setSelectedIds(asset.elements.filter((element) => !element.hidden && !element.locked).map((element) => element.id));

  const reorder = (ids: string[], direction: 1 | -1) => change((draft) => void moveBlock(draft, ids, direction));

  const setFlag = (ids: string[], flag: ElementFlag, value: boolean) => change((draft) => setElementFlag(draft, ids, flag, value));

  /** Masquer / verrouiller (ou l’inverse) : si tous portent déjà le drapeau, il est retiré à tous. */
  const toggleFlag = (ids: string[], flag: ElementFlag) => {
    const all = asset.elements.filter((element) => ids.includes(element.id)).every((element) => element[flag]);
    setFlag(ids, flag, !all);
  };

  const deleteElements = (ids: string[]) => {
    if (ids.length === 0) return;
    change((draft) => removeElements(draft, ids));
    setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
  };

  const rename = (from: string, to: string) => {
    change(onElement(from, (element) => void (element.id = to)));
    setSelectedIds((current) => current.map((id) => (id === from ? to : id)));
  };

  const nudge = (dx: number, dy: number) => {
    if (movableIds.length === 0) return;
    change((draft) => translateElements(draft, movableIds, dx, dy), `${movableIds.join(',')}.nudge`);
  };

  const moveSelectionBy = (dx: number, dy: number) => {
    if (movableIds.length > 0 && (dx !== 0 || dy !== 0)) change((draft) => translateElements(draft, movableIds, dx, dy));
  };

  /** Aligner ou répartir les éléments déplaçables de `ids`. */
  const arrange = (compute: (rects: Rect[]) => Point[], ids: string[] = movableIds) => {
    const placed = ids.filter((id) => bounds.has(id));
    const offsets = compute(placed.map((id) => bounds.get(id) as Rect));
    if (offsets.every((offset) => offset.x === 0 && offset.y === 0)) {
      if (placed.length > 0) setStatus('Déjà aligné');
      return;
    }
    change((draft) => offsetElements(draft, placed, offsets));
  };
  const canvasRect: Rect = { x: 0, y: 0, width: asset.size.width, height: asset.size.height };
  const align = (mode: AlignMode) =>
    arrange((rects) => alignOffsets(rects, mode, alignReference === 'canvas' || rects.length < 2 ? canvasRect : unionRect(rects)));
  const distribute = (axis: DistributeAxis) => arrange((rects) => distributeOffsets(rects, axis));

  /** Ctrl+G : regroupe la sélection (deux éléments au moins). */
  const groupSelection = (ids: string[] = selection) => {
    if (ids.length < 2) {
      setStatus('Sélectionne au moins deux éléments pour les grouper.');
      return;
    }
    const groupId = uniqueId('group', (asset.groups ?? []).map((group) => group.id));
    const name = `Groupe ${(asset.groups?.length ?? 0) + 1}`;
    change((draft) => {
      if (!groupElements(draft, ids, groupId)) return;
      const group = draft.groups?.find((candidate) => candidate.id === groupId);
      if (group) group.name = name;
    });
    setStatus(`${plural(ids.length, 'élément')} groupés dans « ${name} »`);
  };

  /** Ctrl+Maj+G : dissout les groupes touchés par la sélection. */
  const ungroupSelection = (groupIds?: string[]) => {
    const targets = groupIds ?? [...new Set(selected.map((element) => element.group).filter((group): group is string => Boolean(group)))];
    if (targets.length === 0) return;
    change((draft) => ungroupElements(draft, targets));
    setStatus(targets.length > 1 ? `${targets.length} groupes dissous` : 'Groupe dissous');
  };

  const renameGroup = (groupId: string, name: string) =>
    change((draft) => {
      const group = draft.groups?.find((candidate) => candidate.id === groupId);
      if (group) group.name = name;
    });

  /* Presse-papiers */

  const clipboardFor = (ids: string[]): AssetClipboard | null => {
    if (ids.length === 0) return null;
    const { elements, groups } = collectForClipboard(asset, ids);
    setStatus(`${plural(elements.length, 'élément')} copié${elements.length > 1 ? 's' : ''}`);
    return assetClipboard(`asset:${asset.id}`, elements, groups);
  };

  const copyElements = (ids: string[]) => {
    const payload = clipboardFor(ids);
    if (payload) writeClipboard(payload);
  };

  const cutElements = (ids: string[]) => {
    copyElements(ids);
    deleteElements(ids);
  };

  /** Copies décalées au-dessus de tout, identifiants uniques ; les copies sont sélectionnées. */
  const insertCopies = (payload: Pick<AssetClipboard, 'elements' | 'groups'>, shift: number, verb: string) => {
    const plan = pastePlan(payload, assetRef.current, shift);
    if (plan.elements.length === 0) return;
    change((draft) => insertPasted(draft, plan));
    setSelectedIds(plan.elements.map((element) => element.id));
    setTool('select');
    setStatus(`${plural(plan.elements.length, 'élément')} ${verb}`);
  };

  /** Ctrl+D : copies de la sélection, décalées de 4 px. */
  const duplicateElements = (ids: string[] = selection) => {
    if (ids.length > 0) insertCopies(collectForClipboard(asset, ids), 1, ids.length > 1 ? 'dupliqués' : 'dupliqué');
  };

  const pasteContent = (content: ClipboardContent) => {
    if (content.payload?.kind === 'asset') {
      insertCopies(content.payload, nextPasteShift(content.payload, `asset:${asset.id}`), 'collé(s)');
    } else if (content.payload?.kind === 'menu') {
      setStatus('Le presse-papiers contient des éléments de menu : colle-les dans un menu.');
    } else if (content.image) {
      void importImage(content.image, pastedImageName(), { x: asset.size.width / 2, y: asset.size.height / 2, centered: true });
    } else {
      setStatus('Rien à coller : copie d’abord des éléments (Ctrl+C) ou une image PNG.');
    }
  };

  useClipboardShortcuts({
    enabled: () => active,
    copy: () => clipboardFor(selection),
    remove: () => deleteElements(selection),
    paste: pasteContent,
  });

  /* Enregistrement */

  const save = async () => {
    if (saving) return;
    const snapshot = asset;
    setSaving(true);
    setStatus('Export en cours…');
    try {
      // Rendu dédié : attend que toutes les textures soient chargées, sans repères d’éditeur.
      const canvas = await renderAsset(snapshot, { textureVersions });
      const png = await canvasToBlob(canvas);
      await onSave(snapshot, png);
      setSavedJson(JSON.stringify(snapshot));
      setStatus(`« ${snapshot.id} » enregistré, PNG exporté (${canvas.width} × ${canvas.height})`);
    } catch (error) {
      setStatus(`Échec de l’enregistrement : ${errorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  // Bouton « Enregistrer » de la barre du haut : chaque nouvelle demande enregistre une fois.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  const handledSaveRequest = useRef(saveRequest);
  useEffect(() => {
    if (saveRequest === handledSaveRequest.current) return;
    handledSaveRequest.current = saveRequest;
    void saveRef.current();
  }, [saveRequest]);

  /* Menus contextuels */

  const openContextMenu = useContextMenu();

  /** Actions d’un élément, d’un groupe ou de la sélection (clic droit dans la liste ou sur la toile). */
  const selectionMenu = (ids: string[]): MenuEntry[] => {
    const targets = asset.elements.filter((element) => ids.includes(element.id));
    if (targets.length === 0) return [];
    const targetIds = targets.map((element) => element.id);
    const whole = selectedGroups(asset, targetIds);
    const touched = [...new Set(targets.map((element) => element.group).filter((group): group is string => Boolean(group)))];
    const onlyGroup =
      whole.length === 1 && touched.length === 1 && targets.every((element) => element.group === whole[0]) ? findGroup(asset, whole[0]) : undefined;
    const heading =
      targets.length === 1
        ? `${TYPE_NOUNS[targets[0].type]} « ${targets[0].id} »`
        : onlyGroup
          ? `Groupe « ${groupLabel(onlyGroup)} »`
          : `${plural(targets.length, 'élément')} sélectionnés`;
    const hidden = targets.every((element) => element.hidden);
    const locked = targets.every((element) => element.locked);
    return [
      { heading },
      { label: 'Couper', icon: 'cut', shortcut: 'Ctrl+X', onSelect: () => cutElements(targetIds) },
      { label: 'Copier', icon: 'clipboard', shortcut: 'Ctrl+C', onSelect: () => copyElements(targetIds) },
      { label: 'Dupliquer', icon: 'copy', shortcut: 'Ctrl+D', onSelect: () => duplicateElements(targetIds) },
      { separator: true },
      ...(targets.length > 1 && !onlyGroup
        ? [{ label: 'Grouper', icon: 'group' as const, shortcut: 'Ctrl+G', onSelect: () => groupSelection(targetIds) }]
        : []),
      ...(touched.length > 0
        ? [{ label: 'Dégrouper', icon: 'ungroup' as const, shortcut: 'Ctrl+Maj+G', onSelect: () => ungroupSelection(touched) }]
        : []),
      { label: 'Monter', icon: 'chevron-up', disabled: !canMoveBlock(asset, targetIds, 1), onSelect: () => reorder(targetIds, 1) },
      { label: 'Descendre', icon: 'chevron-down', disabled: !canMoveBlock(asset, targetIds, -1), onSelect: () => reorder(targetIds, -1) },
      { separator: true },
      { label: hidden ? 'Afficher' : 'Masquer', icon: hidden ? 'eye' : 'eye-off', onSelect: () => toggleFlag(targetIds, 'hidden') },
      { label: locked ? 'Déverrouiller' : 'Verrouiller', icon: locked ? 'unlock' : 'lock', onSelect: () => toggleFlag(targetIds, 'locked') },
      { separator: true },
      { label: 'Supprimer', icon: 'trash', shortcut: 'Suppr', danger: true, onSelect: () => deleteElements(targetIds) },
    ];
  };

  /** Clic droit sur une zone vide de la toile. */
  const canvasMenu = (): MenuEntry[] => [
    { heading: `Asset « ${asset.name} »` },
    { label: 'Coller', icon: 'clipboard', shortcut: 'Ctrl+V', onSelect: () => void readClipboard().then(pasteContent) },
    { label: 'Tout sélectionner', icon: 'marquee', shortcut: 'Ctrl+A', onSelect: selectAll },
    { separator: true },
    { label: 'Ajouter un texte', icon: 'text', onSelect: () => createText({ x: 4, y: 4 }) },
    { label: 'Ajuster le zoom', icon: 'expand', shortcut: 'Ctrl+0', onSelect: () => setZoomMode('fit') },
  ];

  const openListMenu = (ids: string[], event: ReactMouseEvent) => {
    // La ligne cliquée rejoint la sélection : les actions portent sur toute la sélection si elle la contient.
    const targets = ids.every((id) => selection.includes(id)) && selection.length > ids.length ? selection : ids;
    openContextMenu(event, selectionMenu(targets));
  };

  const openCanvasMenu = (id: string | null, event: ReactMouseEvent) => {
    if (!id) {
      openContextMenu(event, canvasMenu());
      return;
    }
    openContextMenu(event, selectionMenu(selection.includes(id) ? selection : expand([id])));
  };

  /* Clavier */

  const handleKeyDown = (event: KeyboardEvent) => {
    // Écran caché, ou menu contextuel / dialogue ouvert : les touches ne sont pas pour la toile.
    if (!active || event.defaultPrevented || overlayOpen()) return;
    const letter = shortcutLetter(event);
    const command = withCommand(event);
    if (command && letter === 's') {
      event.preventDefault();
      void save();
      return;
    }
    if (isTypingTarget(event.target)) return;
    if (command && letter === 'z') {
      event.preventDefault();
      dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      return;
    }
    if (command && letter === 'y') {
      event.preventDefault();
      dispatch({ type: 'redo' });
      return;
    }
    // Touche physique : sur AZERTY, Ctrl + la touche du 0 produit « à ».
    if (command && shortcutDigit(event) === '0') {
      event.preventDefault();
      setZoomMode('fit');
      return;
    }
    if (command && letter === 'd') {
      event.preventDefault();
      duplicateElements();
      return;
    }
    if (command && letter === 'a') {
      event.preventDefault();
      selectAll();
      return;
    }
    if (command && letter === 'g') {
      event.preventDefault();
      if (event.shiftKey) ungroupSelection();
      else groupSelection();
      return;
    }
    // Ctrl+C, Ctrl+X, Ctrl+V : traités par useClipboardShortcuts.
    if (command || event.altKey) return;
    if (letter && TOOL_KEYS[letter] && !event.shiftKey) {
      setTool(TOOL_KEYS[letter]);
    } else if (event.key === 'Escape') {
      setSelectedIds([]);
      setTool('select');
    } else if (isDeleteKey(event) && selection.length > 0) {
      event.preventDefault();
      deleteElements(selection);
    } else {
      const delta = arrowDelta(event, 1, 10);
      if (delta && selection.length > 0) {
        event.preventDefault();
        nudge(delta.dx, delta.dy);
      }
    }
  };

  const keyHandler = useRef(handleKeyDown);
  useEffect(() => {
    keyHandler.current = handleKeyDown;
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  /* Affichage */

  const maxZoom = maxZoomFor(asset.size.width, asset.size.height);
  const zoomOptions = ZOOM_LEVELS.filter((level) => level <= maxZoom);
  // Autour de la toile : sa marge (24 px de chaque côté, voir AssetCanvas) ; dessous, la ligne
  // des coordonnées (≈ 34 px avec l’espacement).
  const fittedZoom = stageSize
    ? (zoomOptions.filter(
        (level) =>
          asset.size.width * level + CANVAS_PAD * 2 <= stageSize.width &&
          asset.size.height * level + CANVAS_PAD * 2 + 34 <= stageSize.height,
      ).at(-1) ?? 1)
    : defaultZoom(asset.size.width, asset.size.height);
  const effectiveZoom = Math.min(zoomMode === 'fit' ? fittedZoom : zoom, maxZoom);
  const setManualZoom = (level: number) => {
    setZoomMode('manual');
    setZoom(level);
  };

  /* Glisser-déposer d’un PNG depuis l’explorateur */

  /** Pixel de l’asset sous le pointeur (coordonnées écran), ou `null` hors de la toile. */
  const pixelAt = (clientX: number, clientY: number): Point | null => {
    const canvas = stageNode.current?.querySelector('canvas.asset-canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left - CANVAS_PAD) / effectiveZoom, y: (clientY - rect.top - CANVAS_PAD) / effectiveZoom };
  };

  const stageDropHandlers = {
    onDragOver: (event: ReactDragEvent<HTMLDivElement>) => {
      if (!onImportImage || !hasDraggedFiles(event.dataTransfer)) return;
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
      const at = pixelAt(event.clientX, event.clientY);
      void (async () => {
        for (const [index, file] of files.entries()) {
          await importImage(file, file.name, at ? { x: at.x + index * 4, y: at.y + index * 4, centered: true } : null);
        }
      })();
    },
  };

  return (
    <div className="asset-editor">
      <aside className="sidebar">
        <div className="sidebar-tabs" role="tablist" aria-label="Colonne de gauche">
          <button
            type="button"
            role="tab"
            aria-selected={leftTab === 'elements'}
            className={leftTab === 'elements' ? 'active' : ''}
            onClick={() => setLeftTab('elements')}
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
        <div hidden={leftTab !== 'library'}>{librarySlot}</div>
        {leftTab === 'elements' && (
          <>
            <ElementList
              asset={asset}
              selectedIds={selection}
              collapsed={collapsed}
              onToggleCollapsed={(groupId) =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(groupId)) next.delete(groupId);
                  else next.add(groupId);
                  return next;
                })
              }
              onSelect={setSelectedIds}
              onReorder={reorder}
              onToggleFlag={toggleFlag}
              onItemContextMenu={openListMenu}
              onDelete={deleteElements}
              onUngroup={(groupId) => ungroupSelection([groupId])}
              onAddBox={addBoxPreset}
              onAddText={() => createText({ x: 4, y: 4 })}
            />
            <section className="panel-section">
              <details className="shortcuts">
                <summary>
                  <Icon name="keyboard" />
                  Raccourcis
                  <span className="shortcuts-all">
                    tous&nbsp;: <kbd>?</kbd>
                  </span>
                </summary>
                <dl className="shortcut-list">
                  {TOOLS.map((value) => (
                    <Fragment key={value}>
                      <dt>
                        <kbd>{TOOL_LABELS[value].key}</kbd>
                      </dt>
                      <dd>Outil {TOOL_LABELS[value].label}</dd>
                    </Fragment>
                  ))}
                  <dt>
                    <ShortcutKeys shortcut="Maj+Clic" />
                  </dt>
                  <dd>Ajouter à la sélection</dd>
                  <dt>
                    <ShortcutKeys shortcut="Ctrl+A" />
                  </dt>
                  <dd>Tout sélectionner</dd>
                  <dt>
                    <ShortcutKeys shortcut="Ctrl+G" />
                  </dt>
                  <dd>Grouper (Ctrl+Maj+G : dégrouper)</dd>
                  <dt>
                    <ArrowKeys />
                  </dt>
                  <dd>Déplacer de 1 px</dd>
                  <dt>
                    <ShortcutKeys shortcut="Maj+Flèches" />
                  </dt>
                  <dd>Déplacer de 10 px</dd>
                  <dt>
                    <ShortcutKeys shortcut="Suppr" />
                  </dt>
                  <dd>Supprimer la sélection</dd>
                  <dt>
                    <ShortcutKeys shortcut="Ctrl+D" />
                  </dt>
                  <dd>Dupliquer</dd>
                  <dt>
                    <ShortcutKeys shortcut="Ctrl+C" />
                  </dt>
                  <dd>Copier (Ctrl+X couper, Ctrl+V coller)</dd>
                  <dt>
                    <kbd>Échap</kbd>
                  </dt>
                  <dd>Désélectionner</dd>
                  <dt>
                    <ShortcutKeys shortcut="Ctrl+Z" />
                  </dt>
                  <dd>Annuler</dd>
                  <dt>
                    <ShortcutKeys shortcut="Ctrl+Y" />
                  </dt>
                  <dd>Rétablir</dd>
                  <dt>
                    <ShortcutKeys shortcut="Ctrl+0" />
                  </dt>
                  <dd>Ajuster le zoom</dd>
                  <dt>
                    <ShortcutKeys shortcut="Ctrl+S" />
                  </dt>
                  <dd>Enregistrer et exporter</dd>
                </dl>
              </details>
            </section>
          </>
        )}
      </aside>

      <section className="asset-stage">
        <div className="asset-toolbar">
          <Segmented
            label="Outil"
            value={tool}
            options={TOOLS.map((value) => ({
              value,
              label: TOOL_LABELS[value].label,
              title: TOOL_LABELS[value].label,
              hint: TOOL_LABELS[value].hint,
              icon: TOOL_ICONS[value],
              shortcut: TOOL_LABELS[value].key,
            }))}
            onChange={setTool}
          />
          {tool === 'box' && (
            <select value={boxPresetId} onChange={(event) => setBoxPresetId(event.target.value)} aria-label="Préréglage de la box">
              {BOX_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          )}
          {tool === 'image' && (
            <div className="asset-toolbar-texture">
              <TextureField label="Texture à poser" value={imageTexture} textures={textures} onChange={setImageTexture} />
            </div>
          )}
          <div className="asset-toolbar-group">
            <IconButton
              icon="undo"
              label="Annuler"
              shortcut="Ctrl+Z"
              size={24}
              disabled={history.past.length === 0}
              onClick={() => dispatch({ type: 'undo' })}
            />
            <IconButton
              icon="redo"
              label="Rétablir"
              shortcut="Ctrl+Y"
              size={24}
              disabled={history.future.length === 0}
              onClick={() => dispatch({ type: 'redo' })}
            />
          </div>
          <div className="asset-toolbar-group asset-toolbar-end">
            <select
              className="zoom-picker"
              value={zoomMode === 'fit' ? 'fit' : String(effectiveZoom)}
              onChange={(event) => {
                if (event.target.value === 'fit') setZoomMode('fit');
                else setManualZoom(Number(event.target.value));
              }}
              aria-label="Niveau de zoom"
            >
              <option value="fit">Ajuster (×{fittedZoom})</option>
              {zoomOptions.map((level) => (
                <option key={level} value={level}>
                  ×{level}
                </option>
              ))}
            </select>
            <label className="checkbox" title={`Grille de pixels (à partir de ×${GRID_MIN_ZOOM})`}>
              <input
                type="checkbox"
                checked={showGrid}
                disabled={effectiveZoom < GRID_MIN_ZOOM}
                onChange={(event) => setShowGrid(event.target.checked)}
              />
              Grille
            </label>
          </div>
        </div>
        <div
          className={dropActive ? 'stage asset-stage-scroll is-drop-target' : 'stage asset-stage-scroll'}
          ref={observeStage}
          onContextMenu={(event) => {
            // Zone autour de l’asset : même menu qu’une zone vide de la toile.
            if (event.target === event.currentTarget) openCanvasMenu(null, event);
          }}
          {...stageDropHandlers}
        >
          <AssetCanvas
            asset={asset}
            preview={preview}
            bounds={bounds}
            zoom={effectiveZoom}
            showGrid={showGrid}
            tool={tool}
            selectedIds={selection}
            onSelect={setSelectedIds}
            expand={expand}
            onBeginEdit={checkpoint}
            onMoveElements={(positions: ElementPosition[]) =>
              live((draft) => {
                for (const position of positions) {
                  const element = draft.elements.find((candidate) => candidate.id === position.id);
                  if (!element) continue;
                  element.x = position.x;
                  element.y = position.y;
                }
              })
            }
            onResizeBox={(id, rect) =>
              live(
                onElement(id, (element) => {
                  if (element.type !== 'box') return;
                  element.x = rect.x;
                  element.y = rect.y;
                  element.width = rect.width;
                  element.height = rect.height;
                }),
              )
            }
            onCreateBox={createBox}
            onCreateText={createText}
            onPlaceImage={placeImage}
            onContextMenu={openCanvasMenu}
          />
        </div>
        {dropActive && (
          <div className="drop-hint" aria-hidden="true">
            <Icon name="upload" size={24} />
            Déposer le PNG : il devient une image de l’asset
          </div>
        )}
        <div className="asset-footer">
          <span className="asset-footer-hint">
            <Icon name={TOOL_ICONS[tool]} />
            {TOOL_LABELS[tool].hint}
          </span>
          <span className="asset-status" role="status">
            {status}
          </span>
        </div>
      </section>

      <aside className="sidebar">
        {/* L’inspecteur prend le cadre d’une infobulle d’objet, comme en mode Menus. */}
        <div className="inspector inspector-stack">
          <AssetInspector
            asset={asset}
            selected={selected}
            selectionBounds={selectionBounds}
            textures={textures}
            resources={resources}
            onChange={change}
            onLive={live}
            onCheckpoint={checkpoint}
            onRename={rename}
            alignReference={alignReference}
            onAlignReferenceChange={setAlignReference}
            onAlign={align}
            onDistribute={distribute}
            onMoveSelection={moveSelectionBy}
            onSetFlag={setFlag}
            onGroup={() => groupSelection()}
            onUngroup={(groupIds) => ungroupSelection(groupIds)}
            onRenameGroup={renameGroup}
            onDuplicate={() => duplicateElements()}
            onCopy={() => copyElements(selection)}
            onDelete={() => deleteElements(selection)}
          />
        </div>
        <ExportPanel
          asset={asset}
          exportCanvas={exportCanvas}
          dirty={dirty}
          saving={saving}
          missingTextures={missingTextures}
          fontSource={fontSource}
          onSave={() => void save()}
          onAscentChange={(ascent) => change((draft) => void (draft.export.ascent = ascent), 'export.ascent')}
        />
      </aside>
    </div>
  );
}
