import type { Action, ActionType, MenuDefinition, StateDefinition, StateValue } from './menu';

/**
 * Actions au clic : types connus, valeurs par défaut, validation et résumé
 * lisible. Les règles suivent le parseur et le validateur de la lib
 * (`MenuParser`, `MenuValidator`, `StateDefinition.coerce`).
 */

/** Ce que l’éditeur sait du menu pour proposer et vérifier des actions. */
export interface ActionContext {
  /** États du menu résolu (gabarits et composants compris). */
  states: Record<string, StateDefinition>;
  /** Menus de l’espace de travail, pour `open`. */
  menus: ReadonlyArray<Pick<MenuDefinition, 'id' | 'name' | 'template' | 'component' | 'state'>>;
}

export interface ActionTypeInfo {
  type: ActionType;
  label: string;
  /** Une ligne d’aide, affichée sous le sélecteur de type. */
  hint: string;
}

export const ACTION_TYPES: readonly ActionTypeInfo[] = [
  { type: 'open', label: 'Ouvrir un menu', hint: 'Empile le menu : « Retour » y revient' },
  { type: 'back', label: 'Retour', hint: 'Menu précédent, ou fermeture s’il n’y en a pas' },
  { type: 'close', label: 'Fermer', hint: 'Ferme l’inventaire' },
  { type: 'setState', label: 'Changer l’état', hint: 'Donne une valeur à une variable d’état ; le titre est recomposé' },
  { type: 'nextPage', label: 'Page suivante', hint: 'Avance la pagination d’une liste' },
  { type: 'prevPage', label: 'Page précédente', hint: 'Recule la pagination d’une liste' },
  { type: 'sound', label: 'Jouer un son', hint: 'Son joué au joueur seulement' },
  { type: 'command', label: 'Commande', hint: 'Exécutée par le joueur ou par la console, variables comprises' },
  { type: 'custom', label: 'Action serveur', hint: 'Transmise à l’adaptateur du serveur (ClickActions…)' },
];

export const ACTION_LABELS = Object.fromEntries(ACTION_TYPES.map((info) => [info.type, info.label])) as Record<ActionType, string>;

export function isKnownActionType(type: unknown): type is ActionType {
  return typeof type === 'string' && type in ACTION_LABELS;
}

/** Sons courants de l’interface, proposés à la saisie. */
export const COMMON_SOUNDS = [
  'minecraft:ui.button.click',
  'minecraft:block.note_block.pling',
  'minecraft:block.note_block.hat',
  'minecraft:entity.experience_orb.pickup',
  'minecraft:entity.player.levelup',
  'minecraft:entity.villager.no',
  'minecraft:entity.villager.yes',
  'minecraft:item.book.page_turn',
  'minecraft:block.chest.open',
  'minecraft:block.chest.close',
  'minecraft:ui.toast.challenge_complete',
] as const;

/** Listes paginées du menu : `list` de chaque état `page`. */
export function pageLists(states: Record<string, StateDefinition>): string[] {
  const lists: string[] = [];
  for (const definition of Object.values(states)) {
    if (definition.type === 'page' && !lists.includes(definition.list)) lists.push(definition.list);
  }
  return lists;
}

/** Nom de l’état `page` qui pagine `list` (ou l’état `page` nommé `list`), comme `Pagination.pageStateFor`. */
export function pageStateFor(states: Record<string, StateDefinition>, list: string): string | null {
  for (const [name, definition] of Object.entries(states)) {
    if (definition.type === 'page' && definition.list === list) return name;
  }
  return states[list]?.type === 'page' ? list : null;
}

/** Valeur initiale d’un état, comme `StateDefinition.initialValue` de la lib. */
export function initialStateValue(definition: StateDefinition): StateValue {
  switch (definition.type) {
    case 'enum':
      return definition.default;
    case 'bool':
      return definition.default;
    case 'int': {
      const base = definition.default ?? definition.min ?? 0;
      return clampInt(base, definition.min, definition.max);
    }
    case 'page':
      return 1;
  }
}

function clampInt(value: number, min?: number, max?: number): number {
  let result = value;
  if (min !== undefined) result = Math.max(min, result);
  if (max !== undefined) result = Math.min(max, result);
  return result;
}

/**
 * Convertit une valeur pour un état, comme `StateDefinition.coerce` de la lib :
 * `enum` exige une valeur listée, `bool` un booléen (ou « true » / « false »),
 * `int` un entier ramené dans ses bornes, `page` un entier d’au moins 1.
 */
export function coerceStateValue(definition: StateDefinition, raw: unknown): { value: StateValue } | { error: string } {
  switch (definition.type) {
    case 'enum': {
      const value = String(raw);
      return definition.values.includes(value)
        ? { value }
        : { error: `« ${value} » n’est pas une valeur de l’état (${definition.values.join(', ')})` };
    }
    case 'bool':
      if (typeof raw === 'boolean') return { value: raw };
      if (raw === 'true' || raw === 'false') return { value: raw === 'true' };
      return { error: `booléen attendu, reçu « ${String(raw)} »` };
    case 'int':
    case 'page': {
      const number = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(number) || (typeof raw !== 'number' && !/^-?\d+$/.test(String(raw).trim()))) {
        return { error: `entier attendu, reçu « ${String(raw)} »` };
      }
      const rounded = Math.round(number);
      return definition.type === 'int'
        ? { value: clampInt(rounded, definition.min, definition.max) }
        : { value: Math.max(1, rounded) };
    }
  }
}

/** Action neuve d’un type donné, pré-remplie avec ce que le menu connaît déjà. */
export function createAction(type: ActionType, context: ActionContext, currentMenuId?: string): Action {
  switch (type) {
    case 'open': {
      const target = context.menus.find((menu) => menu.id !== currentMenuId && !menu.template && !menu.component);
      return { type, menu: target?.id ?? '' };
    }
    case 'back':
    case 'close':
      return { type };
    case 'setState': {
      const [name, definition] = Object.entries(context.states).find(([, candidate]) => candidate.type !== 'page') ?? [];
      return { type, state: name ?? '', value: definition ? initialStateValue(definition) : '' };
    }
    case 'nextPage':
    case 'prevPage':
      return { type, list: pageLists(context.states)[0] ?? '' };
    case 'sound':
      return { type, sound: COMMON_SOUNDS[0] };
    case 'command':
      return { type, command: 'say {viewer.name}', as: 'player' };
    case 'custom':
      return { type, id: '' };
  }
}

/** Problèmes d’une action, en français ; liste vide si tout va bien. */
export function validateAction(action: Action, context: ActionContext): string[] {
  const problems: string[] = [];
  const raw = action as unknown as Record<string, unknown>;
  if (!isKnownActionType(raw.type)) return [`type d’action inconnu « ${String(raw.type)} »`];
  switch (action.type) {
    case 'open': {
      if (!action.menu) {
        problems.push('choisis le menu à ouvrir');
        break;
      }
      const target = context.menus.find((menu) => menu.id === action.menu);
      if (!target) problems.push(`le menu « ${action.menu} » n’existe pas dans l’espace de travail`);
      else if (target.template) problems.push(`« ${action.menu} » est un gabarit : il ne s’ouvre pas seul`);
      else if (target.component) problems.push(`« ${action.menu} » est un composant : il ne s’ouvre pas seul`);
      for (const [name, value] of Object.entries(action.state ?? {})) {
        const definition = target?.state?.[name];
        if (target && !definition) problems.push(`état initial : « ${name} » n’existe pas dans « ${action.menu} »`);
        else if (definition) {
          const coerced = coerceStateValue(definition, value);
          if ('error' in coerced) problems.push(`état initial « ${name} » : ${coerced.error}`);
        }
      }
      break;
    }
    case 'setState': {
      if (!action.state) {
        problems.push('choisis la variable d’état à changer');
        break;
      }
      const definition = context.states[action.state];
      if (!definition) problems.push(`l’état « ${action.state} » n’existe pas dans ce menu`);
      else {
        const coerced = coerceStateValue(definition, action.value);
        if ('error' in coerced) problems.push(coerced.error);
      }
      break;
    }
    case 'nextPage':
    case 'prevPage':
      if (!action.list) problems.push('choisis la liste à paginer');
      else if (!pageStateFor(context.states, action.list)) {
        problems.push(`aucun état « page » ne pagine la liste « ${action.list} »`);
      }
      break;
    case 'sound':
      if (!action.sound.trim()) problems.push('indique l’identifiant du son (minecraft:…)');
      if (action.volume !== undefined && !(action.volume >= 0)) problems.push('le volume doit être positif');
      if (action.pitch !== undefined && !(action.pitch >= 0 && action.pitch <= 2)) problems.push('la hauteur va de 0 à 2');
      break;
    case 'command':
      if (!action.command.trim()) problems.push('indique la commande à exécuter');
      if (action.as !== undefined && action.as !== 'player' && action.as !== 'console') {
        problems.push('exécutant inconnu : « player » ou « console »');
      }
      break;
    case 'custom':
      if (!action.id.trim()) problems.push('indique l’identifiant de l’action serveur');
      break;
    case 'back':
    case 'close':
      break;
  }
  return problems;
}

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'vrai' : 'faux';
  return String(value);
}

/** Résumé d’une action en une ligne (« tab ← progress », « ouvre shop »…). */
export function describeAction(action: Action, menus: ActionContext['menus'] = []): string {
  switch (action.type) {
    case 'open': {
      const name = menus.find((menu) => menu.id === action.menu)?.name;
      const state = Object.entries(action.state ?? {}).map(([key, value]) => `${key} = ${formatValue(value)}`);
      const target = action.menu ? `« ${name ?? action.menu} »` : '(menu à choisir)';
      return `Ouvre ${target}${state.length > 0 ? ` avec ${state.join(', ')}` : ''}`;
    }
    case 'back':
      return 'Revient au menu précédent';
    case 'close':
      return 'Ferme l’inventaire';
    case 'setState':
      return action.state ? `${action.state} ← ${formatValue(action.value)}` : 'Change l’état (à choisir)';
    case 'nextPage':
      return `Page suivante${action.list ? ` de « ${action.list} »` : ''}`;
    case 'prevPage':
      return `Page précédente${action.list ? ` de « ${action.list} »` : ''}`;
    case 'sound':
      return `Son ${action.sound.replace(/^minecraft:/, '') || '(à choisir)'}`;
    case 'command':
      return `${action.as === 'console' ? 'Console' : 'Joueur'} : /${action.command.replace(/^\//, '')}`;
    case 'custom':
      return `Action serveur ${action.id || '(à nommer)'}`;
  }
}
