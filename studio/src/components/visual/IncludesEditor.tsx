import { ID_PATTERN } from '../../model/menu';
import type { Include, MenuDefinition, StateDefinition } from '../../model/menu';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/IconButton';
import { Tooltip } from '../../ui/Tooltip';
import { useContextMenu } from '../../ui/menuContext';
import type { MenuEntry } from '../../ui/menuContext';
import { FieldError } from '../fields';
import { ConditionEditor } from './ConditionEditor';
import { InlineCommitInput, OptionalNumberField } from './inputs';

interface IncludesEditorProps {
  includes: Include[] | undefined;
  /** Composants de l’espace (menus `component: true`). */
  components: ReadonlyArray<Pick<MenuDefinition, 'id' | 'name'>>;
  /** Menu édité : il ne peut pas s’inclure lui-même. */
  menuId: string;
  states: Record<string, StateDefinition>;
  flags: readonly string[];
  onChange: (includes: Include[] | undefined) => void;
  onOpenComponent: (id: string) => void;
  onDetach: (index: number) => void;
}

/** Valeur numérique facultative d’une instance : 0 et vide reviennent au même (clé absente). */
function offset(value: number | undefined): number | undefined {
  return value === undefined || value === 0 ? undefined : value;
}

/**
 * Instances de composants du menu (`includes`) : composant, préfixe des
 * identifiants, décalage en cases et en pixels, condition de l’instance.
 */
export function IncludesEditor({ includes = [], components, menuId, states, flags, onChange, onOpenComponent, onDetach }: IncludesEditorProps) {
  const openMenu = useContextMenu();
  const available = components.filter((component) => component.id !== menuId);
  const commit = (next: Include[]) => onChange(next.length > 0 ? next : undefined);
  const update = (index: number, recipe: (include: Include) => Include) =>
    commit(includes.map((include, other) => (other === index ? recipe({ ...include }) : include)));
  const setKey = <K extends keyof Include>(index: number, key: K, value: Include[K] | undefined) =>
    update(index, (include) => {
      if (value === undefined || value === '') delete include[key];
      else include[key] = value;
      return include;
    });

  const addEntries: MenuEntry[] = [
    { heading: 'Inclure un composant' },
    ...available.map((component) => ({
      label: `${component.name} (${component.id})`,
      icon: 'component' as const,
      onSelect: () => commit([...includes, { component: component.id }]),
    })),
  ];

  const cardEntries = (index: number): MenuEntry[] => [
    { heading: `Instance de « ${includes[index].component} »` },
    { label: 'Ouvrir le composant', icon: 'open', onSelect: () => onOpenComponent(includes[index].component) },
    { label: 'Détacher (copier ses éléments ici)', icon: 'ungroup', onSelect: () => onDetach(index) },
    { separator: true },
    { label: 'Retirer l’instance', icon: 'trash', danger: true, onSelect: () => commit(includes.filter((_, other) => other !== index)) },
  ];

  return (
    <div className="visual-block includes-editor">
      <div className="visual-block-head">
        <span className="field-label">Composants inclus</span>
        <span className="count">{includes.length}</span>
        <Tooltip
          label="Inclure un composant"
          hint={available.length > 0 ? 'Ses couches, textes et slots, mis à jour quand il change' : 'Aucun composant : crée-en un depuis une sélection (clic droit)'}
        >
          <button type="button" className="sm" disabled={available.length === 0} onClick={(event) => openMenu(event, addEntries)}>
            <Icon name="component" />
            Inclure
          </button>
        </Tooltip>
      </div>
      {includes.length === 0 && (
        <p className="field-hint">
          Un composant se dessine une fois (barre d’onglets, pagination, bouton retour) et se réutilise dans plusieurs menus.
        </p>
      )}
      <ul className="state-list">
        {includes.map((include, index) => {
          const known = components.find((component) => component.id === include.component);
          const problems: string[] = [];
          if (include.component === menuId) problems.push('un menu ne peut pas s’inclure lui-même');
          else if (!known) problems.push(`le composant « ${include.component} » n’existe pas (ou n’est plus marqué composant)`);
          return (
            <li
              key={index}
              className={problems.length > 0 ? 'state-card include-card has-problem' : 'state-card include-card'}
              onContextMenu={(event) => {
                event.stopPropagation();
                openMenu(event, cardEntries(index));
              }}
            >
              <div className="include-card-head">
                <Icon name="component" />
                <select aria-label="Composant" value={include.component} onChange={(event) => setKey(index, 'component', event.target.value)}>
                  {!known && <option value={include.component}>{include.component} (introuvable)</option>}
                  {available.map((component) => (
                    <option key={component.id} value={component.id}>
                      {component.name}
                    </option>
                  ))}
                </select>
                <IconButton icon="open" label="Ouvrir le composant" disabled={!known} onClick={() => onOpenComponent(include.component)} />
                <IconButton icon="more" label="Plus d’actions" hint="Détacher, retirer (clic droit aussi)" variant="ghost" onClick={(event) => openMenu(event, cardEntries(index))} />
              </div>
              <label className="field">
                <span className="field-label">Préfixe des identifiants</span>
                <InlineCommitInput
                  className="mono"
                  label="Préfixe des identifiants"
                  placeholder="aucun"
                  value={include.prefix ?? ''}
                  validate={(value) => (value === '' || ID_PATTERN.test(value) ? null : 'Lettres minuscules, chiffres et _ uniquement')}
                  onCommit={(value) => setKey(index, 'prefix', value || undefined)}
                />
              </label>
              <div className="field-row">
                <OptionalNumberField label="Décalage colonnes" value={include.col} placeholder="0" min={-8} max={8} onChange={(value) => setKey(index, 'col', offset(value))} />
                <OptionalNumberField label="Décalage lignes" value={include.row} placeholder="0" min={-5} max={5} onChange={(value) => setKey(index, 'row', offset(value))} />
              </div>
              <div className="field-row">
                <OptionalNumberField label="x en plus (px)" value={include.x} placeholder="0" onChange={(value) => setKey(index, 'x', offset(value))} />
                <OptionalNumberField label="y en plus (px)" value={include.y} placeholder="0" onChange={(value) => setKey(index, 'y', offset(value))} />
              </div>
              <ConditionEditor
                label="Instance visible si"
                hint="s’ajoute à la condition de chaque élément"
                value={include.visibleWhen}
                states={states}
                flags={flags}
                onCommit={(condition) => setKey(index, 'visibleWhen', condition)}
              />
              {problems.map((problem) => (
                <FieldError key={problem}>{problem}</FieldError>
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
