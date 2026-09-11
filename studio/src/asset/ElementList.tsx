import type { KeyboardEvent, MouseEvent } from 'react';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import type { AssetElement } from './model';
import { BOX_PRESETS } from './presets';

interface ElementListProps {
  /** Éléments dans l’ordre du fichier (le dernier est dessiné au-dessus). */
  elements: AssetElement[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** `1` = vers le dessus, `-1` = vers le dessous. */
  onReorder: (id: string, direction: 1 | -1) => void;
  onToggleHidden: (id: string) => void;
  onDelete: (id: string) => void;
  onAddBox: (presetId: string) => void;
  onAddText: () => void;
  /** Clic droit sur un élément (il est d’abord sélectionné). */
  onItemContextMenu?: (id: string, event: MouseEvent) => void;
}

function stop(action: () => void) {
  return (event: MouseEvent) => {
    event.stopPropagation();
    action();
  };
}

function describe(element: AssetElement): string {
  switch (element.type) {
    case 'box':
      return `${element.width} × ${element.height}${element.style.kind === 'slice' ? ' · nine-slice' : ''}`;
    case 'image':
      return element.texture.split('/').pop() ?? element.texture;
    case 'text': {
      const firstLine = element.text.split('\n')[0].replace(/§./gu, '');
      return `« ${firstLine} »`;
    }
  }
}

/** Liste des éléments, du dessus (en haut) vers le dessous : ordre, visibilité, suppression. */
export function ElementList(props: ElementListProps) {
  const { elements, selectedId } = props;
  const lastIndex = elements.length - 1;

  return (
    <section className="panel-section">
      <header className="section-header">
        <h3>Éléments</h3>
        <div className="section-actions">
          <Tooltip label="Ajouter une box" hint="Au centre de l’asset, avec le préréglage choisi ; outil Box : B">
            <select
              className="asset-add-select"
              value=""
              aria-label="Ajouter une box"
              onChange={(event) => {
                if (event.target.value) props.onAddBox(event.target.value);
              }}
            >
              <option value="">Box…</option>
              {BOX_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </Tooltip>
          <Tooltip label="Ajouter un texte" hint="Posé en haut à gauche ; outil Texte : T">
            <button type="button" className="sm" onClick={props.onAddText}>
              <Icon name="plus" />
              Texte
            </button>
          </Tooltip>
        </div>
      </header>
      {elements.length === 0 && (
        <p className="empty-hint">
          <Icon name="info" />
          <span>
            Aucun élément. Dessine une box (outil Box, <kbd>B</kbd>), pose un texte (<kbd>T</kbd>) ou une image (<kbd>I</kbd>),
            ou insère une texture depuis la bibliothèque.
          </span>
        </p>
      )}
      <ul className="outline-list">
        {elements
          .map((element, index) => ({ element, index }))
          .reverse()
          .map(({ element, index }) => {
            const isSelected = element.id === selectedId;
            const classes = ['outline-item'];
            if (isSelected) classes.push('selected');
            if (element.hidden) classes.push('hidden-by-state');
            return (
              <li
                key={element.id}
                className={classes.join(' ')}
                tabIndex={0}
                aria-current={isSelected || undefined}
                onClick={() => props.onSelect(element.id)}
                onContextMenu={(event: MouseEvent) => {
                  if (!props.onItemContextMenu) return;
                  props.onSelect(element.id);
                  props.onItemContextMenu(element.id, event);
                }}
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                  event.preventDefault();
                  props.onSelect(element.id);
                }}
              >
                <span className="outline-label">
                  <span className={`kind-dot asset-kind-${element.type}`} />
                  <span className="outline-name">{element.id}</span>
                  <span className="muted">{describe(element)}</span>
                </span>
                <span className="outline-actions">
                  <IconButton
                    icon="chevron-up"
                    label="Monter"
                    hint="Dessiner au-dessus"
                    variant="ghost"
                    disabled={index === lastIndex}
                    onClick={stop(() => props.onReorder(element.id, 1))}
                  />
                  <IconButton
                    icon="chevron-down"
                    label="Descendre"
                    hint="Dessiner en dessous"
                    variant="ghost"
                    disabled={index === 0}
                    onClick={stop(() => props.onReorder(element.id, -1))}
                  />
                  <IconButton
                    icon={element.hidden ? 'eye-off' : 'eye'}
                    label={element.hidden ? 'Afficher' : 'Masquer'}
                    hint={element.hidden ? 'Masqué : ni affiché ni exporté' : 'Ni affiché ni exporté une fois masqué'}
                    variant="ghost"
                    pressed={Boolean(element.hidden)}
                    onClick={stop(() => props.onToggleHidden(element.id))}
                  />
                  <IconButton
                    icon="trash"
                    label="Supprimer"
                    shortcut="Suppr"
                    variant="danger"
                    onClick={stop(() => props.onDelete(element.id))}
                  />
                </span>
              </li>
            );
          })}
      </ul>
    </section>
  );
}
