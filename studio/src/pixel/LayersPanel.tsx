import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { useContextMenu } from '../ui/menuContext';
import type { MenuEntry } from '../ui/menuContext';
import { MAX_LAYERS } from './document';
import type { PixelLayer } from './document';
import { dataToCanvas } from './io';

interface LayersPanelProps {
  /** Du dessous (premier) au dessus (dernier) ; la liste les montre du dessus vers le dessous. */
  layers: readonly PixelLayer[];
  width: number;
  height: number;
  activeLayerId: string;
  onSelect: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onRename: (id: string, name: string) => void;
  /** Opacité en cours de réglage : regroupée en une seule entrée d’historique. */
  onOpacity: (id: string, opacity: number) => void;
  onAdd: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  /** `1` = vers le dessus, `-1` = vers le dessous. */
  onMove: (id: string, direction: 1 | -1) => void;
  onMergeDown: (id: string) => void;
}

/** Vignette d’un calque (redessinée quand ses pixels changent). */
function LayerThumb({ data, width, height }: { data: Uint8ClampedArray; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / width, canvas.height / height);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    context.drawImage(dataToCanvas(data, width, height), Math.floor((canvas.width - w) / 2), Math.floor((canvas.height - h) / 2), w, h);
  }, [data, width, height]);
  return <canvas ref={ref} className="pixel-layer-thumb" width={28} height={28} aria-hidden="true" />;
}

/** Calques : visibilité, nom (double-clic pour renommer), ordre, opacité, fusion vers le bas. */
export function LayersPanel(props: LayersPanelProps) {
  const { layers, activeLayerId } = props;
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  const openContextMenu = useContextMenu();
  const activeIndex = layers.findIndex((layer) => layer.id === activeLayerId);
  const active = layers[activeIndex] ?? null;
  const full = layers.length >= MAX_LAYERS;

  const commitRename = () => {
    if (!renaming) return;
    const name = renaming.text.trim();
    const current = layers.find((layer) => layer.id === renaming.id);
    if (name && current && name !== current.name) props.onRename(renaming.id, name);
    setRenaming(null);
  };

  const layerMenu = (layer: PixelLayer, index: number): MenuEntry[] => [
    { heading: `Calque « ${layer.name} »` },
    { label: 'Renommer', icon: 'pencil', shortcut: 'F2', onSelect: () => setRenaming({ id: layer.id, text: layer.name }) },
    { label: 'Dupliquer', icon: 'copy', shortcut: 'Ctrl+J', disabled: full, onSelect: () => props.onDuplicate(layer.id) },
    { label: 'Fusionner vers le bas', icon: 'merge', shortcut: 'Ctrl+E', disabled: index === 0, onSelect: () => props.onMergeDown(layer.id) },
    { label: layer.visible ? 'Masquer' : 'Afficher', icon: layer.visible ? 'eye-off' : 'eye', onSelect: () => props.onToggleVisible(layer.id) },
    { separator: true },
    { label: 'Monter', icon: 'chevron-up', disabled: index === layers.length - 1, onSelect: () => props.onMove(layer.id, 1) },
    { label: 'Descendre', icon: 'chevron-down', disabled: index === 0, onSelect: () => props.onMove(layer.id, -1) },
    { separator: true },
    { label: 'Supprimer', icon: 'trash', danger: true, disabled: layers.length === 1, onSelect: () => props.onDelete(layer.id) },
  ];

  return (
    <section className="panel-section pixel-layers">
      <header className="section-header">
        <h3>
          Calques <span className="count">{layers.length}</span>
        </h3>
        <div className="section-actions">
          <IconButton icon="plus" label="Nouveau calque" hint="Au-dessus du calque actif" variant="ghost" disabled={full} onClick={props.onAdd} />
          <IconButton
            icon="copy"
            label="Dupliquer le calque"
            shortcut="Ctrl+J"
            variant="ghost"
            disabled={!active || full}
            onClick={() => active && props.onDuplicate(active.id)}
          />
          <IconButton
            icon="merge"
            label="Fusionner vers le bas"
            shortcut="Ctrl+E"
            variant="ghost"
            disabled={activeIndex <= 0}
            onClick={() => active && props.onMergeDown(active.id)}
          />
          <IconButton
            icon="trash"
            label="Supprimer le calque"
            variant="danger"
            disabled={layers.length <= 1}
            onClick={() => active && props.onDelete(active.id)}
          />
        </div>
      </header>
      <ul className="outline-list pixel-layer-list">
        {layers
          .map((layer, index) => ({ layer, index }))
          .reverse()
          .map(({ layer, index }) => {
            const isActive = layer.id === activeLayerId;
            const classes = ['outline-item', 'pixel-layer'];
            if (isActive) classes.push('selected');
            if (!layer.visible) classes.push('hidden-by-state');
            return (
              <li
                key={layer.id}
                className={classes.join(' ')}
                tabIndex={0}
                aria-current={isActive || undefined}
                onClick={() => props.onSelect(layer.id)}
                onDoubleClick={() => setRenaming({ id: layer.id, text: layer.name })}
                onContextMenu={(event: ReactMouseEvent) => {
                  props.onSelect(layer.id);
                  openContextMenu(event, layerMenu(layer, index));
                }}
                onKeyDown={(event: ReactKeyboardEvent) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'F2') {
                    event.preventDefault();
                    setRenaming({ id: layer.id, text: layer.name });
                  } else if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    props.onSelect(layer.id);
                  }
                }}
              >
                <IconButton
                  icon={layer.visible ? 'eye' : 'eye-off'}
                  label={layer.visible ? 'Masquer' : 'Afficher'}
                  hint={layer.visible ? 'Un calque masqué n’est ni affiché ni exporté' : 'Masqué : ni affiché ni exporté'}
                  variant="ghost"
                  pressed={!layer.visible}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onToggleVisible(layer.id);
                  }}
                />
                <LayerThumb data={layer.data} width={props.width} height={props.height} />
                {renaming?.id === layer.id ? (
                  <input
                    className="pixel-layer-rename"
                    aria-label="Nom du calque"
                    value={renaming.text}
                    // Le champ apparaît au double-clic : il prend le focus aussitôt.
                    // oxlint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setRenaming({ id: layer.id, text: event.target.value })}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === 'Enter') commitRename();
                      if (event.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <span className="outline-label" title={layer.name}>
                    <span className="outline-name">{layer.name}</span>
                  </span>
                )}
                <span className="outline-meta">{layer.opacity}&nbsp;%</span>
                <span className="outline-actions">
                  <IconButton
                    icon="chevron-up"
                    label="Monter"
                    variant="ghost"
                    disabled={index === layers.length - 1}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onMove(layer.id, 1);
                    }}
                  />
                  <IconButton
                    icon="chevron-down"
                    label="Descendre"
                    variant="ghost"
                    disabled={index === 0}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onMove(layer.id, -1);
                    }}
                  />
                </span>
              </li>
            );
          })}
      </ul>
      {active && (
        <label className="pixel-range">
          <span className="field-label">Opacité du calque</span>
          <input
            type="range"
            min={0}
            max={100}
            value={active.opacity}
            onChange={(event) => props.onOpacity(active.id, Number(event.target.value))}
          />
          <span className="pixel-range-value">{active.opacity}&nbsp;%</span>
        </label>
      )}
      {full && (
        <p className="field-hint">
          <Icon name="info" /> {MAX_LAYERS} calques au plus.
        </p>
      )}
    </section>
  );
}
