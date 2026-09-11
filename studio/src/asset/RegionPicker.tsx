import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { NumberField } from '../components/fields';
import type { LoadedTexture } from '../lib/textures';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';
import { fillChecker } from './canvasUtils';
import { clamp, clampInsets, clampRegion, rectFromPixels } from './geometry';
import type { Point } from './geometry';
import type { Insets, Region } from './model';
import { MAX_CANVAS_SIDE } from './presets';
import { findSprites } from './sprites';

/** Paliers de l’aperçu ; ½ et ¼ pour voir en entier les très grandes textures (atlas). */
const PICKER_ZOOMS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16] as const;
/** Taille visée par défaut pour le zoom automatique (inspecteur : l’aperçu ne repousse pas l’export). */
const PICKER_TARGET = 200;
const LINE_HIT = 4;
/** Tailles de case courantes des atlas (18 = une case d’inventaire). */
const GRID_PRESETS = [8, 16, 18, 32, 64] as const;

type InsetSide = keyof Insets;

/** Façon de choisir la zone : tracé libre, cases d’une grille, sprite détecté. */
type PickMode = 'draw' | 'grid' | 'sprite';

interface GridSpec {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

type PickerDrag =
  | { kind: 'region'; start: Point; moved: boolean }
  | { kind: 'cells'; start: Region }
  | { kind: 'inset'; side: InsetSide; started: boolean };

const MODES: ReadonlyArray<{ mode: PickMode; label: string; icon: IconName; hint: string }> = [
  { mode: 'draw', label: 'Tracer', icon: 'crop', hint: 'Glisser pour tracer la zone' },
  { mode: 'grid', label: 'Grille', icon: 'grid', hint: 'Cliquer une case, ou glisser sur plusieurs cases' },
  { mode: 'sprite', label: 'Sprite', icon: 'sparkles', hint: 'Cliquer un sprite : sa zone est détectée d’après ses pixels opaques' },
];

const MODE_HINTS: Record<PickMode, string> = {
  draw: 'Glisse sur l’aperçu pour tracer la zone source',
  grid: 'Clique une case de la grille, ou glisse pour en prendre plusieurs',
  sprite: 'Clique un sprite : sa zone est détectée d’après ses pixels opaques',
};

interface RegionPickerProps {
  /** `undefined` = en chargement, `null` = introuvable. */
  texture: LoadedTexture | null | undefined;
  /** Zone source ; absente = toute l’image. */
  region: Region | undefined;
  /** Insets du nine-slice (affichés et déplaçables) ; absent pour une image. */
  insets?: Insets;
  /** Début d’un tracé à la souris (une seule entrée d’historique pour tout le geste). */
  onBeginEdit: () => void;
  /** `live` : changement continu pendant un tracé (sans entrée d’historique). */
  onRegionChange: (region: Region | undefined, live: boolean) => void;
  onInsetsChange?: (insets: Insets, live: boolean) => void;
  /** Taille visée par le zoom automatique (px écran). */
  fitSize?: number;
}

/** Zooms possibles sans dépasser la taille maximale de toile. */
function allowedZooms(texture: LoadedTexture | null | undefined): number[] {
  const side = Math.max(texture?.width ?? 1, texture?.height ?? 1, 1);
  const levels = PICKER_ZOOMS.filter((level) => side * level <= MAX_CANVAS_SIDE);
  return levels.length > 0 ? levels : [1];
}

function autoZoom(texture: LoadedTexture | null | undefined, target: number): number {
  if (!texture) return 1;
  const fit = target / Math.max(texture.width, texture.height, 1);
  const levels = allowedZooms(texture);
  return levels.filter((level) => level <= fit).at(-1) ?? levels[0];
}

/** Case de la grille sous un pixel. */
function cellAt(grid: GridSpec, pixel: Point): Region {
  const col = Math.floor((pixel.x - grid.offsetX) / grid.width);
  const row = Math.floor((pixel.y - grid.offsetY) / grid.height);
  return { x: grid.offsetX + col * grid.width, y: grid.offsetY + row * grid.height, width: grid.width, height: grid.height };
}

/** Plus petit rectangle contenant deux zones. */
function unionRegion(a: Region, b: Region): Region {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/**
 * Sélecteur visuel : aperçu agrandi de la texture, où l’on choisit la zone
 * source en la traçant, en cliquant les cases d’une grille (atlas réguliers)
 * ou en cliquant un sprite (zone détectée). Les lignes des insets sont
 * affichées et se déplacent en les tirant.
 */
export function RegionPicker({
  texture,
  region,
  insets,
  onBeginEdit,
  onRegionChange,
  onInsetsChange,
  fitSize = PICKER_TARGET,
}: RegionPickerProps) {
  const [zoomChoice, setZoomChoice] = useState<number | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [mode, setMode] = useState<PickMode>('draw');
  const [grid, setGrid] = useState<GridSpec>({ width: 16, height: 16, offsetX: 0, offsetY: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<PickerDrag | null>(null);

  const zoomLevels = allowedZooms(texture);
  const zoom = Math.min(zoomChoice ?? autoZoom(texture, fitSize), zoomLevels.at(-1) ?? 1);
  const textureWidth = texture?.width ?? 0;
  const textureHeight = texture?.height ?? 0;
  const area = clampRegion(region, textureWidth, textureHeight);
  const safeInsets = insets ? clampInsets(insets, area) : null;
  const safeGrid: GridSpec = {
    width: Math.max(1, grid.width),
    height: Math.max(1, grid.height),
    offsetX: Math.max(0, grid.offsetX),
    offsetY: Math.max(0, grid.offsetY),
  };
  // Étiquetage des sprites : calculé une fois par texture, à l’entrée dans le mode « Sprite ».
  const sprites = useMemo(() => (mode === 'sprite' && texture ? findSprites(texture) : null), [mode, texture]);

  const hoverRect: Region | null = !hover
    ? null
    : mode === 'grid'
      ? clampRegion(cellAt(safeGrid, hover), textureWidth, textureHeight)
      : mode === 'sprite'
        ? (sprites?.at(hover.x, hover.y) ?? null)
        : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !texture) return;
    const width = Math.max(1, Math.round(texture.width * zoom));
    const height = Math.max(1, Math.round(texture.height * zoom));
    canvas.width = width;
    canvas.height = height;
    ctx.imageSmoothingEnabled = false;
    fillChecker(ctx, 0, 0, width, height, 8);
    ctx.drawImage(texture.image, 0, 0, texture.width, texture.height, 0, 0, width, height);

    // Grille des cases (seulement si elle reste lisible).
    if (mode === 'grid' && safeGrid.width * zoom >= 4 && safeGrid.height * zoom >= 4) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gridX = safeGrid.offsetX % safeGrid.width; gridX <= texture.width; gridX += safeGrid.width) {
        ctx.moveTo(gridX * zoom + 0.5, 0);
        ctx.lineTo(gridX * zoom + 0.5, height);
      }
      for (let gridY = safeGrid.offsetY % safeGrid.height; gridY <= texture.height; gridY += safeGrid.height) {
        ctx.moveTo(0, gridY * zoom + 0.5);
        ctx.lineTo(width, gridY * zoom + 0.5);
      }
      ctx.stroke();
      ctx.restore();
    }

    const x = area.x * zoom;
    const y = area.y * zoom;
    const w = area.width * zoom;
    const h = area.height * zoom;
    if (region) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.rect(x, y, w, h);
      ctx.fill('evenodd');
    }
    ctx.lineWidth = 1;
    if (w > 0 && h > 0) {
      ctx.strokeStyle = '#f2c94c';
      ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    }

    // Case ou sprite sous le pointeur : ce qu’un clic prendrait.
    if (hoverRect && !dragRef.current) {
      ctx.save();
      ctx.strokeStyle = '#8fc7ff';
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(hoverRect.x * zoom + 0.5, hoverRect.y * zoom + 0.5, hoverRect.width * zoom - 1, hoverRect.height * zoom - 1);
      ctx.restore();
    }

    if (safeInsets && w > 0 && h > 0) {
      ctx.save();
      ctx.strokeStyle = '#4ee6d2';
      ctx.setLineDash([3, 2]);
      const vertical = (position: number) => {
        const lineX = clamp(position, 0.5, width - 0.5);
        ctx.beginPath();
        ctx.moveTo(lineX, y);
        ctx.lineTo(lineX, y + h);
        ctx.stroke();
      };
      const horizontal = (position: number) => {
        const lineY = clamp(position, 0.5, height - 0.5);
        ctx.beginPath();
        ctx.moveTo(x, lineY);
        ctx.lineTo(x + w, lineY);
        ctx.stroke();
      };
      vertical((area.x + safeInsets.left) * zoom);
      vertical((area.x + area.width - safeInsets.right) * zoom);
      horizontal((area.y + safeInsets.top) * zoom);
      horizontal((area.y + area.height - safeInsets.bottom) * zoom);
      ctx.restore();
    }
  });

  function toTexture(event: ReactPointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom };
  }

  const clampPixel = (point: Point): Point => ({
    x: clamp(Math.floor(point.x), 0, textureWidth - 1),
    y: clamp(Math.floor(point.y), 0, textureHeight - 1),
  });

  const clampCell = (pixel: Point) => clampRegion(cellAt(safeGrid, pixel), textureWidth, textureHeight);

  function insetAt(point: Point): InsetSide | null {
    if (!safeInsets) return null;
    const near = (a: number, b: number) => Math.abs(a - b) * zoom <= LINE_HIT;
    const withinY = point.y >= area.y && point.y <= area.y + area.height;
    const withinX = point.x >= area.x && point.x <= area.x + area.width;
    if (withinY && near(point.x, area.x + safeInsets.left)) return 'left';
    if (withinY && near(point.x, area.x + area.width - safeInsets.right)) return 'right';
    if (withinX && near(point.y, area.y + safeInsets.top)) return 'top';
    if (withinX && near(point.y, area.y + area.height - safeInsets.bottom)) return 'bottom';
    return null;
  }

  function insetValue(side: InsetSide, point: Point, current: Insets): number {
    const px = Math.round(point.x);
    const py = Math.round(point.y);
    switch (side) {
      case 'left':
        return clamp(px - area.x, 0, area.width - current.right);
      case 'right':
        return clamp(area.x + area.width - px, 0, area.width - current.left);
      case 'top':
        return clamp(py - area.y, 0, area.height - current.bottom);
      case 'bottom':
        return clamp(area.y + area.height - py, 0, area.height - current.top);
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || !texture) return;
    const point = toTexture(event);
    const pixel = clampPixel(point);
    if (mode === 'sprite') {
      const found = sprites?.at(pixel.x, pixel.y);
      if (found) onRegionChange(found, false);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const side = onInsetsChange ? insetAt(point) : null;
    if (side) {
      dragRef.current = { kind: 'inset', side, started: false };
    } else if (mode === 'grid') {
      const cell = clampCell(pixel);
      dragRef.current = { kind: 'cells', start: cell };
      onBeginEdit();
      onRegionChange(cell, true);
    } else {
      dragRef.current = { kind: 'region', start: pixel, moved: false };
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!texture) return;
    const point = toTexture(event);
    const pixel = clampPixel(point);
    if (!hover || hover.x !== pixel.x || hover.y !== pixel.y) setHover(pixel);

    const drag = dragRef.current;
    if (drag?.kind === 'region') {
      if (!drag.moved && pixel.x === drag.start.x && pixel.y === drag.start.y) return;
      if (!drag.moved) {
        drag.moved = true;
        onBeginEdit();
      }
      onRegionChange(rectFromPixels(drag.start, pixel), true);
      return;
    }
    if (drag?.kind === 'cells') {
      onRegionChange(clampRegion(unionRegion(drag.start, clampCell(pixel)), textureWidth, textureHeight), true);
      return;
    }
    if (drag?.kind === 'inset' && safeInsets && onInsetsChange) {
      if (!drag.started) {
        drag.started = true;
        onBeginEdit();
      }
      onInsetsChange({ ...safeInsets, [drag.side]: insetValue(drag.side, point, safeInsets) }, true);
    }
  }

  function handlePointerUp() {
    dragRef.current = null;
  }

  if (texture === undefined) return <p className="muted small">Chargement de la texture…</p>;
  if (texture === null) return <p className="warning">Texture introuvable.</p>;

  const setRegionField = (key: keyof Region, value: number) => onRegionChange({ ...area, [key]: value }, false);
  const setInsetField = (key: InsetSide, value: number) => {
    if (safeInsets && onInsetsChange) onInsetsChange({ ...safeInsets, [key]: Math.max(0, value) }, false);
  };
  const opaque = texture.bounds;
  const hoverSide = mode !== 'sprite' && hover && onInsetsChange ? insetAt(hover) : null;
  const cursor =
    hoverSide === 'left' || hoverSide === 'right'
      ? 'ew-resize'
      : hoverSide
        ? 'ns-resize'
        : mode === 'sprite'
          ? hoverRect
            ? 'pointer'
            : 'default'
          : mode === 'grid'
            ? 'cell'
            : 'crosshair';
  const gridPreset = GRID_PRESETS.find((size) => size === grid.width && size === grid.height);
  const setGridField = (key: keyof GridSpec, value: number) =>
    setGrid((previous) => ({ ...previous, [key]: Number.isFinite(value) ? Math.round(value) : previous[key] }));

  return (
    <div className="asset-region-picker">
      <div className="asset-region-toolbar">
        <div className="asset-segmented region-modes" role="group" aria-label="Choix de la zone">
          {MODES.map((item) => (
            <Tooltip key={item.mode} label={item.label} hint={item.hint}>
              <button
                type="button"
                className={mode === item.mode ? 'active' : ''}
                aria-pressed={mode === item.mode}
                onClick={() => setMode(item.mode)}
              >
                <Icon name={item.icon} />
                {item.label}
              </button>
            </Tooltip>
          ))}
        </div>
        <select value={zoom} onChange={(event) => setZoomChoice(Number(event.target.value))} aria-label="Zoom de l’aperçu">
          {zoomLevels.map((level) => (
            <option key={level} value={level}>
              {level < 1 ? `×1/${Math.round(1 / level)}` : `×${level}`}
            </option>
          ))}
        </select>
        <button type="button" className="sm" onClick={() => onRegionChange(undefined, false)} disabled={!region}>
          <Icon name="expand" />
          Toute l’image
        </button>
        <Tooltip label="Contenu opaque" hint="Recadrer sur les pixels non transparents">
          <button
            type="button"
            className="sm"
            disabled={!opaque}
            onClick={() =>
              opaque && onRegionChange({ x: opaque.cropX, y: opaque.cropY, width: opaque.width, height: opaque.height }, false)
            }
          >
            <Icon name="crop" />
            Contenu opaque
          </button>
        </Tooltip>
      </div>
      {mode === 'grid' && (
        <div className="asset-region-toolbar region-grid">
          <select
            aria-label="Taille de case"
            value={gridPreset ?? 'custom'}
            onChange={(event) => {
              const size = Number(event.target.value);
              if (Number.isFinite(size)) setGrid((previous) => ({ ...previous, width: size, height: size }));
            }}
          >
            {GRID_PRESETS.map((size) => (
              <option key={size} value={size}>
                {size} × {size}
              </option>
            ))}
            <option value="custom" disabled>
              Autre
            </option>
          </select>
          <span>case</span>
          <input
            className="mini-input"
            type="number"
            min={1}
            aria-label="Largeur de case"
            value={grid.width}
            onChange={(event) => setGridField('width', Number(event.target.value))}
          />
          <span>×</span>
          <input
            className="mini-input"
            type="number"
            min={1}
            aria-label="Hauteur de case"
            value={grid.height}
            onChange={(event) => setGridField('height', Number(event.target.value))}
          />
          <span>décalage</span>
          <input
            className="mini-input"
            type="number"
            min={0}
            aria-label="Décalage horizontal de la grille"
            value={grid.offsetX}
            onChange={(event) => setGridField('offsetX', Number(event.target.value))}
          />
          <input
            className="mini-input"
            type="number"
            min={0}
            aria-label="Décalage vertical de la grille"
            value={grid.offsetY}
            onChange={(event) => setGridField('offsetY', Number(event.target.value))}
          />
        </div>
      )}
      <div className="asset-region-scroll">
        <canvas
          ref={canvasRef}
          style={{
            width: Math.max(1, Math.round(texture.width * zoom)),
            height: Math.max(1, Math.round(texture.height * zoom)),
            cursor,
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={() => setHover(null)}
        />
      </div>
      <p className="muted small">
        Texture {texture.width} × {texture.height} · zone {area.x}, {area.y} · {area.width} × {area.height}
        {hover ? ` · pixel ${hover.x}, ${hover.y}` : ''}
        {sprites ? ` · ${sprites.count} sprite${sprites.count > 1 ? 's' : ''} détecté${sprites.count > 1 ? 's' : ''}` : ''}
      </p>
      <p className="field-hint">
        {MODE_HINTS[mode]}
        {safeInsets ? ' ; tire les lignes turquoise pour régler les insets' : ''}.
      </p>
      <div className="field-row">
        <NumberField label="Zone x" value={area.x} min={0} max={texture.width - 1} onChange={(value) => setRegionField('x', value)} />
        <NumberField label="Zone y" value={area.y} min={0} max={texture.height - 1} onChange={(value) => setRegionField('y', value)} />
      </div>
      <div className="field-row">
        <NumberField label="Zone largeur" value={area.width} min={1} max={texture.width} onChange={(value) => setRegionField('width', value)} />
        <NumberField label="Zone hauteur" value={area.height} min={1} max={texture.height} onChange={(value) => setRegionField('height', value)} />
      </div>
      {safeInsets && (
        <>
          <div className="field-row">
            <NumberField label="Inset haut" value={safeInsets.top} min={0} onChange={(value) => setInsetField('top', value)} />
            <NumberField label="Inset bas" value={safeInsets.bottom} min={0} onChange={(value) => setInsetField('bottom', value)} />
          </div>
          <div className="field-row">
            <NumberField label="Inset gauche" value={safeInsets.left} min={0} onChange={(value) => setInsetField('left', value)} />
            <NumberField label="Inset droit" value={safeInsets.right} min={0} onChange={(value) => setInsetField('right', value)} />
          </div>
        </>
      )}
    </div>
  );
}
