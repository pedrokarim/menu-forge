import { useCallback, useEffect, useEffectEvent, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, Ref } from 'react';
import { isEditableTarget } from '../canvas/viewport';
import { NBSP } from '../lib/format';
import { activeLayer, dropFloating, nextVersion, withLayerData } from './document';
import type { FloatingLayer, PixelLayer, PixelState } from './document';
import { context2d, createCanvas } from './io';
import {
  brushOffset,
  clamp,
  combineMasks,
  constrainAngle,
  constrainSquare,
  createSurface,
  dirtyRect,
  ellipsePoints,
  emptyDirty,
  fillMask,
  floodMask,
  lift,
  linePoints,
  maskBounds,
  maskEdges,
  maskHas,
  mirrored,
  paintedBounds,
  plot,
  polygonMask,
  readPixel,
  rectFromPoints,
  rectMask,
  rectanglePoints,
  resizeCanvasData,
  restore,
  restoreRect,
  stamp,
  toHex,
} from './raster';
import type { DirtyBox, PaintSurface, Point, Rect, Rgba, SelectionMode } from './raster';
import { GRID_MIN_ZOOM, PAINT_TOOLS, ZOOM_LEVELS } from './tools';
import type { PixelTool, ToolOptions } from './tools';

/** Commandes de la vue, pour la barre d’outils et les raccourcis de l’éditeur. */
export interface PixelCanvasHandle {
  /** Zoom « Ajuster » : le plus grand palier où l’image tient, centrée. */
  fit(): void;
  /** Palier suivant (1) ou précédent (−1), centré sur la vue. */
  zoomStep(direction: 1 | -1): void;
  setZoom(level: number): void;
  /** Pixel d’image au centre de la vue (où poser un collage). */
  visibleCenter(): Point;
}

interface PixelCanvasProps {
  state: PixelState;
  tool: PixelTool;
  options: ToolOptions;
  primary: Rgba;
  secondary: Rgba;
  showGrid: boolean;
  /** Écran affiché : sinon, la barre d’espace n’est pas interceptée. */
  active: boolean;
  /** Nouvel état, une entrée d’historique (`coalesce`  regroupée avec la précédente de même clé). */
  onCommit: (next: PixelState, coalesce?: string) => void;
  onPickColor: (color: Rgba, target: 'primary' | 'secondary') => void;
  /** Couleur posée sur l’image (couleurs récentes). */
  onColorUsed: (color: Rgba) => void;
  onZoomChange: (zoom: number) => void;
  onStatus: (message: string) => void;
  /** Clic droit sur la toile ; `pixel`  pixel d’image visé, `null` hors de l’image. */
  onContextMenu: (event: ReactMouseEvent, pixel: Point | null) => void;
  ref?: Ref<PixelCanvasHandle>;
}

interface View {
  zoom: number;
  /** Position à l’écran (px CSS, dans la zone) du coin haut-gauche de l’image. */
  x: number;
  y: number;
}

/** Calque en cours de modification : ses données remplacent celles de l’état à l’affichage. */
interface LiveLayer {
  layerId: string;
  data: Uint8ClampedArray;
  /** Zone modifiée depuis le dernier affichage (`null`  tout le calque). */
  dirty: DirtyBox | null;
}

type Session =
  | { kind: 'pan'; start: Point; origin: View }
  | { kind: 'pick'; target: 'primary' | 'secondary' }
  | {
      kind: 'paint';
      base: PixelState;
      layerId: string;
      surface: PaintSurface;
      color: Rgba | null;
      size: number;
      last: Point;
      trail: Point[];
      pixelPerfect: boolean;
    }
  | {
      kind: 'shape';
      base: PixelState;
      layerId: string;
      surface: PaintSurface;
      shape: 'line' | 'rectangle' | 'ellipse';
      start: Point;
      end: Point;
      constrain: boolean;
      previous: Rect | null;
    }
  | { kind: 'marquee'; base: PixelState; start: Point; end: Point; mode: SelectionMode; moved: boolean }
  | { kind: 'lasso'; base: PixelState; points: Point[]; mode: SelectionMode }
  | { kind: 'move'; base: PixelState; floating: FloatingLayer; start: Point; origin: Point; moved: boolean }
  | { kind: 'shift'; base: PixelState; layerId: string; data: Uint8ClampedArray; start: Point; offset: Point };

/** Couleurs de la zone de travail et du damier (jetons Deepslate, comme les autres toiles). */
const STAGE_COLOR = '#131418';
const CHECKER_DARK = '#23242a';
const CHECKER_LIGHT = '#2d2e35';
const GOLD = '#f2c94c';
/** Marge autour de l’image au zoom « Ajuster ». */
const FIT_PAD = 24;
/** Part de l’image qui reste toujours visible quand on la fait défiler, en px écran. */
const KEEP_VISIBLE = 32;
/** Molette : cumul (px) qui vaut un palier de zoom. */
const WHEEL_STEP = 60;

function imageDataOf(data: Uint8ClampedArray, width: number, height: number): ImageData {
  return new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height);
}

/** Deux tampons identiques ? (comparaison par mots de 32 bits quand c’est possible). */
function sameData(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  if (a.byteOffset % 4 === 0 && b.byteOffset % 4 === 0) {
    const left = new Uint32Array(a.buffer, a.byteOffset, a.length / 4);
    const right = new Uint32Array(b.buffer, b.byteOffset, b.length / 4);
    for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
    return true;
  }
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
}

/** Coin en « L » dans les trois derniers pixels d’un tracé (mode pixel parfait). */
function isCorner(a: Point, b: Point, c: Point): boolean {
  return (a.x === b.x || a.y === b.y) && (b.x === c.x || b.y === c.y) && Math.abs(a.x - c.x) === 1 && Math.abs(a.y - c.y) === 1;
}

/**
 * Toile de l’éditeur de pixels : affichage (zoom ×1 à ×64, défilement,
 * grille, sélection en fourmis, symétrie) et gestes des outils. Seule la
 * partie visible est dessinée : une image de 1024 px à ×64 reste fluide.
 */
export function PixelCanvas(props: PixelCanvasProps) {
  const { state, tool, options, showGrid, ref } = props;
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ zoom: 1, x: 0, y: 0 });
  const [, setViewEpoch] = useState(0);
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null);
  const fittedFor = useRef('');
  const sessionRef = useRef<Session | null>(null);
  const [sessionKind, setSessionKind] = useState<Session['kind'] | null>(null);
  const hoverRef = useRef<Point | null>(null);
  const [readout, setReadout] = useState<{ pixel: Point; color: Rgba } | null>(null);
  const spaceRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const pointerInside = useRef(false);
  const wheelRef = useRef(0);
  const antPhase = useRef(0);
  const frame = useRef(0);
  const lastPaint = useRef<{ layerId: string; point: Point } | null>(null);

  // Caches d’affichage : un canvas par calque, l’image aplatie, le contenu flottant, les bords de la sélection.
  const surfaces = useRef(new Map<string, { data: Uint8ClampedArray; canvas: HTMLCanvasElement; image: ImageData }>());
  const composite = useRef<HTMLCanvasElement | null>(null);
  const floatingCache = useRef<{ data: Uint8ClampedArray; canvas: HTMLCanvasElement } | null>(null);
  const edgesCache = useRef<{ mask: Uint8Array; edges: Array<[number, number, number, number]> } | null>(null);
  const checker = useRef<CanvasPattern | null>(null);

  const { width, height } = state;

  /* ---------- Vue ---------- */

  const clampView = useCallback(
    (view: View): View => {
      if (!stage) return view;
      const w = width * view.zoom;
      const h = height * view.zoom;
      return {
        zoom: view.zoom,
        x: Math.round(clamp(view.x, KEEP_VISIBLE - w, stage.width - KEEP_VISIBLE)),
        y: Math.round(clamp(view.y, KEEP_VISIBLE - h, stage.height - KEEP_VISIBLE)),
      };
    },
    [stage, width, height],
  );

  const applyView = (next: View) => {
    const previous = viewRef.current;
    viewRef.current = clampView(next);
    if (viewRef.current.zoom !== previous.zoom) props.onZoomChange(viewRef.current.zoom);
    setViewEpoch((epoch) => epoch + 1);
  };

  const fitView = useCallback((): View => {
    if (!stage) return viewRef.current;
    const zoom =
      [...ZOOM_LEVELS].reverse().find((level) => width * level <= stage.width - FIT_PAD * 2 && height * level <= stage.height - FIT_PAD * 2) ??
      ZOOM_LEVELS[0];
    return { zoom, x: Math.round((stage.width - width * zoom) / 2), y: Math.round((stage.height - height * zoom) / 2) };
  }, [stage, width, height]);

  /** Change de zoom en gardant sous `anchor` (px dans la zone) le même pixel d’image. */
  const zoomAt = (level: number, anchor: Point) => {
    const view = viewRef.current;
    const imageX = (anchor.x - view.x) / view.zoom;
    const imageY = (anchor.y - view.y) / view.zoom;
    applyView({ zoom: level, x: anchor.x - imageX * level, y: anchor.y - imageY * level });
  };

  const stageCenter = (): Point => ({ x: (stage?.width ?? 0) / 2, y: (stage?.height ?? 0) / 2 });

  useImperativeHandle(ref, () => ({
    fit: () => applyView(fitView()),
    zoomStep: (direction) => {
      const current = viewRef.current.zoom;
      const next = direction > 0 ? ZOOM_LEVELS.find((level) => level > current) : ZOOM_LEVELS.findLast((level) => level < current);
      if (next) zoomAt(next, stageCenter());
    },
    setZoom: (level) => zoomAt(level, stageCenter()),
    visibleCenter: () => {
      const view = viewRef.current;
      const center = stageCenter();
      return {
        x: clamp(Math.floor((center.x - view.x) / view.zoom), 0, width - 1),
        y: clamp(Math.floor((center.y - view.y) / view.zoom), 0, height - 1),
      };
    },
  }));

  // Taille de la zone, suivie en continu.
  useLayoutEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      // Éditeur caché (autre écran) : taille nulle, on garde la dernière vraie taille.
      if (entry.contentRect.width === 0 || entry.contentRect.height === 0) return;
      setStage({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // « Ajuster » à l’ouverture et à chaque changement de taille de l’image ; sinon la vue reste dans la zone.
  useLayoutEffect(() => {
    if (!stage) return;
    const key = `${width}x${height}`;
    if (fittedFor.current !== key) {
      fittedFor.current = key;
      viewRef.current = fitView();
      props.onZoomChange(viewRef.current.zoom);
    } else {
      viewRef.current = clampView(viewRef.current);
    }
    setViewEpoch((epoch) => epoch + 1);
    // `props.onZoomChange` est stable côté éditeur ; la vue ne dépend que de la zone et de la taille de l’image.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, width, height, fitView, clampView]);

  /* ---------- Affichage ---------- */

  /** Ce qui est affiché : l’état, ou celui du geste en cours (calque modifié, contenu déplacé). */
  function display(): { shown: PixelState; live: LiveLayer | null } {
    const session = sessionRef.current;
    if (!session) return { shown: state, live: null };
    switch (session.kind) {
      case 'paint':
      case 'shape':
        return { shown: session.base, live: { layerId: session.layerId, data: session.surface.data, dirty: session.surface.dirty } };
      case 'move':
        return { shown: { ...session.base, floating: session.floating }, live: null };
      case 'shift':
        return { shown: session.base, live: { layerId: session.layerId, data: session.data, dirty: null } };
      case 'marquee':
      case 'lasso':
        return { shown: session.base, live: null };
      default:
        return { shown: state, live: null };
    }
  }

  function layerSurface(layer: PixelLayer, live: LiveLayer | null, w: number, h: number): HTMLCanvasElement {
    const isLive = live !== null && live.layerId === layer.id;
    const data = isLive ? live.data : layer.data;
    let entry = surfaces.current.get(layer.id);
    if (!entry || entry.canvas.width !== w || entry.canvas.height !== h) {
      const canvas = createCanvas(w, h);
      entry = { data: new Uint8ClampedArray(0), canvas, image: imageDataOf(data, w, h) };
      surfaces.current.set(layer.id, entry);
    }
    const context = context2d(entry.canvas);
    if (entry.data !== data) {
      entry.data = data;
      entry.image = imageDataOf(data, w, h);
      context.putImageData(entry.image, 0, 0);
      if (isLive && live.dirty) Object.assign(live.dirty, emptyDirty());
    } else if (isLive && live.dirty) {
      const rect = dirtyRect(live.dirty);
      if (rect) context.putImageData(entry.image, 0, 0, rect.x, rect.y, rect.width, rect.height);
      Object.assign(live.dirty, emptyDirty());
    }
    return entry.canvas;
  }

  function floatingSurface(floating: FloatingLayer): HTMLCanvasElement {
    const cached = floatingCache.current;
    if (cached && cached.data === floating.bitmap.data) return cached.canvas;
    const canvas = createCanvas(floating.bitmap.width, floating.bitmap.height);
    context2d(canvas).putImageData(imageDataOf(floating.bitmap.data, floating.bitmap.width, floating.bitmap.height), 0, 0);
    floatingCache.current = { data: floating.bitmap.data, canvas };
    return canvas;
  }

  /** Image aplatie de ce qui est affiché (calques visibles, contenu flottant à sa place). */
  function compose(shown: PixelState, live: LiveLayer | null): HTMLCanvasElement {
    let target = composite.current;
    if (!target || target.width !== shown.width || target.height !== shown.height) {
      target = createCanvas(shown.width, shown.height);
      composite.current = target;
    }
    const context = context2d(target);
    context.globalAlpha = 1;
    context.clearRect(0, 0, target.width, target.height);
    for (const layer of shown.layers) {
      if (!layer.visible || layer.opacity === 0) continue;
      context.globalAlpha = layer.opacity / 100;
      context.drawImage(layerSurface(layer, live, shown.width, shown.height), 0, 0);
      if (shown.floating?.layerId === layer.id) context.drawImage(floatingSurface(shown.floating), shown.floating.x, shown.floating.y);
    }
    context.globalAlpha = 1;
    for (const id of surfaces.current.keys()) {
      if (!shown.layers.some((layer) => layer.id === id)) surfaces.current.delete(id);
    }
    return target;
  }

  function edgesOf(mask: Uint8Array, w: number, h: number) {
    if (edgesCache.current?.mask !== mask) edgesCache.current = { mask, edges: maskEdges(mask, w, h) };
    return edgesCache.current.edges;
  }

  /** Bords en « fourmis » : trait noir, tirets blancs qui défilent. */
  function strokeAnts(context: CanvasRenderingContext2D, trace: () => void) {
    context.save();
    context.lineWidth = 1;
    context.beginPath();
    trace();
    context.setLineDash([]);
    context.strokeStyle = '#0b0b0e';
    context.stroke();
    context.setLineDash([4, 4]);
    context.lineDashOffset = -antPhase.current;
    context.strokeStyle = '#ffffff';
    context.stroke();
    context.restore();
  }

  function draw() {
    frame.current = 0;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !stage) return;
    if (canvas.width !== stage.width || canvas.height !== stage.height) {
      canvas.width = stage.width;
      canvas.height = stage.height;
    }
    const { shown, live } = display();
    const w = shown.width;
    const h = shown.height;
    const { zoom, x: ox, y: oy } = viewRef.current;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.imageSmoothingEnabled = false;
    context.fillStyle = STAGE_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const flat = compose(shown, live);
    const left = Math.max(0, ox);
    const top = Math.max(0, oy);
    const right = Math.min(canvas.width, ox + w * zoom);
    const bottom = Math.min(canvas.height, oy + h * zoom);
    if (right > left && bottom > top) {
      if (!checker.current) {
        const tile = createCanvas(16, 16);
        const tileContext = context2d(tile);
        tileContext.fillStyle = CHECKER_DARK;
        tileContext.fillRect(0, 0, 16, 16);
        tileContext.fillStyle = CHECKER_LIGHT;
        tileContext.fillRect(0, 0, 8, 8);
        tileContext.fillRect(8, 8, 8, 8);
        checker.current = context.createPattern(tile, 'repeat');
      }
      if (checker.current) {
        checker.current.setTransform(new DOMMatrix().translateSelf(ox, oy));
        context.fillStyle = checker.current;
      } else {
        context.fillStyle = CHECKER_DARK;
      }
      context.fillRect(left, top, right - left, bottom - top);
      // Seule la partie visible de l’image est agrandie.
      const sx0 = Math.floor((left - ox) / zoom);
      const sy0 = Math.floor((top - oy) / zoom);
      const sx1 = Math.min(w, Math.ceil((right - ox) / zoom));
      const sy1 = Math.min(h, Math.ceil((bottom - oy) / zoom));
      context.drawImage(flat, sx0, sy0, sx1 - sx0, sy1 - sy0, ox + sx0 * zoom, oy + sy0 * zoom, (sx1 - sx0) * zoom, (sy1 - sy0) * zoom);

      if (showGrid && zoom >= GRID_MIN_ZOOM) {
        context.fillStyle = 'rgba(255, 255, 255, 0.09)';
        for (let x = Math.max(1, sx0); x < sx1; x++) context.fillRect(ox + x * zoom, top, 1, bottom - top);
        for (let y = Math.max(1, sy0); y < sy1; y++) context.fillRect(left, oy + y * zoom, right - left, 1);
      }
    }
    context.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    context.lineWidth = 1;
    context.strokeRect(ox - 0.5, oy - 0.5, w * zoom + 1, h * zoom + 1);

    // Axes de symétrie : pointillés dorés au centre de l’image.
    const { symmetry } = options;
    if (symmetry.horizontal || symmetry.vertical) {
      context.save();
      context.strokeStyle = GOLD;
      context.setLineDash([6, 4]);
      context.beginPath();
      if (symmetry.horizontal) {
        const axis = Math.round(ox + (w / 2) * zoom) + 0.5;
        context.moveTo(axis, oy - 12);
        context.lineTo(axis, oy + h * zoom + 12);
      }
      if (symmetry.vertical) {
        const axis = Math.round(oy + (h / 2) * zoom) + 0.5;
        context.moveTo(ox - 12, axis);
        context.lineTo(ox + w * zoom + 12, axis);
      }
      context.stroke();
      context.restore();
    }

    const toScreen = (x: number, y: number): [number, number] => [ox + x * zoom + 0.5, oy + y * zoom + 0.5];
    const traceEdges = (edges: Array<[number, number, number, number]>, dx = 0, dy = 0) => {
      for (const [x0, y0, x1, y1] of edges) {
        context.moveTo(...toScreen(x0 + dx, y0 + dy));
        context.lineTo(...toScreen(x1 + dx, y1 + dy));
      }
    };
    const session = sessionRef.current;

    // Sélection (ou contenu flottant) en fourmis.
    if (shown.floating) {
      const floating = shown.floating;
      const edges = maskEdges(floating.mask, floating.bitmap.width, floating.bitmap.height);
      strokeAnts(context, () => traceEdges(edges, floating.x, floating.y));
    } else if (shown.selection && session?.kind !== 'marquee' && session?.kind !== 'lasso') {
      const edges = edgesOf(shown.selection, w, h);
      strokeAnts(context, () => traceEdges(edges));
    } else if (shown.selection) {
      const edges = edgesOf(shown.selection, w, h);
      strokeAnts(context, () => traceEdges(edges));
    }
    if (session?.kind === 'marquee') {
      const rect = rectFromPoints(clampPoint(session.start, w, h), clampPoint(session.end, w, h));
      strokeAnts(context, () => {
        const [x0, y0] = toScreen(rect.x, rect.y);
        context.rect(x0, y0, rect.width * zoom, rect.height * zoom);
      });
    } else if (session?.kind === 'lasso' && session.points.length > 0) {
      strokeAnts(context, () => {
        session.points.forEach((point, index) => {
          const [x, y] = [ox + (point.x + 0.5) * zoom, oy + (point.y + 0.5) * zoom];
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
      });
    }

    // Pixel visé : la brosse (miroirs compris), ou un simple cadre.
    const hover = hoverRef.current;
    const busy = session !== null && session.kind !== 'paint' && session.kind !== 'shape';
    if (hover && !busy && !spaceRef.current && tool !== 'move') {
      const size = tool === 'pencil' || tool === 'eraser' || tool === 'line' || (tool !== 'rectangle' && tool !== 'ellipse' ? false : !options.filled)
        ? options.brushSize
        : 1;
      const offset = brushOffset(size);
      const boxes: Rect[] = [{ x: hover.x - offset, y: hover.y - offset, width: size, height: size }];
      if (PAINT_TOOLS.has(tool)) {
        if (symmetry.horizontal) boxes.push({ ...boxes[0], x: w - boxes[0].x - size });
        if (symmetry.vertical) boxes.push({ ...boxes[0], y: h - boxes[0].y - size });
        if (symmetry.horizontal && symmetry.vertical) boxes.push({ ...boxes[0], x: w - boxes[0].x - size, y: h - boxes[0].y - size });
      }
      context.save();
      for (const box of boxes) {
        const [x, y] = toScreen(box.x, box.y);
        context.strokeStyle = '#0b0b0e';
        context.strokeRect(x - 1, y - 1, box.width * zoom + 1, box.height * zoom + 1);
        context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        context.strokeRect(x, y, box.width * zoom - 1, box.height * zoom - 1);
      }
      context.restore();
    }
  }

  const scheduleDraw = () => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  };

  // Chaque rendu redessine (état, outil, vue…).
  useLayoutEffect(() => {
    draw();
  });

  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    },
    [],
  );

  // Fourmis qui défilent tant qu’une sélection est visible.
  const hasAnts = state.selection !== null || state.floating !== null || sessionKind === 'marquee' || sessionKind === 'lasso';
  useEffect(() => {
    if (!hasAnts) return;
    const timer = window.setInterval(() => {
      antPhase.current = (antPhase.current + 1) % 8;
      scheduleDraw();
    }, 140);
    return () => window.clearInterval(timer);
    // `scheduleDraw` ne fait que demander une image : sans dépendance.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAnts]);

  /* ---------- Gestes ---------- */

  function clampPoint(point: Point, w = width, h = height): Point {
    return { x: clamp(point.x, 0, w - 1), y: clamp(point.y, 0, h - 1) };
  }

  function localPoint(event: { clientX: number; clientY: number }): Point {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }

  function imagePoint(local: Point): Point {
    const view = viewRef.current;
    return { x: Math.floor((local.x - view.x) / view.zoom), y: Math.floor((local.y - view.y) / view.zoom) };
  }

  const inImage = (point: Point) => point.x >= 0 && point.y >= 0 && point.x < width && point.y < height;

  function startSession(session: Session | null) {
    sessionRef.current = session;
    setSessionKind(session?.kind ?? null);
  }

  /** Couleur sous un pixel : image aplatie affichée, ou calque actif. */
  function sample(point: Point): Rgba | null {
    if (!inImage(point)) return null;
    if (!options.sampleAll) {
      const layer = activeLayer(state);
      return readPixel({ width, height, data: layer.data }, point.x, point.y);
    }
    const flat = composite.current;
    if (!flat) return null;
    const [r, g, b, a] = context2d(flat).getImageData(point.x, point.y, 1, 1).data;
    return { r, g, b, a };
  }

  /** État de départ d’un geste : le contenu flottant est d’abord posé (une entrée d’historique). */
  function settle(): PixelState {
    if (!state.floating) return state;
    const dropped = dropFloating(state);
    props.onCommit(dropped);
    return dropped;
  }

  /** Calque actif, s’il est visible (on ne dessine pas à l’aveugle). */
  function paintableLayer(base: PixelState): PixelLayer | null {
    const layer = activeLayer(base);
    if (!layer.visible) {
      props.onStatus(`Le calque «${NBSP}${layer.name}${NBSP}» est masqué${NBSP}: affiche-le pour y dessiner`);
      return null;
    }
    return layer;
  }

  function selectionMode(event: { shiftKey: boolean; altKey: boolean }): SelectionMode {
    return event.shiftKey ? 'add' : event.altKey ? 'subtract' : 'replace';
  }

  /** Le pixel est-il dans la sélection (ou dans le contenu flottant) ? */
  function insideSelection(point: Point): boolean {
    if (state.floating) {
      const floating = state.floating;
      return maskHas(floating.mask, floating.bitmap.width, floating.bitmap.height, point.x - floating.x, point.y - floating.y);
    }
    return state.selection !== null && maskHas(state.selection, width, height, point.x, point.y);
  }

  function paintStep(session: Extract<Session, { kind: 'paint' }>, point: Point) {
    stamp(session.surface, point.x, point.y, session.size, session.color);
    if (!session.pixelPerfect) return;
    const trail = session.trail;
    trail.push(point);
    if (trail.length >= 3) {
      const [a, b, c] = trail.slice(-3);
      if (isCorner(a, b, c)) {
        restore(session.surface, b.x, b.y);
        trail.splice(trail.length - 2, 1);
      }
    }
    if (trail.length > 3) trail.shift();
  }

  function beginPaint(point: Point, erase: boolean, lineFromLast: boolean) {
    const base = settle();
    const layer = paintableLayer(base);
    if (!layer) return;
    const surface = createSurface({ width, height, data: layer.data }, base.selection, options.symmetry);
    const session: Extract<Session, { kind: 'paint' }> = {
      kind: 'paint',
      base,
      layerId: layer.id,
      surface,
      color: erase ? null : props.primary,
      size: options.brushSize,
      last: point,
      trail: [],
      pixelPerfect: options.pixelPerfect && options.brushSize === 1,
    };
    const from = lineFromLast && lastPaint.current?.layerId === layer.id ? lastPaint.current.point : null;
    if (from) for (const step of linePoints(from.x, from.y, point.x, point.y)) paintStep(session, step);
    else paintStep(session, point);
    startSession(session);
    scheduleDraw();
  }

  function drawShape(session: Extract<Session, { kind: 'shape' }>) {
    const { surface } = session;
    restoreRect(surface, session.previous);
    const size = options.brushSize;
    const end =
      session.constrain && session.shape === 'line'
        ? constrainAngle(session.start, session.end)
        : session.constrain
          ? constrainSquare(session.start, session.end)
          : session.end;
    let points: Point[];
    let footprint = 1;
    if (session.shape === 'line') {
      points = linePoints(session.start.x, session.start.y, end.x, end.y);
      footprint = size;
      for (const point of points) stamp(surface, point.x, point.y, size, props.primary);
    } else if (session.shape === 'rectangle') {
      points = rectanglePoints(rectFromPoints(session.start, end), options.filled, size);
      for (const point of points) plot(surface, point.x, point.y, props.primary);
    } else {
      points = ellipsePoints(rectFromPoints(session.start, end), options.filled);
      if (options.filled) {
        for (const point of points) plot(surface, point.x, point.y, props.primary);
      } else {
        footprint = size;
        for (const point of points) stamp(surface, point.x, point.y, size, props.primary);
      }
    }
    session.previous = paintedBounds(points, footprint, surface);
  }

  function beginShape(point: Point, shape: 'line' | 'rectangle' | 'ellipse', constrain: boolean) {
    const base = settle();
    const layer = paintableLayer(base);
    if (!layer) return;
    const session: Extract<Session, { kind: 'shape' }> = {
      kind: 'shape',
      base,
      layerId: layer.id,
      surface: createSurface({ width, height, data: layer.data }, base.selection, options.symmetry),
      shape,
      start: point,
      end: point,
      constrain,
      previous: null,
    };
    drawShape(session);
    startSession(session);
    scheduleDraw();
  }

  function fill(point: Point) {
    if (!inImage(point)) return;
    const base = settle();
    const layer = paintableLayer(base);
    if (!layer) return;
    const bitmap = { width, height, data: layer.data };
    const surface = createSurface(bitmap, base.selection, options.symmetry);
    for (const seed of mirrored(surface, point.x, point.y)) {
      fillMask(surface, floodMask(bitmap, seed.x, seed.y, options.tolerance, options.contiguous), props.primary);
    }
    if (sameData(surface.data, layer.data)) return;
    props.onCommit(withLayerData(base, layer.id, surface.data));
    props.onColorUsed(props.primary);
  }

  function wand(point: Point, mode: SelectionMode) {
    if (!inImage(point)) return;
    const base = settle();
    const layer = activeLayer(base);
    const area = floodMask({ width, height, data: layer.data }, point.x, point.y, options.tolerance, options.contiguous);
    const selection = combineMasks(base.selection, area, mode);
    props.onCommit({ ...base, selection: selection.some(Boolean) ? selection : null });
  }

  /** Déplacer : le contenu flottant, sinon la sélection détachée du calque, sinon tout le calque. */
  function beginMove(point: Point, copy: boolean) {
    if (state.floating) {
      const floating = state.floating;
      startSession({ kind: 'move', base: state, floating, start: point, origin: { x: floating.x, y: floating.y }, moved: false });
      return;
    }
    const layer = paintableLayer(state);
    if (!layer) return;
    if (state.selection) {
      const lifted = lift({ width, height, data: layer.data }, state.selection);
      if (!lifted) return;
      const floating: FloatingLayer = { ...lifted.floating, layerId: layer.id };
      const base: PixelState = { ...(copy ? state : withLayerData(state, layer.id, lifted.layer)), floating, selection: null };
      startSession({ kind: 'move', base, floating, start: point, origin: { x: floating.x, y: floating.y }, moved: false });
      return;
    }
    startSession({ kind: 'shift', base: state, layerId: layer.id, data: layer.data, start: point, offset: { x: 0, y: 0 } });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (sessionRef.current) return;
    const local = localPoint(event);
    // Défilement : clic molette, ou Espace + glisser.
    if (event.button === 1 || (event.button === 0 && spaceRef.current)) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      startSession({ kind: 'pan', start: local, origin: { ...viewRef.current } });
      return;
    }
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = imagePoint(local);

    if (event.altKey && PAINT_TOOLS.has(tool)) {
      const color = sample(point);
      if (color) props.onPickColor(color, 'primary');
      startSession({ kind: 'pick', target: 'primary' });
      return;
    }
    switch (tool) {
      case 'eyedropper': {
        const target = event.shiftKey ? 'secondary' : 'primary';
        const color = sample(point);
        if (color) props.onPickColor(color, target);
        startSession({ kind: 'pick', target });
        return;
      }
      case 'pencil':
      case 'eraser':
        beginPaint(point, tool === 'eraser', event.shiftKey);
        return;
      case 'bucket':
        fill(point);
        return;
      case 'line':
      case 'rectangle':
      case 'ellipse':
        beginShape(point, tool, event.shiftKey);
        return;
      case 'marquee':
      case 'lasso': {
        if (!event.shiftKey && !event.altKey && insideSelection(point)) {
          beginMove(point, event.ctrlKey || event.metaKey);
          return;
        }
        const base = settle();
        const mode = selectionMode(event);
        if (tool === 'marquee') startSession({ kind: 'marquee', base, start: point, end: point, mode, moved: false });
        else startSession({ kind: 'lasso', base, points: [clampPoint(point)], mode });
        scheduleDraw();
        return;
      }
      case 'wand':
        wand(point, selectionMode(event));
        return;
      case 'move':
        beginMove(point, event.ctrlKey || event.metaKey);
        return;
    }
  }

  function updateHover(point: Point | null) {
    const previous = hoverRef.current;
    if (previous?.x === point?.x && previous?.y === point?.y) return;
    hoverRef.current = point;
    const color = point ? sample(point) : null;
    setReadout(point && color ? { pixel: point, color } : null);
    scheduleDraw();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    pointerInside.current = true;
    const local = localPoint(event);
    const point = imagePoint(local);
    const session = sessionRef.current;
    if (session?.kind === 'pan') {
      applyView({ ...session.origin, x: session.origin.x + local.x - session.start.x, y: session.origin.y + local.y - session.start.y });
      return;
    }
    updateHover(inImage(point) ? point : null);
    if (!session) return;
    switch (session.kind) {
      case 'pick': {
        const color = sample(point);
        if (color) props.onPickColor(color, session.target);
        return;
      }
      case 'paint': {
        if (point.x === session.last.x && point.y === session.last.y) return;
        for (const step of linePoints(session.last.x, session.last.y, point.x, point.y).slice(1)) paintStep(session, step);
        session.last = point;
        scheduleDraw();
        return;
      }
      case 'shape': {
        if (point.x === session.end.x && point.y === session.end.y && session.constrain === event.shiftKey) return;
        session.end = point;
        session.constrain = event.shiftKey;
        drawShape(session);
        scheduleDraw();
        return;
      }
      case 'marquee':
        if (point.x !== session.end.x || point.y !== session.end.y) {
          session.end = point;
          session.moved = true;
          scheduleDraw();
        }
        return;
      case 'lasso': {
        const clamped = clampPoint(point);
        const last = session.points[session.points.length - 1];
        if (last.x !== clamped.x || last.y !== clamped.y) {
          session.points.push(clamped);
          scheduleDraw();
        }
        return;
      }
      case 'move': {
        const dx = point.x - session.start.x;
        const dy = point.y - session.start.y;
        if (dx === session.floating.x - session.origin.x && dy === session.floating.y - session.origin.y) return;
        session.floating = { ...session.floating, x: session.origin.x + dx, y: session.origin.y + dy };
        session.moved = true;
        scheduleDraw();
        return;
      }
      case 'shift': {
        const offset = { x: point.x - session.start.x, y: point.y - session.start.y };
        if (offset.x === session.offset.x && offset.y === session.offset.y) return;
        const layer = session.base.layers.find((candidate) => candidate.id === session.layerId);
        if (!layer) return;
        session.offset = offset;
        session.data = resizeCanvasData({ width, height, data: layer.data }, width, height, offset);
        scheduleDraw();
        return;
      }
    }
  }

  function handlePointerUp() {
    const session = sessionRef.current;
    if (!session) return;
    startSession(null);
    switch (session.kind) {
      case 'paint':
      case 'shape': {
        const layer = session.base.layers.find((candidate) => candidate.id === session.layerId);
        if (layer && !sameData(layer.data, session.surface.data)) {
          props.onCommit(withLayerData(session.base, session.layerId, session.surface.data));
          if (session.kind === 'shape' || session.color) props.onColorUsed(props.primary);
        }
        if (session.kind === 'paint') lastPaint.current = { layerId: session.layerId, point: session.last };
        break;
      }
      case 'marquee': {
        const { base } = session;
        if (!session.moved && session.mode === 'replace') {
          if (base.selection) props.onCommit({ ...base, selection: null });
          break;
        }
        const rect = rectFromPoints(clampPoint(session.start), clampPoint(session.end));
        const selection = combineMasks(base.selection, rectMask(width, height, rect), session.mode);
        props.onCommit({ ...base, selection: selection.some(Boolean) ? selection : null });
        break;
      }
      case 'lasso': {
        const { base } = session;
        if (session.points.length < 2 && session.mode === 'replace') {
          if (base.selection) props.onCommit({ ...base, selection: null });
          break;
        }
        const selection = combineMasks(base.selection, polygonMask(width, height, session.points), session.mode);
        props.onCommit({ ...base, selection: selection.some(Boolean) ? selection : null });
        break;
      }
      case 'move':
        if (session.moved) props.onCommit({ ...session.base, floating: session.floating, contentVersion: nextVersion() });
        break;
      case 'shift':
        if (session.offset.x !== 0 || session.offset.y !== 0) props.onCommit(withLayerData(session.base, session.layerId, session.data));
        break;
      default:
        break;
    }
    scheduleDraw();
  }

  function cancelSession() {
    if (!sessionRef.current) return;
    startSession(null);
    scheduleDraw();
  }

  // Pendant un geste : Échap l’annule, Ctrl+Z attend la fin du geste.
  const handleSessionKey = useEffectEvent((event: KeyboardEvent) => {
    if (!sessionRef.current) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelSession();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.code === 'KeyZ' || event.code === 'KeyY')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  });
  useEffect(() => {
    if (!sessionKind) return;
    const listener = (event: KeyboardEvent) => handleSessionKey(event);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [sessionKind]);

  // Espace maintenu au-dessus de la toile : mode « main » pour faire défiler.
  const handleSpaceKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.code !== 'Space') return;
    if (event.type === 'keyup') {
      spaceRef.current = false;
      setSpaceHeld(false);
      return;
    }
    if (!props.active || isEditableTarget(event.target)) return;
    if (!pointerInside.current && sessionRef.current?.kind !== 'pan') return;
    event.preventDefault();
    if (!spaceRef.current) {
      spaceRef.current = true;
      setSpaceHeld(true);
      scheduleDraw();
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleSpaceKey(event);
    const release = () => {
      spaceRef.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener('keydown', listener);
    window.addEventListener('keyup', listener);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', listener);
      window.removeEventListener('keyup', listener);
      window.removeEventListener('blur', release);
    };
  }, []);

  // Molette : Ctrl = zoom sur le pointeur ; sinon défilement (Maj : horizontal).
  const handleWheel = useEffectEvent((event: WheelEvent) => {
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    if (event.ctrlKey || event.metaKey) {
      const delta = event.deltaY * scale;
      if (Math.sign(delta) !== Math.sign(wheelRef.current)) wheelRef.current = 0;
      wheelRef.current += delta;
      if (Math.abs(wheelRef.current) < WHEEL_STEP) return;
      const direction = wheelRef.current < 0 ? 1 : -1;
      wheelRef.current = 0;
      const current = viewRef.current.zoom;
      const next = direction > 0 ? ZOOM_LEVELS.find((level) => level > current) : ZOOM_LEVELS.findLast((level) => level < current);
      if (next) zoomAt(next, localPoint(event));
      return;
    }
    const view = viewRef.current;
    const dx = (event.shiftKey ? event.deltaY : event.deltaX) * scale;
    const dy = (event.shiftKey ? 0 : event.deltaY) * scale;
    applyView({ ...view, x: view.x - dx, y: view.y - dy });
  });
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const listener = (event: WheelEvent) => handleWheel(event);
    node.addEventListener('wheel', listener, { passive: false });
    return () => node.removeEventListener('wheel', listener);
  }, []);

  /* ---------- Rendu ---------- */

  const view = viewRef.current;
  let cursor = 'crosshair';
  if (sessionKind === 'pan') cursor = 'grabbing';
  else if (spaceHeld) cursor = 'grab';
  else if (tool === 'move' || sessionKind === 'move') cursor = 'move';

  const selectionBounds = state.floating
    ? { x: state.floating.x, y: state.floating.y, width: state.floating.bitmap.width, height: state.floating.bitmap.height }
    : state.selection
      ? maskBounds(state.selection, width)
      : null;

  return (
    <div className="pixel-stage" ref={stageRef}>
      <canvas
        ref={canvasRef}
        className="pixel-canvas"
        style={{ cursor }}
        aria-label={`Toile de ${width} × ${height} pixels`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={cancelSession}
        onPointerEnter={() => {
          pointerInside.current = true;
        }}
        onPointerLeave={() => {
          pointerInside.current = false;
          if (!sessionRef.current) updateHover(null);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          if (sessionRef.current) return;
          const point = imagePoint(localPoint(event));
          props.onContextMenu(event, inImage(point) ? point : null);
        }}
        // Empêche le défilement automatique du clic molette sous Windows.
        onMouseDown={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
      />
      <div className="pixel-readout" aria-live="off">
        <span>
          {width} × {height} px
        </span>
        <span>×{view.zoom}</span>
        {readout && (
          <span>
            {readout.pixel.x}, {readout.pixel.y}
            <span className="pixel-readout-swatch" style={{ background: toHex(readout.color, true) }} />
            <span className="mono">{readout.color.a === 0 ? 'transparent' : toHex(readout.color)}</span>
          </span>
        )}
        {selectionBounds && (
          <span>
            sélection {selectionBounds.width} × {selectionBounds.height}
          </span>
        )}
      </div>
    </div>
  );
}
