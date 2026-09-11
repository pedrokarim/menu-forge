import type { Condition, MenuDefinition, StateDefinition, StateValue } from './menu';

/** Toutes les conditions d’un menu (couches, textes, slots, instances de composants). */
export function menuConditions(menu: MenuDefinition): Condition[] {
  const conditions: Array<Condition | undefined> = [
    ...menu.layers.map((layer) => layer.visibleWhen),
    ...(menu.texts ?? []).map((text) => text.visibleWhen),
    ...(menu.slots ?? []).flatMap((slot) => [slot.visibleWhen, slot.enabledWhen]),
    ...(menu.includes ?? []).map((include) => include.visibleWhen),
    ...(menu.form?.buttons ?? []).map((button) => button.visibleWhen),
  ];
  return conditions.filter((condition): condition is Condition => condition !== undefined);
}

/**
 * Conditions du format vues par l’éditeur visuel : nature d’un nœud, résumé
 * lisible en une ligne, drapeaux connus, contrôle de cohérence et lecture
 * sûre d’un JSON saisi à la main.
 */

export type ConditionKind = 'all' | 'any' | 'not' | 'is' | 'in' | 'flag';

export const CONDITION_KINDS: ReadonlyArray<{ kind: ConditionKind; label: string; hint: string }> = [
  { kind: 'is', label: 'État égal à', hint: 'Une variable d’état vaut une valeur précise' },
  { kind: 'in', label: 'État parmi', hint: 'Une variable d’état vaut l’une des valeurs cochées' },
  { kind: 'flag', label: 'Drapeau levé', hint: 'Booléen fourni par la lib (page.*) ou par le serveur (viewer.*…)' },
  { kind: 'all', label: 'Toutes (et)', hint: 'Vraie si toutes les conditions du groupe le sont' },
  { kind: 'any', label: 'Au moins une (ou)', hint: 'Vraie si une condition du groupe l’est' },
  { kind: 'not', label: 'Pas (inverse)', hint: 'Vraie si la condition contenue est fausse' },
];

export function conditionKind(condition: Condition): ConditionKind {
  if ('all' in condition) return 'all';
  if ('any' in condition) return 'any';
  if ('not' in condition) return 'not';
  if ('flag' in condition) return 'flag';
  if ('in' in condition) return 'in';
  return 'is';
}

function formatValue(value: StateValue): string {
  if (typeof value === 'boolean') return value ? 'vrai' : 'faux';
  return String(value);
}

/** Valeur par défaut d’un état pour une nouvelle condition. */
function firstValue(definition: StateDefinition | undefined): StateValue {
  if (!definition) return '';
  if (definition.type === 'enum') return definition.values[0] ?? '';
  if (definition.type === 'bool') return true;
  if (definition.type === 'int') return definition.default ?? definition.min ?? 0;
  return 1;
}

/** Drapeau de pagination (`<état>.hasPrev` / `<état>.hasNext`) : l’état et le sens, sinon `null`. */
function pageFlag(flag: string, states: Record<string, StateDefinition>): { state: string; next: boolean } | null {
  const match = /^(.+)\.(hasPrev|hasNext)$/.exec(flag);
  if (!match || states[match[1]]?.type !== 'page') return null;
  return { state: match[1], next: match[2] === 'hasNext' };
}

/** Libellé d’un drapeau (« page suivante disponible »…). */
export function flagLabel(flag: string, states: Record<string, StateDefinition> = {}, negated = false): string {
  const page = pageFlag(flag, states);
  if (page) {
    const prefix = page.state === 'page' ? '' : `${page.state} : `;
    const which = page.next ? 'page suivante' : 'page précédente';
    return `${prefix}${negated ? `pas de ${which}` : `${which} disponible`}`;
  }
  return negated ? `sans ${flag}` : flag;
}

/** Drapeaux proposés : ceux de la pagination du menu, puis les autres drapeaux connus. */
export function knownFlags(states: Record<string, StateDefinition>, extra: Iterable<string> = []): Array<{ flag: string; label: string }> {
  const flags = new Map<string, string>();
  for (const [name, definition] of Object.entries(states)) {
    if (definition.type !== 'page') continue;
    for (const suffix of ['hasPrev', 'hasNext']) flags.set(`${name}.${suffix}`, flagLabel(`${name}.${suffix}`, states));
  }
  for (const flag of extra) {
    const trimmed = flag.trim();
    if (trimmed && !flags.has(trimmed)) flags.set(trimmed, flagLabel(trimmed, states));
  }
  if (!flags.has('viewer.isStaff')) flags.set('viewer.isStaff', 'viewer.isStaff');
  return [...flags].map(([flag, label]) => ({ flag, label }));
}

/** Tous les drapeaux cités par une condition. */
export function collectFlags(condition: Condition | undefined, into: Set<string> = new Set()): Set<string> {
  if (!condition) return into;
  if ('all' in condition) condition.all.forEach((child) => collectFlags(child, into));
  else if ('any' in condition) condition.any.forEach((child) => collectFlags(child, into));
  else if ('not' in condition) collectFlags(condition.not, into);
  else if ('flag' in condition) into.add(condition.flag);
  return into;
}

function describeLeaf(condition: Condition, states: Record<string, StateDefinition>, negated: boolean): string | null {
  if ('flag' in condition) return flagLabel(condition.flag, states, negated);
  if ('is' in condition) return `${condition.state} ${negated ? '≠' : '='} ${formatValue(condition.is)}`;
  if ('in' in condition) {
    const values = condition.in.map(formatValue);
    if (values.length === 0) return negated ? 'toujours' : 'jamais';
    return negated ? `${condition.state} ni ${values.join(' ni ')}` : `${condition.state} = ${values.join(' ou ')}`;
  }
  return null;
}

/**
 * Résumé en une ligne : « tab = progress et page suivante disponible ».
 * Une condition absente se lit « toujours ».
 */
export function describeCondition(condition: Condition | undefined, states: Record<string, StateDefinition> = {}): string {
  if (!condition) return 'toujours';
  const inner = (child: Condition, parent: 'all' | 'any'): string => {
    const text = describeCondition(child, states);
    const kind = conditionKind(child);
    const grouped = (kind === 'all' || kind === 'any') && kind !== parent && childCount(child) > 1;
    return grouped ? `(${text})` : text;
  };
  if ('all' in condition) {
    if (condition.all.length === 0) return 'toujours';
    return condition.all.map((child) => inner(child, 'all')).join(' et ');
  }
  if ('any' in condition) {
    if (condition.any.length === 0) return 'jamais';
    return condition.any.map((child) => inner(child, 'any')).join(' ou ');
  }
  if ('not' in condition) {
    const leaf = describeLeaf(condition.not, states, true);
    return leaf ?? `pas (${describeCondition(condition.not, states)})`;
  }
  return describeLeaf(condition, states, false) ?? '?';
}

function childCount(condition: Condition): number {
  if ('all' in condition) return condition.all.length;
  if ('any' in condition) return condition.any.length;
  return 1;
}

/** Nouvelle condition d’une nature donnée, pré-remplie avec les états du menu. */
export function createCondition(kind: ConditionKind, states: Record<string, StateDefinition>): Condition {
  const entries = Object.entries(states).filter(([, definition]) => definition.type !== 'page');
  const [name, definition] = entries.find(([, candidate]) => candidate.type === 'enum') ?? entries[0] ?? [];
  switch (kind) {
    case 'all':
      return { all: [] };
    case 'any':
      return { any: [] };
    case 'not':
      return { not: createCondition('flag', states) };
    case 'is':
      return { state: name ?? '', is: firstValue(definition) };
    case 'in':
      return { state: name ?? '', in: definition ? [firstValue(definition)] : [] };
    case 'flag':
      return { flag: knownFlags(states)[0]?.flag ?? 'viewer.isStaff' };
  }
}

/**
 * Change la nature d’un nœud en gardant ce qui peut l’être : l’état et ses
 * valeurs entre « égal à » et « parmi », les enfants entre « et » et « ou »,
 * le nœud lui-même quand on l’enveloppe dans « pas » ou un groupe.
 */
export function convertCondition(condition: Condition, kind: ConditionKind, states: Record<string, StateDefinition>): Condition {
  const current = conditionKind(condition);
  if (current === kind) return condition;
  if ((current === 'all' || current === 'any') && (kind === 'all' || kind === 'any')) {
    const children = 'all' in condition ? condition.all : 'any' in condition ? condition.any : [];
    return kind === 'all' ? { all: children } : { any: children };
  }
  if (kind === 'not') return { not: condition };
  if (kind === 'all') return { all: [condition] };
  if (kind === 'any') return { any: [condition] };
  if (current === 'is' && kind === 'in' && 'is' in condition) return { state: condition.state, in: [condition.is] };
  if (current === 'in' && kind === 'is' && 'in' in condition) {
    return { state: condition.state, is: condition.in[0] ?? firstValue(states[condition.state]) };
  }
  if (current === 'not' && 'not' in condition && conditionKind(condition.not) === kind) return condition.not;
  return createCondition(kind, states);
}

/** Problèmes d’une condition (état inconnu, valeur hors liste, groupe vide…), en français. */
export function conditionProblems(condition: Condition | undefined, states: Record<string, StateDefinition>): string[] {
  const problems: string[] = [];
  const visit = (node: Condition) => {
    if ('all' in node || 'any' in node) {
      const children = 'all' in node ? node.all : node.any;
      if (children.length === 0) problems.push('groupe vide : ajoute au moins une condition');
      children.forEach(visit);
      return;
    }
    if ('not' in node) {
      visit(node.not);
      return;
    }
    if ('flag' in node) {
      if (!node.flag.trim()) problems.push('drapeau sans nom');
      return;
    }
    const definition = states[node.state];
    if (!node.state) {
      problems.push('choisis une variable d’état');
      return;
    }
    if (!definition) {
      problems.push(`l’état « ${node.state} » n’existe pas dans ce menu`);
      return;
    }
    const values = 'is' in node ? [node.is] : node.in;
    if ('in' in node && values.length === 0) problems.push(`« ${node.state} » : coche au moins une valeur`);
    for (const value of values) {
      if (definition.type === 'enum' && !definition.values.includes(String(value))) {
        problems.push(`« ${formatValue(value)} » n’est pas une valeur de « ${node.state} »`);
      } else if (definition.type === 'bool' && typeof value !== 'boolean') {
        problems.push(`« ${node.state} » est un booléen : vrai ou faux`);
      } else if ((definition.type === 'int' || definition.type === 'page') && typeof value !== 'number') {
        problems.push(`« ${node.state} » est un nombre`);
      }
    }
  };
  if (condition) visit(condition);
  return [...new Set(problems)];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStateValue = (value: unknown): value is StateValue =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

/**
 * Vérifie qu’un JSON saisi à la main est une condition du format ; renvoie
 * le chemin et la raison de la première erreur, ou `null`.
 */
export function conditionShapeError(value: unknown, path = '$'): string | null {
  if (!isRecord(value)) return `${path} : objet attendu`;
  if ('all' in value || 'any' in value) {
    const key = 'all' in value ? 'all' : 'any';
    const children = value[key];
    if (!Array.isArray(children)) return `${path}.${key} : liste attendue`;
    for (const [index, child] of children.entries()) {
      const error = conditionShapeError(child, `${path}.${key}[${index}]`);
      if (error) return error;
    }
    return null;
  }
  if ('not' in value) return conditionShapeError(value.not, `${path}.not`);
  if ('flag' in value) return typeof value.flag === 'string' ? null : `${path}.flag : texte attendu`;
  if ('state' in value) {
    if (typeof value.state !== 'string') return `${path}.state : texte attendu`;
    if ('is' in value) return isStateValue(value.is) ? null : `${path}.is : valeur simple attendue`;
    if ('in' in value) {
      return Array.isArray(value.in) && value.in.every(isStateValue) ? null : `${path}.in : liste de valeurs simples attendue`;
    }
    return `${path} : « is » ou « in » manquant`;
  }
  return `${path} : clé attendue parmi state, flag, all, any, not`;
}
