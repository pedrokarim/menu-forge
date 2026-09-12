import { shortcutLetter } from '../lib/shortcuts';
import { Fragment, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { errorMessage, isTypingTarget } from '../asset/canvasUtils';
import { NBSP } from '../lib/format';
import { fetchPixel } from '../lib/pixelApi';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { ShortcutKeys } from '../ui/Keys';
import { useContextMenu } from '../ui/menuContext';
import type { MenuEntry } from '../ui/menuContext';
import { overlayOpen } from '../ui/overlay';
import { Tooltip } from '../ui/Tooltip';
import { ColorPanel } from './ColorPanel';
import type { ColorSlot } from './ColorPanel';
import {
  MAX_LAYERS,
  activeLayer,
  createHistory,
  createLayer,
  dropFloating,
  exportPathError,
  historyReducer,
  nextLayerId,
  nextVersion,
  withLayer,
  withLayerData,
} from './document';
import type { PixelDocumentFile, PixelLayer, PixelMeta, PixelState } from './document';
import { bitmapToBlob, blobToBitmap, decodeDocument, encodeDocument, flattenData, flattenToBlob } from './io';
import { LayersPanel } from './LayersPanel';
import { PixelCanvas } from './PixelCanvas';
import type { PixelCanvasHandle } from './PixelCanvas';
import { ResizeDialog } from './PixelDialogs';
import type { ResizeInput } from './PixelDialogs';
import {
  composeOver,
  distinctColors,
  invertMask,
  lift,
  maskBounds,
  opaqueBounds,
  readPixel,
  rectMask,
  resizeCanvasData,
  sameColor,
  scaleNearest,
  toHex,
  transformBitmap,
  transformFloating,
} from './raster';
import type { Bitmap, Point, Rect, Rgba, Transform } from './raster';
import { BRUSH_TOOLS, DEFAULT_OPTIONS, GRID_MIN_ZOOM, SELECTION_TOOLS, TOOLS, TOOL_CODES, TOOL_INFO, ZOOM_LEVELS } from './tools';
import type { BrushSize, PixelTool, ToolOptions } from './tools';
import { ResizeHandle } from '../ui/ResizeHandle';
import { useEditorColumns } from '../ui/useResizablePanel';
import './pixel.css';

export interface PixelEditorProps {
  /** Image à ouvrir (`pixels/<id>.pixel.json`). */
  id: string;
  /** Écran affiché ; sinon l’éditeur ignore le clavier. */
  active: boolean;
  /** Grille des pixels à l’ouverture (réglage de l’éditeur). */
  defaultShowGrid: boolean;
  /** Demande d’enregistrement venue de la barre du haut ; change à chaque demande. */
  saveRequest: number;
  /** Enregistre le document et le PNG aplati. Lève une erreur en cas d’échec. */
  onSave: (file: PixelDocumentFile, png: Blob) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}

/** Contenu copié : partagé entre les images ouvertes successivement. */
interface ClipboardContent {
  bitmap: Bitmap;
  mask: Uint8Array;
  /** Position d’origine (collé au même endroit s’il y tient). */
  origin: Point | null;
}

let clipboard: ClipboardContent | null = null;

const RECENT_LIMIT = 16;
const DOCUMENT_COLOR_LIMIT = 48;
const OPAQUE_BLACK: Rgba = { r: 0, g: 0, b: 0, a: 255 };
const OPAQUE_WHITE: Rgba = { r: 255, g: 255, b: 255, a: 255 };

const quote = (text: string) => `«${NBSP}${text}${NBSP}»`;

/** Champ où l’on tape du texte : les lettres et les chiffres y restent (un curseur ou une case à cocher, non). */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'color', 'button'].includes(target.type);
}

/** Champ de formulaire (curseur, liste, saisie) : les flèches et Suppr lui reviennent. */
function isControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]') !== null;
}

/** Charge l’image puis ouvre l’éditeur (un éditeur par image : historique propre). */
export function PixelEditor(props: PixelEditorProps) {
  const [loaded, setLoaded] = useState<{ id: string; meta: PixelMeta; state: PixelState } | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPixel(props.id)
      .then(decodeDocument)
      .then(
        (result) => {
          if (!cancelled) setLoaded({ id: props.id, ...result });
        },
        (failure: unknown) => {
          if (!cancelled) setError({ id: props.id, message: errorMessage(failure) });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [props.id]);

  if (error?.id === props.id) {
    return (
      <section className="stage">
        <div className="empty-state">
          <Icon name="alert" size={48} />
          <h2>Image illisible</h2>
          <p className="muted">{error.message}</p>
        </div>
      </section>
    );
  }
  if (loaded?.id !== props.id) {
    return (
      <section className="stage">
        <p className="muted loading-line pixel-loading">
          <Icon name="loader" />
          Ouverture de l’image…
        </p>
      </section>
    );
  }
  return <PixelWorkbench key={loaded.id} initialMeta={loaded.meta} initialState={loaded.state} {...props} />;
}

interface WorkbenchProps extends PixelEditorProps {
  initialMeta: PixelMeta;
  initialState: PixelState;
}

function bitmapOf(state: PixelState, layer: PixelLayer): Bitmap {
  return { width: state.width, height: state.height, data: layer.data };
}

/**
 * Éditeur de pixels : couleurs à gauche, outils et toile au centre, calques
 * et document à droite. Chaque image garde son historique tant qu’elle est
 * ouverte.
 */
function PixelWorkbench(props: WorkbenchProps) {
  const { active, initialMeta, initialState, onSave, onDirtyChange, saveRequest } = props;
  const [history, dispatch] = useReducer(historyReducer, initialState, createHistory);
  const present = history.present;
  const { width, height } = present;
  const [meta, setMeta] = useState(initialMeta);
  const [savedVersion, setSavedVersion] = useState(initialState.contentVersion);
  const [savedMeta, setSavedMeta] = useState(() => JSON.stringify(initialMeta));
  const [tool, setTool] = useState<PixelTool>('pencil');
  const [options, setOptions] = useState<ToolOptions>(DEFAULT_OPTIONS);
  const [primary, setPrimary] = useState<Rgba>(OPAQUE_BLACK);
  const [secondary, setSecondary] = useState<Rgba>(OPAQUE_WHITE);
  const [recent, setRecent] = useState<Rgba[]>([]);
  const [showGrid, setShowGrid] = useState(props.defaultShowGrid);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<'resize' | null>(null);
  const canvasRef = useRef<PixelCanvasHandle>(null);
  const openContextMenu = useContextMenu();

  const dirty = present.contentVersion !== savedVersion || JSON.stringify(meta) !== savedMeta;
  const layer = activeLayer(present);
  const hasSelection = present.selection !== null || present.floating !== null;
  const textureError = exportPathError(meta.texture);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  /* ---------- Historique ---------- */

  const commit = useCallback((next: PixelState, coalesce?: string) => dispatch({ type: 'commit', state: next, coalesce, at: Date.now() }), []);
  const undo = () => dispatch({ type: 'undo' });
  const redo = () => dispatch({ type: 'redo' });

  /* ---------- Couleurs ---------- */

  const setColor = (slot: ColorSlot, color: Rgba) => (slot === 'primary' ? setPrimary(color) : setSecondary(color));
  const swapColors = () => {
    setPrimary(secondary);
    setSecondary(primary);
  };
  const rememberColor = useCallback((color: Rgba) => {
    setRecent((previous) => [color, ...previous.filter((candidate) => !sameColor(candidate, color))].slice(0, RECENT_LIMIT));
  }, []);

  // Couleurs du document : image aplatie (calques visibles), recalculée quand les calques changent.
  const documentColors = useMemo(
    () => distinctColors(flattenData({ ...present, floating: null }, present.layers), DOCUMENT_COLOR_LIMIT),
    // Les calques suffisent : la sélection et le contenu flottant ne changent pas les couleurs posées.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [present.layers],
  );

  /* ---------- Sélection ---------- */

  const hiddenLayerMessage = (target: PixelLayer) =>
    `Le calque ${quote(target.name)} est masqué${NBSP}: affiche-le pour le modifier`;

  const selectAll = () => {
    const base = dropFloating(present);
    commit({ ...base, selection: rectMask(width, height, { x: 0, y: 0, width, height }) });
  };

  const deselect = () => {
    if (!present.floating && !present.selection) return;
    commit({ ...dropFloating(present), selection: null });
  };

  const invertSelection = () => {
    const base = dropFloating(present);
    const inverted = base.selection ? invertMask(base.selection) : rectMask(width, height, { x: 0, y: 0, width, height });
    commit({ ...base, selection: inverted.some(Boolean) ? inverted : null });
  };

  /** Pose le contenu flottant (Entrée, Échap). */
  const dropContent = () => {
    if (present.floating) commit(dropFloating(present));
  };

  const deleteContent = () => {
    if (present.floating) {
      commit({ ...present, floating: null, contentVersion: nextVersion() });
      return;
    }
    if (!present.selection) {
      setStatus('Rien de sélectionné');
      return;
    }
    const data = layer.data.slice();
    present.selection.forEach((value, cell) => {
      if (value) data.fill(0, cell * 4, cell * 4 + 4);
    });
    commit(withLayerData(present, layer.id, data));
  };

  /** Détache la sélection du calque actif (déplacer, transformer) ; `null` si impossible. */
  const liftSelection = (state: PixelState): PixelState | null => {
    if (state.floating) return state;
    if (!state.selection) return null;
    const target = activeLayer(state);
    if (!target.visible) {
      setStatus(hiddenLayerMessage(target));
      return null;
    }
    const lifted = lift(bitmapOf(state, target), state.selection);
    if (!lifted) return null;
    return { ...withLayerData(state, target.id, lifted.layer), selection: null, floating: { ...lifted.floating, layerId: target.id } };
  };

  const nudge = (dx: number, dy: number) => {
    const lifted = liftSelection(present);
    if (!lifted?.floating) {
      if (!present.selection) setStatus('Sélectionne d’abord une zone à déplacer (M, Q ou W)');
      return;
    }
    const floating = lifted.floating;
    commit({ ...lifted, floating: { ...floating, x: floating.x + dx, y: floating.y + dy }, contentVersion: nextVersion() }, 'nudge');
  };

  /* ---------- Presse-papiers ---------- */

  const copiedContent = (): ClipboardContent | null => {
    if (present.floating) {
      const { bitmap, mask, x, y } = present.floating;
      return { bitmap, mask, origin: { x, y } };
    }
    const selection = present.selection ?? rectMask(width, height, { x: 0, y: 0, width, height });
    const lifted = lift(bitmapOf(present, layer), selection);
    if (!lifted) return null;
    const { bitmap, mask, x, y } = lifted.floating;
    return { bitmap, mask, origin: { x, y } };
  };

  const copy = (cut: boolean) => {
    const content = copiedContent();
    if (!content) {
      setStatus('Rien à copier');
      return;
    }
    clipboard = content;
    const size = `${content.bitmap.width} × ${content.bitmap.height} px`;
    setStatus(cut ? `Coupé${NBSP}: ${size}` : `Copié${NBSP}: ${size}`);
    // Aussi dans le presse-papiers du système (collable ailleurs), si le navigateur l’autorise.
    void bitmapToBlob(content.bitmap)
      .then((blob) => navigator.clipboard?.write([new ClipboardItem({ 'image/png': blob })]))
      .catch(() => undefined);
    if (cut) deleteContent();
  };

  const paste = (content: ClipboardContent) => {
    const base = dropFloating(present);
    const target = activeLayer(base);
    if (!target.visible) {
      setStatus(hiddenLayerMessage(target));
      return;
    }
    const { bitmap } = content;
    let position: Point;
    if (content.origin && content.origin.x + bitmap.width <= width && content.origin.y + bitmap.height <= height) {
      position = content.origin;
    } else {
      const center = canvasRef.current?.visibleCenter() ?? { x: width / 2, y: height / 2 };
      position = {
        x: bitmap.width >= width ? 0 : Math.max(0, Math.min(width - bitmap.width, Math.round(center.x - bitmap.width / 2))),
        y: bitmap.height >= height ? 0 : Math.max(0, Math.min(height - bitmap.height, Math.round(center.y - bitmap.height / 2))),
      };
    }
    commit({
      ...base,
      selection: null,
      floating: { ...position, bitmap, mask: content.mask, layerId: target.id },
      contentVersion: nextVersion(),
    });
    setTool('move');
    const size = `${bitmap.width} × ${bitmap.height} px`;
    setStatus(
      bitmap.width > width || bitmap.height > height
        ? `Collé${NBSP}: ${size}, plus grand que la toile${NBSP}; agrandis-la (Taille de l’image) pour tout garder`
        : `Collé${NBSP}: ${size}${NBSP}; déplace-le, puis Entrée pour le poser`,
    );
  };

  const pasteInternal = () => {
    if (clipboard) paste(clipboard);
    else setStatus('Presse-papiers vide');
  };

  // Ctrl+V : l’évènement « paste » apporte une image du système ; sans image, le contenu copié ici.
  const pasteTimer = useRef(0);
  const pasteRef = useRef({ paste, pasteInternal, active });
  useEffect(() => {
    pasteRef.current = { paste, pasteInternal, active };
  });
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const current = pasteRef.current;
      if (!current.active || overlayOpen() || isTypingTarget(event.target)) return;
      window.clearTimeout(pasteTimer.current);
      pasteTimer.current = 0;
      const file = [...(event.clipboardData?.items ?? [])].find((item) => item.type.startsWith('image/'))?.getAsFile();
      if (!file) {
        current.pasteInternal();
        return;
      }
      event.preventDefault();
      void blobToBitmap(file).then(
        (bitmap) => {
          // Même taille que ce qui a été copié ici : c’est lui (on garde sa position et son masque).
          const own = clipboard && clipboard.bitmap.width === bitmap.width && clipboard.bitmap.height === bitmap.height;
          pasteRef.current.paste(own && clipboard ? clipboard : { bitmap, mask: new Uint8Array(bitmap.width * bitmap.height).fill(1), origin: null });
        },
        () => setStatus('Image du presse-papiers illisible'),
      );
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  /* ---------- Transformations et toile ---------- */

  const transform = (kind: Transform) => {
    if (present.floating) {
      const floating = present.floating;
      commit({ ...present, floating: { ...transformFloating(floating, kind), layerId: floating.layerId }, contentVersion: nextVersion() });
      return;
    }
    if (present.selection) {
      const lifted = liftSelection(present);
      if (!lifted?.floating) return;
      const floating = lifted.floating;
      commit({ ...lifted, floating: { ...transformFloating(floating, kind), layerId: floating.layerId } });
      return;
    }
    // Sans sélection : toute l’image (tous les calques ; un quart de tour échange largeur et hauteur).
    const rotates = kind === 'rotate-cw' || kind === 'rotate-ccw';
    commit({
      ...present,
      width: rotates ? height : width,
      height: rotates ? width : height,
      layers: present.layers.map((candidate) => ({ ...candidate, data: transformBitmap(bitmapOf(present, candidate), kind).bitmap.data })),
      selection: null,
      contentVersion: nextVersion(),
    });
  };

  /** Recadre toute l’image à un rectangle (qui peut déborder : bords transparents). */
  const cropTo = (rect: Rect, base: PixelState = dropFloating(present)) => {
    commit({
      ...base,
      width: rect.width,
      height: rect.height,
      layers: base.layers.map((candidate) => ({
        ...candidate,
        data: resizeCanvasData(bitmapOf(base, candidate), rect.width, rect.height, { x: -rect.x, y: -rect.y }),
      })),
      selection: null,
      contentVersion: nextVersion(),
    });
  };

  const cropToSelection = () => {
    const base = dropFloating(present);
    const bounds = base.selection ? maskBounds(base.selection, width) : null;
    if (!bounds) {
      setStatus('Sélectionne d’abord la zone à garder');
      return;
    }
    cropTo(bounds, base);
    setStatus(`Image recadrée à ${bounds.width} × ${bounds.height} px`);
  };

  const trimToContent = () => {
    const base = dropFloating(present);
    const bounds = opaqueBounds({ width, height, data: flattenData(base, base.layers) });
    if (!bounds) {
      setStatus('Image vide : rien à rogner');
      return;
    }
    if (bounds.width === width && bounds.height === height) {
      setStatus('Aucun bord transparent à rogner');
      return;
    }
    cropTo(bounds, base);
    setStatus(`Bords transparents rognés${NBSP}: ${bounds.width} × ${bounds.height} px`);
  };

  const resize = ({ mode, width: nextWidth, height: nextHeight, anchor }: ResizeInput) => {
    const base = dropFloating(present);
    const offset = { x: Math.round((nextWidth - width) * anchor.x), y: Math.round((nextHeight - height) * anchor.y) };
    commit({
      ...base,
      width: nextWidth,
      height: nextHeight,
      layers: base.layers.map((candidate) => ({
        ...candidate,
        data:
          mode === 'scale'
            ? scaleNearest(bitmapOf(base, candidate), nextWidth, nextHeight)
            : resizeCanvasData(bitmapOf(base, candidate), nextWidth, nextHeight, offset),
      })),
      selection: null,
      contentVersion: nextVersion(),
    });
    setDialog(null);
    setStatus(`Image${NBSP}: ${nextWidth} × ${nextHeight} px`);
  };

  /* ---------- Calques ---------- */

  const selectLayer = (id: string) => {
    if (id === present.activeLayerId) return;
    if (present.floating) commit({ ...dropFloating(present), activeLayerId: id });
    else dispatch({ type: 'replace', state: { ...present, activeLayerId: id } });
  };

  const insertAbove = (base: PixelState, added: PixelLayer) => {
    const index = base.layers.findIndex((candidate) => candidate.id === base.activeLayerId);
    const layers = [...base.layers];
    layers.splice(index + 1, 0, added);
    commit({ ...base, layers, activeLayerId: added.id, contentVersion: nextVersion() });
  };

  const addLayer = () => {
    const base = dropFloating(present);
    if (base.layers.length >= MAX_LAYERS) return;
    insertAbove(base, createLayer(width, height, base.layers));
  };

  const duplicateLayer = (id: string) => {
    const base = dropFloating(present);
    const original = base.layers.find((candidate) => candidate.id === id);
    if (!original || base.layers.length >= MAX_LAYERS) return;
    insertAbove({ ...base, activeLayerId: id }, { ...original, id: nextLayerId(base.layers), name: `${original.name} (copie)` });
  };

  const deleteLayer = (id: string) => {
    const base = dropFloating(present);
    if (base.layers.length <= 1) return;
    const index = base.layers.findIndex((candidate) => candidate.id === id);
    const layers = base.layers.filter((candidate) => candidate.id !== id);
    const nextActive = id === base.activeLayerId ? layers[Math.max(0, index - 1)].id : base.activeLayerId;
    commit({ ...base, layers, activeLayerId: nextActive, contentVersion: nextVersion() });
  };

  const moveLayer = (id: string, direction: 1 | -1) => {
    const base = dropFloating(present);
    const from = base.layers.findIndex((candidate) => candidate.id === id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= base.layers.length) return;
    const layers = [...base.layers];
    [layers[from], layers[to]] = [layers[to], layers[from]];
    commit({ ...base, layers, contentVersion: nextVersion() });
  };

  const mergeDown = (id: string) => {
    const base = dropFloating(present);
    const index = base.layers.findIndex((candidate) => candidate.id === id);
    if (index <= 0) return;
    const upper = base.layers[index];
    const lower = base.layers[index - 1];
    const merged = { ...lower, data: composeOver(lower.data, upper.data, upper.opacity) };
    const layers = base.layers.filter((candidate) => candidate.id !== id).map((candidate) => (candidate.id === lower.id ? merged : candidate));
    commit({ ...base, layers, activeLayerId: lower.id, contentVersion: nextVersion() });
    setStatus(`${quote(upper.name)} fusionné dans ${quote(lower.name)}`);
  };

  /* ---------- Enregistrement ---------- */

  const save = async () => {
    if (saving) return;
    if (textureError) {
      setStatus(`Échec de l’enregistrement${NBSP}: texture d’export invalide (${textureError})`);
      return;
    }
    const snapshot = present;
    const metaSnapshot = meta;
    setSaving(true);
    setStatus('Enregistrement…');
    try {
      const file = await encodeDocument(metaSnapshot, snapshot);
      const png = await flattenToBlob(snapshot);
      await onSave(file, png);
      setSavedVersion(snapshot.contentVersion);
      setSavedMeta(JSON.stringify(metaSnapshot));
      setStatus(`${quote(metaSnapshot.name)} enregistré, PNG exporté dans textures/${metaSnapshot.texture} (${snapshot.width} × ${snapshot.height})`);
    } catch (failure) {
      setStatus(`Échec de l’enregistrement${NBSP}: ${errorMessage(failure)}`);
    } finally {
      setSaving(false);
    }
  };

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

  /* ---------- Clavier ---------- */

  const setBrushSize = (size: BrushSize) => setOptions((previous) => ({ ...previous, brushSize: size }));

  const handleKeyDown = (event: KeyboardEvent) => {
    // Écran caché, ou menu contextuel / dialogue ouvert : les touches ne sont pas pour la toile.
    if (!active || event.defaultPrevented || overlayOpen()) return;
    const withModifier = event.ctrlKey || event.metaKey;
    // Lettres lues sur la touche produite (Ctrl+Z reste sur la touche Z en AZERTY), repli sur la
    // touche physique ; chiffres et signes restent physiques.
    const letter = shortcutLetter(event);
    const code = letter ? `Key${letter.toUpperCase()}` : event.code;
    if (withModifier && code === 'KeyS') {
      event.preventDefault();
      void save();
      return;
    }
    if (isTextEntry(event.target)) return;
    if (withModifier) {
      const actions: Record<string, () => void> = {
        KeyZ: event.shiftKey ? redo : undo,
        KeyY: redo,
        KeyA: selectAll,
        KeyD: deselect,
        KeyC: () => copy(false),
        KeyX: () => copy(true),
        KeyJ: () => duplicateLayer(present.activeLayerId),
        KeyE: () => mergeDown(present.activeLayerId),
        Digit0: () => canvasRef.current?.fit(),
        Numpad0: () => canvasRef.current?.fit(),
        Equal: () => canvasRef.current?.zoomStep(1),
        NumpadAdd: () => canvasRef.current?.zoomStep(1),
        Minus: () => canvasRef.current?.zoomStep(-1),
        NumpadSubtract: () => canvasRef.current?.zoomStep(-1),
      };
      if (code === 'KeyI' && event.shiftKey) {
        event.preventDefault();
        invertSelection();
      } else if (code === 'KeyV') {
        // Pas de preventDefault : le navigateur envoie l’évènement « paste » (image du système).
        window.clearTimeout(pasteTimer.current);
        pasteTimer.current = window.setTimeout(() => {
          pasteTimer.current = 0;
          pasteRef.current.pasteInternal();
        }, 120);
      } else if (actions[code]) {
        event.preventDefault();
        actions[code]();
      }
      return;
    }
    if (event.altKey) return;
    const digit = /^Digit([1-4])$/.exec(code)?.[1];
    if (event.shiftKey) {
      const shifted: Record<string, () => void> = {
        KeyU: () => setTool('ellipse'),
        KeyH: () => transform('flip-h'),
        KeyV: () => transform('flip-v'),
        KeyR: () => transform('rotate-cw'),
        KeyG: () => setShowGrid((shown) => !shown),
      };
      if (shifted[code]) {
        event.preventDefault();
        shifted[code]();
        return;
      }
    } else if (TOOL_CODES[code]) {
      setTool(TOOL_CODES[code]);
      return;
    } else if (code === 'KeyX') {
      swapColors();
      return;
    } else if (digit) {
      setBrushSize(Number(digit) as BrushSize);
      return;
    }
    if (event.key === 'Escape') {
      if (present.floating) dropContent();
      else deselect();
      return;
    }
    // Entrée pose le contenu déplacé, même si un bouton du panneau a gardé le focus après un clic
    // (sans preventDefault, le bouton serait aussi activé).
    if (event.key === 'Enter' && present.floating) {
      event.preventDefault();
      dropContent();
      return;
    }
    // Un curseur ou une liste gardent leurs touches (flèches, Suppr) ; un bouton, non.
    if (isControl(event.target)) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteContent();
    } else if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      const step = event.shiftKey ? 8 : 1;
      nudge(event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
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

  /* ---------- Menus contextuels ---------- */

  const pickAt = (pixel: Point, slot: ColorSlot) => {
    const color = readPixel({ width, height, data: flattenData(present) }, pixel.x, pixel.y);
    setColor(slot, color);
  };

  const canvasMenu = (pixel: Point | null): MenuEntry[] => [
    { heading: hasSelection ? 'Sélection' : `Image ${quote(meta.name)}` },
    { label: 'Couper', icon: 'cut', shortcut: 'Ctrl+X', disabled: !hasSelection, onSelect: () => copy(true) },
    { label: 'Copier', icon: 'copy', shortcut: 'Ctrl+C', onSelect: () => copy(false) },
    { label: 'Coller', icon: 'paste', shortcut: 'Ctrl+V', disabled: !clipboard, onSelect: pasteInternal },
    { label: 'Supprimer le contenu', icon: 'trash', shortcut: 'Suppr', danger: true, disabled: !hasSelection, onSelect: deleteContent },
    { separator: true },
    { label: 'Tout sélectionner', icon: 'marquee', shortcut: 'Ctrl+A', onSelect: selectAll },
    { label: 'Désélectionner', icon: 'close', shortcut: 'Ctrl+D', disabled: !hasSelection, onSelect: deselect },
    { label: 'Inverser la sélection', icon: 'swap', shortcut: 'Ctrl+Maj+I', onSelect: invertSelection },
    { separator: true },
    { label: 'Retourner horizontalement', icon: 'flip-h', shortcut: 'Maj+H', onSelect: () => transform('flip-h') },
    { label: 'Retourner verticalement', icon: 'flip-v', shortcut: 'Maj+V', onSelect: () => transform('flip-v') },
    { label: 'Pivoter de 90° (horaire)', icon: 'rotate-cw', shortcut: 'Maj+R', onSelect: () => transform('rotate-cw') },
    { label: 'Pivoter de 90° (antihoraire)', icon: 'rotate-ccw', onSelect: () => transform('rotate-ccw') },
    { separator: true },
    { label: 'Recadrer à la sélection', icon: 'crop', disabled: !hasSelection, onSelect: cropToSelection },
    { label: 'Rogner les bords transparents', icon: 'crop', onSelect: trimToContent },
    { label: 'Taille de l’image…', icon: 'resize', onSelect: () => setDialog('resize') },
    ...(pixel
      ? [
          { separator: true as const },
          { label: `Prendre la couleur (${pixel.x}, ${pixel.y})`, icon: 'eyedropper' as const, onSelect: () => pickAt(pixel, 'primary') },
        ]
      : []),
    { label: 'Ajuster le zoom', icon: 'expand', shortcut: 'Ctrl+0', onSelect: () => canvasRef.current?.fit() },
  ];

  /* ---------- Affichage ---------- */

  const toolButton = (value: PixelTool) => {
    const info = TOOL_INFO[value];
    return (
      <Tooltip key={value} label={info.label} shortcut={info.shortcut} hint={info.hint} placement="right">
        <button
          type="button"
          className={tool === value ? 'pixel-tool active' : 'pixel-tool'}
          aria-label={info.label}
          aria-pressed={tool === value}
          aria-keyshortcuts={info.shortcut.replace('Maj', 'Shift')}
          onClick={() => setTool(value)}
        >
          <Icon name={info.icon} size={24} />
        </button>
      </Tooltip>
    );
  };

  const toggle = (on: boolean, icon: IconName, label: string, hint: string, onClick: () => void, shortcut?: string) => (
    // Taille standard des boutons de barre d’outils (24 px de picto), comme annuler et rétablir.
    <IconButton icon={icon} label={label} hint={hint} shortcut={shortcut} pressed={on} variant={on ? 'normal' : 'ghost'} size={24} onClick={onClick} />
  );

  const brushSizes = BRUSH_TOOLS.has(tool) && !(tool === 'rectangle' && options.filled) && !(tool === 'ellipse' && options.filled);
  const setOption = <K extends keyof ToolOptions>(key: K, value: ToolOptions[K]) => setOptions((previous) => ({ ...previous, [key]: value }));
  const info = TOOL_INFO[tool];

  return (
    <div className="pixel-editor" ref={observeColumns} style={columnStyle}>
      <aside className="sidebar">
        <ColorPanel
          primary={primary}
          secondary={secondary}
          onChange={setColor}
          onSwap={swapColors}
          recent={recent}
          documentColors={documentColors}
        />
      </aside>

      <section className="pixel-main">
        {/* Quatre groupes, comme les autres barres : l’outil et ses réglages, la symétrie, l’historique,
            l’affichage. Faute de place, c’est un groupe entier qui passe à la ligne. */}
        <div className="asset-toolbar pixel-options" role="toolbar" aria-label="Réglages de l’outil">
          <div className="asset-toolbar-group pixel-tool-options" role="group" aria-label={`Outil ${info.label}`}>
          <span className="pixel-tool-name">
            <Icon name={info.icon} />
            {info.label}
          </span>
          {brushSizes && (
            <div className="asset-segmented pixel-sizes" role="group" aria-label="Taille de la brosse">
              {([1, 2, 3, 4] as const).map((size) => (
                <Tooltip key={size} label={`Brosse de ${size} px`} shortcut={String(size)}>
                  <button
                    type="button"
                    className={options.brushSize === size ? 'active' : ''}
                    aria-pressed={options.brushSize === size}
                    onClick={() => setBrushSize(size)}
                  >
                    {size}&nbsp;px
                  </button>
                </Tooltip>
              ))}
            </div>
          )}
          {(tool === 'rectangle' || tool === 'ellipse') && (
            <div className="asset-segmented" role="group" aria-label="Remplissage">
              <button type="button" className={options.filled ? '' : 'active'} aria-pressed={!options.filled} onClick={() => setOption('filled', false)}>
                Contour
              </button>
              <button type="button" className={options.filled ? 'active' : ''} aria-pressed={options.filled} onClick={() => setOption('filled', true)}>
                {tool === 'ellipse' ? 'Pleine' : 'Plein'}
              </button>
            </div>
          )}
          {tool === 'pencil' && (
            <Tooltip label="Pixel parfait" hint="Brosse de 1 px : supprime les coins en « L » des tracés à main levée">
              <label className="checkbox">
                <input type="checkbox" checked={options.pixelPerfect} onChange={(event) => setOption('pixelPerfect', event.target.checked)} />
                Pixel parfait
              </label>
            </Tooltip>
          )}
          {(tool === 'bucket' || tool === 'wand') && (
            <>
              <Tooltip label="Zone contiguë" hint="Coché : seulement les pixels reliés ; décoché : toute l’image">
                <label className="checkbox">
                  <input type="checkbox" checked={options.contiguous} onChange={(event) => setOption('contiguous', event.target.checked)} />
                  Contigu
                </label>
              </Tooltip>
              <label className="pixel-tolerance">
                Tolérance
                <input
                  type="number"
                  className="mini-input"
                  min={0}
                  max={255}
                  value={options.tolerance}
                  onChange={(event) => {
                    if (event.target.value !== '') setOption('tolerance', Math.max(0, Math.min(255, Math.round(Number(event.target.value)))));
                  }}
                />
              </label>
            </>
          )}
          {tool === 'eyedropper' && (
            <Tooltip label="Image entière" hint="Coché : la couleur affichée (tous les calques) ; décoché : le calque actif seul">
              <label className="checkbox">
                <input type="checkbox" checked={options.sampleAll} onChange={(event) => setOption('sampleAll', event.target.checked)} />
                Image entière
              </label>
            </Tooltip>
          )}
          {(SELECTION_TOOLS.has(tool) || tool === 'move') && (
            <div className="asset-toolbar-group">
              <IconButton icon="flip-h" label="Retourner horizontalement" shortcut="Maj+H" hint="La sélection, ou toute l’image" variant="ghost" size={24} onClick={() => transform('flip-h')} />
              <IconButton icon="flip-v" label="Retourner verticalement" shortcut="Maj+V" hint="La sélection, ou toute l’image" variant="ghost" size={24} onClick={() => transform('flip-v')} />
              <IconButton icon="rotate-ccw" label="Pivoter de 90° (antihoraire)" hint="La sélection, ou toute l’image" variant="ghost" size={24} onClick={() => transform('rotate-ccw')} />
              <IconButton icon="rotate-cw" label="Pivoter de 90° (horaire)" shortcut="Maj+R" hint="La sélection, ou toute l’image" variant="ghost" size={24} onClick={() => transform('rotate-cw')} />
            </div>
          )}
          </div>
          <span className="tb-sep" aria-hidden="true" />
          <div className="asset-toolbar-group" role="group" aria-label="Symétrie">
            {toggle(
              options.symmetry.horizontal,
              'symmetry-h',
              'Symétrie horizontale',
              'Le dessin se reflète de part et d’autre de l’axe vertical',
              () => setOption('symmetry', { ...options.symmetry, horizontal: !options.symmetry.horizontal }),
            )}
            {toggle(
              options.symmetry.vertical,
              'symmetry-v',
              'Symétrie verticale',
              'Le dessin se reflète de part et d’autre de l’axe horizontal',
              () => setOption('symmetry', { ...options.symmetry, vertical: !options.symmetry.vertical }),
            )}
          </div>
          <span className="tb-sep" aria-hidden="true" />
          <div className="asset-toolbar-group" role="group" aria-label="Historique">
            <IconButton icon="undo" label="Annuler" shortcut="Ctrl+Z" size={24} disabled={history.past.length === 0} onClick={undo} />
            <IconButton icon="redo" label="Rétablir" shortcut="Ctrl+Y" size={24} disabled={history.future.length === 0} onClick={redo} />
          </div>
          <div className="asset-toolbar-group asset-toolbar-end" role="group" aria-label="Affichage">
            <Tooltip label="Grille des pixels" shortcut="Maj+G" hint={`Visible à partir de ×${GRID_MIN_ZOOM}`}>
              <label className="checkbox">
                <input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} />
                Grille
              </label>
            </Tooltip>
            <select
              className="pixel-zoom"
              value={String(zoom)}
              aria-label="Niveau de zoom"
              onChange={(event) => {
                if (event.target.value === 'fit') canvasRef.current?.fit();
                else canvasRef.current?.setZoom(Number(event.target.value));
              }}
            >
              <option value="fit">Ajuster</option>
              {ZOOM_LEVELS.map((level) => (
                <option key={level} value={level}>
                  ×{level}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="pixel-body">
          <div className="pixel-tools" role="toolbar" aria-orientation="vertical" aria-label="Outils">
            {TOOLS.map(toolButton)}
            <span className="pixel-tools-sep" aria-hidden="true" />
            <Tooltip label="Échanger les couleurs" shortcut="X" placement="right">
              <button type="button" className="pixel-tool pixel-tool-colors" aria-label="Échanger les couleurs" onClick={swapColors}>
                <span className="pixel-mini-well secondary" style={{ background: toHex(secondary, true) }} />
                <span className="pixel-mini-well primary" style={{ background: toHex(primary, true) }} />
              </button>
            </Tooltip>
          </div>
          <PixelCanvas
            ref={canvasRef}
            state={present}
            tool={tool}
            options={options}
            primary={primary}
            secondary={secondary}
            showGrid={showGrid}
            active={active}
            onCommit={commit}
            onPickColor={(color, slot) => setColor(slot, color)}
            onColorUsed={rememberColor}
            onZoomChange={setZoom}
            onStatus={setStatus}
            onContextMenu={(event: ReactMouseEvent, pixel) => openContextMenu(event, canvasMenu(pixel))}
          />
        </div>

        <div className="asset-footer">
          <span className="asset-footer-hint">
            <Icon name={info.icon} />
            {info.hint}
          </span>
          <span className={/^(Échec|Le calque)/.test(status) ? 'asset-status is-error' : 'asset-status'} role="status">
            {status}
          </span>
        </div>
      </section>

      <aside className="sidebar">
        <LayersPanel
          layers={present.layers}
          width={width}
          height={height}
          activeLayerId={present.activeLayerId}
          onSelect={selectLayer}
          onToggleVisible={(id) => {
            const target = present.layers.find((candidate) => candidate.id === id);
            if (target) commit(withLayer(present, id, { visible: !target.visible }));
          }}
          onRename={(id, name) => commit(withLayer(present, id, { name }))}
          onOpacity={(id, opacity) => commit(withLayer(present, id, { opacity }), `opacity:${id}`)}
          onAdd={addLayer}
          onDuplicate={duplicateLayer}
          onDelete={deleteLayer}
          onMove={moveLayer}
          onMergeDown={mergeDown}
        />
        <DocumentPanel
          meta={meta}
          width={width}
          height={height}
          textureError={textureError}
          hasSelection={hasSelection}
          dirty={dirty}
          saving={saving}
          onRename={(name) => setMeta((previous) => ({ ...previous, name }))}
          onTextureChange={(texture) => setMeta((previous) => ({ ...previous, texture }))}
          onResize={() => setDialog('resize')}
          onCropToSelection={cropToSelection}
          onTrim={trimToContent}
          onSave={() => void save()}
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
                    <ShortcutKeys shortcut={TOOL_INFO[value].shortcut} />
                  </dt>
                  <dd>{TOOL_INFO[value].label}</dd>
                </Fragment>
              ))}
              {[
                ['X', 'Échanger les couleurs'],
                ['1', 'Brosse de 1 px (jusqu’à 4)'],
                ['Alt+Clic', 'Pipette temporaire'],
                ['Ctrl+A', 'Tout sélectionner'],
                ['Ctrl+D', 'Désélectionner'],
                ['Ctrl+C', 'Copier'],
                ['Ctrl+V', 'Coller'],
                ['Suppr', 'Vider la sélection'],
                ['Flèches', 'Déplacer la sélection de 1 px'],
                ['Ctrl+J', 'Dupliquer le calque'],
                ['Ctrl+E', 'Fusionner vers le bas'],
                ['Ctrl+S', 'Enregistrer et exporter'],
              ].map(([keys, label]) => (
                <Fragment key={keys}>
                  <dt>
                    <ShortcutKeys shortcut={keys} />
                  </dt>
                  <dd>{label}</dd>
                </Fragment>
              ))}
            </dl>
          </details>
        </section>
      </aside>
      {/* Poignées des deux colonnes : largeur réglée à la souris ou au clavier, mémorisée. */}
      <ResizeHandle side="left" label="Largeur de la colonne de gauche" handle={leftColumn} />
      <ResizeHandle side="right" label="Largeur de la colonne de droite" handle={rightColumn} />

      {dialog === 'resize' && <ResizeDialog width={width} height={height} onCancel={() => setDialog(null)} onApply={resize} />}
    </div>
  );
}

interface DocumentPanelProps {
  meta: PixelMeta;
  width: number;
  height: number;
  textureError: string | null;
  hasSelection: boolean;
  dirty: boolean;
  saving: boolean;
  onRename: (name: string) => void;
  onTextureChange: (texture: string) => void;
  onResize: () => void;
  onCropToSelection: () => void;
  onTrim: () => void;
  onSave: () => void;
}

/** Document : nom, taille, texture d’export (le PNG aplati utilisé par les menus et les assets). */
function DocumentPanel(props: DocumentPanelProps) {
  const { meta, textureError } = props;
  const source = meta.source;
  return (
    <section className="panel-section pixel-document">
      <header className="section-header">
        <h3>Image</h3>
        <span className="pill mono">{meta.id}</span>
      </header>
      <label className="field">
        <span className="field-label">Nom</span>
        <input value={meta.name} onChange={(event) => props.onRename(event.target.value)} />
      </label>
      <div className="pixel-document-size">
        <span>
          {props.width} × {props.height}&nbsp;px
        </span>
        <Tooltip label="Taille de l’image" hint="Agrandir, recadrer la toile ou mettre à l’échelle">
          <button type="button" className="sm" onClick={props.onResize}>
            <Icon name="resize" />
            Taille…
          </button>
        </Tooltip>
      </div>
      <div className="button-row">
        <Tooltip label="Recadrer à la sélection" hint="Ne garde que le rectangle qui contient la sélection">
          <button type="button" className="sm" disabled={!props.hasSelection} onClick={props.onCropToSelection}>
            <Icon name="crop" />
            Recadrer
          </button>
        </Tooltip>
        <Tooltip label="Rogner les bords transparents" hint="Réduit l’image au rectangle de ses pixels visibles">
          <button type="button" className="sm" onClick={props.onTrim}>
            <Icon name="crop" />
            Rogner
          </button>
        </Tooltip>
      </div>
      <label className="field">
        <span className="field-label">Texture exportée (sous textures/)</span>
        <input className="mono" spellCheck={false} value={meta.texture} onChange={(event) => props.onTextureChange(event.target.value)} />
        {textureError ? (
          <span className="field-error">
            <Icon name="alert" />
            {textureError}
          </span>
        ) : (
          <span className="field-hint">PNG aplati, réécrit à chaque enregistrement ; utilisable tel quel dans les menus et les assets.</span>
        )}
      </label>
      {source && (
        <p className="muted small pixel-source">
          <Icon name="info" />
          {source.kind === 'library' ? (
            <span>
              Copie de <span className="mono">{source.path}</span> ({source.library})&nbsp;: la texture d’origine n’est jamais modifiée.
            </span>
          ) : (
            <span>
              Créée depuis <span className="mono">{source.texture}</span>.
            </span>
          )}
        </p>
      )}
      <button type="button" className="primary wide" disabled={!props.dirty || props.saving || Boolean(textureError)} onClick={props.onSave}>
        <Icon name={props.saving ? 'loader' : props.dirty ? 'save' : 'check'} />
        {props.saving ? 'Enregistrement…' : props.dirty ? 'Enregistrer et exporter' : 'Enregistré'}
      </button>
    </section>
  );
}
