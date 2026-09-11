import type { MenuDefinition } from './menu';

/** Références d’un menu à un autre : héritage (`extends`) et actions `open`. */

export interface MenuReference {
  id: string;
  name: string;
  /** Le menu hérite du menu visé (`extends`). */
  inherits: boolean;
  /** Nombre d’actions `open` qui ouvrent le menu visé. */
  opens: number;
  /** Nombre d’instances du menu visé, quand c’est un composant (`includes`). */
  includes: number;
}

function openActions(menu: MenuDefinition, target: string): number {
  let count = 0;
  for (const slot of menu.slots ?? []) {
    for (const action of slot.onClick ?? []) if (action.type === 'open' && action.menu === target) count++;
  }
  return count;
}

/** Menus qui font référence à `target` (hors `target` lui-même). */
export function menuReferences(menus: readonly MenuDefinition[], target: string): MenuReference[] {
  return menus
    .filter((menu) => menu.id !== target)
    .map((menu) => ({
      id: menu.id,
      name: menu.name,
      inherits: (menu.extends ?? []).includes(target),
      opens: openActions(menu, target),
      includes: (menu.includes ?? []).filter((include) => include.component === target).length,
    }))
    .filter((reference) => reference.inherits || reference.opens > 0 || reference.includes > 0);
}

/** Recette : remplace les références à `from` par `to` ; vrai si quelque chose a changé. */
export function rewriteMenuReferences(draft: MenuDefinition, from: string, to: string): boolean {
  let changed = false;
  if (draft.extends?.includes(from)) {
    draft.extends = draft.extends.map((id) => (id === from ? to : id));
    changed = true;
  }
  for (const slot of draft.slots ?? []) {
    for (const action of slot.onClick ?? []) {
      if (action.type === 'open' && action.menu === from) {
        action.menu = to;
        changed = true;
      }
    }
  }
  // Instances d’un composant renommé : elles suivent le nouvel identifiant.
  for (const include of draft.includes ?? []) {
    if (include.component === from) {
      include.component = to;
      changed = true;
    }
  }
  return changed;
}

/** « hérite », « ouvre 2 fois »… pour la liste des références. */
export function describeReference(reference: MenuReference): string {
  const parts: string[] = [];
  if (reference.inherits) parts.push('en hérite');
  if (reference.opens > 0) parts.push(reference.opens > 1 ? `l’ouvre (${reference.opens} actions)` : 'l’ouvre');
  if (reference.includes > 0) parts.push(reference.includes > 1 ? `l’inclut (${reference.includes} instances)` : 'l’inclut');
  return parts.join(' et ');
}
