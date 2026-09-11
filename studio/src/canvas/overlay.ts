import type { ResizeHandle } from '../model/geometry';
import { OVERLAY, labelFont } from './theme';

/**
 * Surimpressions de la toile, dessinées en pixels écran (transformation
 * identité) pour rester nettes quel que soit le zoom : tout est tracé par
 * aplats entiers plutôt que par traits anticrénelés.
 */

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface HandlePoint {
  handle: ResizeHandle;
  x: number;
  y: number;
}

/** Côté d’une poignée, bord noir compris. */
export const HANDLE_SIZE = 10;

export function expandRect(rect: ScreenRect, by: number): ScreenRect {
  return { left: rect.left - by, top: rect.top - by, right: rect.right + by, bottom: rect.bottom + by };
}

export function withAlpha(hex: string, alpha: number): string {
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

/** Anneau plein de `width` px posé à l’intérieur de `rect`. */
function fillRing(ctx: CanvasRenderingContext2D, rect: ScreenRect, width: number, color: string) {
  const w = rect.right - rect.left;
  const h = rect.bottom - rect.top;
  ctx.fillStyle = color;
  ctx.fillRect(rect.left, rect.top, w, width);
  ctx.fillRect(rect.left, rect.bottom - width, w, width);
  ctx.fillRect(rect.left, rect.top + width, width, h - 2 * width);
  ctx.fillRect(rect.right - width, rect.top + width, width, h - 2 * width);
}

/** Cadre de sélection : or 2 px, bordé de noir 2 px, à l’extérieur de l’élément. */
export function drawSelectionFrame(ctx: CanvasRenderingContext2D, rect: ScreenRect) {
  fillRing(ctx, expandRect(rect, 4), 2, OVERLAY.ink);
  fillRing(ctx, expandRect(rect, 2), 2, OVERLAY.gold);
}

/** Contour de survol, plus discret que la sélection. */
export function drawHoverFrame(ctx: CanvasRenderingContext2D, rect: ScreenRect) {
  fillRing(ctx, expandRect(rect, 2), 2, OVERLAY.hover);
}

/** Les 8 poignées d’un cadre, coins d’abord (prioritaires au clic). */
export function rectHandles(rect: ScreenRect): HandlePoint[] {
  const centerX = Math.round((rect.left + rect.right) / 2);
  const centerY = Math.round((rect.top + rect.bottom) / 2);
  return [
    { handle: 'nw', x: rect.left, y: rect.top },
    { handle: 'ne', x: rect.right, y: rect.top },
    { handle: 'se', x: rect.right, y: rect.bottom },
    { handle: 'sw', x: rect.left, y: rect.bottom },
    { handle: 'n', x: centerX, y: rect.top },
    { handle: 'e', x: rect.right, y: centerY },
    { handle: 's', x: centerX, y: rect.bottom },
    { handle: 'w', x: rect.left, y: centerY },
  ];
}

export function drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const left = Math.round(x - HANDLE_SIZE / 2);
  const top = Math.round(y - HANDLE_SIZE / 2);
  ctx.fillStyle = OVERLAY.ink;
  ctx.fillRect(left, top, HANDLE_SIZE, HANDLE_SIZE);
  ctx.fillStyle = OVERLAY.gold;
  ctx.fillRect(left + 2, top + 2, HANDLE_SIZE - 4, HANDLE_SIZE - 4);
}

/** Repère d’alignement en pointillés, sur toute la toile. */
export function drawGuide(ctx: CanvasRenderingContext2D, axis: 'x' | 'y', position: number, width: number, height: number) {
  const at = Math.round(position) - 1;
  ctx.fillStyle = OVERLAY.guide;
  const length = axis === 'x' ? height : width;
  for (let offset = 0; offset < length; offset += 7) {
    if (axis === 'x') ctx.fillRect(at, offset, 2, 4);
    else ctx.fillRect(offset, at, 4, 2);
  }
}

export interface SlotZoneStyle {
  color: string;
  visible: boolean;
  enabled: boolean;
  inherited: boolean;
  label: string;
  fontSize: number;
}

/** Zone de slots : voile de la couleur du type, bord 2 px, étiquette en Pixelify Sans. */
export function drawSlotZone(ctx: CanvasRenderingContext2D, rect: ScreenRect, style: SlotZoneStyle) {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  ctx.save();
  ctx.globalAlpha = style.visible ? 1 : 0.35;
  ctx.fillStyle = withAlpha(style.color, style.enabled ? 0.22 : 0.08);
  ctx.fillRect(rect.left, rect.top, width, height);
  if (style.inherited) {
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(rect.left + 1, rect.top + 1, width - 2, height - 2);
    ctx.setLineDash([]);
  } else {
    fillRing(ctx, rect, 2, style.color);
  }
  ctx.beginPath();
  ctx.rect(rect.left + 2, rect.top + 2, width - 4, height - 4);
  ctx.clip();
  ctx.font = labelFont(style.fontSize);
  ctx.textBaseline = 'top';
  ctx.fillStyle = OVERLAY.ink;
  ctx.fillText(style.label, rect.left + 5, rect.top + 4);
  ctx.fillStyle = OVERLAY.labelText;
  ctx.fillText(style.label, rect.left + 4, rect.top + 3);
  ctx.restore();
}

/** Rectangle de sélection (glisser sur une zone vide) : voile d’or et cadre fin. */
export function drawMarquee(ctx: CanvasRenderingContext2D, rect: ScreenRect) {
  ctx.fillStyle = OVERLAY.draftFill;
  ctx.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
  fillRing(ctx, expandRect(rect, 1), 1, OVERLAY.ink);
  fillRing(ctx, rect, 1, OVERLAY.gold);
}

/** Cadre englobant d’une sélection multiple : pointillés d’or autour de l’ensemble. */
export function drawGroupFrame(ctx: CanvasRenderingContext2D, rect: ScreenRect) {
  const outer = expandRect(rect, 7);
  ctx.fillStyle = OVERLAY.gold;
  const dash = (x: number, y: number, w: number, h: number) => ctx.fillRect(x, y, w, h);
  for (let x = outer.left; x < outer.right; x += 8) {
    dash(x, outer.top, Math.min(4, outer.right - x), 1);
    dash(x, outer.bottom - 1, Math.min(4, outer.right - x), 1);
  }
  for (let y = outer.top; y < outer.bottom; y += 8) {
    dash(outer.left, y, 1, Math.min(4, outer.bottom - y));
    dash(outer.right - 1, y, 1, Math.min(4, outer.bottom - y));
  }
}

/** Aperçu de la zone en cours de tracé (outil Slots). */
export function drawDraftZone(ctx: CanvasRenderingContext2D, rect: ScreenRect) {
  ctx.fillStyle = OVERLAY.draftFill;
  ctx.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
  drawSelectionFrame(ctx, rect);
}

/** Étiquette de coordonnées au-dessus de l’élément (ou dessous s’il n’y a pas la place). */
export function drawTag(ctx: CanvasRenderingContext2D, text: string, anchor: ScreenRect, canvasWidth: number, canvasHeight: number) {
  ctx.save();
  ctx.font = labelFont(13);
  const paddingX = 6;
  const height = 20;
  const width = Math.ceil(ctx.measureText(text).width) + paddingX * 2;
  const left = Math.max(2, Math.min(anchor.left - 4, canvasWidth - width - 2));
  let top = anchor.top - height - 8;
  if (top < 2) top = Math.min(anchor.bottom + 8, canvasHeight - height - 2);
  ctx.fillStyle = OVERLAY.ink;
  ctx.fillRect(left, top, width, height);
  fillRing(ctx, { left, top, right: left + width, bottom: top + height }, 1, OVERLAY.gold);
  ctx.fillStyle = OVERLAY.labelText;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + paddingX, top + height / 2 + 1);
  ctx.restore();
}
