import { Icon } from './Icon';
import type { IconName } from './Icon';

/**
 * Touches et gestes dessinés en picto pixel (même style que le reste du
 * studio) ; les lettres, les chiffres, Ctrl et Échap restent écrits.
 * Clés en minuscules : « Ctrl+molette » et « Ctrl+Molette » donnent la même chose.
 */
const KEY_ICONS: Record<string, IconName> = {
  maj: 'key-shift',
  suppr: 'key-delete',
  entrée: 'key-enter',
  espace: 'key-space',
  molette: 'mouse',
  'clic molette': 'mouse-middle',
  'clic droit': 'mouse-right',
  glisser: 'drag',
};

function Key({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (lower === 'flèches') return <ArrowKeys />;
  const icon = KEY_ICONS[lower];
  if (!icon) return <kbd>{name}</kbd>;
  return (
    <kbd className="key-icon" title={name} aria-label={name}>
      <Icon name={icon} />
    </kbd>
  );
}

/** Touches d’un raccourci, séparées par « + » (« Ctrl+Z », « Maj+Flèches »…), affichées comme des touches de clavier. */
export function ShortcutKeys({ shortcut }: { shortcut: string }) {
  const keys = shortcut.split('+');
  return (
    <span className="shortcut-keys">
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} className="shortcut-key">
          {index > 0 && <span className="shortcut-plus">+</span>}
          <Key name={key} />
        </span>
      ))}
    </span>
  );
}

/** Les quatre flèches du clavier, en pictos pixel. */
export function ArrowKeys() {
  return (
    <span className="shortcut-keys" aria-label="Flèches">
      <kbd>
        <Icon name="arrow-left" />
      </kbd>
      <kbd>
        <Icon name="arrow-right" />
      </kbd>
      <kbd>
        <Icon name="arrow-up" />
      </kbd>
      <kbd>
        <Icon name="arrow-down" />
      </kbd>
    </span>
  );
}
