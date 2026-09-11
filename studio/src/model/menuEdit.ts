import type { MenuClipboard } from '../lib/clipboard';
import type { Selection } from '../state/editor';
import { GRID_COLUMNS, SLOT_SIZE, areaSize, moveArea } from './geometry';
import type { Point } from './geometry';
import { setEditorFlag, uniqueId } from './menu';
import type { EditorFlag, Layer, MenuDefinition, Slot, SlotArea, TextElement } from './menu';

/**
 * Opérations d’édition sur plusieurs éléments d’un menu : déplacer, supprimer,
 * dupliquer, coller, verrouiller / masquer. Fonctions pures (ou recettes sur
 * un brouillon), sans React.
 */

/** Nouvelle position d’un élément déplacé. */
export type ElementMove =
  | { kind: 'layer' | 'text'; id: string; x: number; y: number }
  | { kind: 'slot'; id: string; area: SlotArea };

type AnyElement = Layer | TextElement | Slot;

/** Chemin de la texture d’une couche générée par le studio. */
export function generatedTexturePath(menuId: string, layerId: string): string {
  return `generated/${menuId}/${layerId}.png`;
}

export function findElement(menu: MenuDefinition, target: Selection): AnyElement | undefined {
  if (target.kind === 'layer') return menu.layers.find((layer) => layer.id === target.id);
  if (target.kind === 'text') return menu.texts?.find((text) => text.id === target.id);
  return menu.slots?.find((slot) => slot.id === target.id);
}

/** Tous les éléments propres au menu : couches (de bas en haut), textes, slots. */
export function allTargets(menu: MenuDefinition): Selection[] {
  return [
    ...menu.layers.map((layer) => ({ kind: 'layer' as const, id: layer.id })),
    ...(menu.texts ?? []).map((text) => ({ kind: 'text' as const, id: text.id })),
    ...(menu.slots ?? []).map((slot) => ({ kind: 'slot' as const, id: slot.id })),
  ];
}

/** Applique des déplacements au brouillon. */
export function applyMoves(draft: MenuDefinition, moves: readonly ElementMove[]) {
  for (const move of moves) {
    if (move.kind === 'slot') {
      const slot = draft.slots?.find((candidate) => candidate.id === move.id);
      if (slot) slot.area = move.area;
      continue;
    }
    const element = findElement(draft, move) as Layer | TextElement | undefined;
    if (element) {
      element.x = move.x;
      element.y = move.y;
    }
  }
}

/** Menu avec des déplacements appliqués, sans modifier l’original (aperçu pendant un glisser). */
export function withMoves(menu: MenuDefinition, moves: readonly ElementMove[]): MenuDefinition {
  if (moves.length === 0) return menu;
  const byKey = new Map(moves.map((move) => [`${move.kind}:${move.id}`, move]));
  const moved = <T extends { id: string }>(kind: Selection['kind'], element: T): T => {
    const move = byKey.get(`${kind}:${element.id}`);
    if (!move) return element;
    return move.kind === 'slot' ? { ...element, area: move.area } : { ...element, x: move.x, y: move.y };
  };
  return {
    ...menu,
    layers: menu.layers.map((layer) => moved('layer', layer)),
    texts: menu.texts?.map((text) => moved('text', text)),
    slots: menu.slots?.map((slot) => moved('slot', slot)),
  };
}

/** Décalage commun des zones, en cellules, borné pour qu’aucune ne sorte de la grille. */
export function clampCellDelta(areas: readonly SlotArea[], col: number, row: number, rows: number): { col: number; row: number } {
  let minCol = -Infinity;
  let maxCol = Infinity;
  let minRow = -Infinity;
  let maxRow = Infinity;
  for (const area of areas) {
    const { width, height } = areaSize(area);
    minCol = Math.max(minCol, -area.col);
    maxCol = Math.min(maxCol, GRID_COLUMNS - area.col - width);
    minRow = Math.max(minRow, -area.row);
    maxRow = Math.min(maxRow, rows - area.row - height);
  }
  const bound = (value: number, min: number, max: number) => (max < min ? 0 : Math.min(max, Math.max(min, value)));
  return { col: bound(col, minCol, maxCol), row: bound(row, minRow, maxRow) };
}

/**
 * Déplacements d’un groupe d’éléments : couches et textes de `delta` pixels,
 * zones de `cells` cellules (bornées ensemble à la grille).
 */
export function translateMoves(
  menu: MenuDefinition,
  targets: readonly Selection[],
  delta: Point,
  cells: { col: number; row: number },
): ElementMove[] {
  const slots = targets.flatMap((target) => {
    const slot = target.kind === 'slot' ? menu.slots?.find((candidate) => candidate.id === target.id) : undefined;
    return slot ? [slot] : [];
  });
  const shift = clampCellDelta(
    slots.map((slot) => slot.area),
    cells.col,
    cells.row,
    menu.container.rows,
  );
  const moves: ElementMove[] = [];
  for (const target of targets) {
    const element = findElement(menu, target);
    if (!element) continue;
    if (target.kind === 'slot') {
      const { area } = element as Slot;
      if (shift.col !== 0 || shift.row !== 0) {
        moves.push({ kind: 'slot', id: target.id, area: { ...area, col: area.col + shift.col, row: area.row + shift.row } });
      }
    } else if (delta.x !== 0 || delta.y !== 0) {
      const { x, y } = element as Layer | TextElement;
      moves.push({ kind: target.kind, id: target.id, x: x + delta.x, y: y + delta.y });
    }
  }
  return moves;
}

/** Flèches : 1 px (18 px avec Maj) pour couches et textes, une cellule pour les zones. */
export function nudgeMoves(menu: MenuDefinition, targets: readonly Selection[], dx: number, dy: number): ElementMove[] {
  return translateMoves(menu, targets, { x: dx, y: dy }, { col: Math.sign(dx), row: Math.sign(dy) });
}

/**
 * Déplacements d’alignement : chaque élément reçoit son décalage en pixels ;
 * une zone de slots le reçoit arrondi à la cellule (et reste dans la grille).
 */
export function offsetMoves(menu: MenuDefinition, targets: readonly Selection[], offsets: readonly Point[]): ElementMove[] {
  const moves: ElementMove[] = [];
  targets.forEach((target, index) => {
    const offset = offsets[index];
    const element = findElement(menu, target);
    if (!element || !offset || (offset.x === 0 && offset.y === 0)) return;
    if (target.kind === 'slot') {
      const { area } = element as Slot;
      const next = moveArea(area, Math.round(offset.x / SLOT_SIZE), Math.round(offset.y / SLOT_SIZE), menu.container.rows);
      if (next.col !== area.col || next.row !== area.row) moves.push({ kind: 'slot', id: target.id, area: next });
      return;
    }
    const { x, y } = element as Layer | TextElement;
    moves.push({ kind: target.kind, id: target.id, x: x + offset.x, y: y + offset.y });
  });
  return moves;
}

export function removeElements(draft: MenuDefinition, targets: readonly Selection[]) {
  const doomed = new Set(targets.map((target) => `${target.kind}:${target.id}`));
  draft.layers = draft.layers.filter((layer) => !doomed.has(`layer:${layer.id}`));
  if (draft.texts) draft.texts = draft.texts.filter((text) => !doomed.has(`text:${text.id}`));
  if (draft.slots) draft.slots = draft.slots.filter((slot) => !doomed.has(`slot:${slot.id}`));
}

/** Pose ou retire un drapeau d’éditeur (verrou, masque) sur plusieurs éléments. */
export function setFlagOn(draft: MenuDefinition, targets: readonly Selection[], flag: EditorFlag, value: boolean) {
  for (const target of targets) {
    const element = findElement(draft, target);
    if (element) setEditorFlag(element, flag, value);
  }
}

/* Duplication et collage */

/** Identifiants déjà pris (menu résolu : un id de gabarit repris remplacerait l’élément hérité). */
export interface TakenIds {
  layer: Set<string>;
  text: Set<string>;
  slot: Set<string>;
}

export function takenIds(resolved: MenuDefinition): TakenIds {
  return {
    layer: new Set(resolved.layers.map((layer) => layer.id)),
    text: new Set((resolved.texts ?? []).map((text) => text.id)),
    slot: new Set((resolved.slots ?? []).map((slot) => slot.id)),
  };
}

/** Élément à insérer ; `after` : identifiant de l’élément au-dessus duquel le poser (sinon à la fin). */
export type NewElement =
  | { kind: 'layer'; element: Layer; after?: string }
  | { kind: 'text'; element: TextElement; after?: string }
  | { kind: 'slot'; element: Slot; after?: string };

/** Copie sous un identifiant libre, sans drapeaux d’éditeur (un collage n’arrive jamais verrouillé). */
function fresh<T extends { id: string; editor?: unknown }>(element: T, taken: Set<string>): T {
  const copy = structuredClone(element);
  delete copy.editor;
  copy.id = uniqueId(element.id, taken);
  taken.add(copy.id);
  return copy;
}

/** Couche copiée : une texture générée par le studio est rattachée au menu d’arrivée (à regénérer). */
function freshLayer(layer: Layer, taken: TakenIds, menuId: string, shift: number): Layer {
  const copy = fresh(layer, taken.layer);
  copy.x += shift * 4;
  copy.y += shift * 4;
  if (copy.generator) copy.texture = generatedTexturePath(menuId, copy.id);
  return copy;
}

function freshSlot(slot: Slot, taken: TakenIds, rows: number, col: number, row: number): Slot {
  const copy = fresh(slot, taken.slot);
  copy.area = moveArea(copy.area, col, row, rows);
  return copy;
}

/**
 * Ctrl+D : copies juste au-dessus des originaux, sur place (une zone de slots
 * est décalée d’une case pour ne pas recouvrir l’originale).
 */
export function duplicatePlan(menu: MenuDefinition, targets: readonly Selection[], taken: TakenIds): NewElement[] {
  const plan: NewElement[] = [];
  for (const target of targets) {
    const element = findElement(menu, target);
    if (!element) continue;
    if (target.kind === 'layer') plan.push({ kind: 'layer', element: freshLayer(element as Layer, taken, menu.id, 0), after: target.id });
    else if (target.kind === 'text') plan.push({ kind: 'text', element: fresh(element as TextElement, taken.text), after: target.id });
    else {
      const slot = element as Slot;
      const fitsRight = slot.area.col + areaSize(slot.area).width < GRID_COLUMNS;
      const copy = freshSlot(slot, taken, menu.container.rows, fitsRight ? 1 : 0, fitsRight ? 0 : 1);
      plan.push({ kind: 'slot', element: copy, after: target.id });
    }
  }
  return plan;
}

/** Collage : décalé de `shift` crans (4 px, une case pour les zones), identifiants rendus uniques. */
export function pastePlan(payload: MenuClipboard, menu: MenuDefinition, taken: TakenIds, shift: number): NewElement[] {
  return [
    ...payload.layers.map((layer): NewElement => ({ kind: 'layer', element: freshLayer(layer, taken, menu.id, shift) })),
    ...payload.texts.map((text): NewElement => {
      const copy = fresh(text, taken.text);
      copy.x += shift * 4;
      copy.y += shift * 4;
      return { kind: 'text', element: copy };
    }),
    ...payload.slots.map((slot): NewElement => ({ kind: 'slot', element: freshSlot(slot, taken, menu.container.rows, shift, shift) })),
  ];
}

function insertAfter<T extends { id: string }>(list: T[], element: T, after?: string) {
  const index = after === undefined ? -1 : list.findIndex((candidate) => candidate.id === after);
  if (index < 0) list.push(element);
  else list.splice(index + 1, 0, element);
}

export function insertElements(draft: MenuDefinition, plan: readonly NewElement[]) {
  for (const entry of plan) {
    if (entry.kind === 'layer') insertAfter(draft.layers, entry.element, entry.after);
    else if (entry.kind === 'text') insertAfter((draft.texts ??= []), entry.element, entry.after);
    else insertAfter((draft.slots ??= []), entry.element, entry.after);
  }
}

export function planSelection(plan: readonly NewElement[]): Selection[] {
  return plan.map((entry) => ({ kind: entry.kind, id: entry.element.id }));
}

/** Éléments sélectionnés, dans l’ordre du menu, prêts à copier. */
export function collectElements(menu: MenuDefinition, targets: readonly Selection[]) {
  const wanted = new Set(targets.map((target) => `${target.kind}:${target.id}`));
  return {
    layers: structuredClone(menu.layers.filter((layer) => wanted.has(`layer:${layer.id}`))),
    texts: structuredClone((menu.texts ?? []).filter((text) => wanted.has(`text:${text.id}`))),
    slots: structuredClone((menu.slots ?? []).filter((slot) => wanted.has(`slot:${slot.id}`))),
  };
}
