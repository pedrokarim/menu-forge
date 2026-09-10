import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
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
import { GRID_MIN_ZOOM } from './presets';
import type { AssetTool } from './presets';

/** Marge autour de l’asset, en pixels écran (poignées et sélection restent visibles au bord). */
const PAD = 24;
const HANDLE_SIZE = 7;
/** Or de sélection et cerne sombre (jetons Deepslate). */
const SELECTION_COLOR = '#f2c94c';
const SELECTION_EDGE = '#0b0b0e';
const HANDLE_HIT = 6;

interface AssetCanvasProps {
  asset: AssetDefinition;
  /** Rendu de l’asset à l’échelle 1 (avec repères pour les textures manquantes). */
  preview: HTMLCanvasElement;
  /** Rectangle de chaque élément, en pixels d’asset. */
  bounds: ReadonlyMap<string, Rect>;
  zoom: number;
  showGrid: boolean;
  tool: AssetTool;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Début d’un déplacement ou d’un redimensionnement (une entrée d’historique). */
  onBeginEdit: () => void;
  onMoveElement: (id: string, x: number, y: number) => void;
  onResizeBox: (id: string, rect: Rect) => void;
  /** `clicked` : simple clic sans glisser (la box prend la taille du préréglage). */
  onCreateBox: (rect: Rect, clicked: boolean) => void;
  onCreateText: (pixel: Point) => void;
  onPlaceImage: (pixel: Point) => void;
}

type DragState =
  | { kind: 'move'; id: string; start: Point; origin: Point; moved: boolean }
  | { kind: 'resize'; id: string; handle: ResizeHandle; origin: Rect; last: Rect; started: boolean };

export function AssetCanvas(props: AssetCanvasProps) {
  const { asset, preview, bounds, zoom, showGrid, tool, selectedId } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [draft, setDraft] = useState<{ start: Point; end: Point } | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [cursor, setCursor] = useState('default');

  const { width, height } = asset.size;
  const viewWidth = width * zoom + PAD * 2;
  const viewHeight = height * zoom + PAD * 2;
  const selected = asset.elements.find((element) => element.id === selectedId) ?? null;
  const selectedRect = selected ? (bounds.get(selected.id) ?? null) : null;
  const resizable = tool === 'select' && selected?.type === 'box';

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

    if (selectedRect) {
      const rect = toScreen(selectedRect);
      ctx.save();
      ctx.lineWidth = 4;
      ctx.strokeStyle = SELECTION_EDGE;
      ctx.strokeRect(rect.x - 2, rect.y - 2, rect.width + 4, rect.height + 4);
      ctx.lineWidth = 2;
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.strokeRect(rect.x - 2, rect.y - 2, rect.width + 4, rect.height + 4);
      ctx.restore();
      if (resizable) {
        // Poignée : carré d’or à bord noir de 2 px, comme les boutons.
        const outer = HANDLE_SIZE + 3;
        for (const handle of RESIZE_HANDLES) {
          const position = handlePosition(selectedRect, handle);
          const x = Math.round(PAD + position.x * zoom) - outer / 2;
          const y = Math.round(PAD + position.y * zoom) - outer / 2;
          ctx.fillStyle = SELECTION_EDGE;
          ctx.fillRect(x, y, outer, outer);
          ctx.fillStyle = SELECTION_COLOR;
          ctx.fillRect(x + 2, y + 2, outer - 4, outer - 4);
        }
      }
    }
  });

  /** Position de la souris en pixels d’asset (fractionnaire). */
  function toAsset(event: ReactPointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left - PAD) / zoom, y: (event.clientY - rect.top - PAD) / zoom };
  }

  const toPixel = (point: Point): Point => ({ x: Math.floor(point.x), y: Math.floor(point.y) });
  const clampPixel = (pixel: Point): Point => ({
    x: clamp(pixel.x, 0, width - 1),
    y: clamp(pixel.y, 0, height - 1),
  });

  function handleAt(point: Point): ResizeHandle | null {
    if (!resizable || !selectedRect) return null;
    for (const handle of RESIZE_HANDLES) {
      const position = handlePosition(selectedRect, handle);
      if (Math.abs((point.x - position.x) * zoom) <= HANDLE_HIT && Math.abs((point.y - position.y) * zoom) <= HANDLE_HIT) {
        return handle;
      }
    }
    return null;
  }

  /** Élément visible le plus haut sous le point. */
  function hitTest(point: Point): string | null {
    for (let index = asset.elements.length - 1; index >= 0; index--) {
      const element = asset.elements[index];
      if (element.hidden) continue;
      const rect = bounds.get(element.id);
      if (rect && rectContains(rect, point.x, point.y)) return element.id;
    }
    return null;
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
    if (handle && selected && selectedRect) {
      dragRef.current = { kind: 'resize', id: selected.id, handle, origin: selectedRect, last: selectedRect, started: false };
      return;
    }
    const hit = hitTest(point);
    props.onSelect(hit);
    const element = hit ? asset.elements.find((candidate) => candidate.id === hit) : undefined;
    if (element) {
      dragRef.current = { kind: 'move', id: element.id, start: point, origin: { x: element.x, y: element.y }, moved: false };
    }
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

    const drag = dragRef.current;
    if (drag?.kind === 'move') {
      const dx = Math.round(point.x - drag.start.x);
      const dy = Math.round(point.y - drag.start.y);
      if (!drag.moved && dx === 0 && dy === 0) return;
      if (!drag.moved) {
        drag.moved = true;
        props.onBeginEdit();
      }
      props.onMoveElement(drag.id, drag.origin.x + dx, drag.origin.y + dy);
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
    dragRef.current = null;
  }

  function handlePointerCancel() {
    setDraft(null);
    dragRef.current = null;
  }

  const readout = [
    `${width} × ${height} px`,
    hover ? `curseur ${hover.x}, ${hover.y}` : null,
    selectedRect ? `sélection ${selectedRect.x}, ${selectedRect.y} · ${selectedRect.width} × ${selectedRect.height}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <div className="asset-canvas-frame">
      <canvas
        ref={canvasRef}
        className="asset-canvas"
        style={{ width: viewWidth, height: viewHeight, cursor: tool === 'select' ? cursor : 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={() => setHover(null)}
      />
      <div className="asset-coords">{readout}</div>
    </div>
  );
}
