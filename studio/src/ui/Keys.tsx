import { Icon } from './Icon';

/** Touches d’un raccourci, séparées par « + » (« Ctrl+Z », « V »…), affichées comme des touches de clavier. */
export function ShortcutKeys({ shortcut }: { shortcut: string }) {
  const keys = shortcut.split('+');
  return (
    <span className="shortcut-keys">
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} className="shortcut-key">
          {index > 0 && <span className="shortcut-plus">+</span>}
          <kbd>{key}</kbd>
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
