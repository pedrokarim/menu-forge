import type { AssetClipboard } from '../lib/clipboard';
import { uniqueId } from '../model/menu';
import type { Point } from './geometry';
import { normalizeGroups } from './groups';
import type { AssetDefinition, AssetElement, AssetGroup } from './model';

/**
 * Opérations d’édition sur plusieurs éléments d’un asset : déplacer,
 * supprimer, verrouiller / masquer, copier, coller, dupliquer. Recettes sur
 * un brouillon (historique) ou fonctions pures.
 */

/** Drapeau booléen d’un élément : masqué (ni affiché ni exporté) ou verrouillé (non sélectionnable). */
export type ElementFlag = 'hidden' | 'locked';

export function translateElements(draft: AssetDefinition, ids: readonly string[], dx: number, dy: number) {
  const wanted = new Set(ids);
  for (const element of draft.elements) {
    if (!wanted.has(element.id)) continue;
    element.x += dx;
    element.y += dy;
  }
}

/** Décalage propre à chaque élément (alignement, répartition). */
export function offsetElements(draft: AssetDefinition, ids: readonly string[], offsets: readonly Point[]) {
  ids.forEach((id, index) => {
    const element = draft.elements.find((candidate) => candidate.id === id);
    const offset = offsets[index];
    if (!element || !offset) return;
    element.x += offset.x;
    element.y += offset.y;
  });
}

export function removeElements(draft: AssetDefinition, ids: readonly string[]) {
  const doomed = new Set(ids);
  draft.elements = draft.elements.filter((element) => !doomed.has(element.id));
  normalizeGroups(draft);
}

export function setElementFlag(draft: AssetDefinition, ids: readonly string[], flag: ElementFlag, value: boolean) {
  const wanted = new Set(ids);
  for (const element of draft.elements) {
    if (!wanted.has(element.id)) continue;
    if (value) element[flag] = true;
    else delete element[flag];
  }
}

/** Éléments sélectionnés (dans l’ordre du fichier) et leurs groupes, prêts à copier. */
export function collectForClipboard(asset: AssetDefinition, ids: readonly string[]): { elements: AssetElement[]; groups: AssetGroup[] } {
  const wanted = new Set(ids);
  const elements = structuredClone(asset.elements.filter((element) => wanted.has(element.id)));
  const used = new Set(elements.map((element) => element.group).filter(Boolean));
  const groups = structuredClone((asset.groups ?? []).filter((group) => used.has(group.id)));
  return { elements, groups };
}

/** Éléments et groupes à insérer (identifiants déjà rendus uniques). */
export interface AssetPastePlan {
  elements: AssetElement[];
  groups: AssetGroup[];
}

/**
 * Collage (ou duplication) : copies décalées de `shift` crans de 4 px,
 * identifiants uniques ; les groupes copiés deviennent de nouveaux groupes.
 * Une copie n’arrive jamais verrouillée ; le masquage (qui touche l’export) est gardé.
 */
export function pastePlan(payload: Pick<AssetClipboard, 'elements' | 'groups'>, asset: AssetDefinition, shift: number): AssetPastePlan {
  const takenElements = new Set(asset.elements.map((element) => element.id));
  const takenGroups = new Set((asset.groups ?? []).map((group) => group.id));
  const groupIds = new Map<string, string>();
  const groups = payload.groups.map((group) => {
    const id = uniqueId(group.id, takenGroups);
    takenGroups.add(id);
    groupIds.set(group.id, id);
    return { ...structuredClone(group), id };
  });
  const elements = payload.elements.map((element) => {
    const copy = structuredClone(element);
    copy.id = uniqueId(element.id, takenElements);
    takenElements.add(copy.id);
    copy.x += shift * 4;
    copy.y += shift * 4;
    delete copy.locked;
    const group = copy.group ? groupIds.get(copy.group) : undefined;
    if (group) copy.group = group;
    else delete copy.group;
    return copy;
  });
  return { elements, groups: groups.filter((group) => elements.some((element) => element.group === group.id)) };
}

/** Insère un collage au-dessus de tout (fin de la pile), groupes compris. */
export function insertPasted(draft: AssetDefinition, plan: AssetPastePlan) {
  draft.elements.push(...structuredClone(plan.elements));
  if (plan.groups.length > 0) draft.groups = [...(draft.groups ?? []), ...structuredClone(plan.groups)];
  normalizeGroups(draft);
}
