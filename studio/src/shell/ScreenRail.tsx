import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';
import type { ScreenId } from './router';

export type RailScreen = Exclude<ScreenId, 'workspaces'>;

/** Écrans du rail, dans l’ordre des raccourcis Ctrl+1 à Ctrl+5. */
const RAIL_ITEMS: ReadonlyArray<{ screen: RailScreen; label: string; icon: IconName; shortcut: string }> = [
  { screen: 'home', label: 'Accueil', icon: 'home', shortcut: 'Ctrl+1' },
  { screen: 'editor', label: 'Éditeur', icon: 'chest', shortcut: 'Ctrl+2' },
  { screen: 'libraries', label: 'Bibliothèques', icon: 'library', shortcut: 'Ctrl+3' },
  { screen: 'settings', label: 'Paramètres', icon: 'sliders', shortcut: 'Ctrl+4' },
  { screen: 'about', label: 'À propos', icon: 'info', shortcut: 'Ctrl+5' },
];

interface ScreenRailProps {
  current: ScreenId;
  onSelect: (screen: RailScreen) => void;
  onShowShortcuts: () => void;
}

/** Rail vertical des écrans : icônes, infobulle avec le raccourci, écran actif en or. */
export function ScreenRail({ current, onSelect, onShowShortcuts }: ScreenRailProps) {
  return (
    <nav className="rail" aria-label="Écrans">
      <img className="rail-logo" src="/brand/logo.svg" alt="menu-forge" width={32} height={32} />
      {RAIL_ITEMS.map((item) => (
        <Tooltip key={item.screen} label={item.label} shortcut={item.shortcut} placement="right">
          <button
            type="button"
            className="rail-button"
            aria-label={item.label}
            aria-current={current === item.screen ? 'page' : undefined}
            aria-keyshortcuts={item.shortcut.replace('Ctrl', 'Control')}
            onClick={() => onSelect(item.screen)}
          >
            <Icon name={item.icon} size={24} />
          </button>
        </Tooltip>
      ))}
      <span className="rail-spacer" />
      <Tooltip label="Raccourcis clavier" shortcut="?" placement="right">
        <button type="button" className="rail-button" aria-label="Raccourcis clavier" onClick={onShowShortcuts}>
          <Icon name="keyboard" size={24} />
        </button>
      </Tooltip>
    </nav>
  );
}
