import type { Action, Condition, MenuDefinition, StateDefinition } from './menu';

/**
 * Variables d’état vues par l’éditeur visuel : validation, conversion d’un
 * type à l’autre, renommage avec mise à jour des références du menu.
 */

export type StateType = StateDefinition['type'];

export const STATE_TYPES: ReadonlyArray<{ type: StateType; label: string; hint: string }> = [
  { type: 'enum', label: 'Liste de valeurs', hint: 'Onglet, filtre… : une valeur parmi une liste' },
  { type: 'bool', label: 'Booléen', hint: 'Vrai ou faux : une option cochée' },
  { type: 'int', label: 'Nombre entier', hint: 'Compteur, quantité : borné si min ou max sont donnés' },
  { type: 'page', label: 'Page d’une liste', hint: 'Pagination d’un slot « liste » : page.number, page.count…' },
];

/** Nom d’un état : sert dans `{state.<nom>}` et les drapeaux `<nom>.hasNext`, donc sans point. */
export const STATE_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

export function validateStateName(name: string, taken: Iterable<string>, current?: string): string | null {
  if (!STATE_NAME_PATTERN.test(name)) return 'Lettres, chiffres et _ uniquement (pas d’espace ni de point)';
  if (name !== current && new Set(taken).has(name)) return 'Une variable porte déjà ce nom';
  return null;
}

/** Problèmes d’une déclaration d’état (mêmes règles que le parseur de la lib). */
export function stateDefinitionProblems(definition: StateDefinition): string[] {
  switch (definition.type) {
    case 'enum': {
      const problems: string[] = [];
      if (definition.values.length === 0) problems.push('ajoute au moins une valeur');
      if (new Set(definition.values).size !== definition.values.length) problems.push('valeur en double');
      if (definition.values.some((value) => value.trim() === '')) problems.push('valeur vide');
      if (definition.values.length > 0 && !definition.values.includes(definition.default)) {
        problems.push('la valeur par défaut doit faire partie de la liste');
      }
      return problems;
    }
    case 'int':
      if (definition.min !== undefined && definition.max !== undefined && definition.min > definition.max) {
        return [`min (${definition.min}) est supérieur à max (${definition.max})`];
      }
      return [];
    case 'page':
      return definition.list.trim() ? [] : ['indique la liste paginée (nom de la source d’un slot liste)'];
    case 'bool':
      return [];
  }
}

/** Déclaration convertie vers un autre type, en gardant ce qui peut l’être. */
export function convertStateType(definition: StateDefinition, type: StateType, lists: readonly string[] = []): StateDefinition {
  if (definition.type === type) return definition;
  switch (type) {
    case 'enum': {
      const values = definition.type === 'bool' ? ['false', 'true'] : ['a', 'b'];
      return { type, values, default: definition.type === 'bool' ? String(definition.default) : values[0] };
    }
    case 'bool':
      return { type, default: false };
    case 'int':
      return { type, default: 0 };
    case 'page':
      return { type, list: lists[0] ?? 'items' };
  }
}

/** Déclaration neuve d’un type donné. */
export function createStateDefinition(type: StateType, lists: readonly string[] = []): StateDefinition {
  switch (type) {
    case 'enum':
      return { type, values: ['a', 'b'], default: 'a' };
    case 'bool':
      return { type, default: false };
    case 'int':
      return { type, default: 0 };
    case 'page':
      return { type, list: lists[0] ?? 'items' };
  }
}

/**
 * Recette : la valeur `from` de l’état `enum` nommé `state` devient `to`,
 * dans la déclaration (liste et défaut), les conditions et les `setState`.
 */
export function renameEnumValue(draft: MenuDefinition, state: string, from: string, to: string) {
  const definition = draft.state?.[state];
  if (!definition || definition.type !== 'enum' || from === to) return;
  definition.values = definition.values.map((value) => (value === from ? to : value));
  if (definition.default === from) definition.default = to;
  forEachCondition(draft, (condition) =>
    mapCondition(condition, (node) => {
      if (!('state' in node) || node.state !== state) return node;
      if ('is' in node) return node.is === from ? { ...node, is: to } : node;
      return { ...node, in: node.in.map((value) => (value === from ? to : value)) };
    }),
  );
  for (const slot of draft.slots ?? []) {
    for (const action of slot.onClick ?? []) {
      if (action.type === 'setState' && action.state === state && action.value === from) action.value = to;
    }
  }
  for (const button of draft.form?.buttons ?? []) {
    for (const action of button.onClick ?? []) {
      if (action.type === 'setState' && action.state === state && action.value === from) action.value = to;
    }
  }
}

/** Applique `fn` à chaque condition du menu (couches, textes, slots, instances). */
export function forEachCondition(menu: MenuDefinition, fn: (condition: Condition) => Condition | undefined) {
  for (const layer of menu.layers) if (layer.visibleWhen) layer.visibleWhen = fn(layer.visibleWhen);
  for (const text of menu.texts ?? []) if (text.visibleWhen) text.visibleWhen = fn(text.visibleWhen);
  for (const slot of menu.slots ?? []) {
    if (slot.visibleWhen) slot.visibleWhen = fn(slot.visibleWhen);
    if (slot.enabledWhen) slot.enabledWhen = fn(slot.enabledWhen);
  }
  for (const include of menu.includes ?? []) if (include.visibleWhen) include.visibleWhen = fn(include.visibleWhen);
  for (const button of menu.form?.buttons ?? []) if (button.visibleWhen) button.visibleWhen = fn(button.visibleWhen);
}

/** Condition réécrite nœud par nœud (feuilles comprises). */
export function mapCondition(condition: Condition, leaf: (node: Condition) => Condition): Condition {
  if ('all' in condition) return { all: condition.all.map((child) => mapCondition(child, leaf)) };
  if ('any' in condition) return { any: condition.any.map((child) => mapCondition(child, leaf)) };
  if ('not' in condition) return { not: mapCondition(condition.not, leaf) };
  return leaf(condition);
}

function renameVariables(text: string, from: string, to: string): string {
  return text
    .replaceAll(`{state.${from}}`, `{state.${to}}`)
    .replaceAll(`{${from}.number}`, `{${to}.number}`)
    .replaceAll(`{${from}.count}`, `{${to}.count}`);
}

/**
 * Recette : l’état `from` devient `to` dans le menu et partout où le menu le
 * cite (conditions, drapeaux de page, actions `setState`, variables des
 * textes et des items). L’ordre des états est conservé.
 */
export function renameState(draft: MenuDefinition, from: string, to: string) {
  if (from === to || !draft.state?.[from]) return;
  draft.state = Object.fromEntries(Object.entries(draft.state).map(([name, definition]) => [name === from ? to : name, definition]));
  forEachCondition(draft, (condition) =>
    mapCondition(condition, (node) => {
      if ('state' in node && node.state === from) return { ...node, state: to };
      if ('flag' in node && (node.flag === `${from}.hasPrev` || node.flag === `${from}.hasNext`)) {
        return { flag: `${to}.${node.flag.slice(from.length + 1)}` };
      }
      return node;
    }),
  );
  for (const text of draft.texts ?? []) text.value = renameVariables(text.value, from, to);
  for (const slot of draft.slots ?? []) {
    for (const action of slot.onClick ?? []) if (action.type === 'setState' && action.state === from) action.state = to;
    if (slot.item?.name) slot.item.name = renameVariables(slot.item.name, from, to);
    if (slot.item?.lore) slot.item.lore = slot.item.lore.map((line) => renameVariables(line, from, to));
  }
  if (draft.form) {
    draft.form.title = renameVariables(draft.form.title, from, to);
    if (draft.form.content !== undefined) draft.form.content = renameVariables(draft.form.content, from, to);
    for (const button of draft.form.buttons) {
      for (const action of button.onClick ?? []) if (action.type === 'setState' && action.state === from) action.state = to;
      button.text = renameVariables(button.text, from, to);
      if (button.subtitle !== undefined) button.subtitle = renameVariables(button.subtitle, from, to);
    }
  }
}

function conditionCites(condition: Condition | undefined, name: string): boolean {
  if (!condition) return false;
  if ('all' in condition) return condition.all.some((child) => conditionCites(child, name));
  if ('any' in condition) return condition.any.some((child) => conditionCites(child, name));
  if ('not' in condition) return conditionCites(condition.not, name);
  if ('flag' in condition) return condition.flag === `${name}.hasPrev` || condition.flag === `${name}.hasNext`;
  return condition.state === name;
}

const citesAction = (action: Action, name: string) => action.type === 'setState' && action.state === name;

/** États de `states` cités par les éléments du menu (pour les emporter dans un composant). */
export function referencedStates(menu: MenuDefinition, states: Record<string, StateDefinition>): Record<string, StateDefinition> {
  return Object.fromEntries(Object.entries(states).filter(([name]) => stateUsageCount(menu, name) > 0));
}

/** Nombre d’éléments du menu qui citent l’état (pour prévenir avant de le supprimer). */
export function stateUsageCount(menu: MenuDefinition, name: string): number {
  const variable = (text: string | undefined) =>
    Boolean(text && (text.includes(`{state.${name}}`) || text.includes(`{${name}.number}`) || text.includes(`{${name}.count}`)));
  let count = 0;
  for (const layer of menu.layers) if (conditionCites(layer.visibleWhen, name)) count++;
  for (const text of menu.texts ?? []) if (conditionCites(text.visibleWhen, name) || variable(text.value)) count++;
  for (const slot of menu.slots ?? []) {
    const cited =
      conditionCites(slot.visibleWhen, name) ||
      conditionCites(slot.enabledWhen, name) ||
      (slot.onClick ?? []).some((action) => citesAction(action, name)) ||
      variable(slot.item?.name) ||
      (slot.item?.lore ?? []).some(variable);
    if (cited) count++;
  }
  if (menu.form && (variable(menu.form.title) || variable(menu.form.content))) count++;
  for (const button of menu.form?.buttons ?? []) {
    const cited =
      conditionCites(button.visibleWhen, name) ||
      (button.onClick ?? []).some((action) => citesAction(action, name)) ||
      variable(button.text) ||
      variable(button.subtitle);
    if (cited) count++;
  }
  return count;
}
