import { Suspense, lazy, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { AlignMode, AlignReference, DistributeAxis } from '../model/arrange';
import { MAX_ROWS } from '../model/geometry';
import type { Rect } from '../model/geometry';
import type {
  Condition,
  EditorFlag,
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
import type { ActionContext } from '../model/actions';
import { AlignBar } from './AlignBar';
import { CommitField, Field, NumberField } from './fields';
import { SLOT_COLORS } from './slotColors';
import './visual/visual.css';

// Éditeurs visuels chargés à part : leur code n’alourdit pas le démarrage du studio. L’inspecteur les
// précharge dès son apparition, et chacun a sa propre attente : la sélection reste toujours affichée.
const VISUAL_EDITORS = {
  actions: () => import('./visual/ActionListEditor'),
  conditions: () => import('./visual/ConditionEditor'),
  includes: () => import('./visual/IncludesEditor'),
  item: () => import('./visual/ItemEditor'),
  states: () => import('./visual/StateEditor'),
};
const ActionListEditor = lazy(() => VISUAL_EDITORS.actions().then((module) => ({ default: module.ActionListEditor })));
const ConditionEditor = lazy(() => VISUAL_EDITORS.conditions().then((module) => ({ default: module.ConditionEditor })));
const IncludesEditor = lazy(() => VISUAL_EDITORS.includes().then((module) => ({ default: module.IncludesEditor })));
const ItemEditor = lazy(() => VISUAL_EDITORS.item().then((module) => ({ default: module.ItemEditor })));
const StateEditor = lazy(() => VISUAL_EDITORS.states().then((module) => ({ default: module.StateEditor })));

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
  /** Ce que l’éditeur d’actions connaît : états résolus et menus de l’espace. */
  actionContext: ActionContext;
  /** Drapeaux connus (autres menus, aperçu), proposés dans les conditions. */
  flags: string[];
  /** Variables de l’aperçu, pour l’infobulle des items. */
  variables: Record<string, string>;
  /** Sources des slots « liste » et listes paginées. */
  lists: string[];
  /** Composants de l’espace (menus `component: true`), à inclure. */
  components: Array<Pick<MenuDefinition, 'id' | 'name'>>;
  /** Ouvre un autre menu de l’espace dans l’éditeur. */
  onOpenMenu: (id: string) => void;
  /** Détache une instance de composant : ses éléments deviennent propres au menu. */
  onDetachInclude: (index: number) => void;
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

/** En-tête de l’inspecteur : titre et pastille du type d’élément. */
function InspectorHeader({ children }: { children: ReactNode }) {
  return (
    <header className="section-header">
      <h3>Inspecteur</h3>
      <span className="pill">{children}</span>
    </header>
  );
}

/** Condition d’un élément, dans son cadre : éditeur visuel (arbre, résumé, accès JSON). */
function ConditionField({
  label,
  value,
  states,
  flags,
  hint,
  onCommit,
}: {
  label: string;
  value: Condition | undefined;
  states: Record<string, StateDefinition>;
  flags: string[];
  hint?: string;
  onCommit: (condition: Condition | undefined) => void;
}) {
  return (
    <div className="field-group">
      <Suspense fallback={<EditorLoading />}>
        <ConditionEditor label={label} value={value} states={states} flags={flags} hint={hint} onCommit={onCommit} />
      </Suspense>
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
          hint="Dans l’éditeur seulement : l’élément reste affiché en jeu"
          flag="hidden"
          menu={props.menu}
          targets={targets}
          onChange={props.onChange}
        />
      </div>
    </div>
  );
}

/** Inspecteur de la sélection (ou du menu) ; ses éditeurs visuels, chargés à part, sont préchargés dès son apparition. */
export function Inspector(props: InspectorProps) {
  useEffect(() => {
    for (const load of Object.values(VISUAL_EDITORS)) void load();
  }, []);
  return <InspectorContent {...props} />;
}

/** Place d’un éditeur visuel pendant son chargement (le reste de l’inspecteur reste affiché). */
function EditorLoading() {
  return (
    <p className="muted small loading-line">
      <Icon name="loader" />
      Chargement…
    </p>
  );
}

function InspectorContent(props: InspectorProps) {
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
            hint={layer.generator ? 'Indisponible pour une texture générée' : 'Garder une partie : un sprite d’un atlas, une case…'}
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
          flags={props.flags}
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
        <Field label="Contenu" hint="Variables : {viewer.name}, {page.number}, {page.count}, {state.nom}…">
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
          flags={props.flags}
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
        <Field label="Source de données" hint="Nom de la liste fournie par le serveur (ListProvider)">
          <input
            className="mono"
            list="inspector-list-sources"
            value={slot.list ?? ''}
            onChange={(event) => update((target) => (target.list = event.target.value))}
          />
          <datalist id="inspector-list-sources">
            {props.lists.map((list) => (
              <option key={list} value={list} />
            ))}
          </datalist>
        </Field>
      ) : (
        <div className="field-group">
          <Suspense fallback={<EditorLoading />}>
            <ItemEditor
              item={slot.item}
              variables={props.variables}
              onChange={(item) =>
                update((target) => {
                  if (item) target.item = item;
                  else delete target.item;
                })
              }
            />
          </Suspense>
        </div>
      )}
      {(slot.kind !== 'decoration' || (slot.onClick?.length ?? 0) > 0) && (
        <div className="field-group">
          <Suspense fallback={<EditorLoading />}>
            <ActionListEditor
              actions={slot.onClick}
              context={props.actionContext}
              menuId={menu.id}
              onOpenMenu={props.onOpenMenu}
              onChange={(actions) =>
                update((target) => {
                  if (actions) target.onClick = actions;
                  else delete target.onClick;
                })
              }
            />
          </Suspense>
        </div>
      )}
      <ConditionField
        label="Visible si"
        hint="sinon le slot est vide"
        value={slot.visibleWhen}
        states={props.states}
        flags={props.flags}
        onCommit={(condition) => update((target) => (target.visibleWhen = condition))}
      />
      <ConditionField
        label="Actif si"
        hint="sinon il est affiché mais ne réagit pas"
        value={slot.enabledWhen}
        states={props.states}
        flags={props.flags}
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
        flags={props.flags}
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

function MenuProperties(props: InspectorProps) {
  const { menu, onChange } = props;
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
      <label className="checkbox" title="Inclus dans d’autres menus (Composants inclus) ; ne s’ouvre pas seul en jeu">
        <input
          type="checkbox"
          checked={menu.component ?? false}
          onChange={(event) => onChange((draft) => (draft.component = event.target.checked || undefined))}
        />
        Composant réutilisable
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
      <div className="field-group">
        <Suspense fallback={<EditorLoading />}>
          <StateEditor menu={menu} resolvedStates={props.states} lists={props.lists} onChange={onChange} />
        </Suspense>
      </div>
      <div className="field-group">
        <Suspense fallback={<EditorLoading />}>
          <IncludesEditor
            includes={menu.includes}
            components={props.components}
            menuId={menu.id}
            states={props.states}
            flags={props.flags}
            onOpenComponent={props.onOpenMenu}
            onDetach={props.onDetachInclude}
            onChange={(includes) =>
              onChange((draft) => {
                if (includes) draft.includes = includes;
                else delete draft.includes;
              })
            }
          />
        </Suspense>
      </div>
      <p className="field-hint">
        Sélectionne un élément sur la toile ou dans la liste pour le modifier ; Maj ou Ctrl + clic, ou un rectangle tracé
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
            <kbd>E</kbd>
          </dt>
          <dd>Essayer le menu (Échap pour revenir)</dd>
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
