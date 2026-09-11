import type { ReactNode } from 'react';
import type { AlignMode, AlignReference, DistributeAxis } from '../model/arrange';
import { MAX_ROWS } from '../model/geometry';
import type { Rect } from '../model/geometry';
import type {
  Action,
  Condition,
  EditorFlag,
  ItemSpec,
  Layer,
  MenuDefinition,
  Slot,
  SlotKind,
  StateDefinition,
  TextAlign,
  TextElement,
} from '../model/menu';
import { ID_PATTERN, hasEditorFlag } from '../model/menu';
import { findElement, setFlagOn } from '../model/menuEdit';
import type { ElementKind } from '../model/resolve';
import type { Selection } from '../state/editor';
import { Icon } from '../ui/Icon';
import { ArrowKeys, ShortcutKeys } from '../ui/Keys';
import { Tooltip } from '../ui/Tooltip';
import { AlignBar } from './AlignBar';
import { CommitField, Field, JsonField, NumberField } from './fields';
import { SLOT_COLORS } from './slotColors';

type Recipe = (draft: MenuDefinition) => void;

interface InspectorProps {
  /** Menu propre (non résolu) : seul ce qu’il contient est éditable. */
  menu: MenuDefinition;
  /** États disponibles, gabarits inclus, pour les conditions rapides. */
  states: Record<string, StateDefinition>;
  selection: Selection[];
  textures: string[];
  onChange: (recipe: Recipe) => void;
  onSelect: (selection: Selection[]) => void;
  onEditGenerator: (layerId: string) => void;
  /** Rogner la texture d’une couche (garder un sprite d’un atlas). */
  onCropLayer: (layerId: string) => void;
  onDuplicate: (targets: Selection[]) => void;
  onCopy: (targets: Selection[]) => void;
  onDelete: (targets: Selection[]) => void;
  /** Rectangle englobant de la sélection (pixels fenêtre). */
  selectionBounds: Rect | null;
  /** Déplace toute la sélection (couches et textes au pixel, zones à la cellule). */
  onMoveSelection: (dx: number, dy: number) => void;
  alignReference: AlignReference;
  onAlignReferenceChange: (reference: AlignReference) => void;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: DistributeAxis) => void;
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

const KIND_WORDS: Record<ElementKind, [string, string]> = {
  layer: ['couche', 'couches'],
  text: ['texte', 'textes'],
  slot: ['zone de slots', 'zones de slots'],
};

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

/** Case à cocher d’un drapeau d’éditeur, à trois états pour une sélection multiple. */
function FlagCheckbox({
  label,
  hint,
  flag,
  menu,
  targets,
  onChange,
}: {
  label: string;
  hint: string;
  flag: EditorFlag;
  menu: MenuDefinition;
  targets: Selection[];
  onChange: (recipe: Recipe) => void;
}) {
  const values = targets.map((target) => {
    const element = findElement(menu, target);
    return element ? hasEditorFlag(element, flag) : false;
  });
  const all = values.length > 0 && values.every(Boolean);
  const some = values.some(Boolean);
  return (
    <label className="checkbox" title={hint}>
      <input
        type="checkbox"
        checked={all}
        ref={(node) => {
          if (node) node.indeterminate = some && !all;
        }}
        onChange={(event) => {
          const value = event.target.checked;
          onChange((draft) => setFlagOn(draft, targets, flag, value));
        }}
      />
      {label}
    </label>
  );
}

/** Disposition : alignement et drapeaux d’éditeur (verrou, masque). */
function ArrangeSection({ props, targets }: { props: InspectorProps; targets: Selection[] }) {
  const multiple = targets.length > 1;
  return (
    <div className="field-group arrange-section">
      <span className="field-label">{multiple ? 'Aligner et répartir' : 'Aligner sur la toile'}</span>
      <AlignBar
        count={targets.length}
        reference={multiple ? props.alignReference : 'canvas'}
        onReferenceChange={multiple ? props.onAlignReferenceChange : undefined}
        onAlign={props.onAlign}
        onDistribute={props.onDistribute}
      />
      <div className="flag-row">
        <FlagCheckbox
          label="Verrouillé"
          hint="Ne se sélectionne plus sur la toile (reste dans la liste)"
          flag="locked"
          menu={props.menu}
          targets={targets}
          onChange={props.onChange}
        />
        <FlagCheckbox
          label="Masqué sur la toile"
          hint="Dans l’éditeur seulement : l’élément reste affiché en jeu"
          flag="hidden"
          menu={props.menu}
          targets={targets}
          onChange={props.onChange}
        />
      </div>
    </div>
  );
}

export function Inspector(props: InspectorProps) {
  const { menu, selection } = props;
  const own = selection.filter((target) => findElement(menu, target) !== undefined);

  if (own.length === 0) return <MenuProperties {...props} />;
  if (own.length > 1) return <SelectionInspector props={props} targets={own} />;
  const [only] = own;

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
    props.onSelect([{ kind, id: next }]);
  };

  if (only.kind === 'layer') {
    const layer = menu.layers.find((candidate) => candidate.id === only.id);
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
        <div className="button-row">
          <Tooltip
            label="Rogner la texture"
            hint={layer.generator ? 'Indisponible pour une texture générée' : 'Garder une partie : un sprite d’un atlas, une case…'}
          >
            <button type="button" className="sm" disabled={Boolean(layer.generator)} onClick={() => props.onCropLayer(layer.id)}>
              <Icon name="crop" />
              Rogner…
            </button>
          </Tooltip>
          <Tooltip label="Dupliquer la couche" shortcut="Ctrl+D">
            <button type="button" className="sm" onClick={() => props.onDuplicate([only])}>
              <Icon name="copy" />
              Dupliquer
            </button>
          </Tooltip>
        </div>
        {layer.generator && (
          <button type="button" className="wide" onClick={() => props.onEditGenerator(layer.id)}>
            <Icon name="sparkles" />
            Modifier la texture générée
          </button>
        )}
        <ArrangeSection props={props} targets={own} />
        <ConditionField
          label="Visible si"
          value={layer.visibleWhen}
          states={props.states}
          onCommit={(condition) => update((target) => (target.visibleWhen = condition))}
        />
      </section>
    );
  }

  if (only.kind === 'text') {
    const text = menu.texts?.find((candidate) => candidate.id === only.id);
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
        <ArrangeSection props={props} targets={own} />
        <ConditionField
          label="Visible si"
          value={text.visibleWhen}
          states={props.states}
          onCommit={(condition) => update((target) => (target.visibleWhen = condition))}
        />
      </section>
    );
  }

  const slot = menu.slots?.find((candidate) => candidate.id === only.id);
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
      <ArrangeSection props={props} targets={own} />
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

/** Sélection multiple : résumé, position de l’ensemble, disposition et ce qui est commun. */
function SelectionInspector({ props, targets }: { props: InspectorProps; targets: Selection[] }) {
  const { menu, selectionBounds } = props;
  const counts = (Object.keys(KIND_WORDS) as ElementKind[])
    .map((kind) => [kind, targets.filter((target) => target.kind === kind).length] as const)
    .filter(([, count]) => count > 0);
  const conditions = targets.map((target) => JSON.stringify(findElement(menu, target)?.visibleWhen ?? null));
  const sameCondition = conditions.every((condition) => condition === conditions[0]);
  const common = sameCondition ? findElement(menu, targets[0])?.visibleWhen : undefined;
  return (
    <section className="panel-section inspector">
      <InspectorHeader>
        <Icon name="marquee" />
        sélection · {targets.length} éléments
      </InspectorHeader>
      <ul className="selection-summary">
        {counts.map(([kind, count]) => (
          <li key={kind}>
            <span className={`kind-dot ${kind === 'slot' ? 'slot' : kind}`} />
            {count} {KIND_WORDS[kind][count > 1 ? 1 : 0]}
          </li>
        ))}
      </ul>
      {selectionBounds && (
        <>
          <div className="field-row">
            <NumberField label="x" value={selectionBounds.x} onChange={(value) => props.onMoveSelection(value - selectionBounds.x, 0)} />
            <NumberField label="y" value={selectionBounds.y} onChange={(value) => props.onMoveSelection(0, value - selectionBounds.y)} />
          </div>
          <p className="field-hint">
            Ensemble de {selectionBounds.width} × {selectionBounds.height} px ; les zones de slots se déplacent par case.
          </p>
        </>
      )}
      <ArrangeSection props={props} targets={targets} />
      <ConditionField
        label={sameCondition ? 'Visible si (tous)' : 'Visible si (valeurs différentes)'}
        value={common}
        states={props.states}
        onCommit={(condition) =>
          props.onChange((draft) => {
            for (const target of targets) {
              const element = findElement(draft, target);
              if (element) element.visibleWhen = condition;
            }
          })
        }
      />
      <div className="button-row wrap">
        <Tooltip label="Dupliquer la sélection" shortcut="Ctrl+D">
          <button type="button" className="sm" onClick={() => props.onDuplicate(targets)}>
            <Icon name="copy" />
            Dupliquer
          </button>
        </Tooltip>
        <Tooltip label="Copier la sélection" shortcut="Ctrl+C">
          <button type="button" className="sm" onClick={() => props.onCopy(targets)}>
            <Icon name="clipboard" />
            Copier
          </button>
        </Tooltip>
        <Tooltip label="Supprimer la sélection" shortcut="Suppr">
          <button type="button" className="sm danger" onClick={() => props.onDelete(targets)}>
            <Icon name="trash" />
            Supprimer
          </button>
        </Tooltip>
      </div>
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
      <p className="field-hint">
        Sélectionne un élément sur la toile ou dans la liste pour le modifier ; Maj ou Ctrl + clic, ou un rectangle tracé
        sur une zone vide, pour en sélectionner plusieurs.
      </p>
      <details className="shortcuts">
        <summary>
          <Icon name="keyboard" />
          Raccourcis
          <span className="shortcuts-all">
            tous&nbsp;: <kbd>?</kbd>
          </span>
        </summary>
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
            <ShortcutKeys shortcut="Maj+Clic" />
          </dt>
          <dd>Ajouter à la sélection</dd>
          <dt>
            <ShortcutKeys shortcut="Ctrl+A" />
          </dt>
          <dd>Tout sélectionner</dd>
          <dt>
            <ShortcutKeys shortcut="Suppr" />
          </dt>
          <dd>Supprimer la sélection</dd>
          <dt>
            <ShortcutKeys shortcut="Ctrl+D" />
          </dt>
          <dd>Dupliquer</dd>
          <dt>
            <ShortcutKeys shortcut="Ctrl+C" />
          </dt>
          <dd>Copier (Ctrl+X couper, Ctrl+V coller)</dd>
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
      </details>
    </section>
  );
}
