import { useId } from 'react';
import { plural } from '../../lib/format';
import { uniqueId } from '../../model/menu';
import type { MenuDefinition, StateDefinition } from '../../model/menu';
import {
  STATE_TYPES,
  convertStateType,
  createStateDefinition,
  renameEnumValue,
  renameState,
  stateDefinitionProblems,
  stateUsageCount,
  validateStateName,
} from '../../model/stateEdit';
import type { StateType } from '../../model/stateEdit';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/IconButton';
import { Tooltip } from '../../ui/Tooltip';
import { useContextMenu } from '../../ui/menuContext';
import { Field, FieldError } from '../fields';
import { AdvancedJson } from './AdvancedJson';
import { AddValueInput, InlineCommitInput, OptionalNumberField } from './inputs';

type Recipe = (draft: MenuDefinition) => void;

const TYPE_LABELS = Object.fromEntries(STATE_TYPES.map((info) => [info.type, info.label])) as Record<StateType, string>;

/** Nom proposé pour une nouvelle variable de ce type. */
const DEFAULT_NAMES: Record<StateType, string> = { enum: 'tab', bool: 'enabled', int: 'count', page: 'page' };

interface StateEditorProps {
  /** Menu propre : seules ses variables sont modifiables. */
  menu: MenuDefinition;
  /** Variables du menu résolu (gabarits et composants compris). */
  resolvedStates: Record<string, StateDefinition>;
  /** Sources des slots « liste », proposées pour un état `page`. */
  lists: readonly string[];
  onChange: (recipe: Recipe) => void;
}

function stateShapeError(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'objet attendu : { "nom": { "type": … } }';
  for (const [name, definition] of Object.entries(value)) {
    const type = (definition as { type?: unknown } | null)?.type;
    if (!['enum', 'bool', 'int', 'page'].includes(String(type))) return `« ${name} » : type inconnu (enum, bool, int, page)`;
  }
  return null;
}

/** Variables d’état du menu : liste de cartes, un contrôle par type, renommage qui suit les références. */
export function StateEditor({ menu, resolvedStates, lists, onChange }: StateEditorProps) {
  const openMenu = useContextMenu();
  const own = Object.entries(menu.state ?? {});
  const inherited = Object.entries(resolvedStates).filter(([name]) => !(name in (menu.state ?? {})));
  const taken = Object.keys(resolvedStates);

  const add = (type: StateType) =>
    onChange((draft) => {
      const name = uniqueId(DEFAULT_NAMES[type], Object.keys(draft.state ?? {}).concat(taken));
      draft.state = { ...draft.state, [name]: createStateDefinition(type, lists) };
    });

  return (
    <div className="visual-block state-editor">
      <div className="visual-block-head">
        <span className="field-label">Variables d’état</span>
        <span className="count">{own.length}</span>
        <Tooltip label="Ajouter une variable" hint="Onglet, option, compteur ou pagination">
          <button
            type="button"
            className="sm"
            onClick={(event) =>
              openMenu(event, [
                { heading: 'Nouvelle variable' },
                ...STATE_TYPES.map((info) => ({ label: info.label, icon: 'plus' as const, onSelect: () => add(info.type) })),
              ])
            }
          >
            <Icon name="plus" />
            Ajouter
          </button>
        </Tooltip>
      </div>
      {own.length === 0 && inherited.length === 0 && (
        <p className="empty-hint">
          <Icon name="info" />
          <span>Aucune variable : le menu n’a qu’un aspect. Un onglet, une option ou une pagination en demandent une.</span>
        </p>
      )}
      <ul className="state-list">
        {own.map(([name, definition]) => (
          <StateCard key={name} name={name} definition={definition} menu={menu} taken={taken} lists={lists} onChange={onChange} />
        ))}
      </ul>
      {inherited.length > 0 && (
        <ul className="inherited-states">
          {inherited.map(([name, definition]) => (
            <li key={name}>
              <span className="mono">{name}</span>
              <span className="muted small">{TYPE_LABELS[definition.type]}</span>
              <span className="badge">hérité</span>
              <Tooltip label="Redéfinir dans ce menu" hint="Copie la déclaration : elle remplace celle du gabarit ou du composant">
                <button
                  type="button"
                  className="sm"
                  onClick={() =>
                    onChange((draft) => {
                      draft.state = { ...draft.state, [name]: structuredClone(definition) };
                    })
                  }
                >
                  Redéfinir
                </button>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
      <AdvancedJson<Record<string, StateDefinition>>
        value={own.length > 0 ? menu.state : undefined}
        rows={5}
        validate={stateShapeError}
        onCommit={(state) =>
          onChange((draft) => {
            draft.state = state ?? {};
          })
        }
      />
    </div>
  );
}

function StateCard({
  name,
  definition,
  menu,
  taken,
  lists,
  onChange,
}: {
  name: string;
  definition: StateDefinition;
  menu: MenuDefinition;
  taken: readonly string[];
  lists: readonly string[];
  onChange: (recipe: Recipe) => void;
}) {
  const listId = useId();
  const problems = stateDefinitionProblems(definition);
  const usage = stateUsageCount(menu, name);
  const update = (next: StateDefinition) =>
    onChange((draft) => {
      if (draft.state?.[name]) draft.state[name] = next;
    });
  const remove = () => {
    const message = `La variable « ${name} » est utilisée par ${plural(usage, 'élément')}. La supprimer quand même ?`;
    if (usage > 0 && !window.confirm(message)) return;
    onChange((draft) => {
      if (!draft.state) return;
      const rest = { ...draft.state };
      delete rest[name];
      draft.state = rest;
    });
  };
  return (
    <li className={problems.length > 0 ? 'state-card has-problem' : 'state-card'}>
      <div className="state-card-head">
        <InlineCommitInput
          className="mono"
          label="Nom de la variable"
          value={name}
          validate={(next) => validateStateName(next, taken, name)}
          onCommit={(next) => onChange((draft) => renameState(draft, name, next))}
        />
        <IconButton
          icon="trash"
          label="Supprimer la variable"
          hint={usage > 0 ? `Utilisée par ${plural(usage, 'élément')}` : undefined}
          variant="danger"
          onClick={remove}
        />
      </div>
      <select aria-label={`Type de ${name}`} value={definition.type} onChange={(event) => update(convertStateType(definition, event.target.value as StateType, lists))}>
        {STATE_TYPES.map((info) => (
          <option key={info.type} value={info.type}>
            {info.label}
          </option>
        ))}
      </select>
      {definition.type === 'enum' && (
        <>
          <span className="field-label">Valeurs</span>
          <ul className="chip-list">
            {definition.values.map((value, index) => (
              <li key={index} className="chip">
                <InlineCommitInput
                  grow
                  label={`Valeur ${index + 1} de ${name}`}
                  value={value}
                  validate={(next) =>
                    !next.trim() ? 'Valeur vide' : definition.values.some((other, position) => position !== index && other === next) ? 'Déjà dans la liste' : null
                  }
                  onCommit={(next) => onChange((draft) => renameEnumValue(draft, name, value, next))}
                />
                <IconButton
                  icon="close"
                  label="Retirer la valeur"
                  variant="ghost"
                  disabled={definition.values.length <= 1}
                  onClick={() => {
                    const values = definition.values.filter((_, position) => position !== index);
                    update({ ...definition, values, default: values.includes(definition.default) ? definition.default : values[0] });
                  }}
                />
              </li>
            ))}
          </ul>
          <AddValueInput
            label={`Nouvelle valeur de ${name}`}
            placeholder="Nouvelle valeur, puis Entrée"
            validate={(next) => (definition.values.includes(next) ? 'Déjà dans la liste' : null)}
            onAdd={(next) => update({ ...definition, values: [...definition.values, next] })}
          />
          <Field label="Valeur par défaut">
            <select value={definition.default} onChange={(event) => update({ ...definition, default: event.target.value })}>
              {!definition.values.includes(definition.default) && <option value={definition.default}>{definition.default} (hors liste)</option>}
              {definition.values.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      {definition.type === 'bool' && (
        <label className="checkbox">
          <input type="checkbox" checked={definition.default} onChange={(event) => update({ ...definition, default: event.target.checked })} />
          Vrai à l’ouverture
        </label>
      )}
      {definition.type === 'int' && (
        <div className="inline-fields">
          {(['default', 'min', 'max'] as const).map((key) => (
            <OptionalNumberField
              key={key}
              label={key === 'default' ? 'Défaut' : key === 'min' ? 'Min' : 'Max'}
              value={definition[key]}
              placeholder={key === 'default' ? '0' : 'aucun'}
              onChange={(value) => {
                const next = { ...definition };
                if (value === undefined) delete next[key];
                else next[key] = value;
                update(next);
              }}
            />
          ))}
        </div>
      )}
      {definition.type === 'page' && (
        <Field label="Liste paginée" hint={`Variables {${name}.number}, {${name}.count} ; drapeaux ${name}.hasPrev, ${name}.hasNext`}>
          <input className="mono" list={listId} value={definition.list} onChange={(event) => update({ ...definition, list: event.target.value })} />
          <datalist id={listId}>
            {lists.map((list) => (
              <option key={list} value={list} />
            ))}
          </datalist>
        </Field>
      )}
      {problems.map((problem) => (
        <FieldError key={problem}>{problem}</FieldError>
      ))}
    </li>
  );
}
