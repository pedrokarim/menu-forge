import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  drawDraftZone,
  drawGuide,
  drawHandle,
  drawHoverFrame,
  drawSelectionFrame,
  drawSlotZone,
  drawTag,
  expandRect,
  rectHandles,
} from '../canvas/overlay';
import type { ScreenRect } from '../canvas/overlay';
import { alignmentGuides, gridSnapLines, snapRect, snapThreshold, withRects } from '../canvas/snapping';
import type { SnapGuide, SnapLines } from '../canvas/snapping';
import { labelFont } from '../canvas/theme';
import { CANVAS_MARGINS, isEditableTarget, scrollParentOf, stepZoom } from '../canvas/viewport';
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
  areaSize,
  chestCell,
  chestCellAt,
  clampedChestCell,
  moveArea,
  playerCell,
  rectContains,
  resizeArea,
  sameArea,
  windowHeight,
} from '../model/geometry';
import type { GridCell, Point, Rect, ResizeHandle } from '../model/geometry';
import type { Layer, MenuDefinition, Slot, SlotArea, TextElement } from '../model/menu';
import type { PreviewContext } from '../model/preview';
import { interpolate } from '../model/preview';
import { elementKey } from '../model/resolve';
import type { Selection } from '../state/editor';
import { SLOT_COLORS } from './slotColors';

export type CanvasTool = 'select' | 'slot';
export type BackgroundMode = 'slots-only' | 'vanilla' | 'none';

/** Marges autour de la fenêtre, pour voir ce qui déborde (barre d’onglets flottante…). */
const MARGIN_X = CANVAS_MARGINS.x;
const MARGIN_TOP = CANVAS_MARGINS.top;
const MARGIN_BOTTOM = CANVAS_MARGINS.bottom;

/** Distance (px écran) à parcourir avant qu’un clic devienne un glisser. */
const DRAG_THRESHOLD = 3;
/** Tolérance (px écran) autour du centre d’une poignée. */
const HANDLE_HIT = 7;
/** Écart (px écran) entre le bord d’une zone et le centre de ses poignées. */
const HANDLE_OFFSET = 3;
/** Défilement cumulé (px) nécessaire pour changer de palier au Ctrl + molette. */
const WHEEL_STEP = 50;
const DEFAULT_ZOOM_LEVELS = [2, 3, 4, 5, 6];

const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

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
  /** Appelé juste avant `onMove`, au relâchement d’un glisser (point d’historique). */
  onBeginMove: () => void;
  onMove: (selection: Selection, x: number, y: number) => void;
  onCreateSlot: (area: SlotArea) => void;
  /** Zone de slots déplacée ou redimensionnée à la souris ; sans ce rappel, les zones restent fixes. */
  onSlotAreaChange?: (id: string, area: SlotArea) => void;
  /** Aimantation des couches et des textes (Alt maintenu la suspend). Vrai par défaut. */
  snapping?: boolean;
  /** Paliers de zoom parcourus au Ctrl + molette. */
  zoomLevels?: readonly number[];
  onZoomChange?: (zoom: number) => void;
  /** Clic droit : l’élément sous le pointeur (sélectionné au passage), ou `null` sur une zone vide. */
  onContextMenu?: (target: Selection | null, event: ReactMouseEvent<HTMLCanvasElement>) => void;
}

/** Glisser d’une couche ou d’un texte. */
interface ElementDrag {
  kind: 'element';
  target: Selection;
  startClient: Point;
  start: Point;
  origin: Point;
  /** Rectangle visible de l’élément, relatif à son origine `(x, y)`. */
  offset: Rect;
  lines: SnapLines;
  position: Point;
  guides: SnapGuide[];
  moved: boolean;
  /** Élément à sélectionner si le clic se relâche sans bouger (sélection « en dessous »). */
  cycleTo: Selection | null;
}

interface SlotMove {
  kind: 'slot-move';
  id: string;
  startClient: Point;
  start: Point;
  origin: SlotArea;
  area: SlotArea;
  moved: boolean;
  cycleTo: Selection | null;
}

interface SlotResize {
  kind: 'slot-resize';
  id: string;
  handle: ResizeHandle;
  startClient: Point;
  origin: SlotArea;
  area: SlotArea;
  moved: boolean;
}

interface SlotDraw {
  kind: 'draw';
  start: GridCell;
  end: GridCell;
}

interface Pan {
  kind: 'pan';
  startClient: Point;
  scroll: Point;
  scroller: HTMLElement;
}

type Interaction = ElementDrag | SlotMove | SlotResize | SlotDraw | Pan;

interface Hover {
  target: Selection | null;
  handle: ResizeHandle | null;
  cell: GridCell | null;
}

const NO_HOVER: Hover = { target: null, handle: null, cell: null };

function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.id === b.id;
}

function sameCell(a: GridCell | null, b: GridCell | null): boolean {
  if (!a || !b) return a === b;
  return a.col === b.col && a.row === b.row;
}

function sameHover(a: Hover, b: Hover): boolean {
  return sameSelection(a.target, b.target) && a.handle === b.handle && sameCell(a.cell, b.cell);
}

function textRect(text: TextElement, context: PreviewContext): Rect {
  const width = textWidth(interpolate(text.value, context.variables));
  return { x: alignedStart(text.x, width, text.align), y: text.y, width: Math.max(width, 2), height: TEXT_HEIGHT };
}

/** Partie visible d’une couche (pixels opaques), pour le cadre et l’aimantation. */
function layerRect(layer: Layer, textures: TextureMap): Rect {
  const texture = textures.get(layer.texture);
  if (!texture) return { x: layer.x, y: layer.y, width: 16, height: 16 };
  if (!texture.bounds) return { x: layer.x, y: layer.y, width: texture.width, height: texture.height };
  const { cropX, cropY, width, height } = texture.bounds;
  return { x: layer.x + cropX, y: layer.y + cropY, width, height };
}

/** Menu tel qu’il apparaît pendant un glisser : l’aperçu n’est validé qu’au relâchement. */
function applyInteraction(menu: MenuDefinition, interaction: Interaction | null): MenuDefinition {
  if (!interaction) return menu;
  if (interaction.kind === 'element' && interaction.moved) {
    const { target, position } = interaction;
    if (target.kind === 'layer') {
      return {
        ...menu,
        layers: menu.layers.map((layer) => (layer.id === target.id ? { ...layer, ...position } : layer)),
      };
    }
    return {
      ...menu,
      texts: menu.texts?.map((text) => (text.id === target.id ? { ...text, ...position } : text)),
    };
  }
  if ((interaction.kind === 'slot-move' || interaction.kind === 'slot-resize') && interaction.moved) {
    const { id, area } = interaction;
    return { ...menu, slots: menu.slots?.map((slot) => (slot.id === id ? { ...slot, area } : slot)) };
  }
  return menu;
}

/** Fond de la fenêtre : cases seules (pack « cases seules »), coffre vanilla, ou rien. */
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
  const snapping = props.snapping ?? true;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // L’interaction vit dans une référence (lue par les gestionnaires, toujours à jour)
  // et dans l’état (pour redessiner).
  const interactionRef = useRef<Interaction | null>(null);
  const [interaction, setInteractionState] = useState<Interaction | null>(null);
  const [hover, setHover] = useState<Hover>(NO_HOVER);
  const [spaceHeld, setSpaceHeldState] = useState(false);
  // Doublé d’une référence : le clic qui suit l’appui doit le voir, même avant le rendu.
  const spaceHeldRef = useRef(false);
  const [, setFontEpoch] = useState(0);
  const pointerInsideRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const zoomAnchorRef = useRef<{ gui: Point; client: Point } | null>(null);
  const wheelRef = useRef(0);

  const shown = applyInteraction(menu, interaction);
  const rows = menu.container.rows;
  const viewWidth = WINDOW_WIDTH + MARGIN_X * 2;
  const viewHeight = windowHeight(rows) + MARGIN_TOP + MARGIN_BOTTOM;

  function setSpaceHeld(held: boolean) {
    spaceHeldRef.current = held;
    setSpaceHeldState(held);
  }

  function setInteraction(next: Interaction | null) {
    interactionRef.current = next;
    setInteractionState(next);
  }

  function toScreenRect(rect: Rect): ScreenRect {
    return {
      left: Math.round((MARGIN_X + rect.x) * zoom),
      top: Math.round((MARGIN_TOP + rect.y) * zoom),
      right: Math.round((MARGIN_X + rect.x + rect.width) * zoom),
      bottom: Math.round((MARGIN_TOP + rect.y + rect.height) * zoom),
    };
  }

  function elementRect(target: Selection, source: MenuDefinition): Rect | null {
    if (target.kind === 'layer') {
      const layer = source.layers.find((candidate) => candidate.id === target.id);
      return layer ? layerRect(layer, textures) : null;
    }
    if (target.kind === 'text') {
      const text = source.texts?.find((candidate) => candidate.id === target.id);
      return text ? textRect(text, context) : null;
    }
    const slot = source.slots?.find((candidate) => candidate.id === target.id);
    return slot ? areaRect(slot.area) : null;
  }

  /** Zone sélectionnée qui accepte les poignées (outil Sélection, zone propre au menu). */
  function resizableSlot(): Slot | null {
    if (tool !== 'select' || !showSlots || !props.onSlotAreaChange || selection?.kind !== 'slot') return null;
    if (inherited.has(elementKey('slot', selection.id))) return null;
    return shown.slots?.find((candidate) => candidate.id === selection.id) ?? null;
  }

  function slotHandles(slot: Slot) {
    return rectHandles(expandRect(toScreenRect(areaRect(slot.area)), HANDLE_OFFSET));
  }

  function handleAt(screen: Point): ResizeHandle | null {
    const slot = resizableSlot();
    if (!slot) return null;
    const hit = slotHandles(slot).find(
      (point) => Math.abs(point.x - screen.x) <= HANDLE_HIT && Math.abs(point.y - screen.y) <= HANDLE_HIT,
    );
    return hit?.handle ?? null;
  }

  /** Éléments modifiables sous un point, du plus haut au plus bas (zones, textes, couches). */
  function hitStack(point: Point): Selection[] {
    const stack: Selection[] = [];
    if (showSlots) {
      for (const slot of [...(menu.slots ?? [])].reverse()) {
        if (inherited.has(elementKey('slot', slot.id))) continue;
        if (rectContains(areaRect(slot.area), point)) stack.push({ kind: 'slot', id: slot.id });
      }
    }
    for (const text of [...(menu.texts ?? [])].reverse()) {
      if (inherited.has(elementKey('text', text.id))) continue;
      if (!evaluateCondition(text.visibleWhen, context)) continue;
      if (rectContains(textRect(text, context), point)) stack.push({ kind: 'text', id: text.id });
    }
    for (const layer of [...menu.layers].reverse()) {
      if (inherited.has(elementKey('layer', layer.id))) continue;
      if (!evaluateCondition(layer.visibleWhen, context)) continue;
      const texture = textures.get(layer.texture);
      if (!texture) continue;
      if (alphaAt(texture, Math.floor(point.x - layer.x), Math.floor(point.y - layer.y)) > 0) {
        stack.push({ kind: 'layer', id: layer.id });
      }
    }
    return stack;
  }

  /** L’élément sélectionné garde la main s’il est sous le pointeur ; sinon le plus haut. */
  function pick(stack: Selection[]): { target: Selection | null; cycleTo: Selection | null; kept: boolean } {
    const index = selection ? stack.findIndex((candidate) => sameSelection(candidate, selection)) : -1;
    if (index < 0) return { target: stack[0] ?? null, cycleTo: null, kept: false };
    const cycleTo = stack.length > 1 ? stack[(index + 1) % stack.length] : null;
    return { target: stack[index], cycleTo, kept: true };
  }

  /** Lignes d’aimantation : grille, fenêtre et autres éléments visibles. */
  function snapLinesFor(target: Selection): SnapLines {
    const rects: Rect[] = [];
    for (const layer of menu.layers) {
      if (target.kind === 'layer' && layer.id === target.id) continue;
      if (evaluateCondition(layer.visibleWhen, context)) rects.push(layerRect(layer, textures));
    }
    for (const text of menu.texts ?? []) {
      if (target.kind === 'text' && text.id === target.id) continue;
      if (evaluateCondition(text.visibleWhen, context)) rects.push(textRect(text, context));
    }
    return withRects(gridSnapLines(rows), rects);
  }

  function elementPosition(drag: ElementDrag, point: Point, free: boolean): { position: Point; guides: SnapGuide[] } {
    const raw = { x: drag.origin.x + point.x - drag.start.x, y: drag.origin.y + point.y - drag.start.y };
    if (!snapping || free) return { position: { x: Math.round(raw.x), y: Math.round(raw.y) }, guides: [] };
    const rect = { ...drag.offset, x: raw.x + drag.offset.x, y: raw.y + drag.offset.y };
    const snap = snapRect(rect, drag.lines, snapThreshold(zoom));
    const position = { x: Math.round(raw.x + (snap.dx ?? 0)), y: Math.round(raw.y + (snap.dy ?? 0)) };
    const placed = { ...drag.offset, x: position.x + drag.offset.x, y: position.y + drag.offset.y };
    return { position, guides: alignmentGuides(placed, drag.lines) };
  }

  function readPointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return {
      screen,
      point: { x: screen.x / zoom - MARGIN_X, y: screen.y / zoom - MARGIN_TOP },
      client: { x: event.clientX, y: event.clientY },
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const { screen, point, client } = readPointer(event);

    // Défilement de la zone de travail : clic molette, ou Espace + glisser.
    if (event.button === 1 || (event.button === 0 && spaceHeldRef.current)) {
      event.preventDefault();
      const scroller = scrollParentOf(canvas);
      if (!scroller) return;
      canvas.setPointerCapture(event.pointerId);
      setInteraction({ kind: 'pan', startClient: client, scroll: { x: scroller.scrollLeft, y: scroller.scrollTop }, scroller });
      return;
    }
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    lastPointRef.current = point;

    if (tool === 'slot') {
      const cell = chestCellAt(point, rows);
      if (cell) setInteraction({ kind: 'draw', start: cell, end: cell });
      return;
    }

    const handle = handleAt(screen);
    const resizable = handle ? resizableSlot() : null;
    if (handle && resizable) {
      setInteraction({
        kind: 'slot-resize',
        id: resizable.id,
        handle,
        startClient: client,
        origin: resizable.area,
        area: resizable.area,
        moved: false,
      });
      return;
    }

    const { target, cycleTo, kept } = pick(hitStack(point));
    if (!kept) props.onSelect(target);
    if (!target) return;

    if (target.kind === 'slot') {
      const slot = menu.slots?.find((candidate) => candidate.id === target.id);
      if (!slot) return;
      setInteraction({
        kind: 'slot-move',
        id: slot.id,
        startClient: client,
        start: point,
        origin: slot.area,
        area: slot.area,
        moved: false,
        cycleTo,
      });
      return;
    }

    const element =
      target.kind === 'layer'
        ? menu.layers.find((layer) => layer.id === target.id)
        : menu.texts?.find((text) => text.id === target.id);
    const rect = elementRect(target, menu);
    if (!element || !rect) return;
    const origin = { x: element.x, y: element.y };
    setInteraction({
      kind: 'element',
      target,
      startClient: client,
      start: point,
      origin,
      offset: { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height },
      lines: snapLinesFor(target),
      position: origin,
      guides: [],
      moved: false,
      cycleTo,
    });
  }

  function updateHover(screen: Point, point: Point) {
    let next: Hover;
    if (tool === 'slot') {
      next = { target: null, handle: null, cell: chestCellAt(point, rows) };
    } else {
      const handle = handleAt(screen);
      next = handle ? { target: null, handle, cell: null } : { target: pick(hitStack(point)).target, handle: null, cell: null };
    }
    if (!sameHover(hover, next)) setHover(next);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const { screen, point, client } = readPointer(event);
    // `pointerenter` peut manquer (capture, rechargement) : tout mouvement vaut présence.
    pointerInsideRef.current = true;
    lastPointRef.current = point;
    const current = interactionRef.current;
    if (!current) {
      updateHover(screen, point);
      return;
    }
    if (current.kind === 'pan') {
      current.scroller.scrollLeft = current.scroll.x - (client.x - current.startClient.x);
      current.scroller.scrollTop = current.scroll.y - (client.y - current.startClient.y);
      return;
    }
    if (current.kind === 'draw') {
      const end = clampedChestCell(point, rows);
      if (!sameCell(end, current.end)) setInteraction({ ...current, end });
      return;
    }
    const moved =
      current.moved || Math.hypot(client.x - current.startClient.x, client.y - current.startClient.y) >= DRAG_THRESHOLD;
    if (!moved) return;
    if (current.kind === 'element') {
      setInteraction({ ...current, moved, ...elementPosition(current, point, event.altKey) });
    } else if (current.kind === 'slot-move') {
      const deltaCol = Math.round((point.x - current.start.x) / SLOT_SIZE);
      const deltaRow = Math.round((point.y - current.start.y) / SLOT_SIZE);
      setInteraction({ ...current, moved, area: moveArea(current.origin, deltaCol, deltaRow, rows) });
    } else {
      setInteraction({ ...current, moved, area: resizeArea(current.origin, current.handle, point, rows) });
    }
  }

  /** Relâchement : un glisser devient une seule modification ; un simple clic peut changer de couche. */
  function handlePointerUp() {
    const current = interactionRef.current;
    if (!current) return;
    setInteraction(null);
    switch (current.kind) {
      case 'element':
        if (!current.moved) {
          if (current.cycleTo) props.onSelect(current.cycleTo);
        } else if (current.position.x !== current.origin.x || current.position.y !== current.origin.y) {
          props.onBeginMove();
          props.onMove(current.target, current.position.x, current.position.y);
        }
        return;
      case 'slot-move':
        if (!current.moved) {
          if (current.cycleTo) props.onSelect(current.cycleTo);
        } else if (!sameArea(current.area, current.origin)) {
          props.onSlotAreaChange?.(current.id, current.area);
        }
        return;
      case 'slot-resize':
        if (current.moved && !sameArea(current.area, current.origin)) props.onSlotAreaChange?.(current.id, current.area);
        return;
      case 'draw':
        props.onCreateSlot(areaFromCells(current.start, current.end));
        return;
      case 'pan':
        return;
    }
  }

  function cancelInteraction() {
    if (interactionRef.current) setInteraction(null);
  }

  // Pendant un glisser : Échap annule (sans atteindre les raccourcis de l’appli),
  // Alt suspend l’aimantation, Ctrl+Z attend la fin du geste.
  const handleInteractionKey = useEffectEvent((event: KeyboardEvent) => {
    const current = interactionRef.current;
    if (!current) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'keydown') setInteraction(null);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && /^[zy]$/i.test(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.key === 'Alt') {
      event.preventDefault();
      const point = lastPointRef.current;
      if (current.kind === 'element' && current.moved && point) {
        setInteraction({ ...current, ...elementPosition(current, point, event.type === 'keydown') });
      }
    }
  });

  const interacting = interaction !== null;
  useEffect(() => {
    if (!interacting) return;
    const listener = (event: KeyboardEvent) => handleInteractionKey(event);
    window.addEventListener('keydown', listener, true);
    window.addEventListener('keyup', listener, true);
    return () => {
      window.removeEventListener('keydown', listener, true);
      window.removeEventListener('keyup', listener, true);
    };
  }, [interacting]);

  // Espace maintenu au-dessus de la toile : mode « main » pour faire défiler.
  const handleSpaceKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.code !== 'Space') return;
    if (event.type === 'keyup') {
      setSpaceHeld(false);
      return;
    }
    if (isEditableTarget(event.target)) return;
    if (!pointerInsideRef.current && interactionRef.current?.kind !== 'pan') return;
    event.preventDefault();
    setSpaceHeld(true);
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleSpaceKey(event);
    const release = () => setSpaceHeld(false);
    window.addEventListener('keydown', listener);
    window.addEventListener('keyup', listener);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', listener);
      window.removeEventListener('keyup', listener);
      window.removeEventListener('blur', release);
    };
  }, []);

  // Ctrl + molette : palier de zoom suivant, en gardant sous le curseur le point visé.
  const handleWheel = useEffectEvent((event: WheelEvent) => {
    const onZoomChange = props.onZoomChange;
    if (!(event.ctrlKey || event.metaKey) || !onZoomChange) return;
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    const delta = event.deltaY * scale;
    if (Math.sign(delta) !== Math.sign(wheelRef.current)) wheelRef.current = 0;
    wheelRef.current += delta;
    if (Math.abs(wheelRef.current) < WHEEL_STEP) return;
    const direction = wheelRef.current < 0 ? 1 : -1;
    wheelRef.current = 0;
    const next = stepZoom(props.zoomLevels ?? DEFAULT_ZOOM_LEVELS, zoom, direction);
    const canvas = canvasRef.current;
    if (next === zoom || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    zoomAnchorRef.current = {
      gui: { x: (event.clientX - rect.left) / zoom - MARGIN_X, y: (event.clientY - rect.top) / zoom - MARGIN_TOP },
      client: { x: event.clientX, y: event.clientY },
    };
    onZoomChange(next);
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const target = scrollParentOf(canvas) ?? canvas;
    if (!target) return;
    const listener = (event: WheelEvent) => handleWheel(event);
    target.addEventListener('wheel', listener, { passive: false });
    return () => target.removeEventListener('wheel', listener);
  }, []);

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    zoomAnchorRef.current = null;
    const canvas = canvasRef.current;
    const scroller = scrollParentOf(canvas);
    if (!anchor || !canvas || !scroller) return;
    const rect = canvas.getBoundingClientRect();
    scroller.scrollLeft += rect.left + (anchor.gui.x + MARGIN_X) * zoom - anchor.client.x;
    scroller.scrollTop += rect.top + (anchor.gui.y + MARGIN_TOP) * zoom - anchor.client.y;
  }, [zoom]);

  // Les étiquettes utilisent Pixelify Sans : on redessine quand une police arrive.
  useEffect(() => {
    const fonts = document.fonts;
    const refresh = () => setFontEpoch((epoch) => epoch + 1);
    fonts.addEventListener('loadingdone', refresh);
    fonts.load(labelFont(12)).catch(() => undefined);
    return () => fonts.removeEventListener('loadingdone', refresh);
  }, []);

  function dragTag(): { text: string; rect: Rect } | null {
    if (!interaction) return null;
    if (interaction.kind === 'draw') {
      const area = areaFromCells(interaction.start, interaction.end);
      const size = areaSize(area);
      return { text: `${size.width} × ${size.height}`, rect: areaRect(area) };
    }
    if (interaction.kind === 'pan' || !interaction.moved) return null;
    if (interaction.kind === 'element') {
      const { position, offset } = interaction;
      return {
        text: `x ${position.x} · y ${position.y}`,
        rect: { ...offset, x: position.x + offset.x, y: position.y + offset.y },
      };
    }
    const { area } = interaction;
    const size = areaSize(area);
    const text =
      interaction.kind === 'slot-move'
        ? `colonne ${area.col} · ligne ${area.row}`
        : `${size.width} × ${size.height} · colonne ${area.col} · ligne ${area.row}`;
    return { text, rect: areaRect(area) };
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.width = viewWidth * zoom;
    canvas.height = viewHeight * zoom;
    ctx.imageSmoothingEnabled = false;

    // 1. Le menu lui-même, en coordonnées fenêtre : jamais recoloré.
    ctx.setTransform(zoom, 0, 0, zoom, MARGIN_X * zoom, MARGIN_TOP * zoom);
    drawWindow(ctx, rows, background);
    for (const layer of shown.layers) {
      if (!evaluateCondition(layer.visibleWhen, context)) continue;
      const texture = textures.get(layer.texture);
      if (texture) ctx.drawImage(texture.image, layer.x, layer.y);
      else drawMissing(ctx, layer.x, layer.y, texture === null);
    }
    for (const text of shown.texts ?? []) {
      if (!evaluateCondition(text.visibleWhen, context)) continue;
      const rect = textRect(text, context);
      drawText(ctx, interpolate(text.value, context.variables), rect.x, rect.y, text.color ?? '#404040');
    }

    // 2. Les surimpressions, en pixels écran.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (showSlots) {
      const fontSize = Math.round(Math.min(16, Math.max(10, zoom * 3.5)));
      for (const slot of shown.slots ?? []) {
        drawSlotZone(ctx, toScreenRect(areaRect(slot.area)), {
          color: SLOT_COLORS[slot.kind],
          visible: evaluateCondition(slot.visibleWhen, context),
          enabled: evaluateCondition(slot.enabledWhen, context),
          inherited: inherited.has(elementKey('slot', slot.id)),
          label: slot.id,
          fontSize,
        });
      }
    }

    if (interaction?.kind === 'draw') {
      drawDraftZone(ctx, toScreenRect(areaRect(areaFromCells(interaction.start, interaction.end))));
    } else if (tool === 'slot' && hover.cell) {
      const cell = chestCell(hover.cell.col, hover.cell.row);
      drawHoverFrame(ctx, toScreenRect({ ...cell, width: SLOT_SIZE, height: SLOT_SIZE }));
    }

    if (tool === 'select' && !interaction && hover.target && !sameSelection(hover.target, selection)) {
      const rect = elementRect(hover.target, shown);
      if (rect) drawHoverFrame(ctx, toScreenRect(rect));
    }

    if (interaction?.kind === 'element') {
      for (const guide of interaction.guides) {
        const position =
          guide.axis === 'x' ? (MARGIN_X + guide.position) * zoom : (MARGIN_TOP + guide.position) * zoom;
        drawGuide(ctx, guide.axis, position, canvas.width, canvas.height);
      }
    }

    const selected = selection ? elementRect(selection, shown) : null;
    if (selected) drawSelectionFrame(ctx, toScreenRect(selected));
    const resizable = resizableSlot();
    if (resizable) for (const point of slotHandles(resizable)) drawHandle(ctx, point.x, point.y);

    const tag = dragTag();
    if (tag) drawTag(ctx, tag.text, toScreenRect(tag.rect), canvas.width, canvas.height);
  });

  function cursor(): string {
    if (interaction?.kind === 'pan') return 'grabbing';
    if (spaceHeld) return 'grab';
    if (interaction?.kind === 'slot-resize') return HANDLE_CURSORS[interaction.handle];
    if (interaction?.kind === 'element' || interaction?.kind === 'slot-move') return 'move';
    if (tool === 'slot') return 'crosshair';
    if (hover.handle) return HANDLE_CURSORS[hover.handle];
    if (hover.target) return 'move';
    return 'default';
  }

  return (
    <canvas
      ref={canvasRef}
      className={`menu-canvas tool-${tool}`}
      style={{ width: viewWidth * zoom, height: viewHeight * zoom, cursor: cursor() }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={cancelInteraction}
      onLostPointerCapture={cancelInteraction}
      onPointerEnter={() => {
        pointerInsideRef.current = true;
      }}
      onPointerLeave={() => {
        pointerInsideRef.current = false;
        if (!sameHover(hover, NO_HOVER)) setHover(NO_HOVER);
      }}
      onContextMenu={(event: ReactMouseEvent<HTMLCanvasElement>) => {
        event.preventDefault();
        if (!props.onContextMenu) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const point = {
          x: (event.clientX - rect.left) / zoom - MARGIN_X,
          y: (event.clientY - rect.top) / zoom - MARGIN_TOP,
        };
        const { target } = pick(hitStack(point));
        if (target) props.onSelect(target);
        props.onContextMenu(target, event);
      }}
      // Empêche le défilement automatique du clic molette sous Windows.
      onMouseDown={(event: ReactMouseEvent<HTMLCanvasElement>) => {
        if (event.button === 1) event.preventDefault();
      }}
    />
  );
}
