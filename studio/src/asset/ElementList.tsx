import type { MouseEvent } from 'react';
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
      return `« ${firstLine} »`;
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
          <select
            className="asset-add-select"
            value=""
            aria-label="Ajouter une box"
            onChange={(event) => {
              if (event.target.value) props.onAddBox(event.target.value);
            }}
          >
            <option value="">＋ Box…</option>
            {BOX_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={props.onAddText}>
            ＋ Texte
          </button>
        </div>
      </header>
      {elements.length === 0 && (
        <p className="muted small">
          Aucun élément. Dessine une box (outil Box), pose un texte ou une image, ou insère une texture depuis la
          bibliothèque.
        </p>
      )}
      <ul className="outline-list">
        {elements
          .map((element, index) => ({ element, index }))
          .reverse()
          .map(({ element, index }) => {
            const classes = ['outline-item'];
            if (element.id === selectedId) classes.push('selected');
            if (element.hidden) classes.push('hidden-by-state');
            return (
              <li key={element.id} className={classes.join(' ')} onClick={() => props.onSelect(element.id)}>
                <span className="outline-label">
                  <span className={`kind-dot asset-kind-${element.type}`} /> {element.id}{' '}
                  <span className="muted">{describe(element)}</span>
                </span>
                <span className="outline-actions">
                  <button
                    type="button"
                    title="Monter (dessiner au-dessus)"
                    disabled={index === lastIndex}
                    onClick={stop(() => props.onReorder(element.id, 1))}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    title="Descendre (dessiner en dessous)"
                    disabled={index === 0}
                    onClick={stop(() => props.onReorder(element.id, -1))}
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    title={element.hidden ? 'Afficher' : 'Masquer (ni affiché ni exporté)'}
                    aria-pressed={Boolean(element.hidden)}
                    onClick={stop(() => props.onToggleHidden(element.id))}
                  >
                    {element.hidden ? '○' : '◉'}
                  </button>
                  <button type="button" title="Supprimer" onClick={stop(() => props.onDelete(element.id))}>
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
      </ul>
    </section>
  );
}
