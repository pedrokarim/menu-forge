// Ce module n’importe que des types : les tests de parité (studio/tests) le chargent tel quel dans Node.
import type { Condition, Include, Layer, MenuDefinition, Slot, StateDefinition, TextElement } from './menu';

export type ElementKind = 'layer' | 'text' | 'slot';

/** D’où vient un élément qui n’est pas propre au menu. */
export interface ElementOrigin {
  kind: 'template' | 'component';
  /** Identifiant du gabarit (`extends`) ou du composant (`includes`). */
  id: string;
}

export interface ResolvedMenu {
  menu: MenuDefinition;
  /** Clés `kind:id` des éléments hérités d’un gabarit ou d’un composant (non éditables dans ce menu). */
  inherited: ReadonlySet<string>;
  /** Origine de chaque élément hérité (clé `kind:id`). */
  origins: ReadonlyMap<string, ElementOrigin>;
  errors: string[];
}

/** Taille d’une case du coffre en pixels (cf. model/geometry, SLOT_SIZE). */
const CELL = 18;

export function elementKey(kind: ElementKind, id: string): string {
  return `${kind}:${id}`;
}

/** Élément accompagné de son origine (`null` : propre au menu en cours de résolution). */
interface Tagged<T> {
  item: T;
  origin: ElementOrigin | null;
}

interface Resolution {
  state: Record<string, StateDefinition>;
  layers: Tagged<Layer>[];
  texts: Tagged<TextElement>[];
  slots: Tagged<Slot>[];
}

/** Ajoute `top` à `base` ; un id déjà présent est remplacé à sa position. */
function mergeById<T extends { id: string }>(base: Tagged<T>[], top: Tagged<T>[]): Tagged<T>[] {
  const result = [...base];
  for (const entry of top) {
    const index = result.findIndex((existing) => existing.item.id === entry.item.id);
    if (index >= 0) result[index] = entry;
    else result.push(entry);
  }
  return result;
}

function retag<T>(entries: Tagged<T>[], origin: ElementOrigin): Tagged<T>[] {
  return entries.map((entry) => ({ item: entry.item, origin }));
}

const own = <T>(items: T[] | undefined): Tagged<T>[] => (items ?? []).map((item) => ({ item, origin: null }));

/** Condition de l’instance ajoutée à celle de l’élément (les deux doivent être vraies). */
function combine(outer: Condition | undefined, inner: Condition | undefined): Condition | undefined {
  if (!outer) return inner;
  if (!inner) return outer;
  return { all: [outer, inner] };
}

/** Copie d’un élément de composant, sans les drapeaux d’éditeur du composant. */
function instanceCopy<T extends { id: string; editor?: unknown }>(element: T, prefix: string): T {
  const copy = { ...element, id: prefix + element.id };
  delete copy.editor;
  return copy;
}

/**
 * Éléments des instances de composants (`includes`), dans l’ordre des
 * instances, décalés et préfixés. Deux instances qui produisent le même
 * identifiant sont une erreur (il faut un préfixe).
 */
function expandIncludes(
  includes: readonly Include[],
  lookup: (id: string) => MenuDefinition | undefined,
  chain: string[],
  errors: string[],
): Resolution {
  const result: Resolution = { state: {}, layers: [], texts: [], slots: [] };
  const seen = { layer: new Set<string>(), text: new Set<string>(), slot: new Set<string>() };
  const unique = (kind: ElementKind, id: string, component: string) => {
    if (!seen[kind].has(id)) {
      seen[kind].add(id);
      return true;
    }
    errors.push(`Identifiant en double dans les composants : ${kind} « ${id} » (instance de « ${component} » ; donne-lui un préfixe)`);
    return false;
  };

  for (const include of includes) {
    const target = include.component;
    if (chain.includes(target)) {
      errors.push(`Cycle de gabarits ou de composants : ${[...chain, target].join(' → ')}`);
      continue;
    }
    const component = lookup(target);
    if (!component) {
      errors.push(`Composant introuvable : ${target}`);
      continue;
    }
    if (component.form) {
      errors.push(`« ${target} » est un formulaire Bedrock : il ne peut pas servir de composant`);
      continue;
    }
    const resolved = resolveRecursive(component, lookup, [...chain, target], errors);
    const origin: ElementOrigin = { kind: 'component', id: target };
    const prefix = include.prefix ?? '';
    const col = include.col ?? 0;
    const row = include.row ?? 0;
    const dx = col * CELL + (include.x ?? 0);
    const dy = row * CELL + (include.y ?? 0);

    for (const { item } of resolved.layers) {
      const layer = instanceCopy(item, prefix);
      if (!unique('layer', layer.id, target)) continue;
      layer.x += dx;
      layer.y += dy;
      const visibleWhen = combine(include.visibleWhen, item.visibleWhen);
      if (visibleWhen) layer.visibleWhen = visibleWhen;
      result.layers.push({ item: layer, origin });
    }
    for (const { item } of resolved.texts) {
      const text = instanceCopy(item, prefix);
      if (!unique('text', text.id, target)) continue;
      text.x += dx;
      text.y += dy;
      const visibleWhen = combine(include.visibleWhen, item.visibleWhen);
      if (visibleWhen) text.visibleWhen = visibleWhen;
      result.texts.push({ item: text, origin });
    }
    for (const { item } of resolved.slots) {
      const slot = instanceCopy(item, prefix);
      slot.area = { ...item.area, col: item.area.col + col, row: item.area.row + row };
      if (slot.area.col < 0 || slot.area.row < 0) {
        errors.push(`Composant « ${target} » : la zone « ${slot.id} » sort de la grille (colonne ${slot.area.col}, ligne ${slot.area.row})`);
        continue;
      }
      if (!unique('slot', slot.id, target)) continue;
      const visibleWhen = combine(include.visibleWhen, item.visibleWhen);
      if (visibleWhen) slot.visibleWhen = visibleWhen;
      result.slots.push({ item: slot, origin });
    }
    result.state = { ...result.state, ...resolved.state };
  }
  return result;
}

function resolveRecursive(
  menu: MenuDefinition,
  lookup: (id: string) => MenuDefinition | undefined,
  chain: string[],
  errors: string[],
): Resolution {
  let inherited: Resolution = { state: {}, layers: [], texts: [], slots: [] };

  for (const parentId of menu.extends ?? []) {
    if (chain.includes(parentId)) {
      errors.push(`Cycle de gabarits : ${[...chain, parentId].join(' → ')}`);
      continue;
    }
    const parent = lookup(parentId);
    if (!parent) {
      errors.push(`Gabarit introuvable : ${parentId}`);
      continue;
    }
    if (parent.form) {
      errors.push(`« ${parentId} » est un formulaire Bedrock : il ne peut pas servir de gabarit`);
      continue;
    }
    const resolved = resolveRecursive(parent, lookup, [...chain, parentId], errors);
    const origin: ElementOrigin = { kind: 'template', id: parentId };
    inherited = {
      state: { ...inherited.state, ...resolved.state },
      layers: mergeById(inherited.layers, retag(resolved.layers, origin)),
      texts: mergeById(inherited.texts, retag(resolved.texts, origin)),
      slots: mergeById(inherited.slots, retag(resolved.slots, origin)),
    };
  }

  // Éléments propres : ceux des instances de composants, puis ceux du menu (un id repris remplace l’élément de l’instance).
  const included = expandIncludes(menu.includes ?? [], lookup, chain, errors);
  return {
    state: { ...inherited.state, ...included.state, ...menu.state },
    layers: mergeById(inherited.layers, mergeById(included.layers, own(menu.layers))),
    texts: mergeById(inherited.texts, mergeById(included.texts, own(menu.texts))),
    slots: mergeById(inherited.slots, mergeById(included.slots, own(menu.slots))),
  };
}

/**
 * Applique les gabarits (`extends`) et les composants (`includes`) comme le
 * fait la lib (`TemplateResolver`, cf. docs/format.md § Gabarits et § Composants).
 */
export function resolveMenu(menu: MenuDefinition, lookup: (id: string) => MenuDefinition | undefined): ResolvedMenu {
  // Formulaire Bedrock : ni gabarit ni composant, il est déjà « résolu ».
  if (menu.form) {
    const errors: string[] = [];
    if ((menu.extends ?? []).length > 0) errors.push('Un formulaire Bedrock n’hérite pas de gabarit (extends ignoré)');
    if ((menu.includes ?? []).length > 0) errors.push('Un formulaire Bedrock n’inclut pas de composant (includes ignoré)');
    return { menu, inherited: new Set(), origins: new Map(), errors };
  }
  const errors: string[] = [];
  const resolved = resolveRecursive(menu, lookup, [menu.id], errors);

  const origins = new Map<string, ElementOrigin>();
  const collect = (kind: ElementKind, entries: Tagged<{ id: string }>[]) => {
    for (const entry of entries) if (entry.origin) origins.set(elementKey(kind, entry.item.id), entry.origin);
  };
  collect('layer', resolved.layers);
  collect('text', resolved.texts);
  collect('slot', resolved.slots);

  return {
    menu: {
      ...menu,
      state: resolved.state,
      layers: resolved.layers.map((entry) => entry.item),
      texts: resolved.texts.map((entry) => entry.item),
      slots: resolved.slots.map((entry) => entry.item),
    },
    inherited: new Set(origins.keys()),
    origins,
    errors,
  };
}
