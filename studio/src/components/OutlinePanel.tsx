import { useRef } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { isAdditiveClick } from '../lib/shortcuts';
import { evaluateCondition } from '../model/conditions';
import type { EditorFlag, EditorFlags, MenuDefinition, SlotKind } from '../model/menu';
import type { PreviewContext } from '../model/preview';
import { elementKey } from '../model/resolve';
import type { ElementKind, ElementOrigin } from '../model/resolve';
import { mergeSelections, sameSelection, selectionIncludes, toggleSelection } from '../state/editor';
import type { Selection } from '../state/editor';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import { SLOT_COLORS } from './slotColors';

interface OutlinePanelProps {
  /** Menu résolu : les éléments hérités sont listés mais pas éditables. */
  menu: MenuDefinition;
  inherited: ReadonlySet<string>;
  /** Origine des éléments hérités (gabarit ou composant), pour leur pastille. */
  origins?: ReadonlyMap<string, ElementOrigin>;
  context: PreviewContext;
  selection: Selection[];
  onSelect: (selection: Selection[]) => void;
  onReorderLayer: (id: string, direction: 1 | -1) => void;
  onDelete: (targets: Selection[]) => void;
  /** Verrouiller / masquer un élément (bascule). */
  onToggleFlag: (target: Selection, flag: EditorFlag) => void;
  onAddText: () => void;
  onOpenGenerator: () => void;
  onImport: (file: File) => void;
  /** Clic droit sur un élément modifiable (il rejoint d’abord la sélection s’il n’y était pas). */
  onItemContextMenu?: (selection: Selection, event: MouseEvent) => void;
}

/** Nom affiché de chaque type de slot (la valeur du format reste en anglais). */
const SLOT_KIND_NAMES: Record<SlotKind, string> = {
  button: 'bouton',
  list: 'liste',
  input: 'dépôt',
  decoration: 'décoration',
};

function stop(action: () => void) {
  return (event: MouseEvent) => {
    event.stopPropagation();
    action();
  };
}

export function OutlinePanel(props: OutlinePanelProps) {
  const { menu, inherited, context, selection } = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const slots = menu.slots ?? [];
  const texts = menu.texts ?? [];
  // Ordre d’affichage de chaque section (Maj+clic sélectionne une plage dans une section).
  const sections: Record<ElementKind, string[]> = {
    layer: [...menu.layers].reverse().map((layer) => layer.id),
    text: texts.map((text) => text.id),
    slot: slots.map((slot) => slot.id),
  };

  /** Clic sur un élément de la liste : seul, ajouté / retiré (Ctrl), ou plage (Maj). */
  const choose = (target: Selection, event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    const anchor = selection.at(-1);
    if (event.shiftKey && anchor && anchor.kind === target.kind && !sameSelection(anchor, target)) {
      const order = sections[target.kind];
      const [from, to] = [order.indexOf(anchor.id), order.indexOf(target.id)].sort((a, b) => a - b);
      const range = order
        .slice(from, to + 1)
        .filter((id) => !inherited.has(elementKey(target.kind, id)))
        .map((id) => ({ kind: target.kind, id }));
      // L’ancre reste l’élément actif (dernier de la sélection).
      props.onSelect([...mergeSelections(selection, range).filter((item) => !sameSelection(item, anchor)), anchor]);
      return;
    }
    if (isAdditiveClick(event)) props.onSelect(toggleSelection(selection, target));
    else props.onSelect([target]);
  };

  const flagButtons = (target: Selection, flags: EditorFlags | undefined) => {
    const locked = flags?.locked === true;
    const hidden = flags?.hidden === true;
    return (
      <>
        <IconButton
          icon={hidden ? 'eye-off' : 'eye'}
          label={hidden ? 'Afficher sur la toile' : 'Masquer sur la toile'}
          hint="Dans l’éditeur seulement : l’élément reste en jeu"
          variant="ghost"
          pressed={hidden}
          onClick={stop(() => props.onToggleFlag(target, 'hidden'))}
        />
        <IconButton
          icon={locked ? 'lock' : 'unlock'}
          label={locked ? 'Déverrouiller' : 'Verrouiller'}
          hint="Verrouillé : ne se sélectionne plus sur la toile"
          variant="ghost"
          pressed={locked}
          onClick={stop(() => props.onToggleFlag(target, 'locked'))}
        />
      </>
    );
  };

  const renderItem = (
    kind: ElementKind,
    id: string,
    label: ReactNode,
    visible: boolean,
    flags: EditorFlags | undefined,
    meta?: ReactNode,
    extraActions?: ReactNode,
  ) => {
    const target = { kind, id };
    const isInherited = inherited.has(elementKey(kind, id));
    const origin = props.origins?.get(elementKey(kind, id));
    const isSelected = selectionIncludes(selection, target);
    const classes = ['outline-item'];
    if (isSelected) classes.push('selected');
    if (isInherited) classes.push('inherited');
    if (!visible || flags?.hidden) classes.push('hidden-by-state');
    const title = flags?.hidden
      ? 'Masqué sur la toile (toujours présent en jeu)'
      : visible
        ? undefined
        : 'Masqué dans l’état d’aperçu courant';
    return (
      <li
        key={elementKey(kind, id)}
        className={classes.join(' ')}
        tabIndex={isInherited ? undefined : 0}
        aria-current={isSelected || undefined}
        onClick={(event: MouseEvent) => !isInherited && choose(target, event)}
        onContextMenu={(event: MouseEvent) => {
          if (isInherited || !props.onItemContextMenu) return;
          if (!isSelected) props.onSelect([target]);
          props.onItemContextMenu(target, event);
        }}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          if (!isInherited) choose(target, event);
        }}
        title={title}
      >
        <span className="outline-label">{label}</span>
        {isInherited ? (
          <span className="badge" title={origin ? `${origin.kind === 'component' ? 'Composant' : 'Gabarit'} « ${origin.id} »` : undefined}>
            {origin?.kind === 'component' ? 'composant' : 'gabarit'}
          </span>
        ) : (
          <>
            {(flags?.locked || flags?.hidden) && (
              <span className="outline-flags" aria-hidden="true">
                {flags.hidden && <Icon name="eye-off" />}
                {flags.locked && <Icon name="lock" />}
              </span>
            )}
            {meta !== undefined && <span className="outline-meta">{meta}</span>}
            <span className="outline-actions">
              {flagButtons(target, flags)}
              {extraActions}
              <IconButton
                icon="trash"
                label="Supprimer"
                shortcut="Suppr"
                variant="danger"
                onClick={stop(() => props.onDelete([target]))}
              />
            </span>
          </>
        )}
      </li>
    );
  };

  return (
    <div className="outline">
      <section className="panel-section">
        <header className="section-header">
          <h3>Couches</h3>
          <div className="section-actions">
            <Tooltip label="Générer une texture" hint="Panneau, bouton, cellules ou voile, dessinés par le studio">
              <button type="button" className="sm" onClick={props.onOpenGenerator}>
                <Icon name="sparkles" />
                Générer
              </button>
            </Tooltip>
            <Tooltip label="Importer un PNG" hint="Ajoute l’image comme nouvelle couche ; on peut aussi la glisser sur la toile">
              <button type="button" className="sm" onClick={() => fileInput.current?.click()}>
                <Icon name="upload" />
                PNG
              </button>
            </Tooltip>
            <input
              ref={fileInput}
              type="file"
              accept="image/png"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) props.onImport(file);
                event.target.value = '';
              }}
            />
          </div>
        </header>
        {menu.layers.length === 0 && (
          <p className="empty-hint">
            <Icon name="info" />
            <span>Aucune couche. Génère un panneau, importe un PNG (ou glisse-le sur la toile) ou pioche dans la bibliothèque.</span>
          </p>
        )}
        <ul className="outline-list">
          {[...menu.layers].reverse().map((layer) =>
            renderItem(
              'layer',
              layer.id,
              <>
                <span className="kind-dot layer" />
                <span className="outline-name">{layer.id}</span>
              </>,
              evaluateCondition(layer.visibleWhen, context),
              layer.editor,
              undefined,
              <>
                <IconButton
                  icon="chevron-up"
                  label="Monter"
                  hint="Dessiner au-dessus"
                  variant="ghost"
                  onClick={stop(() => props.onReorderLayer(layer.id, 1))}
                />
                <IconButton
                  icon="chevron-down"
                  label="Descendre"
                  hint="Dessiner en dessous"
                  variant="ghost"
                  onClick={stop(() => props.onReorderLayer(layer.id, -1))}
                />
              </>,
            ),
          )}
        </ul>
      </section>

      <section className="panel-section">
        <header className="section-header">
          <h3>Textes</h3>
          <div className="section-actions">
            <Tooltip label="Ajouter un texte" hint="Variables acceptées : {viewer.name}, {page.number}…">
              <button type="button" className="sm" onClick={props.onAddText}>
                <Icon name="plus" />
                Texte
              </button>
            </Tooltip>
          </div>
        </header>
        {texts.length === 0 && <p className="muted small">Aucun texte dans le titre.</p>}
        <ul className="outline-list">
          {texts.map((text) =>
            renderItem(
              'text',
              text.id,
              <>
                <span className="kind-dot text" />
                <span className="outline-name">{text.id}</span>
                <span className="muted">« {text.value} »</span>
              </>,
              evaluateCondition(text.visibleWhen, context),
              text.editor,
            ),
          )}
        </ul>
      </section>

      <section className="panel-section">
        <header className="section-header">
          <h3>Slots</h3>
          <span className="count">{slots.length}</span>
        </header>
        <p className="muted small">
          Outil Slots <kbd>S</kbd> : glisse sur la grille pour créer une zone.
        </p>
        <ul className="outline-list">
          {slots.map((slot) => {
            const width = slot.area.width ?? 1;
            const height = slot.area.height ?? 1;
            return renderItem(
              'slot',
              slot.id,
              <>
                <span className="kind-dot" style={{ background: SLOT_COLORS[slot.kind] }} />
                <span className="outline-name">{slot.id}</span>
                <span className="muted">{SLOT_KIND_NAMES[slot.kind]}</span>
              </>,
              evaluateCondition(slot.visibleWhen, context),
              slot.editor,
              `${slot.area.col},${slot.area.row}${width > 1 || height > 1 ? ` · ${width}×${height}` : ''}`,
            );
          })}
        </ul>
        {slots.length > 0 && (
          <div className="legend" aria-label="Légende des types de slots">
            {(Object.keys(SLOT_KIND_NAMES) as SlotKind[]).map((kind) => (
              <span key={kind}>
                <span className="kind-dot" style={{ background: SLOT_COLORS[kind] }} />
                {SLOT_KIND_NAMES[kind]}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
