import { useId, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import {
  ACTION_TYPES,
  COMMON_SOUNDS,
  createAction,
  describeAction,
  initialStateValue,
  isKnownActionType,
  pageLists,
  validateAction,
} from '../../model/actions';
import type { ActionContext } from '../../model/actions';
import type { Action, ActionType, StateValue } from '../../model/menu';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/Icon';
import { IconButton } from '../../ui/IconButton';
import { Tooltip } from '../../ui/Tooltip';
import { useContextMenu } from '../../ui/menuContext';
import type { MenuEntry } from '../../ui/menuContext';
import { Field, FieldError } from '../fields';
import { AdvancedJson } from './AdvancedJson';
import { OptionalNumberField, StateValueInput } from './inputs';
import { moveItem, useDragReorder } from './reorder';

const ACTION_ICONS: Record<ActionType, IconName> = {
  open: 'open',
  back: 'back',
  close: 'close',
  setState: 'sliders',
  nextPage: 'arrow-right',
  prevPage: 'arrow-left',
  sound: 'volume',
  command: 'terminal',
  custom: 'zap',
};

const STATE_TYPE_SHORT = { enum: 'liste', bool: 'booléen', int: 'entier', page: 'page' } as const;

interface ActionListEditorProps {
  actions: Action[] | undefined;
  context: ActionContext;
  /** Menu édité (exclu des propositions de `open` par défaut). */
  menuId: string;
  onChange: (actions: Action[] | undefined) => void;
  /** Ouvre dans l’éditeur le menu visé par une action `open`. */
  onOpenMenu?: (id: string) => void;
}

/** Vérifie la forme d’une liste d’actions saisie en JSON. */
function actionsShapeError(value: unknown): string | null {
  if (!Array.isArray(value)) return 'liste d’actions attendue : [ { "type": … } ]';
  for (const [index, action] of value.entries()) {
    if (typeof action !== 'object' || action === null || Array.isArray(action)) return `[${index}] : objet attendu`;
    const type = (action as Record<string, unknown>).type;
    if (!isKnownActionType(type)) return `[${index}] : type d’action inconnu « ${String(type)} »`;
  }
  return null;
}

/** Éditeur visuel des actions au clic d’un slot : liste réordonnable, champs propres à chaque type. */
export function ActionListEditor({ actions = [], context, menuId, onChange, onOpenMenu }: ActionListEditorProps) {
  const openMenu = useContextMenu();
  const commit = (next: Action[]) => onChange(next.length > 0 ? next : undefined);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= actions.length || from === to) return;
    commit(moveItem(actions, from, to));
  };
  const reorder = useDragReorder(move);
  const add = (type: ActionType) => commit([...actions, createAction(type, context, menuId)]);

  const addEntries = (): MenuEntry[] => [
    { heading: 'Ajouter une action' },
    ...ACTION_TYPES.map((info) => ({ label: info.label, icon: ACTION_ICONS[info.type], onSelect: () => add(info.type) })),
  ];

  const itemEntries = (index: number): MenuEntry[] => [
    { heading: `Action ${index + 1} · ${describeAction(actions[index], context.menus)}` },
    { label: 'Dupliquer', icon: 'copy', onSelect: () => commit([...actions.slice(0, index + 1), structuredClone(actions[index]), ...actions.slice(index + 1)]) },
    { separator: true },
    { label: 'Monter', icon: 'chevron-up', shortcut: 'Alt+↑', disabled: index === 0, onSelect: () => move(index, index - 1) },
    { label: 'Descendre', icon: 'chevron-down', shortcut: 'Alt+↓', disabled: index === actions.length - 1, onSelect: () => move(index, index + 1) },
    { label: 'Tout en haut', icon: 'arrow-up', disabled: index === 0, onSelect: () => move(index, 0) },
    { separator: true },
    { label: 'Supprimer', icon: 'trash', danger: true, onSelect: () => commit(actions.filter((_, other) => other !== index)) },
  ];

  const onCardKey = (index: number) => (event: KeyboardEvent<HTMLLIElement>) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    event.stopPropagation();
    const target = index + (event.key === 'ArrowUp' ? -1 : 1);
    move(index, target);
    // La carte déplacée garde le focus à sa nouvelle place.
    const list = event.currentTarget.parentElement;
    requestAnimationFrame(() => list?.querySelectorAll<HTMLElement>(':scope > .action-card')[target]?.focus());
  };

  return (
    <div className="visual-block action-editor">
      <div className="visual-block-head">
        <span className="field-label">Actions au clic</span>
        <span className="count">{actions.length}</span>
        <Tooltip label="Ajouter une action" hint="Ouvrir un menu, changer l’état, paginer, jouer un son…">
          <button type="button" className="sm" onClick={(event) => openMenu(event, addEntries())}>
            <Icon name="plus" />
            Ajouter
          </button>
        </Tooltip>
      </div>
      {actions.length === 0 ? (
        <p className="empty-hint">
          <Icon name="info" />
          <span>Aucune action : le clic ne fait rien. Les actions s’exécutent dans l’ordre de la liste.</span>
        </p>
      ) : (
        <ol className="action-list">
          {actions.map((action, index) => (
            <ActionCard
              key={index}
              action={action}
              index={index}
              count={actions.length}
              context={context}
              menuId={menuId}
              dropTarget={reorder.over === index}
              rowProps={reorder.rowProps(index)}
              handleProps={reorder.handleProps(index)}
              onChange={(next) => commit(actions.map((candidate, other) => (other === index ? next : candidate)))}
              onRemove={() => commit(actions.filter((_, other) => other !== index))}
              onMove={(target) => move(index, target)}
              onMenu={(event) => openMenu(event, itemEntries(index))}
              onKeyDown={onCardKey(index)}
              onOpenMenu={onOpenMenu}
            />
          ))}
        </ol>
      )}
      <AdvancedJson<Action[]> value={actions.length > 0 ? actions : undefined} validate={actionsShapeError} onCommit={(next) => commit(next ?? [])} />
    </div>
  );
}

interface ActionCardProps {
  action: Action;
  index: number;
  count: number;
  context: ActionContext;
  menuId: string;
  dropTarget: boolean;
  rowProps: ReturnType<ReturnType<typeof useDragReorder>['rowProps']>;
  handleProps: ReturnType<ReturnType<typeof useDragReorder>['handleProps']>;
  onChange: (action: Action) => void;
  onRemove: () => void;
  onMove: (target: number) => void;
  onMenu: (event: MouseEvent) => void;
  onKeyDown: (event: KeyboardEvent<HTMLLIElement>) => void;
  onOpenMenu?: (id: string) => void;
}

function ActionCard(props: ActionCardProps) {
  const { action, index, count, context } = props;
  const known = isKnownActionType((action as { type: unknown }).type);
  const problems = validateAction(action, context);
  const classes = ['action-card'];
  if (problems.length > 0) classes.push('has-problem');
  if (props.dropTarget) classes.push('is-drop-target');
  return (
    <li
      className={classes.join(' ')}
      tabIndex={0}
      aria-label={`Action ${index + 1} sur ${count}`}
      {...props.rowProps}
      onContextMenu={(event) => {
        event.stopPropagation();
        props.onMenu(event);
      }}
      onKeyDown={props.onKeyDown}
    >
      <div className="action-card-head">
        <Tooltip label="Glisser pour réordonner" shortcut="Alt+↑">
          <span className="drag-grip" {...props.handleProps}>
            <Icon name="drag" />
          </span>
        </Tooltip>
        <span className="action-index">{index + 1}</span>
        <Icon name={known ? ACTION_ICONS[action.type] : 'warning'} />
        <span className="action-summary" title={describeAction(action, context.menus)}>
          {known ? describeAction(action, context.menus) : 'Action inconnue'}
        </span>
        <IconButton icon="chevron-up" label="Monter" shortcut="Alt+↑" variant="ghost" disabled={index === 0} onClick={() => props.onMove(index - 1)} />
        <IconButton
          icon="chevron-down"
          label="Descendre"
          shortcut="Alt+↓"
          variant="ghost"
          disabled={index === count - 1}
          onClick={() => props.onMove(index + 1)}
        />
        <IconButton icon="trash" label="Supprimer l’action" hint="Clic droit : dupliquer, déplacer…" variant="danger" onClick={props.onRemove} />
      </div>
      <select
        className="action-type"
        aria-label={`Type de l’action ${index + 1}`}
        value={known ? action.type : ''}
        onChange={(event) => props.onChange(createAction(event.target.value as ActionType, context, props.menuId))}
      >
        {!known && <option value="">Type inconnu (voir le JSON)</option>}
        {ACTION_TYPES.map((info) => (
          <option key={info.type} value={info.type}>
            {info.label}
          </option>
        ))}
      </select>
      {known && <ActionFields action={action} context={context} menuId={props.menuId} onChange={props.onChange} onOpenMenu={props.onOpenMenu} />}
      {problems.map((problem) => (
        <FieldError key={problem}>{problem}</FieldError>
      ))}
    </li>
  );
}

function ActionFields({
  action,
  context,
  menuId,
  onChange,
  onOpenMenu,
}: {
  action: Action;
  context: ActionContext;
  menuId: string;
  onChange: (action: Action) => void;
  onOpenMenu?: (id: string) => void;
}) {
  switch (action.type) {
    case 'open':
      return <OpenFields action={action} context={context} menuId={menuId} onChange={onChange} onOpenMenu={onOpenMenu} />;
    case 'setState':
      return <SetStateFields action={action} context={context} onChange={onChange} />;
    case 'nextPage':
    case 'prevPage':
      return <ListField action={action} context={context} onChange={onChange} />;
    case 'sound':
      return <SoundFields action={action} onChange={onChange} />;
    case 'command':
      return <CommandFields action={action} onChange={onChange} />;
    case 'custom':
      return <CustomFields action={action} onChange={onChange} />;
    case 'back':
    case 'close':
      return null;
  }
}

type OpenAction = Extract<Action, { type: 'open' }>;

function OpenFields({
  action,
  context,
  menuId,
  onChange,
  onOpenMenu,
}: {
  action: OpenAction;
  context: ActionContext;
  menuId: string;
  onChange: (action: Action) => void;
  onOpenMenu?: (id: string) => void;
}) {
  const openable = context.menus.filter((menu) => !menu.template && !menu.component);
  const target = context.menus.find((menu) => menu.id === action.menu);
  const targetStates = Object.entries(target?.state ?? {}).filter(([, definition]) => definition.type !== 'page');
  const initial = Object.entries(action.state ?? {});
  const setInitial = (entries: Array<[string, StateValue]>) => {
    const next: OpenAction = { ...action };
    if (entries.length > 0) next.state = Object.fromEntries(entries);
    else delete next.state;
    onChange(next);
  };
  const free = targetStates.filter(([name]) => !initial.some(([used]) => used === name));
  return (
    <>
      <div className="inline-control">
        <select
          aria-label="Menu à ouvrir"
          value={action.menu}
          onChange={(event) => onChange({ type: 'open', menu: event.target.value })}
        >
          {!action.menu && <option value="">Choisir le menu…</option>}
          {action.menu && !target && <option value={action.menu}>{action.menu} (introuvable)</option>}
          {openable.map((menu) => (
            <option key={menu.id} value={menu.id}>
              {menu.name} ({menu.id}){menu.id === menuId ? ' · ce menu' : ''}
            </option>
          ))}
        </select>
        {onOpenMenu && target && target.id !== menuId && (
          <IconButton icon="open" label="Ouvrir ce menu dans l’éditeur" onClick={() => onOpenMenu(target.id)} />
        )}
      </div>
      {initial.map(([name, value], index) => (
        <div className="kv-row" key={index}>
          <select
            aria-label="Variable de l’état initial"
            value={name}
            onChange={(event) => {
              const next = [...initial];
              const definition = target?.state?.[event.target.value];
              next[index] = [event.target.value, definition ? initialStateValue(definition) : ''];
              setInitial(next);
            }}
          >
            {!target?.state?.[name] && <option value={name}>{name} (inconnue)</option>}
            {targetStates.map(([option]) => (
              <option key={option} value={option} disabled={option !== name && initial.some(([used]) => used === option)}>
                {option}
              </option>
            ))}
          </select>
          <StateValueInput
            definition={target?.state?.[name]}
            value={value}
            label={`Valeur initiale de ${name}`}
            onChange={(next) => setInitial(initial.map((entry, other) => (other === index ? [name, next] : entry)))}
          />
          <IconButton icon="close" label="Retirer cette valeur initiale" variant="ghost" onClick={() => setInitial(initial.filter((_, other) => other !== index))} />
        </div>
      ))}
      <Tooltip
        label="Valeur initiale"
        hint={target ? (free.length > 0 ? 'État du menu ouvert au départ (facultatif)' : 'Toutes ses variables ont déjà une valeur') : 'Choisis d’abord le menu'}
      >
        <button
          type="button"
          className="sm"
          disabled={!target || free.length === 0}
          onClick={() => {
            const [name, definition] = free[0];
            setInitial([...initial, [name, initialStateValue(definition)]]);
          }}
        >
          <Icon name="plus" />
          État initial
        </button>
      </Tooltip>
    </>
  );
}

function SetStateFields({
  action,
  context,
  onChange,
}: {
  action: Extract<Action, { type: 'setState' }>;
  context: ActionContext;
  onChange: (action: Action) => void;
}) {
  const entries = Object.entries(context.states);
  const definition = context.states[action.state];
  if (entries.length === 0 && !action.state) {
    return <p className="field-hint">Aucune variable d’état : déclare-en dans les propriétés du menu (clic sur une zone vide).</p>;
  }
  return (
    <div className="field-row">
      <Field label="Variable">
        <select
          value={action.state}
          onChange={(event) => {
            const next = context.states[event.target.value];
            onChange({ type: 'setState', state: event.target.value, value: next ? initialStateValue(next) : '' });
          }}
        >
          {!action.state && <option value="">Choisir…</option>}
          {action.state && !definition && <option value={action.state}>{action.state} (inconnue)</option>}
          {entries.map(([name, candidate]) => (
            <option key={name} value={name}>
              {name} · {STATE_TYPE_SHORT[candidate.type]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Nouvelle valeur">
        <StateValueInput definition={definition} value={action.value} label="Nouvelle valeur" onChange={(value) => onChange({ ...action, value })} />
      </Field>
    </div>
  );
}

function ListField({
  action,
  context,
  onChange,
}: {
  action: Extract<Action, { type: 'nextPage' | 'prevPage' }>;
  context: ActionContext;
  onChange: (action: Action) => void;
}) {
  const lists = pageLists(context.states);
  return (
    <Field label="Liste paginée" hint={lists.length === 0 ? 'Aucun état « page » : ajoute-en un dans les propriétés du menu' : undefined}>
      <select value={action.list} onChange={(event) => onChange({ ...action, list: event.target.value })}>
        {!action.list && <option value="">Choisir…</option>}
        {action.list && !lists.includes(action.list) && <option value={action.list}>{action.list} (non paginée)</option>}
        {lists.map((list) => (
          <option key={list} value={list}>
            {list}
          </option>
        ))}
      </select>
    </Field>
  );
}

function SoundFields({ action, onChange }: { action: Extract<Action, { type: 'sound' }>; onChange: (action: Action) => void }) {
  const listId = useId();
  const setNumber = (key: 'volume' | 'pitch', value: number | undefined) => {
    const next = { ...action };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };
  return (
    <>
      <Field label="Son" hint="Identifiant du jeu ou d’un pack (minecraft:…)">
        <input className="mono" list={listId} value={action.sound} onChange={(event) => onChange({ ...action, sound: event.target.value })} />
        <datalist id={listId}>
          {COMMON_SOUNDS.map((sound) => (
            <option key={sound} value={sound} />
          ))}
        </datalist>
      </Field>
      <div className="field-row">
        <OptionalNumberField label="Volume" value={action.volume} placeholder="1" min={0} max={10} step={0.1} integer={false} onChange={(value) => setNumber('volume', value)} />
        <OptionalNumberField label="Hauteur" value={action.pitch} placeholder="1" min={0} max={2} step={0.05} integer={false} onChange={(value) => setNumber('pitch', value)} />
      </div>
    </>
  );
}

function CommandFields({ action, onChange }: { action: Extract<Action, { type: 'command' }>; onChange: (action: Action) => void }) {
  const as = action.as ?? 'player';
  return (
    <>
      <Field label="Commande" hint="Sans « / » ; variables : {viewer.name}, {state.tab}, {page.number}…">
        <input className="mono" value={action.command} placeholder="spawn" onChange={(event) => onChange({ ...action, command: event.target.value })} />
      </Field>
      <div className="segmented-mini" role="radiogroup" aria-label="Exécutée par">
        {(['player', 'console'] as const).map((sender) => (
          <button key={sender} type="button" role="radio" aria-checked={as === sender} onClick={() => onChange({ ...action, as: sender })}>
            <Icon name={sender === 'player' ? 'user' : 'terminal'} />
            {sender === 'player' ? 'Joueur' : 'Console'}
          </button>
        ))}
      </div>
    </>
  );
}

/** Valeur d’argument saisie : nombre, booléen ou texte. */
function parseArgument(text: string): unknown {
  if (/^-?\d+(\.\d+)?$/.test(text.trim())) return Number(text);
  if (text === 'true' || text === 'false') return text === 'true';
  return text;
}

function argumentKind(value: unknown): string {
  if (typeof value === 'number') return 'nombre';
  if (typeof value === 'boolean') return 'booléen';
  if (typeof value === 'string') return 'texte';
  return 'JSON';
}

function CustomFields({ action, onChange }: { action: Extract<Action, { type: 'custom' }>; onChange: (action: Action) => void }) {
  const [keyError, setKeyError] = useState<string | null>(null);
  const args = Object.entries(action.args ?? {});
  const setArgs = (entries: Array<[string, unknown]>) => {
    const next = { ...action };
    if (entries.length > 0) next.args = Object.fromEntries(entries);
    else delete next.args;
    onChange(next);
  };
  return (
    <>
      <Field label="Identifiant" hint="Nom enregistré par l’adaptateur du serveur (monserveur:reward…)">
        <input className="mono" value={action.id} placeholder="monserveur:action" onChange={(event) => onChange({ ...action, id: event.target.value })} />
      </Field>
      {args.length > 0 && <span className="field-label">Arguments</span>}
      {args.map(([key, value], index) => {
        const simple = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
        return (
          <div className="kv-row" key={index}>
            <input
              className="mono"
              aria-label={`Nom de l’argument ${index + 1}`}
              value={key}
              onChange={(event) => {
                const name = event.target.value;
                if (args.some(([other], position) => position !== index && other === name)) {
                  setKeyError(`L’argument « ${name} » existe déjà`);
                  return;
                }
                setKeyError(null);
                setArgs(args.map((entry, position) => (position === index ? [name, value] : entry)));
              }}
            />
            <input
              className="mono"
              aria-label={`Valeur de l’argument ${key}`}
              title={`Type lu : ${argumentKind(value)} (nombre, true / false, ou texte)`}
              value={simple ? String(value) : JSON.stringify(value)}
              disabled={!simple}
              onChange={(event) => setArgs(args.map((entry, position) => (position === index ? [key, parseArgument(event.target.value)] : entry)))}
            />
            <IconButton icon="close" label="Retirer l’argument" variant="ghost" onClick={() => setArgs(args.filter((_, position) => position !== index))} />
          </div>
        );
      })}
      {keyError && <FieldError>{keyError}</FieldError>}
      <button
        type="button"
        className="sm"
        onClick={() => {
          let name = 'arg';
          for (let suffix = 2; args.some(([key]) => key === name); suffix++) name = `arg${suffix}`;
          setArgs([...args, [name, '']]);
        }}
      >
        <Icon name="plus" />
        Argument
      </button>
    </>
  );
}
