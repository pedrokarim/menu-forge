import { useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { NBSP } from '../lib/format';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { useContextMenu } from '../ui/menuContext';
import { Tooltip } from '../ui/Tooltip';
import { DEFAULT_PALETTE } from './palette';
import { parseHex, sameColor, toHex } from './raster';
import type { Rgba } from './raster';

export type ColorSlot = 'primary' | 'secondary';

interface ColorPanelProps {
  primary: Rgba;
  secondary: Rgba;
  onChange: (slot: ColorSlot, color: Rgba) => void;
  onSwap: () => void;
  /** Dernières couleurs posées, de la plus récente à la plus ancienne. */
  recent: readonly Rgba[];
  /** Couleurs présentes dans l’image (calques visibles). */
  documentColors: readonly Rgba[];
}

/** Pastille de couleur avec damier derrière (couleurs translucides). */
function Chip({ color }: { color: Rgba }) {
  return (
    <span className="pixel-chip">
      <span style={{ background: toHex(color, true) }} />
    </span>
  );
}

/**
 * Couleurs : principale et secondaire (X pour échanger), saisie hexadécimale
 * avec alpha, sélecteur du système, palette par défaut, couleurs récentes et
 * couleurs du document. Clic : principale ; Maj+clic : secondaire ; clic
 * droit : menu.
 */
export function ColorPanel({ primary, secondary, onChange, onSwap, recent, documentColors }: ColorPanelProps) {
  const [editing, setEditing] = useState<ColorSlot>('primary');
  const color = editing === 'primary' ? primary : secondary;
  const [text, setText] = useState(toHex(color));
  const [base, setBase] = useState(color);
  // Resynchronise la saisie quand la couleur change ailleurs (pipette, palette, échange).
  if (!sameColor(base, color)) {
    setBase(color);
    setText(toHex(color));
  }
  const openContextMenu = useContextMenu();
  const invalid = parseHex(text) === null;

  const switchTo = (slot: ColorSlot) => {
    setEditing(slot);
    const next = slot === 'primary' ? primary : secondary;
    setBase(next);
    setText(toHex(next));
  };

  const swatchProps = (value: Rgba, label: string) => ({
    onClick: (event: ReactMouseEvent) => onChange(event.shiftKey ? 'secondary' : 'primary', value),
    onContextMenu: (event: ReactMouseEvent) =>
      openContextMenu(event, [
        { heading: `${label} · ${toHex(value)}` },
        { label: 'Couleur principale', icon: 'pencil', onSelect: () => onChange('primary', value) },
        { label: 'Couleur secondaire', icon: 'swap', shortcut: 'Maj+clic', onSelect: () => onChange('secondary', value) },
        { separator: true },
        { label: 'Copier le code', icon: 'copy', onSelect: () => void navigator.clipboard?.writeText(toHex(value)).catch(() => undefined) },
      ]),
  });

  const grid = (colors: ReadonlyArray<{ color: Rgba; name: string }>, key: string) => (
    <div className="pixel-swatches" role="group" aria-label={key}>
      {colors.map(({ color: value, name }, index) => (
        <Tooltip key={`${key}-${index}`} label={name} hint={`${toHex(value)} · Maj+clic : secondaire`}>
          <button type="button" className="pixel-swatch" aria-label={`${name} ${toHex(value)}`} {...swatchProps(value, name)}>
            <Chip color={value} />
          </button>
        </Tooltip>
      ))}
    </div>
  );

  const alpha = color.a;
  const setAlpha = (value: number) => onChange(editing, { ...color, a: Math.max(0, Math.min(255, Math.round(value))) });

  return (
    <section className="panel-section pixel-colors">
      <header className="section-header">
        <h3>Couleurs</h3>
        <IconButton icon="swap" label="Échanger les couleurs" shortcut="X" variant="ghost" onClick={onSwap} />
      </header>
      <div className="pixel-color-pair">
        <Tooltip label="Couleur principale" hint="Clic gauche des outils de dessin">
          <button
            type="button"
            className={editing === 'primary' ? 'pixel-color-well primary active' : 'pixel-color-well primary'}
            aria-pressed={editing === 'primary'}
            aria-label={`Couleur principale ${toHex(primary)}`}
            onClick={() => switchTo('primary')}
          >
            <Chip color={primary} />
          </button>
        </Tooltip>
        <Tooltip label="Couleur secondaire" shortcut="X" hint="Échangée avec la principale">
          <button
            type="button"
            className={editing === 'secondary' ? 'pixel-color-well secondary active' : 'pixel-color-well secondary'}
            aria-pressed={editing === 'secondary'}
            aria-label={`Couleur secondaire ${toHex(secondary)}`}
            onClick={() => switchTo('secondary')}
          >
            <Chip color={secondary} />
          </button>
        </Tooltip>
        <div className="pixel-color-fields">
          <span className="field-label">{editing === 'primary' ? 'Principale' : 'Secondaire'}</span>
          <div className="color-input">
            <input
              type="color"
              aria-label="Choisir la couleur"
              value={toHex({ ...color, a: 255 }, false)}
              onChange={(event) => {
                const picked = parseHex(event.target.value);
                if (picked) onChange(editing, { ...picked, a: color.a === 0 ? 255 : color.a });
              }}
            />
            <input
              className="mono"
              aria-label="Code hexadécimal (#rrggbb ou #rrggbbaa)"
              value={text}
              spellCheck={false}
              onChange={(event) => {
                setText(event.target.value);
                const parsed = parseHex(event.target.value);
                if (parsed) {
                  setBase(parsed);
                  onChange(editing, parsed);
                }
              }}
              onBlur={() => setText(toHex(color))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setText(toHex(color));
              }}
            />
          </div>
        </div>
      </div>
      {invalid && (
        <span className="field-error">
          <Icon name="alert" />
          Format attendu{NBSP}: #rrggbb ou #rrggbbaa
        </span>
      )}
      <label className="pixel-range">
        <span className="field-label">Opacité</span>
        <input type="range" min={0} max={255} value={alpha} onChange={(event) => setAlpha(Number(event.target.value))} />
        <input
          type="number"
          className="mini-input"
          min={0}
          max={255}
          value={alpha}
          aria-label="Opacité (0 à 255)"
          onChange={(event) => {
            if (event.target.value !== '') setAlpha(Number(event.target.value));
          }}
        />
      </label>

      <h4 className="pixel-subtitle">Palette</h4>
      {grid(
        DEFAULT_PALETTE.map((entry) => ({ color: parseHex(entry.hex) ?? primary, name: entry.name })),
        'Palette par défaut',
      )}
      <h4 className="pixel-subtitle">Récentes</h4>
      {recent.length > 0 ? (
        grid(recent.map((value) => ({ color: value, name: 'Couleur récente' })), 'Couleurs récentes')
      ) : (
        <p className="muted small">Les couleurs posées apparaîtront ici.</p>
      )}
      <h4 className="pixel-subtitle">
        Du document <span className="count">{documentColors.length}</span>
      </h4>
      {documentColors.length > 0 ? (
        grid(documentColors.map((value) => ({ color: value, name: 'Couleur du document' })), 'Couleurs du document')
      ) : (
        <p className="muted small">Image encore vide.</p>
      )}
    </section>
  );
}
