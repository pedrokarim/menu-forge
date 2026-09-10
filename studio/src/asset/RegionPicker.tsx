import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { NumberField } from '../components/fields';
import type { LoadedTexture } from '../lib/textures';
import { fillChecker } from './canvasUtils';
import { clamp, clampInsets, clampRegion, rectFromPixels } from './geometry';
import type { Point } from './geometry';
import type { Insets, Region } from './model';
import { MAX_CANVAS_SIDE } from './presets';

const PICKER_ZOOMS = [1, 2, 3, 4, 6, 8, 12, 16] as const;
/** Largeur visée pour le zoom automatique (colonne de droite). */
const PICKER_TARGET = 288;
const LINE_HIT = 4;

type InsetSide = keyof Insets;

type PickerDrag = { kind: 'region'; start: Point; moved: boolean } | { kind: 'inset'; side: InsetSide; started: boolean };

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
}

/** Zooms possibles sans dépasser la taille maximale de toile. */
function allowedZooms(texture: LoadedTexture | null | undefined): number[] {
  const side = Math.max(texture?.width ?? 1, texture?.height ?? 1, 1);
  const levels = PICKER_ZOOMS.filter((level) => side * level <= MAX_CANVAS_SIDE);
  return levels.length > 0 ? levels : [1];
}

function autoZoom(texture: LoadedTexture | null | undefined): number {
  if (!texture) return 1;
  const fit = Math.max(1, Math.floor(PICKER_TARGET / Math.max(texture.width, texture.height, 1)));
  return allowedZooms(texture).filter((level) => level <= fit).at(-1) ?? 1;
}

/**
 * Sélecteur visuel : aperçu agrandi de la texture, où l’on trace la zone
 * source à la souris ; les lignes des insets sont affichées et se déplacent
 * en les tirant.
 */
export function RegionPicker({ texture, region, insets, onBeginEdit, onRegionChange, onInsetsChange }: RegionPickerProps) {
  const [zoomChoice, setZoomChoice] = useState<number | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [cursor, setCursor] = useState('crosshair');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<PickerDrag | null>(null);

  const zoomLevels = allowedZooms(texture);
  const zoom = Math.min(zoomChoice ?? autoZoom(texture), zoomLevels.at(-1) ?? 1);
  const textureWidth = texture?.width ?? 0;
  const textureHeight = texture?.height ?? 0;
  const area = clampRegion(region, textureWidth, textureHeight);
  const safeInsets = insets ? clampInsets(insets, area) : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !texture) return;
    const width = texture.width * zoom;
    const height = texture.height * zoom;
    canvas.width = width;
    canvas.height = height;
    ctx.imageSmoothingEnabled = false;
    fillChecker(ctx, 0, 0, width, height, 8);
    ctx.drawImage(texture.image, 0, 0, texture.width, texture.height, 0, 0, width, height);

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
      ctx.strokeStyle = '#ff3d7f';
      ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
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
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toTexture(event);
    const side = onInsetsChange ? insetAt(point) : null;
    dragRef.current = side
      ? { kind: 'inset', side, started: false }
      : { kind: 'region', start: clampPixel(point), moved: false };
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
    if (drag?.kind === 'inset' && safeInsets && onInsetsChange) {
      if (!drag.started) {
        drag.started = true;
        onBeginEdit();
      }
      onInsetsChange({ ...safeInsets, [drag.side]: insetValue(drag.side, point, safeInsets) }, true);
      return;
    }
    const side = onInsetsChange ? insetAt(point) : null;
    const nextCursor = side === 'left' || side === 'right' ? 'ew-resize' : side ? 'ns-resize' : 'crosshair';
    if (nextCursor !== cursor) setCursor(nextCursor);
  }

  function handlePointerUp() {
    dragRef.current = null;
  }

  if (texture === undefined) return <p className="muted small">Chargement de la texture…</p>;
  if (texture === null) return <p className="warning">Texture introuvable dans l’espace de travail.</p>;

  const setRegionField = (key: keyof Region, value: number) => onRegionChange({ ...area, [key]: value }, false);
  const setInsetField = (key: InsetSide, value: number) => {
    if (safeInsets && onInsetsChange) onInsetsChange({ ...safeInsets, [key]: Math.max(0, value) }, false);
  };
  const opaque = texture.bounds;

  return (
    <div className="asset-region-picker">
      <div className="asset-region-toolbar">
        <select
          value={zoom}
          onChange={(event) => setZoomChoice(Number(event.target.value))}
          aria-label="Zoom de l’aperçu"
        >
          {zoomLevels.map((level) => (
            <option key={level} value={level}>
              ×{level}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => onRegionChange(undefined, false)} disabled={!region}>
          Toute l’image
        </button>
        <button
          type="button"
          disabled={!opaque}
          title="Recadrer sur les pixels non transparents"
          onClick={() =>
            opaque && onRegionChange({ x: opaque.cropX, y: opaque.cropY, width: opaque.width, height: opaque.height }, false)
          }
        >
          Contenu opaque
        </button>
      </div>
      <div className="asset-region-scroll">
        <canvas
          ref={canvasRef}
          style={{ width: texture.width * zoom, height: texture.height * zoom, cursor }}
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
      </p>
      <p className="field-hint">
        Glisse sur l’aperçu pour tracer la zone source{safeInsets ? ' ; tire les lignes turquoise pour régler les insets' : ''}.
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
