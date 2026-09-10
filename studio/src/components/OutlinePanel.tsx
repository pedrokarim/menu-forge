import { useRef } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { evaluateCondition } from '../model/conditions';
import type { MenuDefinition } from '../model/menu';
import type { PreviewContext } from '../model/preview';
import { elementKey } from '../model/resolve';
import type { ElementKind } from '../model/resolve';
import type { Selection } from '../state/editor';
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
}

function stop(action: () => void) {
  return (event: MouseEvent) => {
    event.stopPropagation();
    action();
  };
}

export function OutlinePanel(props: OutlinePanelProps) {
  const { menu, inherited, context, selection } = props;
  const fileInput = useRef<HTMLInputElement>(null);

  const renderItem = (
    kind: ElementKind,
    id: string,
    label: ReactNode,
    visible: boolean,
    extraActions?: ReactNode,
  ) => {
    const isInherited = inherited.has(elementKey(kind, id));
    const isSelected = selection?.kind === kind && selection.id === id;
    const classes = ['outline-item'];
    if (isSelected) classes.push('selected');
    if (isInherited) classes.push('inherited');
    if (!visible) classes.push('hidden-by-state');
    return (
      <li
        key={elementKey(kind, id)}
        className={classes.join(' ')}
        onClick={() => !isInherited && props.onSelect({ kind, id })}
        title={visible ? undefined : 'Masqué dans l’état d’aperçu courant'}
      >
        <span className="outline-label">{label}</span>
        {isInherited ? (
          <span className="badge">gabarit</span>
        ) : (
          <span className="outline-actions">
            {extraActions}
            <button type="button" title="Supprimer" onClick={stop(() => props.onDelete({ kind, id }))}>
              ✕
            </button>
          </span>
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
            <button type="button" onClick={props.onOpenGenerator} title="Générer une texture">
              ＋ Générer
            </button>
            <button type="button" onClick={() => fileInput.current?.click()} title="Importer un PNG">
              ＋ PNG
            </button>
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
        {menu.layers.length === 0 && <p className="muted">Aucune couche. Génère un panneau pour commencer.</p>}
        <ul className="outline-list">
          {[...menu.layers].reverse().map((layer) =>
            renderItem(
              'layer',
              layer.id,
              <>
                <span className="kind-dot layer" /> {layer.id}
              </>,
              evaluateCondition(layer.visibleWhen, context),
              <>
                <button type="button" title="Monter" onClick={stop(() => props.onReorderLayer(layer.id, 1))}>
                  ▲
                </button>
                <button type="button" title="Descendre" onClick={stop(() => props.onReorderLayer(layer.id, -1))}>
                  ▼
                </button>
              </>,
            ),
          )}
        </ul>
      </section>

      <section className="panel-section">
        <header className="section-header">
          <h3>Textes</h3>
          <div className="section-actions">
            <button type="button" onClick={props.onAddText}>
              ＋ Texte
            </button>
          </div>
        </header>
        <ul className="outline-list">
          {(menu.texts ?? []).map((text) =>
            renderItem(
              'text',
              text.id,
              <>
                <span className="kind-dot text" /> {text.id} <span className="muted">« {text.value} »</span>
              </>,
              evaluateCondition(text.visibleWhen, context),
            ),
          )}
        </ul>
      </section>

      <section className="panel-section">
        <header className="section-header">
          <h3>Slots</h3>
        </header>
        <p className="muted small">Outil Slots (S) : glisse sur la grille pour créer une zone.</p>
        <ul className="outline-list">
          {(menu.slots ?? []).map((slot) =>
            renderItem(
              'slot',
              slot.id,
              <>
                <span className="kind-dot" style={{ background: SLOT_COLORS[slot.kind] }} /> {slot.id}{' '}
                <span className="muted">
                  {slot.kind} · {slot.area.col},{slot.area.row}
                  {(slot.area.width ?? 1) > 1 || (slot.area.height ?? 1) > 1
                    ? ` · ${slot.area.width ?? 1}×${slot.area.height ?? 1}`
                    : ''}
                </span>
              </>,
              evaluateCondition(slot.visibleWhen, context),
            ),
          )}
        </ul>
      </section>
    </div>
  );
}
