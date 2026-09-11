import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { isAdditiveClick } from '../lib/shortcuts';
import { intersects, rectBetween, unionRect } from '../model/arrange';
import { fillChecker } from './canvasUtils';
import {
  HANDLE_CURSORS,
  RESIZE_HANDLES,
  clamp,
  handlePosition,
  rectContains,
  rectFromPixels,
  resizeRect,
  sameRect,
} from './geometry';
import type { Point, Rect, ResizeHandle } from './geometry';
import type { AssetDefinition } from './model';
import { CANVAS_PAD, GRID_MIN_ZOOM } from './presets';
import type { AssetTool } from './presets';

/** Marge autour de l’asset, en pixels écran (poignées et sélection restent visibles au bord). */
const PAD = CANVAS_PAD;
const HANDLE_SIZE = 7;
/** Or de sélection et cerne sombre (jetons Deepslate). */
const SELECTION_COLOR = '#f2c94c';
const SELECTION_EDGE = '#0b0b0e';
const HANDLE_HIT = 6;
/** Distance (px écran) à parcourir avant qu’un clic sur une zone vide trace un rectangle. */
const MARQUEE_THRESHOLD = 3;

export interface ElementPosition {
  id: string;
  x: number;
  y: number;
}

interface AssetCanvasProps {
  asset: AssetDefinition;
  /** Rendu de l’asset à l’échelle 1 (avec repères pour les textures manquantes). */
  preview: HTMLCanvasElement;
  /** Rectangle de chaque élément, en pixels d’asset. */
  bounds: ReadonlyMap<string, Rect>;
  zoom: number;
  showGrid: boolean;
  tool: AssetTool;
  /** Éléments sélectionnés, dans l’ordre du fichier. */
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  /** Sélection étendue aux groupes : un membre entraîne tout son groupe. */
  expand: (ids: string[]) => string[];
  /** Début d’un déplacement ou d’un redimensionnement (une entrée d’historique). */
  onBeginEdit: () => void;
  /** Positions pendant un déplacement de la sélection (précédé d’`onBeginEdit`). */
  onMoveElements: (positions: ElementPosition[]) => void;
  onResizeBox: (id: string, rect: Rect) => void;
  /** `clicked` : simple clic sans glisser (la box prend la taille du préréglage). */
  onCreateBox: (rect: Rect, clicked: boolean) => void;
  onCreateText: (pixel: Point) => void;
  onPlaceImage: (pixel: Point) => void;
  /** Clic droit : l’élément visé (sa sélection est prise s’il n’y était pas), ou `null` sur une zone vide. */
  onContextMenu?: (id: string | null, event: ReactMouseEvent<HTMLCanvasElement>) => void;
}

type DragState =
  | { kind: 'move'; start: Point; origins: ElementPosition[]; moved: boolean; narrowTo: string[] | null }
  | { kind: 'resize'; id: string; handle: ResizeHandle; origin: Rect; last: Rect; started: boolean };

interface Marquee {
  start: Point;
  end: Point;
  /** Maj ou Ctrl : ajoute à la sélection de départ (`base`). */
  additive: boolean;
  base: string[];
  moved: boolean;
}

export function AssetCanvas(props: AssetCanvasProps) {
  const { asset, preview, bounds, zoom, showGrid, tool, selectedIds } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [draft, setDraft] = useState<{ start: Point; end: Point } | null>(null);
  const [marquee, setMarqueeState] = useState<Marquee | null>(null);
  const marqueeRef = useRef<Marquee | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [cursor, setCursor] = useState('default');

  const { width, height } = asset.size;
  const viewWidth = width * zoom + PAD * 2;
  const viewHeight = height * zoom + PAD * 2;
  const selected = asset.elements.filter((element) => selectedIds.includes(element.id));
  const selectedRects = selected.map((element) => bounds.get(element.id)).filter((rect): rect is Rect => rect !== undefined);
  const single = selected.length === 1 ? selected[0] : null;
  const singleRect = single ? (bounds.get(single.id) ?? null) : null;
  const resizable = tool === 'select' && single?.type === 'box' && !single.locked;

  function setMarquee(next: Marquee | null) {
    marqueeRef.current = next;
    setMarqueeState(next);
  }

  /** Éléments que la souris atteint : ni masqués, ni verrouillés. */
  const reachable = asset.elements.filter((element) => !element.hidden && !element.locked);

  function marqueeHits(area: Rect): string[] {
    const hits = reachable
      .filter((element) => {
        const rect = bounds.get(element.id);
        return rect !== undefined && intersects(rect, area);
      })
      .map((element) => element.id);
    return props.expand(hits);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.width = viewWidth;
    canvas.height = viewHeight;
    ctx.imageSmoothingEnabled = false;
    const assetWidth = width * zoom;
    const assetHeight = height * zoom;
    const toScreen = (rect: Rect) => ({
      x: PAD + rect.x * zoom,
      y: PAD + rect.y * zoom,
      width: rect.width * zoom,
      height: rect.height * zoom,
    });

    fillChecker(ctx, PAD, PAD, assetWidth, assetHeight, 8);
    ctx.drawImage(preview, 0, 0, preview.width, preview.height, PAD, PAD, preview.width * zoom, preview.height * zoom);

    if (showGrid && zoom >= GRID_MIN_ZOOM) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      for (let column = 1; column < width; column++) ctx.fillRect(PAD + column * zoom, PAD, 1, assetHeight);
      for (let row = 1; row < height; row++) ctx.fillRect(PAD, PAD + row * zoom, assetWidth, 1);
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD - 0.5, PAD - 0.5, assetWidth + 1, assetHeight + 1);

    if (tool !== 'select' && hover && !draft && zoom >= 3) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.strokeRect(PAD + hover.x * zoom + 0.5, PAD + hover.y * zoom + 0.5, zoom - 1, zoom - 1);
    }

    // Tracé en cours et sélection : l’or Deepslate, cerné de noir pour rester lisible sur tout fond.
    if (draft) {
      const rect = toScreen(rectFromPixels(draft.start, draft.end));
      ctx.fillStyle = 'rgba(242, 201, 76, 0.22)';
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
      ctx.lineWidth = 1;
    }

    const frame = (rect: Rect) => {
      const screen = toScreen(rect);
      ctx.save();
      ctx.lineWidth = 4;
      ctx.strokeStyle = SELECTION_EDGE;
      ctx.strokeRect(screen.x - 2, screen.y - 2, screen.width + 4, screen.height + 4);
      ctx.lineWidth = 2;
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.strokeRect(screen.x - 2, screen.y - 2, screen.width + 4, screen.height + 4);
      ctx.restore();
    };

    // Rectangle de sélection : les éléments qu’il touche sont surlignés avant le relâchement.
    if (marquee?.moved) {
      const area = rectBetween(marquee.start, marquee.end);
      ctx.save();
      ctx.strokeStyle = 'rgba(242, 201, 76, 0.6)';
      ctx.lineWidth = 1;
      for (const id of marqueeHits(area)) {
        const rect = bounds.get(id);
        if (rect) {
          const screen = toScreen(rect);
          ctx.strokeRect(screen.x - 1.5, screen.y - 1.5, screen.width + 3, screen.height + 3);
        }
      }
      const screen = toScreen(area);
      ctx.fillStyle = 'rgba(242, 201, 76, 0.16)';
      ctx.fillRect(screen.x, screen.y, screen.width, screen.height);
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.strokeRect(screen.x + 0.5, screen.y + 0.5, screen.width - 1, screen.height - 1);
      ctx.restore();
    }

    for (const rect of selectedRects) frame(rect);
    if (selectedRects.length > 1) {
      const screen = toScreen(unionRect(selectedRects));
      ctx.save();
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(screen.x - 6.5, screen.y - 6.5, screen.width + 13, screen.height + 13);
      ctx.restore();
    }
    if (resizable && singleRect) {
      // Poignée : carré d’or à bord noir de 2 px, comme les boutons.
      const outer = HANDLE_SIZE + 3;
      for (const handle of RESIZE_HANDLES) {
        const position = handlePosition(singleRect, handle);
        const x = Math.round(PAD + position.x * zoom) - outer / 2;
        const y = Math.round(PAD + position.y * zoom) - outer / 2;
        ctx.fillStyle = SELECTION_EDGE;
        ctx.fillRect(x, y, outer, outer);
        ctx.fillStyle = SELECTION_COLOR;
        ctx.fillRect(x + 2, y + 2, outer - 4, outer - 4);
      }
    }
  });

  /** Position de la souris en pixels d’asset (fractionnaire). */
  function toAsset(event: ReactPointerEvent<HTMLCanvasElement> | ReactMouseEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left - PAD) / zoom, y: (event.clientY - rect.top - PAD) / zoom };
  }

  const toPixel = (point: Point): Point => ({ x: Math.floor(point.x), y: Math.floor(point.y) });
  const clampPixel = (pixel: Point): Point => ({
    x: clamp(pixel.x, 0, width - 1),
    y: clamp(pixel.y, 0, height - 1),
  });

  function handleAt(point: Point): ResizeHandle | null {
    if (!resizable || !singleRect) return null;
    for (const handle of RESIZE_HANDLES) {
      const position = handlePosition(singleRect, handle);
      if (Math.abs((point.x - position.x) * zoom) <= HANDLE_HIT && Math.abs((point.y - position.y) * zoom) <= HANDLE_HIT) {
        return handle;
      }
    }
    return null;
  }

  /** Élément atteignable le plus haut sous le point. */
  function hitTest(point: Point): string | null {
    for (let index = asset.elements.length - 1; index >= 0; index--) {
      const element = asset.elements[index];
      if (element.hidden || element.locked) continue;
      const rect = bounds.get(element.id);
      if (rect && rectContains(rect, point.x, point.y)) return element.id;
    }
    return null;
  }

  function startMove(ids: string[], start: Point, narrowTo: string[] | null) {
    const origins = asset.elements
      .filter((element) => ids.includes(element.id) && !element.locked)
      .map((element) => ({ id: element.id, x: element.x, y: element.y }));
    if (origins.length > 0) dragRef.current = { kind: 'move', start, origins, moved: false, narrowTo };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return;
    const point = toAsset(event);
    const pixel = clampPixel(toPixel(point));
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === 'box') {
      setDraft({ start: pixel, end: pixel });
      return;
    }
    if (tool === 'text') {
      props.onCreateText(pixel);
      return;
    }
    if (tool === 'image') {
      props.onPlaceImage(pixel);
      return;
    }

    const handle = handleAt(point);
    if (handle && single && singleRect) {
      dragRef.current = { kind: 'resize', id: single.id, handle, origin: singleRect, last: singleRect, started: false };
      return;
    }
    const hit = hitTest(point);
    // Maj ou Ctrl + clic : ajoute l’élément (et son groupe) à la sélection, ou l’en retire.
    if (isAdditiveClick(event)) {
      if (!hit) {
        setMarquee({ start: point, end: point, additive: true, base: selectedIds, moved: false });
        return;
      }
      const group = props.expand([hit]);
      const already = group.every((id) => selectedIds.includes(id));
      const next = already
        ? selectedIds.filter((id) => !group.includes(id))
        : [...selectedIds, ...group.filter((id) => !selectedIds.includes(id))];
      props.onSelect(next);
      if (!already) startMove(next, point, null);
      return;
    }
    if (!hit) {
      if (selectedIds.length > 0) props.onSelect([]);
      setMarquee({ start: point, end: point, additive: false, base: [], moved: false });
      return;
    }
    if (selectedIds.includes(hit)) {
      startMove(selectedIds, point, selectedIds.length > 1 ? props.expand([hit]) : null);
      return;
    }
    const ids = props.expand([hit]);
    props.onSelect(ids);
    startMove(ids, point, null);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = toAsset(event);
    const pixel = toPixel(point);
    const inside = pixel.x >= 0 && pixel.y >= 0 && pixel.x < width && pixel.y < height;
    if (!inside) {
      if (hover) setHover(null);
    } else if (!hover || hover.x !== pixel.x || hover.y !== pixel.y) {
      setHover(pixel);
    }

    if (draft) {
      const end = clampPixel(pixel);
      if (end.x !== draft.end.x || end.y !== draft.end.y) setDraft({ start: draft.start, end });
      return;
    }

    const current = marqueeRef.current;
    if (current) {
      const moved =
        current.moved || Math.hypot(point.x - current.start.x, point.y - current.start.y) * zoom >= MARQUEE_THRESHOLD;
      if (moved) setMarquee({ ...current, end: point, moved });
      return;
    }

    const drag = dragRef.current;
    if (drag?.kind === 'move') {
      const dx = Math.round(point.x - drag.start.x);
      const dy = Math.round(point.y - drag.start.y);
      if (!drag.moved && dx === 0 && dy === 0) return;
      if (!drag.moved) {
        drag.moved = true;
        props.onBeginEdit();
      }
      props.onMoveElements(drag.origins.map((origin) => ({ id: origin.id, x: origin.x + dx, y: origin.y + dy })));
      return;
    }
    if (drag?.kind === 'resize') {
      const next = resizeRect(drag.origin, drag.handle, point);
      if (sameRect(next, drag.last)) return;
      if (!drag.started) {
        drag.started = true;
        props.onBeginEdit();
      }
      drag.last = next;
      props.onResizeBox(drag.id, next);
      return;
    }

    if (tool !== 'select') return;
    const handle = handleAt(point);
    const nextCursor = handle ? HANDLE_CURSORS[handle] : hitTest(point) ? 'move' : 'default';
    if (nextCursor !== cursor) setCursor(nextCursor);
  }

  function handlePointerUp() {
    if (draft) {
      const clicked = draft.start.x === draft.end.x && draft.start.y === draft.end.y;
      props.onCreateBox(rectFromPixels(draft.start, draft.end), clicked);
      setDraft(null);
    }
    const current = marqueeRef.current;
    if (current) {
      setMarquee(null);
      if (current.moved) {
        const hits = marqueeHits(rectBetween(current.start, current.end));
        props.onSelect(current.additive ? [...current.base, ...hits.filter((id) => !current.base.includes(id))] : hits);
      }
    }
    const drag = dragRef.current;
    dragRef.current = null;
    // Clic sans glisser sur un élément d’une sélection multiple : lui seul (et son groupe) reste sélectionné.
    if (drag?.kind === 'move' && !drag.moved && drag.narrowTo) props.onSelect(drag.narrowTo);
  }

  function handlePointerCancel() {
    setDraft(null);
    setMarquee(null);
    dragRef.current = null;
  }

  const selectionRect = selectedRects.length > 0 ? unionRect(selectedRects) : null;
  const readout = [
    `${width} × ${height} px`,
    hover ? `curseur ${hover.x}, ${hover.y}` : null,
    selectionRect
      ? `sélection${selectedRects.length > 1 ? ` (${selectedRects.length})` : ''} ${selectionRect.x}, ${selectionRect.y} · ${selectionRect.width} × ${selectionRect.height}`
      : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <div className="asset-canvas-frame">
      <canvas
        ref={canvasRef}
        className="asset-canvas"
        style={{ width: viewWidth, height: viewHeight, cursor: tool === 'select' ? (marquee ? 'crosshair' : cursor) : 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={(event) => {
          // Double-clic : un seul élément, même s’il fait partie d’un groupe.
          if (tool !== 'select') return;
          const hit = hitTest(toAsset(event));
          if (hit) props.onSelect([hit]);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          if (!props.onContextMenu) return;
          const hit = hitTest(toAsset(event));
          if (hit && !selectedIds.includes(hit)) props.onSelect(props.expand([hit]));
          props.onContextMenu(hit, event);
        }}
      />
      <div className="asset-coords">{readout}</div>
    </div>
  );
}
