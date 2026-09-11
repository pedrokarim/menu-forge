import { useRef } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { evaluateCondition } from '../model/conditions';
import type { MenuDefinition, SlotKind } from '../model/menu';
import type { PreviewContext } from '../model/preview';
import { elementKey } from '../model/resolve';
import type { ElementKind } from '../model/resolve';
import type { Selection } from '../state/editor';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import { SLOT_COLORS } from './slotColors';

interface OutlinePanelProps {
  /** Menu résolu : les éléments hérités sont listés mais pas éditables. */
  menu: MenuDefinition;
  inherited: ReadonlySet<string>;
  context: PreviewContext;
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  onReorderLayer: (id: string, direction: 1 | -1) => void;
  onDelete: (selection: Selection) => void;
  onAddText: () => void;
  onOpenGenerator: () => void;
  onImport: (file: File) => void;
  /** Clic droit sur un élément modifiable (l’élément est d’abord sélectionné). */
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

  const renderItem = (
    kind: ElementKind,
    id: string,
    label: ReactNode,
    visible: boolean,
    meta?: ReactNode,
    extraActions?: ReactNode,
  ) => {
    const isInherited = inherited.has(elementKey(kind, id));
    const isSelected = selection?.kind === kind && selection.id === id;
    const classes = ['outline-item'];
    if (isSelected) classes.push('selected');
    if (isInherited) classes.push('inherited');
    if (!visible) classes.push('hidden-by-state');
    const choose = () => !isInherited && props.onSelect({ kind, id });
    return (
      <li
        key={elementKey(kind, id)}
        className={classes.join(' ')}
        tabIndex={isInherited ? undefined : 0}
        aria-current={isSelected || undefined}
        onClick={choose}
        onContextMenu={(event: MouseEvent) => {
          if (isInherited || !props.onItemContextMenu) return;
          props.onSelect({ kind, id });
          props.onItemContextMenu({ kind, id }, event);
        }}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          choose();
        }}
        title={visible ? undefined : 'Masqué dans l’état d’aperçu courant'}
      >
        <span className="outline-label">{label}</span>
        {isInherited ? (
          <span className="badge">gabarit</span>
        ) : (
          <>
            {meta !== undefined && <span className="outline-meta">{meta}</span>}
            <span className="outline-actions">
              {extraActions}
              <IconButton
                icon="trash"
                label="Supprimer"
                shortcut="Suppr"
                variant="danger"
                onClick={stop(() => props.onDelete({ kind, id }))}
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
            <Tooltip label="Importer un PNG" hint="Ajoute l’image comme nouvelle couche">
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
            <span>Aucune couche. Génère un panneau, importe un PNG ou pioche dans la bibliothèque.</span>
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
            <Tooltip label="Ajouter un texte" hint="Variables acceptées : {viewer.name}, {page.number}…">
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
