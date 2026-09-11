import { useId } from 'react';
import {
  CONDITION_KINDS,
  conditionKind,
  conditionProblems,
  conditionShapeError,
  convertCondition,
  createCondition,
  describeCondition,
  flagLabel,
  knownFlags,
} from '../../model/conditionText';
import type { ConditionKind } from '../../model/conditionText';
import type { Condition, StateDefinition, StateValue } from '../../model/menu';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/Icon';
import { IconButton } from '../../ui/IconButton';
import { Tooltip } from '../../ui/Tooltip';
import { useContextMenu } from '../../ui/menuContext';
import type { MenuEntry } from '../../ui/menuContext';
import { FieldError } from '../fields';
import { AdvancedJson } from './AdvancedJson';
import { InlineCommitInput, StateValueInput } from './inputs';
import { moveItem, useDragReorder } from './reorder';

const KIND_ICONS: Record<ConditionKind, IconName> = {
  is: 'sliders',
  in: 'list',
  flag: 'flag',
  all: 'braces',
  any: 'braces',
  not: 'minus',
};

const KIND_LABELS = Object.fromEntries(CONDITION_KINDS.map((info) => [info.kind, info.label])) as Record<ConditionKind, string>;

/** Conditions prêtes à l’emploi, déduites des états du menu. */
function quickConditions(states: Record<string, StateDefinition>): Array<{ label: string; condition: Condition }> {
  const options: Array<{ label: string; condition: Condition }> = [];
  for (const [name, definition] of Object.entries(states)) {
    if (definition.type === 'enum') {
      for (const value of definition.values) options.push({ label: `${name} = ${value}`, condition: { state: name, is: value } });
    } else if (definition.type === 'bool') {
      options.push({ label: `${name} vrai`, condition: { state: name, is: true } });
      options.push({ label: `${name} faux`, condition: { state: name, is: false } });
    } else if (definition.type === 'page') {
      options.push({ label: `${name} : page précédente`, condition: { flag: `${name}.hasPrev` } });
      options.push({ label: `${name} : pas de page précédente`, condition: { not: { flag: `${name}.hasPrev` } } });
      options.push({ label: `${name} : page suivante`, condition: { flag: `${name}.hasNext` } });
      options.push({ label: `${name} : pas de page suivante`, condition: { not: { flag: `${name}.hasNext` } } });
    }
  }
  return options;
}

interface ConditionEditorProps {
  /** « Visible si », « Actif si »… */
  label: string;
  value: Condition | undefined;
  /** États du menu résolu. */
  states: Record<string, StateDefinition>;
  /** Drapeaux déjà connus (autres menus, aperçu), proposés à la saisie. */
  flags: readonly string[];
  onCommit: (condition: Condition | undefined) => void;
  /** Aide sous le libellé (« le slot est vide si la condition est fausse »). */
  hint?: string;
}

/**
 * Éditeur visuel d’une condition : résumé lisible, arbre `et` / `ou` /
 * `pas`, feuilles « état égal à », « état parmi » et « drapeau », accès
 * « Avancé (JSON) ».
 */
export function ConditionEditor({ label, value, states, flags, onCommit, hint }: ConditionEditorProps) {
  const openMenu = useContextMenu();
  const summary = describeCondition(value, states);
  const problems = conditionProblems(value, states);
  const quick = quickConditions(states);
  const buildEntries: MenuEntry[] = [
    { heading: 'Construire une condition' },
    ...CONDITION_KINDS.map((info) => ({ label: info.label, icon: KIND_ICONS[info.kind], onSelect: () => onCommit(createCondition(info.kind, states)) })),
  ];
  return (
    <div className="visual-block condition-editor">
      <div className="visual-block-head">
        <span className="field-label">{label}</span>
        {value && <IconButton icon="close" label="Toujours" hint="Retirer la condition" variant="ghost" onClick={() => onCommit(undefined)} />}
      </div>
      <p className={value ? 'condition-summary' : 'condition-summary is-always'} title={hint}>
        <Icon name={value ? 'eye' : 'check'} />
        <span>{value ? summary : `Toujours${hint ? ` · ${hint}` : ''}`}</span>
      </p>
      {value ? (
        <ConditionNode node={value} states={states} flags={flags} depth={0} onChange={onCommit} onRemove={() => onCommit(undefined)} />
      ) : (
        <div className="inline-control">
          <select
            aria-label={`${label} : condition rapide`}
            value=""
            onChange={(event) => {
              const option = quick[Number(event.target.value)];
              if (option) onCommit(structuredClone(option.condition));
            }}
          >
            <option value="">Condition rapide…</option>
            {quick.map((option, index) => (
              <option key={option.label} value={index}>
                {option.label}
              </option>
            ))}
          </select>
          <Tooltip label="Construire une condition" hint="Égalité, liste de valeurs, drapeau, groupes « et », « ou », « pas »">
            <button type="button" className="sm" onClick={(event) => openMenu(event, buildEntries)}>
              <Icon name="plus" />
              Construire
            </button>
          </Tooltip>
        </div>
      )}
      {problems.map((problem) => (
        <FieldError key={problem}>{problem}</FieldError>
      ))}
      <AdvancedJson<Condition> value={value} rows={3} validate={conditionShapeError} onCommit={onCommit} />
    </div>
  );
}

interface NodeProps {
  node: Condition;
  states: Record<string, StateDefinition>;
  flags: readonly string[];
  depth: number;
  onChange: (condition: Condition) => void;
  onRemove: () => void;
  /** Entrées propres à la place du nœud dans son groupe (monter, descendre). */
  siblingEntries?: MenuEntry[];
  grip?: ReturnType<ReturnType<typeof useDragReorder>['handleProps']>;
}

function ConditionNode({ node, states, flags, depth, onChange, onRemove, siblingEntries = [], grip }: NodeProps) {
  const openMenu = useContextMenu();
  const kind = conditionKind(node);
  const group = kind === 'all' || kind === 'any';
  const children = 'all' in node ? node.all : 'any' in node ? node.any : [];
  const entries: MenuEntry[] = [
    { heading: KIND_LABELS[kind] },
    {
      label: kind === 'not' ? 'Retirer l’inverse' : 'Inverser (pas)',
      icon: 'minus',
      onSelect: () => onChange('not' in node ? node.not : { not: node }),
    },
    { label: 'Grouper avec « et »', icon: 'braces', onSelect: () => onChange({ all: [node] }) },
    { label: 'Grouper avec « ou »', icon: 'braces', onSelect: () => onChange({ any: [node] }) },
    ...(group ? [{ label: 'Dégrouper', icon: 'ungroup' as const, disabled: children.length !== 1, onSelect: () => onChange(children[0]) }] : []),
    ...(siblingEntries.length > 0 ? [{ separator: true } as const, ...siblingEntries] : []),
    { separator: true },
    { label: 'Supprimer', icon: 'trash', danger: true, onSelect: onRemove },
  ];
  const classes = ['condition-node', `kind-${kind}`];
  if (group || kind === 'not') classes.push('is-branch');
  return (
    <div
      className={classes.join(' ')}
      data-depth={Math.min(depth, 4)}
      onContextMenu={(event) => {
        event.stopPropagation();
        openMenu(event, entries);
      }}
    >
      <div className="condition-row">
        {grip && (
          <Tooltip label="Glisser pour réordonner">
            <span className="drag-grip" {...grip}>
              <Icon name="drag" />
            </span>
          </Tooltip>
        )}
        <select
          aria-label="Nature de la condition"
          value={kind}
          onChange={(event) => onChange(convertCondition(node, event.target.value as ConditionKind, states))}
        >
          {CONDITION_KINDS.map((info) => (
            <option key={info.kind} value={info.kind}>
              {info.label}
            </option>
          ))}
        </select>
        <IconButton icon="more" label="Options de la condition" hint="Inverser, grouper, déplacer (clic droit aussi)" variant="ghost" onClick={(event) => openMenu(event, entries)} />
        <IconButton icon="trash" label="Supprimer la condition" variant="danger" onClick={onRemove} />
      </div>
      {('is' in node || 'in' in node) && <StateLeaf node={node} states={states} onChange={onChange} />}
      {'flag' in node && <FlagLeaf flag={node.flag} states={states} flags={flags} onChange={(flag) => onChange({ flag })} />}
      {'not' in node && (
        <ConditionNode node={node.not} states={states} flags={flags} depth={depth + 1} onChange={(child) => onChange({ not: child })} onRemove={onRemove} />
      )}
      {group && (
        <GroupChildren
          kind={kind}
          items={children}
          states={states}
          flags={flags}
          depth={depth}
          onChange={(next) => onChange(kind === 'all' ? { all: next } : { any: next })}
        />
      )}
    </div>
  );
}

function GroupChildren({
  kind,
  items,
  states,
  flags,
  depth,
  onChange,
}: {
  kind: 'all' | 'any';
  items: Condition[];
  states: Record<string, StateDefinition>;
  flags: readonly string[];
  depth: number;
  onChange: (children: Condition[]) => void;
}) {
  const openMenu = useContextMenu();
  const move = (from: number, to: number) => {
    if (to >= 0 && to < items.length && from !== to) onChange(moveItem(items, from, to));
  };
  const reorder = useDragReorder(move);
  const addEntries: MenuEntry[] = [
    { heading: kind === 'all' ? 'Ajouter au groupe « et »' : 'Ajouter au groupe « ou »' },
    ...CONDITION_KINDS.map((info) => ({
      label: info.label,
      icon: KIND_ICONS[info.kind],
      onSelect: () => onChange([...items, createCondition(info.kind, states)]),
    })),
  ];
  return (
    <>
      {items.length === 0 && <p className="field-hint">Groupe vide : ajoute une condition.</p>}
      <ol className="condition-children">
        {items.map((child, index) => (
          <li key={index} className={reorder.over === index ? 'is-drop-target' : undefined} {...reorder.rowProps(index)}>
            {index > 0 && <span className="condition-joiner">{kind === 'all' ? 'et' : 'ou'}</span>}
            <ConditionNode
              node={child}
              states={states}
              flags={flags}
              depth={depth + 1}
              grip={reorder.handleProps(index)}
              onChange={(next) => onChange(items.map((candidate, other) => (other === index ? next : candidate)))}
              onRemove={() => onChange(items.filter((_, other) => other !== index))}
              siblingEntries={[
                { label: 'Monter', icon: 'chevron-up', disabled: index === 0, onSelect: () => move(index, index - 1) },
                { label: 'Descendre', icon: 'chevron-down', disabled: index === items.length - 1, onSelect: () => move(index, index + 1) },
              ]}
            />
          </li>
        ))}
      </ol>
      <button type="button" className="sm condition-add" onClick={(event) => openMenu(event, addEntries)}>
        <Icon name="plus" />
        Ajouter une condition
      </button>
    </>
  );
}

function StateSelect({ value, states, onChange }: { value: string; states: Record<string, StateDefinition>; onChange: (name: string) => void }) {
  const names = Object.keys(states);
  return (
    <select aria-label="Variable d’état" value={value} onChange={(event) => onChange(event.target.value)}>
      {!value && <option value="">Variable…</option>}
      {value && !states[value] && <option value={value}>{value} (inconnue)</option>}
      {names.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

/** Première valeur d’un état (liste : la première ; booléen : vrai ; nombre : son défaut). */
function firstValue(definition: StateDefinition | undefined): StateValue {
  if (!definition) return '';
  if (definition.type === 'enum') return definition.values[0] ?? '';
  if (definition.type === 'bool') return true;
  if (definition.type === 'int') return definition.default ?? definition.min ?? 0;
  return 1;
}

function StateLeaf({
  node,
  states,
  onChange,
}: {
  node: Extract<Condition, { state: string }>;
  states: Record<string, StateDefinition>;
  onChange: (condition: Condition) => void;
}) {
  const definition = states[node.state];
  if ('is' in node) {
    return (
      <div className="field-row">
        <StateSelect value={node.state} states={states} onChange={(name) => onChange({ state: name, is: firstValue(states[name]) })} />
        <StateValueInput definition={definition} value={node.is} label={`Valeur de ${node.state}`} onChange={(is) => onChange({ state: node.state, is })} />
      </div>
    );
  }
  const values = node.in;
  const toggle = (value: StateValue, checked: boolean) =>
    onChange({ state: node.state, in: checked ? [...values, value] : values.filter((candidate) => candidate !== value) });
  const choices: StateValue[] | null = definition?.type === 'enum' ? definition.values : definition?.type === 'bool' ? [true, false] : null;
  return (
    <>
      <StateSelect value={node.state} states={states} onChange={(name) => onChange({ state: name, in: [firstValue(states[name])] })} />
      {choices ? (
        <div className="value-checks" role="group" aria-label={`Valeurs de ${node.state}`}>
          {choices.map((choice) => (
            <label key={String(choice)} className="checkbox">
              <input type="checkbox" checked={values.includes(choice)} onChange={(event) => toggle(choice, event.target.checked)} />
              {typeof choice === 'boolean' ? (choice ? 'vrai' : 'faux') : choice}
            </label>
          ))}
        </div>
      ) : (
        <InlineCommitInput
          className="mono"
          label={`Valeurs de ${node.state}, séparées par des virgules`}
          placeholder="1, 2, 3"
          value={values.join(', ')}
          validate={(text) => (text.split(',').every((part) => /^\s*-?\d+\s*$/.test(part)) ? null : 'Nombres entiers séparés par des virgules')}
          onCommit={(text) => onChange({ state: node.state, in: text.split(',').map((part) => Number(part.trim())) })}
        />
      )}
    </>
  );
}

function FlagLeaf({
  flag,
  states,
  flags,
  onChange,
}: {
  flag: string;
  states: Record<string, StateDefinition>;
  flags: readonly string[];
  onChange: (flag: string) => void;
}) {
  const listId = useId();
  const known = knownFlags(states, flags);
  const label = flagLabel(flag, states);
  return (
    <>
      <input className="mono" list={listId} aria-label="Drapeau" placeholder="viewer.isStaff" value={flag} onChange={(event) => onChange(event.target.value)} />
      <datalist id={listId}>
        {known.map((entry) => (
          <option key={entry.flag} value={entry.flag}>
            {entry.label}
          </option>
        ))}
      </datalist>
      <span className="field-hint">
        {label !== flag ? label : flag.startsWith('viewer.') ? 'Fourni par le serveur (FlagProvider)' : 'Drapeau fourni par la lib ou par le serveur'}
      </span>
    </>
  );
}
