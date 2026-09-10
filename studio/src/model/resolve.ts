import type { MenuDefinition } from './menu';

export type ElementKind = 'layer' | 'text' | 'slot';

export interface ResolvedMenu {
  menu: MenuDefinition;
  /** Clés `kind:id` des éléments hérités d’un gabarit (non éditables dans ce menu). */
  inherited: ReadonlySet<string>;
  errors: string[];
}

export function elementKey(kind: ElementKind, id: string): string {
  return `${kind}:${id}`;
}

/** Ajoute `overrides` à `base` ; un id déjà présent est remplacé à sa position. */
function mergeById<T extends { id: string }>(base: T[], overrides: T[]): T[] {
  const result = [...base];
  for (const item of overrides) {
    const index = result.findIndex((existing) => existing.id === item.id);
    if (index >= 0) result[index] = item;
    else result.push(item);
  }
  return result;
}

function resolveRecursive(
  menu: MenuDefinition,
  lookup: (id: string) => MenuDefinition | undefined,
  chain: string[],
  errors: string[],
): MenuDefinition {
  let state: MenuDefinition['state'] = {};
  let layers: MenuDefinition['layers'] = [];
  let texts: NonNullable<MenuDefinition['texts']> = [];
  let slots: NonNullable<MenuDefinition['slots']> = [];

  for (const parentId of menu.extends ?? []) {
    if (chain.includes(parentId)) {
      errors.push(`Cycle de gabarits : ${[...chain, parentId].join(' → ')}`);
      continue;
    }
    const parent = lookup(parentId);
    if (!parent) {
      errors.push(`Gabarit introuvable : ${parentId}`);
      continue;
    }
    const resolved = resolveRecursive(parent, lookup, [...chain, parentId], errors);
    state = { ...state, ...resolved.state };
    layers = mergeById(layers, resolved.layers);
    texts = mergeById(texts, resolved.texts ?? []);
    slots = mergeById(slots, resolved.slots ?? []);
  }

  return {
    ...menu,
    state: { ...state, ...menu.state },
    layers: mergeById(layers, menu.layers),
    texts: mergeById(texts, menu.texts ?? []),
    slots: mergeById(slots, menu.slots ?? []),
  };
}

/** Applique les gabarits (`extends`) comme le fera la lib (cf. docs/format.md § Gabarits). */
export function resolveMenu(
  menu: MenuDefinition,
  lookup: (id: string) => MenuDefinition | undefined,
): ResolvedMenu {
  const errors: string[] = [];
  const resolved = resolveRecursive(menu, lookup, [menu.id], errors);

  const own = new Set([
    ...menu.layers.map((layer) => elementKey('layer', layer.id)),
    ...(menu.texts ?? []).map((text) => elementKey('text', text.id)),
    ...(menu.slots ?? []).map((slot) => elementKey('slot', slot.id)),
  ]);
  const inherited = new Set<string>();
  const collect = (kind: ElementKind, ids: string[]) => {
    for (const id of ids) {
      const key = elementKey(kind, id);
      if (!own.has(key)) inherited.add(key);
    }
  };
  collect('layer', resolved.layers.map((layer) => layer.id));
  collect('text', (resolved.texts ?? []).map((text) => text.id));
  collect('slot', (resolved.slots ?? []).map((slot) => slot.id));

  return { menu: resolved, inherited, errors };
}
