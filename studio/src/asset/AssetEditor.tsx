import { Fragment, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { ArrowKeys, ShortcutKeys } from '../ui/Keys';
import type { JSX, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useContextMenu } from '../ui/menuContext';
import { overlayOpen } from '../ui/overlay';
import type { LoadedTexture } from '../lib/textures';
import { canvasToBlob } from '../model/generator';
import { sanitizeId, uniqueId } from '../model/menu';
import { AssetCanvas } from './AssetCanvas';
import { Segmented, TextureField } from './AssetFields';
import { AssetInspector } from './AssetInspector';
import { ElementList } from './ElementList';
import { ExportPanel } from './ExportPanel';
import { errorMessage, isTypingTarget } from './canvasUtils';
import type { Point, Rect } from './geometry';
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

/** Recette qui modifie un élément par son identifiant. */
function onElement(id: string, mutate: (element: AssetElement) => void): Recipe {
  return (draft) => {
    const element = draft.elements.find((candidate) => candidate.id === id);
    if (element) mutate(element);
  };
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
  } = props;
  const [history, dispatch] = useReducer(historyReducer, initial, createHistory);
  const asset = history.present;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<AssetTool>('select');
  const [boxPresetId, setBoxPresetId] = useState(DEFAULT_BOX_PRESET);
  const [imageTexture, setImageTexture] = useState('');
  const [zoom, setZoom] = useState(() => openingZoom || defaultZoom(initial.size.width, initial.size.height));
  // Zoom « Ajuster » par défaut, comme pour les menus : le plus grand palier où l’asset tient dans la zone.
  const [zoomMode, setZoomMode] = useState<'fit' | 'manual'>(openingZoom === 0 ? 'fit' : 'manual');
  const [stageSize, setStageSize] = useState<{ width: number; height: number } | null>(null);
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
  const [showGrid, setShowGrid] = useState(defaultShowGrid);
  const [leftTab, setLeftTab] = useState<'elements' | 'library'>('elements');
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initial));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const dirty = JSON.stringify(asset) !== savedJson;
  const selected = asset.elements.find((element) => element.id === selectedId) ?? null;

  /* Ressources et rendus */

  const pathsKey = [
    ...new Set([...assetTexturePaths(asset), ...(tool === 'image' && imageTexture ? [imageTexture] : [])]),
  ].join('\n');
  const texturePaths = useMemo(() => (pathsKey ? pathsKey.split('\n') : []), [pathsKey]);
  const { resources, fontError } = useAssetResources(texturePaths, textureVersions);
  const preview = useMemo(() => renderAssetSync(asset, resources, { placeholders: true }), [asset, resources]);
  const exportCanvas = useMemo(() => renderAssetSync(asset, resources), [asset, resources]);
  const bounds = useMemo(
    () => new Map(asset.elements.map((element) => [element.id, elementBounds(element, resources)])),
    [asset, resources],
  );
  const missingTextures = assetTexturePaths(asset).filter((path) => resources.textures.get(path) === null);

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
    setSelectedId(element.id);
    setTool('select');
  }, []);

  const takenIds = () => assetRef.current.elements.map((element) => element.id);

  /**
   * Ajoute une image (au point donné, ou centrée), à une échelle qui tient dans l’asset.
   * `source` : zone de la texture à afficher (sprite rogné dans un atlas).
   */
  const insertImage = useCallback(
    (texture: string, loaded: LoadedTexture | null, at: Point | null, source?: ImageElement['source']) => {
      const current = assetRef.current;
      const base = sanitizeId(texture.split('/').pop()?.replace(/\.png$/i, '') ?? 'image');
      const id = uniqueId(base, current.elements.map((element) => element.id));
      const sourceWidth = source?.width ?? loaded?.width ?? 16;
      const sourceHeight = source?.height ?? loaded?.height ?? 16;
      const scale = loaded ? fitScale(sourceWidth, sourceHeight, current.size.width, current.size.height) : 1;
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const element: ImageElement = {
        id,
        type: 'image',
        x: at ? at.x : Math.floor((current.size.width - width) / 2),
        y: at ? at.y : Math.floor((current.size.height - height) / 2),
        texture,
      };
      if (source) element.source = source;
      if (scale !== 1) element.scale = scale;
      addElement(element);
    },
    [addElement],
  );

  /** Copie d’un élément, décalée de 4 px pour qu’on la voie ; la copie est sélectionnée. */
  const duplicateElement = (id: string) => {
    const original = assetRef.current.elements.find((element) => element.id === id);
    if (!original) return;
    const copy = structuredClone(original);
    copy.id = uniqueId(original.id, takenIds());
    copy.x += 4;
    copy.y += 4;
    addElement(copy);
  };

  // Insertion demandée par la bibliothèque : la texture est chargée d’abord pour centrer l’image.
  const handledNonce = useRef(insertRequest?.nonce ?? null);
  useEffect(() => {
    if (!insertRequest || insertRequest.nonce === handledNonce.current) return;
    handledNonce.current = insertRequest.nonce;
    const { texture, source } = insertRequest;
    void loadAssetTexture(texture, textureVersions[texture] ?? 0).then((loaded) => {
      insertImage(texture, loaded, null, source);
      setStatus(loaded ? `Image insérée : ${texture}` : `Texture introuvable : ${texture}`);
    });
  }, [insertRequest, textureVersions, insertImage]);

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

  const reorder = (id: string, direction: 1 | -1) =>
    change((draft) => {
      const from = draft.elements.findIndex((element) => element.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= draft.elements.length) return;
      [draft.elements[from], draft.elements[to]] = [draft.elements[to], draft.elements[from]];
    });

  const toggleHidden = (id: string) =>
    change(
      onElement(id, (element) => {
        if (element.hidden) delete element.hidden;
        else element.hidden = true;
      }),
    );

  const deleteElement = (id: string) => {
    change((draft) => void (draft.elements = draft.elements.filter((element) => element.id !== id)));
    if (selectedId === id) setSelectedId(null);
  };

  const rename = (from: string, to: string) => {
    change(onElement(from, (element) => void (element.id = to)));
    setSelectedId(to);
  };

  const nudge = (dx: number, dy: number) => {
    if (!selected) return;
    change(
      onElement(selected.id, (element) => {
        element.x += dx;
        element.y += dy;
      }),
      `${selected.id}.nudge`,
    );
  };

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
      setStatus(`Échec de l’enregistrement : ${errorMessage(error)}`);
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

  /* Menu contextuel d’un élément (clic droit dans la liste) */

  const openContextMenu = useContextMenu();
  const openElementMenu = (id: string, event: ReactMouseEvent) => {
    const index = asset.elements.findIndex((element) => element.id === id);
    const element = asset.elements[index];
    if (!element) return;
    const noun = element.type === 'box' ? 'Box' : element.type === 'image' ? 'Image' : 'Texte';
    openContextMenu(event, [
      { heading: `${noun} « ${id} »` },
      { label: 'Dupliquer', icon: 'copy', shortcut: 'Ctrl+D', onSelect: () => duplicateElement(id) },
      {
        label: element.hidden ? 'Afficher' : 'Masquer',
        icon: element.hidden ? 'eye' : 'eye-off',
        onSelect: () => toggleHidden(id),
      },
      { separator: true },
      { label: 'Monter', icon: 'chevron-up', disabled: index === asset.elements.length - 1, onSelect: () => reorder(id, 1) },
      { label: 'Descendre', icon: 'chevron-down', disabled: index === 0, onSelect: () => reorder(id, -1) },
      { separator: true },
      { label: 'Supprimer', icon: 'trash', shortcut: 'Suppr', danger: true, onSelect: () => deleteElement(id) },
    ]);
  };

  /* Clavier */

  const handleKeyDown = (event: KeyboardEvent) => {
    // Écran caché, ou menu contextuel / dialogue ouvert : les touches ne sont pas pour la toile.
    if (!active || event.defaultPrevented || overlayOpen()) return;
    const key = event.key.toLowerCase();
    const withModifier = event.ctrlKey || event.metaKey;
    if (withModifier && key === 's') {
      event.preventDefault();
      void save();
      return;
    }
    if (isTypingTarget(event.target)) return;
    if (withModifier && key === 'z') {
      event.preventDefault();
      dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      return;
    }
    if (withModifier && key === 'y') {
      event.preventDefault();
      dispatch({ type: 'redo' });
      return;
    }
    // Touche physique : sur AZERTY, Ctrl + la touche du 0 produit « à ».
    if (withModifier && (event.code === 'Digit0' || event.code === 'Numpad0')) {
      event.preventDefault();
      setZoomMode('fit');
      return;
    }
    if (withModifier && key === 'd') {
      event.preventDefault();
      if (selected) duplicateElement(selected.id);
      return;
    }
    if (withModifier || event.altKey) return;
    if (TOOL_KEYS[key]) {
      setTool(TOOL_KEYS[key]);
    } else if (key === 'escape') {
      setSelectedId(null);
      setTool('select');
    } else if ((key === 'delete' || key === 'backspace') && selected) {
      event.preventDefault();
      deleteElement(selected.id);
    } else if (key.startsWith('arrow') && selected) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
      const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
      nudge(dx, dy);
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
              elements={asset.elements}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              onReorder={reorder}
              onToggleHidden={toggleHidden}
              onItemContextMenu={openElementMenu}
              onDelete={deleteElement}
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
                  <dd>Supprimer l’élément</dd>
                  <dt>
                    <ShortcutKeys shortcut="Ctrl+D" />
                  </dt>
                  <dd>Dupliquer l’élément</dd>
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
        <div className="stage asset-stage-scroll" ref={observeStage}>
          <AssetCanvas
            asset={asset}
            preview={preview}
            bounds={bounds}
            zoom={effectiveZoom}
            showGrid={showGrid}
            tool={tool}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            onBeginEdit={checkpoint}
            onMoveElement={(id, x, y) =>
              live(
                onElement(id, (element) => {
                  element.x = x;
                  element.y = y;
                }),
              )
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
          />
        </div>
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
            selectedBounds={selected ? (bounds.get(selected.id) ?? null) : null}
            textures={textures}
            resources={resources}
            onChange={change}
            onLive={live}
            onCheckpoint={checkpoint}
            onRename={rename}
          />
        </div>
        <ExportPanel
          asset={asset}
          exportCanvas={exportCanvas}
          dirty={dirty}
          saving={saving}
          missingTextures={missingTextures}
          fontError={fontError}
          onSave={() => void save()}
          onAscentChange={(ascent) => change((draft) => void (draft.export.ascent = ascent), 'export.ascent')}
        />
      </aside>
    </div>
  );
}
