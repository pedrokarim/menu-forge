import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { alphaAt } from '../lib/textures';
import type { TextureMap } from '../lib/textures';
import { evaluateCondition } from '../model/conditions';
import { TEXT_HEIGHT, alignedStart, charAdvance, textWidth } from '../model/fontMetrics';
import { drawPanelStyle } from '../model/generator';
import {
  GRID_COLUMNS,
  SLOT_SIZE,
  WINDOW_WIDTH,
  areaFromCells,
  areaRect,
  chestCell,
  chestCellAt,
  playerCell,
  rectContains,
  windowHeight,
} from '../model/geometry';
import type { GridCell, Point, Rect } from '../model/geometry';
import type { MenuDefinition, SlotArea, TextElement } from '../model/menu';
import type { PreviewContext } from '../model/preview';
import { interpolate } from '../model/preview';
import { elementKey } from '../model/resolve';
import type { Selection } from '../state/editor';
import { SLOT_COLORS } from './slotColors';

export type CanvasTool = 'select' | 'slot';
export type BackgroundMode = 'slots-only' | 'vanilla' | 'none';

/** Marges autour de la fenêtre, pour voir ce qui déborde (barre d’onglets flottante…). */
const MARGIN_X = 40;
const MARGIN_TOP = 48;
const MARGIN_BOTTOM = 16;

interface MenuCanvasProps {
  /** Menu résolu (gabarits inclus). */
  menu: MenuDefinition;
  inherited: ReadonlySet<string>;
  context: PreviewContext;
  textures: TextureMap;
  zoom: number;
  tool: CanvasTool;
  background: BackgroundMode;
  showSlots: boolean;
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  onBeginMove: () => void;
  onMove: (selection: Selection, x: number, y: number) => void;
  onCreateSlot: (area: SlotArea) => void;
}

interface DragState {
  selection: Selection;
  start: Point;
  origin: Point;
  moved: boolean;
}

function withAlpha(hex: string, alpha: number): string {
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

function textRect(text: TextElement, context: PreviewContext): Rect {
  const width = textWidth(interpolate(text.value, context.variables));
  return { x: alignedStart(text.x, width, text.align), y: text.y, width: Math.max(width, 2), height: TEXT_HEIGHT };
}

/** Fond de la fenêtre : cases seules (pack « cases seules »), coffre vanilla, ou rien. */
function drawWindow(ctx: CanvasRenderingContext2D, rows: number, mode: BackgroundMode) {
  const height = windowHeight(rows);
  if (mode === 'vanilla') drawPanelStyle(ctx, 'panel', 0, 0, WINDOW_WIDTH, height, '#c6c6c6');
  if (mode !== 'none') {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < GRID_COLUMNS; col++) {
        const cell = chestCell(col, row);
        drawPanelStyle(ctx, 'cell', cell.x, cell.y, SLOT_SIZE, SLOT_SIZE, '#8b8b8b');
      }
    }
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < GRID_COLUMNS; col++) {
        const cell = playerCell(col, row, rows);
        drawPanelStyle(ctx, 'cell', cell.x, cell.y, SLOT_SIZE, SLOT_SIZE, '#8b8b8b');
      }
    }
  }
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 2]);
  ctx.strokeRect(0, 0, WINDOW_WIDTH, height);
  ctx.restore();
}

/** Texte au pas de la police vanilla : chaque caractère occupe son avance réelle. */
function drawText(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${TEXT_HEIGHT}px ui-monospace, Consolas, monospace`;
  ctx.textBaseline = 'top';
  let cursor = x;
  for (const char of value) {
    ctx.fillText(char, cursor, y, charAdvance(char));
    cursor += charAdvance(char);
  }
  ctx.restore();
}

function drawMissing(ctx: CanvasRenderingContext2D, x: number, y: number, missing: boolean) {
  ctx.save();
  ctx.fillStyle = missing ? 'rgba(255, 0, 170, 0.6)' : 'rgba(255, 255, 255, 0.15)';
  ctx.fillRect(x, y, 16, 16);
  ctx.restore();
}

export function MenuCanvas(props: MenuCanvasProps) {
  const { menu, inherited, context, textures, zoom, tool, background, showSlots, selection } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [slotDraft, setSlotDraft] = useState<{ start: GridCell; end: GridCell } | null>(null);
  const [hoverCell, setHoverCell] = useState<GridCell | null>(null);

  const rows = menu.container.rows;
  const viewWidth = WINDOW_WIDTH + MARGIN_X * 2;
  const viewHeight = windowHeight(rows) + MARGIN_TOP + MARGIN_BOTTOM;

  function selectionRect(target: Selection): Rect | null {
    if (target.kind === 'layer') {
      const layer = menu.layers.find((candidate) => candidate.id === target.id);
      const texture = layer ? textures.get(layer.texture) : undefined;
      if (!layer) return null;
      return { x: layer.x, y: layer.y, width: texture?.width ?? 16, height: texture?.height ?? 16 };
    }
    if (target.kind === 'text') {
      const text = menu.texts?.find((candidate) => candidate.id === target.id);
      return text ? textRect(text, context) : null;
    }
    const slot = menu.slots?.find((candidate) => candidate.id === target.id);
    return slot ? areaRect(slot.area) : null;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.width = viewWidth * zoom;
    canvas.height = viewHeight * zoom;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(zoom, 0, 0, zoom, MARGIN_X * zoom, MARGIN_TOP * zoom);
    const hairline = 1 / zoom;

    drawWindow(ctx, rows, background);

    for (const layer of menu.layers) {
      if (!evaluateCondition(layer.visibleWhen, context)) continue;
      const texture = textures.get(layer.texture);
      if (texture) ctx.drawImage(texture.image, layer.x, layer.y);
      else drawMissing(ctx, layer.x, layer.y, texture === null);
    }

    for (const text of menu.texts ?? []) {
      if (!evaluateCondition(text.visibleWhen, context)) continue;
      const rect = textRect(text, context);
      drawText(ctx, interpolate(text.value, context.variables), rect.x, rect.y, text.color ?? '#404040');
    }

    if (showSlots) {
      for (const slot of menu.slots ?? []) {
        const rect = areaRect(slot.area);
        const color = SLOT_COLORS[slot.kind];
        const visible = evaluateCondition(slot.visibleWhen, context);
        const enabled = evaluateCondition(slot.enabledWhen, context);
        ctx.save();
        ctx.globalAlpha = visible ? 1 : 0.35;
        ctx.fillStyle = withAlpha(color, enabled ? 0.25 : 0.08);
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 * hairline;
        if (inherited.has(elementKey('slot', slot.id))) ctx.setLineDash([3 * hairline * 2, 2 * hairline * 2]);
        ctx.strokeRect(rect.x + hairline, rect.y + hairline, rect.width - 2 * hairline, rect.height - 2 * hairline);
        ctx.fillStyle = '#ffffff';
        ctx.font = `${10 * hairline}px system-ui, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(slot.id, rect.x + 2 * hairline, rect.y + 2 * hairline, rect.width - 4 * hairline);
        ctx.restore();
      }
    }

    ctx.save();
    ctx.lineWidth = 2 * hairline;
    if (slotDraft) {
      const rect = areaRect(areaFromCells(slotDraft.start, slotDraft.end));
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    } else if (tool === 'slot' && hoverCell) {
      const cell = chestCell(hoverCell.col, hoverCell.row);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.strokeRect(cell.x, cell.y, SLOT_SIZE, SLOT_SIZE);
    }

    const selected = selection ? selectionRect(selection) : null;
    if (selected) {
      ctx.strokeStyle = '#ff3d7f';
      ctx.setLineDash([4 * hairline, 3 * hairline]);
      ctx.strokeRect(selected.x - hairline, selected.y - hairline, selected.width + 2 * hairline, selected.height + 2 * hairline);
    }
    ctx.restore();
  });

  function hitTest(point: Point): Selection | null {
    for (const text of [...(menu.texts ?? [])].reverse()) {
      if (inherited.has(elementKey('text', text.id))) continue;
      if (!evaluateCondition(text.visibleWhen, context)) continue;
      if (rectContains(textRect(text, context), point)) return { kind: 'text', id: text.id };
    }
    for (const layer of [...menu.layers].reverse()) {
      if (inherited.has(elementKey('layer', layer.id))) continue;
      if (!evaluateCondition(layer.visibleWhen, context)) continue;
      const texture = textures.get(layer.texture);
      if (!texture) continue;
      if (alphaAt(texture, Math.floor(point.x - layer.x), Math.floor(point.y - layer.y)) > 0) {
        return { kind: 'layer', id: layer.id };
      }
    }
    if (showSlots) {
      for (const slot of [...(menu.slots ?? [])].reverse()) {
        if (inherited.has(elementKey('slot', slot.id))) continue;
        if (rectContains(areaRect(slot.area), point)) return { kind: 'slot', id: slot.id };
      }
    }
    return null;
  }

  function toPoint(event: ReactPointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / zoom - MARGIN_X,
      y: (event.clientY - rect.top) / zoom - MARGIN_TOP,
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return;
    const point = toPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === 'slot') {
      const cell = chestCellAt(point, rows);
      if (cell) setSlotDraft({ start: cell, end: cell });
      return;
    }

    const hit = hitTest(point);
    props.onSelect(hit);
    if (!hit || hit.kind === 'slot') return;
    const element =
      hit.kind === 'layer'
        ? menu.layers.find((layer) => layer.id === hit.id)
        : menu.texts?.find((text) => text.id === hit.id);
    if (element) dragRef.current = { selection: hit, start: point, origin: { x: element.x, y: element.y }, moved: false };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = toPoint(event);
    if (tool === 'slot') {
      const cell = chestCellAt(point, rows);
      setHoverCell(cell);
      if (slotDraft && cell) setSlotDraft({ ...slotDraft, end: cell });
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const dx = Math.round(point.x - drag.start.x);
    const dy = Math.round(point.y - drag.start.y);
    if (!drag.moved && dx === 0 && dy === 0) return;
    if (!drag.moved) {
      drag.moved = true;
      props.onBeginMove();
    }
    props.onMove(drag.selection, drag.origin.x + dx, drag.origin.y + dy);
  }

  function handlePointerUp() {
    if (slotDraft) {
      props.onCreateSlot(areaFromCells(slotDraft.start, slotDraft.end));
      setSlotDraft(null);
    }
    dragRef.current = null;
  }

  return (
    <canvas
      ref={canvasRef}
      className={`menu-canvas tool-${tool}`}
      style={{ width: viewWidth * zoom, height: viewHeight * zoom }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => setHoverCell(null)}
    />
  );
}
