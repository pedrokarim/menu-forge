import { coerceStateValue, pageStateFor } from './actions';
import { evaluateCondition } from './conditions';
import type { Action, MenuDefinition, StateValue } from './menu';
import { DEFAULT_PAGE_COUNT, DEFAULT_PREVIEW, buildPreviewContext, interpolate } from './preview';
import type { PreviewValues } from './preview';

/**
 * Mode « Essayer » : une session de menus simulée, comme celle de la lib
 * (`MenuSessionImpl`, `ActionExecutor`) : une pile de menus pour `open` /
 * `back`, l’état de chaque menu, la pagination. Fonctions pures : le
 * document édité n’est jamais touché.
 */

export interface TryFrame {
  menuId: string;
  values: PreviewValues;
}

export type LogTone = 'click' | 'state' | 'nav' | 'info' | 'warn';

export interface TryLogEntry {
  id: number;
  tone: LogTone;
  text: string;
}

export interface TrySession {
  stack: TryFrame[];
  /** Inventaire fermé (`close`, ou `back` sur le premier menu). */
  closed: boolean;
  log: TryLogEntry[];
  nextLogId: number;
}

/** Menus résolus (gabarits et composants appliqués), par identifiant. */
export type ResolvedLookup = (id: string) => MenuDefinition | undefined;

const LOG_LIMIT = 200;

export function startSession(menuId: string, values: PreviewValues): TrySession {
  return { stack: [{ menuId, values }], closed: false, log: [], nextLogId: 1 };
}

export function currentFrame(session: TrySession): TryFrame | null {
  return session.closed ? null : (session.stack.at(-1) ?? null);
}

/** Session modifiable le temps d’un clic (copie profonde des cadres et du journal). */
class Draft {
  stack: TryFrame[];
  closed: boolean;
  log: TryLogEntry[];
  nextLogId: number;

  constructor(session: TrySession) {
    this.stack = structuredClone(session.stack);
    this.closed = session.closed;
    this.log = [...session.log];
    this.nextLogId = session.nextLogId;
  }

  write(tone: LogTone, text: string) {
    this.log = [...this.log, { id: this.nextLogId++, tone, text }].slice(-LOG_LIMIT);
  }

  top(): TryFrame | null {
    return this.closed ? null : (this.stack.at(-1) ?? null);
  }

  done(): TrySession {
    return { stack: this.stack, closed: this.closed, log: this.log, nextLogId: this.nextLogId };
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'vrai' : 'faux';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Valeurs d’aperçu à l’ouverture d’un menu : état initial demandé, drapeaux et pseudo gardés. */
function openingValues(target: MenuDefinition, requested: Record<string, StateValue> | undefined, from: PreviewValues | null, draft: Draft): PreviewValues {
  const state: Record<string, StateValue> = {};
  for (const [name, raw] of Object.entries(requested ?? {})) {
    const definition = target.state?.[name];
    if (!definition) {
      draft.write('warn', `État initial ignoré : « ${name} » n’existe pas dans « ${target.id} »`);
      continue;
    }
    const coerced = coerceStateValue(definition, raw);
    if ('error' in coerced) draft.write('warn', `État initial « ${name} » ignoré : ${coerced.error}`);
    else state[name] = coerced.value;
  }
  return {
    ...DEFAULT_PREVIEW,
    state,
    flags: from?.flags ?? [],
    viewerName: from?.viewerName ?? DEFAULT_PREVIEW.viewerName,
  };
}

function runAction(action: Action, draft: Draft, lookup: ResolvedLookup) {
  const frame = draft.top();
  const menu = frame ? lookup(frame.menuId) : undefined;
  switch (action.type) {
    case 'open': {
      const target = lookup(action.menu);
      if (!target) {
        draft.write('warn', `Ouvrir : le menu « ${action.menu} » est introuvable`);
        return;
      }
      if (draft.closed) {
        draft.closed = false;
        draft.stack = [];
      }
      draft.stack.push({ menuId: target.id, values: openingValues(target, action.state, frame?.values ?? null, draft) });
      draft.write('nav', `Ouvre « ${target.name} » (pile : ${draft.stack.length})`);
      return;
    }
    case 'back':
      if (draft.closed) return;
      if (draft.stack.length <= 1) {
        draft.closed = true;
        draft.write('nav', 'Retour : pas de menu précédent, l’inventaire se ferme');
        return;
      }
      draft.stack.pop();
      draft.write('nav', `Retour à « ${lookup(draft.stack.at(-1)?.menuId ?? '')?.name ?? draft.stack.at(-1)?.menuId} »`);
      return;
    case 'close':
      if (draft.closed) return;
      draft.closed = true;
      draft.write('nav', 'Inventaire fermé');
      return;
    case 'setState': {
      if (!frame || !menu) return;
      const definition = menu.state?.[action.state];
      if (!definition) {
        draft.write('warn', `Changer l’état : « ${action.state} » n’existe pas dans « ${menu.id} »`);
        return;
      }
      const coerced = coerceStateValue(definition, action.value);
      if ('error' in coerced) {
        draft.write('warn', `Changer l’état « ${action.state} » : ${coerced.error}`);
        return;
      }
      frame.values = { ...frame.values, state: { ...frame.values.state, [action.state]: coerced.value } };
      draft.write('state', `${action.state} ← ${formatValue(coerced.value)}`);
      return;
    }
    case 'nextPage':
    case 'prevPage': {
      if (!frame || !menu) return;
      const stateName = pageStateFor(menu.state ?? {}, action.list);
      if (!stateName) {
        draft.write('warn', `Pagination : aucun état « page » ne pagine la liste « ${action.list} »`);
        return;
      }
      const count = Math.max(1, frame.values.pageCounts[stateName] ?? DEFAULT_PAGE_COUNT);
      const raw = frame.values.state[stateName];
      const current = typeof raw === 'number' ? raw : 1;
      const next = Math.max(1, Math.min(count, current + (action.type === 'nextPage' ? 1 : -1)));
      if (next === current) {
        draft.write('info', `${stateName} : déjà en page ${current} sur ${count}`);
        return;
      }
      frame.values = { ...frame.values, state: { ...frame.values.state, [stateName]: next } };
      draft.write('state', `${stateName} : page ${next} sur ${count}`);
      return;
    }
    case 'sound':
      draft.write('info', `Son ${action.sound} (volume ${action.volume ?? 1}, hauteur ${action.pitch ?? 1})`);
      return;
    case 'command': {
      const variables = menu && frame ? buildPreviewContext(menu, frame.values).variables : {};
      const line = interpolate(action.command, variables).replace(/^\//, '');
      draft.write('info', `Commande ${action.as === 'console' ? 'de la console' : 'du joueur'} : /${line}`);
      return;
    }
    case 'custom': {
      const args = Object.entries(action.args ?? {}).map(([key, value]) => `${key} = ${formatValue(value)}`);
      draft.write('info', `Action serveur « ${action.id} »${args.length > 0 ? ` (${args.join(', ')})` : ''}`);
      return;
    }
  }
}

/** Clic sur un slot du menu affiché : ses actions s’exécutent dans l’ordre, comme en jeu. */
export function clickSlot(session: TrySession, lookup: ResolvedLookup, slotId: string): TrySession {
  const draft = new Draft(session);
  const frame = draft.top();
  const menu = frame ? lookup(frame.menuId) : undefined;
  const slot = menu?.slots?.find((candidate) => candidate.id === slotId);
  if (!frame || !menu || !slot) return session;
  const context = buildPreviewContext(menu, frame.values);
  draft.write('click', `Clic sur « ${slot.id} »`);
  if (!evaluateCondition(slot.visibleWhen, context)) {
    draft.write('info', 'Slot vide : sa condition d’affichage est fausse');
    return draft.done();
  }
  if (!evaluateCondition(slot.enabledWhen, context)) {
    draft.write('warn', 'Inactif : sa condition d’activation est fausse');
    return draft.done();
  }
  if (slot.kind === 'decoration') {
    draft.write('info', 'Décoration : jamais cliquable');
    return draft.done();
  }
  if (slot.kind === 'list') draft.write('info', `Entrée de la liste « ${slot.list ?? '?'} » : ses actions viennent du serveur`);
  if (slot.kind === 'input') draft.write('info', 'Dépôt : le joueur peut y poser un item');
  const actions = slot.onClick ?? [];
  if (actions.length === 0 && slot.kind === 'button') draft.write('info', 'Aucune action au clic');
  for (const action of actions) runAction(action, draft, lookup);
  return draft.done();
}

/**
 * Clic sur un bouton du formulaire Bedrock affiché : ses actions s’exécutent
 * dans l’ordre, comme sur le serveur (le formulaire est ensuite renvoyé, sauf
 * fermeture).
 */
export function clickFormButton(session: TrySession, lookup: ResolvedLookup, buttonId: string): TrySession {
  const draft = new Draft(session);
  const frame = draft.top();
  const menu = frame ? lookup(frame.menuId) : undefined;
  const button = menu?.form?.buttons.find((candidate) => candidate.id === buttonId);
  if (!frame || !menu || !button) return session;
  draft.write('click', `Clic sur « ${button.id} »`);
  if (!evaluateCondition(button.visibleWhen, buildPreviewContext(menu, frame.values))) {
    draft.write('info', 'Bouton non envoyé : sa condition d’affichage est fausse');
    return draft.done();
  }
  const actions = button.onClick ?? [];
  if (actions.length === 0) draft.write('info', 'Aucune action : le serveur renvoie le formulaire');
  for (const action of actions) runAction(action, draft, lookup);
  return draft.done();
}

/** Retour simulé (bouton du panneau), comme l’action `back`. */
export function goBack(session: TrySession, lookup: ResolvedLookup): TrySession {
  const draft = new Draft(session);
  runAction({ type: 'back' }, draft, lookup);
  return draft.done();
}

/** Rouvre le dernier menu après une fermeture. */
export function reopen(session: TrySession): TrySession {
  if (!session.closed) return session;
  const draft = new Draft(session);
  draft.closed = false;
  if (draft.stack.length === 0) return session;
  draft.write('nav', 'Inventaire rouvert');
  return draft.done();
}

/** Valeurs d’aperçu du menu affiché, changées à la main dans le panneau. */
export function setFrameValues(session: TrySession, values: PreviewValues): TrySession {
  if (session.closed || session.stack.length === 0) return session;
  const stack = [...session.stack];
  stack[stack.length - 1] = { ...stack[stack.length - 1], values };
  return { ...session, stack };
}

export function clearLog(session: TrySession): TrySession {
  return { ...session, log: [] };
}
