import { ALIGN_LABELS, DISTRIBUTE_LABELS } from '../model/arrange';
import type { AlignMode, AlignReference, DistributeAxis } from '../model/arrange';
import type { IconName } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';

const ALIGN_ICONS: ReadonlyArray<readonly [AlignMode, IconName]> = [
  ['left', 'arrange-left'],
  ['center', 'arrange-center'],
  ['right', 'arrange-right'],
  ['top', 'arrange-top'],
  ['middle', 'arrange-middle'],
  ['bottom', 'arrange-bottom'],
];

const DISTRIBUTE_ICONS: ReadonlyArray<readonly [DistributeAxis, IconName]> = [
  ['horizontal', 'distribute-horizontal'],
  ['vertical', 'distribute-vertical'],
];

interface AlignBarProps {
  /** Nombre d’éléments à aligner. */
  count: number;
  /** Référence : la sélection (deux éléments ou plus) ou la toile. */
  reference: AlignReference;
  /** Absent : référence imposée (un seul élément s’aligne toujours sur la toile). */
  onReferenceChange?: (reference: AlignReference) => void;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: DistributeAxis) => void;
}

/** Barre d’alignement et de répartition (icônes pixel), partagée par les deux éditeurs. */
export function AlignBar({ count, reference, onReferenceChange, onAlign, onDistribute }: AlignBarProps) {
  const target = reference === 'canvas' ? 'la toile' : 'la sélection';
  return (
    <div className="align-bar" role="group" aria-label="Aligner et répartir">
      <div className="align-buttons">
        {ALIGN_ICONS.map(([mode, icon]) => (
          <IconButton
            key={mode}
            icon={icon}
            label={ALIGN_LABELS[mode]}
            hint={`Par rapport à ${target}`}
            disabled={count === 0}
            onClick={() => onAlign(mode)}
          />
        ))}
        <span className="align-sep" aria-hidden="true" />
        {DISTRIBUTE_ICONS.map(([axis, icon]) => (
          <IconButton
            key={axis}
            icon={icon}
            label={DISTRIBUTE_LABELS[axis]}
            hint={count < 3 ? 'Il faut au moins trois éléments' : 'Écarts égaux entre les éléments'}
            disabled={count < 3}
            onClick={() => onDistribute(axis)}
          />
        ))}
      </div>
      {onReferenceChange && (
        <div className="segmented align-reference" role="radiogroup" aria-label="Aligner par rapport à">
          {(['selection', 'canvas'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={reference === value}
              className={reference === value ? 'active' : ''}
              onClick={() => onReferenceChange(value)}
            >
              {value === 'selection' ? 'Sélection' : 'Toile'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
