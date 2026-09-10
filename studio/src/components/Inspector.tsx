import type { ReactNode } from 'react';
import { MAX_ROWS } from '../model/geometry';
import type {
  Action,
  Condition,
  ItemSpec,
  Layer,
  MenuDefinition,
  Slot,
  SlotKind,
  StateDefinition,
  TextAlign,
  TextElement,
} from '../model/menu';
import { ID_PATTERN } from '../model/menu';
import type { ElementKind } from '../model/resolve';
import type { Selection } from '../state/editor';
import { Icon } from '../ui/Icon';
import { ArrowKeys, ShortcutKeys } from '../ui/Keys';
import { CommitField, Field, JsonField, NumberField } from './fields';
import { SLOT_COLORS } from './slotColors';

type Recipe = (draft: MenuDefinition) => void;

interface InspectorProps {
  /** Menu propre (non résolu) : seul ce qu’il contient est éditable. */
  menu: MenuDefinition;
  /** États disponibles, gabarits inclus, pour les conditions rapides. */
  states: Record<string, StateDefinition>;
  selection: Selection | null;
  textures: string[];
  onChange: (recipe: Recipe) => void;
  onSelect: (selection: Selection | null) => void;
  onEditGenerator: (layerId: string) => void;
}

const SLOT_KIND_LABELS: Record<SlotKind, string> = {
  button: 'Bouton',
  list: 'Liste (source de données)',
  input: 'Dépôt d’item',
  decoration: 'Décoration',
};

/** Nom court de chaque type de slot, pour la pastille de l’en-tête. */
const SLOT_KIND_NAMES: Record<SlotKind, string> = {
  button: 'bouton',
  list: 'liste',
  input: 'dépôt',
  decoration: 'décoration',
};

const ACTION_PRESETS: Array<{ label: string; action: Action }> = [
  { label: 'Ouvrir un menu', action: { type: 'open', menu: 'autre_menu' } },
  { label: 'Retour', action: { type: 'back' } },
  { label: 'Fermer', action: { type: 'close' } },
  { label: 'Changer l’état', action: { type: 'setState', state: 'tab', value: '' } },
  { label: 'Page suivante', action: { type: 'nextPage', list: 'items' } },
  { label: 'Page précédente', action: { type: 'prevPage', list: 'items' } },
  { label: 'Jouer un son', action: { type: 'sound', sound: 'minecraft:ui.button.click' } },
  { label: 'Commande', action: { type: 'command', command: 'say {viewer.name}', as: 'player' } },
  { label: 'Action serveur', action: { type: 'custom', id: 'mon_action' } },
];

function collectionOf(draft: MenuDefinition, kind: ElementKind): Array<{ id: string }> {
  if (kind === 'layer') return draft.layers;
  if (kind === 'text') return (draft.texts ??= []);
  return (draft.slots ??= []);
}

/** Options de conditions prêtes à l’emploi, déduites des états du menu. */
function conditionOptions(states: Record<string, StateDefinition>): Array<{ label: string; condition: Condition }> {
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

/** En-tête de l’inspecteur : titre et pastille du type d’élément. */
function InspectorHeader({ children }: { children: ReactNode }) {
  return (
    <header className="section-header">
      <h3>Inspecteur</h3>
      <span className="pill">{children}</span>
    </header>
  );
}

function ConditionField({
  label,
  value,
  states,
  onCommit,
}: {
  label: string;
  value: Condition | undefined;
  states: Record<string, StateDefinition>;
  onCommit: (condition: Condition | undefined) => void;
}) {
  const options = conditionOptions(states);
  const serialized = JSON.stringify(value);
  const index = options.findIndex((option) => JSON.stringify(option.condition) === serialized);
  const selected = value === undefined ? 'always' : index >= 0 ? String(index) : 'custom';
  return (
    <div className="field-group">
      <Field label={label}>
        <select
          value={selected}
          onChange={(event) => {
            const choice = event.target.value;
            if (choice === 'always') onCommit(undefined);
            else if (choice !== 'custom') onCommit(options[Number(choice)].condition);
          }}
        >
          <option value="always">Toujours</option>
          {options.map((option, optionIndex) => (
            <option key={option.label} value={optionIndex}>
              {option.label}
            </option>
          ))}
          <option value="custom" disabled>
            Personnalisée (JSON ci-dessous)
          </option>
        </select>
      </Field>
      <JsonField<Condition> label="Condition (JSON)" value={value} onCommit={onCommit} rows={2} />
    </div>
  );
}

export function Inspector(props: InspectorProps) {
  const { menu, selection } = props;

  if (!selection) return <MenuProperties {...props} />;

  const validateId = (kind: ElementKind, current: string) => (next: string) => {
    if (!ID_PATTERN.test(next)) return 'Lettres minuscules, chiffres et _ uniquement';
    const taken = collectionOf(structuredClone(menu), kind).some((element) => element.id === next);
    return taken && next !== current ? 'Identifiant déjà utilisé' : null;
  };

  const rename = (kind: ElementKind, current: string) => (next: string) => {
    props.onChange((draft) => {
      const element = collectionOf(draft, kind).find((candidate) => candidate.id === current);
      if (element) element.id = next;
    });
    props.onSelect({ kind, id: next });
  };

  if (selection.kind === 'layer') {
    const layer = menu.layers.find((candidate) => candidate.id === selection.id);
    if (!layer) return null;
    const update = (recipe: (target: Layer) => void) =>
      props.onChange((draft) => {
        const target = draft.layers.find((candidate) => candidate.id === layer.id);
        if (target) recipe(target);
      });
    const textureChoices = props.textures.includes(layer.texture) ? props.textures : [layer.texture, ...props.textures];
    return (
      <section className="panel-section inspector">
        <InspectorHeader>
          <span className="kind-dot layer" />
          couche{layer.generator ? ' · générée' : ''}
        </InspectorHeader>
        <CommitField label="Identifiant" value={layer.id} validate={validateId('layer', layer.id)} onCommit={rename('layer', layer.id)} />
        <Field label="Texture">
          <select className="mono" value={layer.texture} onChange={(event) => update((target) => (target.texture = event.target.value))}>
            {textureChoices.map((texture) => (
              <option key={texture} value={texture}>
                {texture}
              </option>
            ))}
          </select>
        </Field>
        <div className="field-row">
          <NumberField label="x" value={layer.x} onChange={(value) => update((target) => (target.x = value))} />
          <NumberField label="y" value={layer.y} onChange={(value) => update((target) => (target.y = value))} />
        </div>
        {layer.generator && (
          <button type="button" className="wide" onClick={() => props.onEditGenerator(layer.id)}>
            <Icon name="sparkles" />
            Modifier la texture générée
          </button>
        )}
        <ConditionField
          label="Visible si"
          value={layer.visibleWhen}
          states={props.states}
          onCommit={(condition) => update((target) => (target.visibleWhen = condition))}
        />
      </section>
    );
  }

  if (selection.kind === 'text') {
    const text = menu.texts?.find((candidate) => candidate.id === selection.id);
    if (!text) return null;
    const update = (recipe: (target: TextElement) => void) =>
      props.onChange((draft) => {
        const target = draft.texts?.find((candidate) => candidate.id === text.id);
        if (target) recipe(target);
      });
    return (
      <section className="panel-section inspector">
        <InspectorHeader>
          <span className="kind-dot text" />
          texte
        </InspectorHeader>
        <CommitField label="Identifiant" value={text.id} validate={validateId('text', text.id)} onCommit={rename('text', text.id)} />
        <Field label="Contenu" hint="Variables : {viewer.name}, {page.number}, {page.count}, {state.nom}…">
          <input value={text.value} onChange={(event) => update((target) => (target.value = event.target.value))} />
        </Field>
        <div className="field-row">
          <NumberField label="x" value={text.x} onChange={(value) => update((target) => (target.x = value))} />
          <NumberField label="y" value={text.y} onChange={(value) => update((target) => (target.y = value))} />
        </div>
        <div className="field-row">
          <Field label="Alignement">
            <select
              value={text.align ?? 'left'}
              onChange={(event) => update((target) => (target.align = event.target.value as TextAlign))}
            >
              <option value="left">Gauche</option>
              <option value="center">Centré</option>
              <option value="right">Droite</option>
            </select>
          </Field>
          <Field label="Couleur">
            <input
              type="color"
              value={text.color ?? '#404040'}
              onChange={(event) => update((target) => (target.color = event.target.value))}
            />
          </Field>
        </div>
        <ConditionField
          label="Visible si"
          value={text.visibleWhen}
          states={props.states}
          onCommit={(condition) => update((target) => (target.visibleWhen = condition))}
        />
      </section>
    );
  }

  const slot = menu.slots?.find((candidate) => candidate.id === selection.id);
  if (!slot) return null;
  const update = (recipe: (target: Slot) => void) =>
    props.onChange((draft) => {
      const target = draft.slots?.find((candidate) => candidate.id === slot.id);
      if (target) recipe(target);
    });
  const updateItem = (recipe: (item: ItemSpec) => void) =>
    update((target) => {
      target.item ??= {};
      recipe(target.item);
    });
  return (
    <section className="panel-section inspector">
      <InspectorHeader>
        <span className="kind-dot" style={{ background: SLOT_COLORS[slot.kind] }} />
        slot · {SLOT_KIND_NAMES[slot.kind]}
      </InspectorHeader>
      <CommitField label="Identifiant" value={slot.id} validate={validateId('slot', slot.id)} onCommit={rename('slot', slot.id)} />
      <Field label="Type">
        <select value={slot.kind} onChange={(event) => update((target) => (target.kind = event.target.value as SlotKind))}>
          {Object.entries(SLOT_KIND_LABELS).map(([kind, label]) => (
            <option key={kind} value={kind}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <div className="field-row">
        <NumberField label="Colonne" value={slot.area.col} min={0} max={8} onChange={(value) => update((target) => (target.area.col = value))} />
        <NumberField label="Ligne" value={slot.area.row} min={0} max={MAX_ROWS - 1} onChange={(value) => update((target) => (target.area.row = value))} />
      </div>
      <div className="field-row">
        <NumberField label="Largeur" value={slot.area.width ?? 1} min={1} max={9} onChange={(value) => update((target) => (target.area.width = value))} />
        <NumberField label="Hauteur" value={slot.area.height ?? 1} min={1} max={MAX_ROWS} onChange={(value) => update((target) => (target.area.height = value))} />
      </div>
      {slot.kind === 'list' ? (
        <Field label="Source de données" hint="Nom de la liste fournie par le serveur">
          <input className="mono" value={slot.list ?? ''} onChange={(event) => update((target) => (target.list = event.target.value))} />
        </Field>
      ) : (
        <>
          <Field label="Nom affiché (MiniMessage)">
            <input value={slot.item?.name ?? ''} onChange={(event) => updateItem((item) => (item.name = event.target.value))} />
          </Field>
          <Field label="Description (une ligne par entrée)">
            <textarea
              rows={3}
              value={(slot.item?.lore ?? []).join('\n')}
              onChange={(event) =>
                updateItem((item) => (item.lore = event.target.value ? event.target.value.split('\n') : undefined))
              }
            />
          </Field>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={slot.item?.invisible ?? false}
              onChange={(event) => updateItem((item) => (item.invisible = event.target.checked || undefined))}
            />
            Item invisible (le bouton est dessiné par une couche)
          </label>
          {!slot.item?.invisible && (
            <Field label="Matériau">
              <input
                className="mono"
                value={slot.item?.material ?? ''}
                placeholder="PLAYER_HEAD, DIAMOND…"
                onChange={(event) => updateItem((item) => (item.material = event.target.value || undefined))}
              />
            </Field>
          )}
        </>
      )}
      <Field label="Ajouter une action au clic">
        <select
          value=""
          onChange={(event) => {
            const preset = ACTION_PRESETS[Number(event.target.value)];
            if (preset) update((target) => (target.onClick = [...(target.onClick ?? []), structuredClone(preset.action)]));
          }}
        >
          <option value="">Choisir…</option>
          {ACTION_PRESETS.map((preset, index) => (
            <option key={preset.label} value={index}>
              {preset.label}
            </option>
          ))}
        </select>
      </Field>
      <JsonField<Action[]>
        label="Actions au clic (JSON)"
        value={slot.onClick}
        rows={4}
        onCommit={(actions) => update((target) => (target.onClick = actions))}
      />
      <ConditionField
        label="Visible si"
        value={slot.visibleWhen}
        states={props.states}
        onCommit={(condition) => update((target) => (target.visibleWhen = condition))}
      />
      <ConditionField
        label="Actif si"
        value={slot.enabledWhen}
        states={props.states}
        onCommit={(condition) => update((target) => (target.enabledWhen = condition))}
      />
    </section>
  );
}

function MenuProperties({ menu, onChange }: InspectorProps) {
  return (
    <section className="panel-section inspector">
      <InspectorHeader>
        <Icon name="chest" />
        menu · {menu.id}
      </InspectorHeader>
      <Field label="Nom">
        <input value={menu.name} onChange={(event) => onChange((draft) => (draft.name = event.target.value))} />
      </Field>
      <NumberField
        label="Lignes du coffre"
        value={menu.container.rows}
        min={1}
        max={MAX_ROWS}
        onChange={(value) => onChange((draft) => (draft.container.rows = Math.min(MAX_ROWS, Math.max(1, value))))}
      />
      <label className="checkbox">
        <input
          type="checkbox"
          checked={menu.template ?? false}
          onChange={(event) => onChange((draft) => (draft.template = event.target.checked || undefined))}
        />
        Gabarit partiel (hérité par d’autres menus)
      </label>
      <CommitField
        label="Hérite de (ids séparés par des virgules)"
        value={(menu.extends ?? []).join(', ')}
        onCommit={(value) =>
          onChange((draft) => {
            const ids = value.split(',').map((id) => id.trim()).filter(Boolean);
            draft.extends = ids.length > 0 ? ids : undefined;
          })
        }
      />
      <JsonField<Record<string, StateDefinition>>
        label="Variables d’état (JSON)"
        value={menu.state}
        rows={6}
        placeholder={'{ "tab": { "type": "enum", "values": ["a", "b"], "default": "a" } }'}
        onCommit={(state) => onChange((draft) => (draft.state = state))}
      />
      <p className="field-hint">Sélectionne un élément sur la toile ou dans la liste pour le modifier.</p>
      <div className="shortcuts">
        <h4>
          <Icon name="keyboard" />
          Raccourcis
        </h4>
        <dl className="shortcut-list">
          <dt>
            <kbd>V</kbd>
          </dt>
          <dd>Outil Sélection</dd>
          <dt>
            <kbd>S</kbd>
          </dt>
          <dd>Outil Slots</dd>
          <dt>
            <kbd>Suppr</kbd>
          </dt>
          <dd>Supprimer l’élément</dd>
          <dt>
            <ArrowKeys />
          </dt>
          <dd>Déplacer de 1 px</dd>
          <dt>
            <ShortcutKeys shortcut="Maj+Flèches" />
          </dt>
          <dd>Déplacer de 18 px</dd>
          <dt>
            <kbd>Échap</kbd>
          </dt>
          <dd>Désélectionner</dd>
          <dt>
            <ShortcutKeys shortcut="Ctrl+Z" />
          </dt>
          <dd>Annuler</dd>
          <dt>
            <ShortcutKeys shortcut="Ctrl+Y" />
          </dt>
          <dd>Rétablir</dd>
          <dt>
            <ShortcutKeys shortcut="Ctrl+0" />
          </dt>
          <dd>Ajuster le zoom</dd>
          <dt>
            <ShortcutKeys shortcut="Ctrl+S" />
          </dt>
          <dd>Enregistrer</dd>
        </dl>
      </div>
    </section>
  );
}
