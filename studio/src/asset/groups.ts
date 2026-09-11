import type { AssetDefinition, AssetElement, AssetGroup } from './model';

/**
 * Groupes d’éléments d’un asset (un seul niveau). Les membres restent dans
 * `elements` et y sont **contigus** : un groupe s’empile comme un bloc, et le
 * rendu ne change pas. Les fonctions qui modifient prennent un brouillon
 * (recette de l’historique).
 */

export function findGroup(asset: AssetDefinition, groupId: string): AssetGroup | undefined {
  return asset.groups?.find((group) => group.id === groupId);
}

export function groupLabel(group: AssetGroup): string {
  return group.name?.trim() || group.id;
}

/** Identifiants des membres d’un groupe, dans l’ordre du fichier. */
export function groupMemberIds(asset: AssetDefinition, groupId: string): string[] {
  return asset.elements.filter((element) => element.group === groupId).map((element) => element.id);
}

/** Sélection étendue aux groupes : un membre sélectionné entraîne tout son groupe. */
export function expandToGroups(asset: AssetDefinition, ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  const groups = new Set(
    asset.elements.filter((element) => wanted.has(element.id) && element.group).map((element) => element.group),
  );
  for (const element of asset.elements) if (element.group && groups.has(element.group)) wanted.add(element.id);
  return asset.elements.filter((element) => wanted.has(element.id)).map((element) => element.id);
}

/** Groupes entièrement couverts par une sélection. */
export function selectedGroups(asset: AssetDefinition, ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  return (asset.groups ?? [])
    .filter((group) => {
      const members = groupMemberIds(asset, group.id);
      return members.length > 0 && members.every((id) => wanted.has(id));
    })
    .map((group) => group.id);
}

/** Replace les membres d’un groupe en bloc, à la place de leur membre le plus haut. */
function gather(elements: AssetElement[], isMember: (element: AssetElement) => boolean): AssetElement[] {
  const top = elements.findLastIndex(isMember);
  if (top < 0) return elements;
  const members = elements.filter(isMember);
  const others = elements.filter((element) => !isMember(element));
  const insertAt = elements.slice(0, top).filter((element) => !isMember(element)).length;
  others.splice(insertAt, 0, ...members);
  return others;
}

function contiguous(elements: readonly AssetElement[], groupId: string): boolean {
  const first = elements.findIndex((element) => element.group === groupId);
  const last = elements.findLastIndex((element) => element.group === groupId);
  return elements.slice(first, last + 1).every((element) => element.group === groupId);
}

/**
 * Remet le document d’aplomb : références à des groupes inconnus retirées,
 * groupes vides supprimés (clé `groups` retirée si plus aucun), membres
 * rendus contigus.
 */
export function normalizeGroups(draft: AssetDefinition) {
  const known = new Set((draft.groups ?? []).map((group) => group.id));
  for (const element of draft.elements) if (element.group && !known.has(element.group)) delete element.group;
  const used = new Set(draft.elements.map((element) => element.group).filter(Boolean));
  const groups = (draft.groups ?? []).filter((group) => used.has(group.id));
  if (groups.length > 0) draft.groups = groups;
  else delete draft.groups;
  for (let pass = 0; pass <= groups.length; pass++) {
    const broken = groups.find((group) => !contiguous(draft.elements, group.id));
    if (!broken) break;
    draft.elements = gather(draft.elements, (element) => element.group === broken.id);
  }
}

/**
 * Regroupe `ids` (au moins deux éléments) dans le groupe `groupId`, à la
 * place du membre le plus haut. Un membre d’un autre groupe le quitte.
 */
export function groupElements(draft: AssetDefinition, ids: readonly string[], groupId: string): boolean {
  const wanted = new Set(ids);
  if (draft.elements.filter((element) => wanted.has(element.id)).length < 2) return false;
  draft.elements = gather(draft.elements, (element) => wanted.has(element.id));
  for (const element of draft.elements) if (wanted.has(element.id)) element.group = groupId;
  draft.groups = [...(draft.groups ?? []), { id: groupId }];
  normalizeGroups(draft);
  return true;
}

/** Dissout des groupes : leurs membres restent en place, hors de tout groupe. */
export function ungroupElements(draft: AssetDefinition, groupIds: readonly string[]) {
  const dissolved = new Set(groupIds);
  for (const element of draft.elements) if (element.group && dissolved.has(element.group)) delete element.group;
  normalizeGroups(draft);
}

/** Plan d’un déplacement de bloc dans la pile : retirer `length` éléments à `from`, les réinsérer à `to`. */
interface BlockMove {
  from: number;
  length: number;
  to: number;
}

/** Unité voisine d’un bloc (élément seul, ou groupe entier), `[début, fin]` inclus. */
function neighbourUnit(elements: readonly AssetElement[], index: number, direction: 1 | -1, withinGroup?: string): [number, number] | null {
  const element = elements[index];
  if (!element) return null;
  if (withinGroup !== undefined) return element.group === withinGroup ? [index, index] : null;
  if (!element.group) return [index, index];
  let end = index;
  while (elements[end + direction]?.group === element.group) end += direction;
  return direction > 0 ? [index, end] : [end, index];
}

function planBlockMove(elements: readonly AssetElement[], ids: readonly string[], direction: 1 | -1): BlockMove | null {
  const wanted = new Set(ids);
  const indices = elements.flatMap((element, index) => (wanted.has(element.id) ? [index] : []));
  if (indices.length === 0) return null;
  const first = indices[0];
  const last = indices[indices.length - 1];
  if (last - first + 1 !== indices.length) return null;
  // Une partie d’un groupe ne bouge qu’à l’intérieur de son groupe ; un groupe entier saute ses voisins.
  const groups = new Set(indices.map((index) => elements[index].group));
  const [only] = groups;
  const within =
    groups.size === 1 && only !== undefined && elements.filter((element) => element.group === only).length > indices.length
      ? only
      : undefined;
  const unit = neighbourUnit(elements, direction > 0 ? last + 1 : first - 1, direction, within);
  if (!unit) return null;
  return { from: first, length: indices.length, to: direction > 0 ? unit[1] - indices.length + 1 : unit[0] };
}

/** Vrai si le bloc (élément, sélection contiguë ou groupe) peut monter (1) ou descendre (−1). */
export function canMoveBlock(asset: AssetDefinition, ids: readonly string[], direction: 1 | -1): boolean {
  return planBlockMove(asset.elements, ids, direction) !== null;
}

/** Monte (1) ou descend (−1) un bloc d’un cran ; un groupe voisin est franchi d’un coup. */
export function moveBlock(draft: AssetDefinition, ids: readonly string[], direction: 1 | -1): boolean {
  const plan = planBlockMove(draft.elements, ids, direction);
  if (!plan) return false;
  const block = draft.elements.splice(plan.from, plan.length);
  draft.elements.splice(plan.to, 0, ...block);
  return true;
}
