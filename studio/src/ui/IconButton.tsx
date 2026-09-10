import type { MouseEvent, ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { Tooltip } from './Tooltip';

interface IconButtonProps {
  icon: IconName;
  /** Nom accessible, repris en tête de l’infobulle. */
  label: string;
  shortcut?: string;
  hint?: ReactNode;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  /** `ghost` : sans cadre au repos (listes) ; `danger` : action destructrice. */
  variant?: 'normal' | 'ghost' | 'danger';
  /** Taille de l’icône : 12 px dans les listes, 24 px dans les barres d’outils. */
  size?: 12 | 24;
  pressed?: boolean;
  placement?: 'top' | 'bottom';
}

/** Bouton réduit à une icône, toujours accompagné d’une infobulle (et de son raccourci). */
export function IconButton({
  icon,
  label,
  shortcut,
  hint,
  onClick,
  disabled,
  variant = 'normal',
  size = 12,
  pressed,
  placement,
}: IconButtonProps) {
  const classes = ['icon-only', size === 24 ? 'icon-lg' : 'icon-sm'];
  if (variant === 'ghost') classes.push('ghost');
  if (variant === 'danger') classes.push('ghost', 'danger');
  return (
    <Tooltip label={label} shortcut={shortcut} hint={hint} placement={placement}>
      <button
        type="button"
        className={classes.join(' ')}
        aria-label={label}
        aria-keyshortcuts={shortcut}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
      >
        <Icon name={icon} size={size} />
      </button>
    </Tooltip>
  );
}
