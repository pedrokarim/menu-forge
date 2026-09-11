import { useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';

interface TitleBarProps {
  /** Écran ou document en cours, à côté du nom du logiciel. */
  context: string;
  /** Vrai si la fenêtre peut se fermer (sinon l’utilisateur a choisi de rester). */
  confirmClose: () => boolean;
}

function WindowButton({ icon, label, danger = false, onClick }: { icon: IconName; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <Tooltip label={label}>
      <button type="button" className={danger ? 'titlebar-button titlebar-close' : 'titlebar-button'} aria-label={label} onClick={onClick}>
        <Icon name={icon} />
      </button>
    </Tooltip>
  );
}

/**
 * Barre de titre maison de l’appli (la fenêtre n’a pas de décorations
 * natives) : logo, nom, écran en cours, boutons Réduire, Agrandir et Fermer.
 * Glisser la barre déplace la fenêtre, un double-clic l’agrandit.
 */
export function TitleBar({ context, confirmClose }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);
  const confirmRef = useRef(confirmClose);
  useEffect(() => {
    confirmRef.current = confirmClose;
  });

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let disposed = false;
    const cleanups: Array<() => void> = [];
    const keep = (unlisten: () => void) => (disposed ? unlisten() : cleanups.push(unlisten));
    const refresh = () =>
      void appWindow.isMaximized().then((value) => {
        if (!disposed) setMaximized(value);
      });
    refresh();
    void appWindow.onResized(refresh).then(keep);
    // Fermeture (bouton, Alt+F4, barre des tâches) : on demande avant de perdre des modifications.
    void appWindow
      .onCloseRequested((event) => {
        if (!confirmRef.current()) event.preventDefault();
      })
      .then(keep);
    return () => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
    };
  }, []);

  useEffect(() => {
    void getCurrentWindow()
      .setTitle(`Menu Forge · ${context}`)
      .catch(() => undefined);
  }, [context]);

  const appWindow = getCurrentWindow();
  return (
    <header className="titlebar" data-tauri-drag-region>
      <img className="titlebar-logo" src="/brand/logo.svg" alt="" width={16} height={16} data-tauri-drag-region />
      <span className="titlebar-name" data-tauri-drag-region>
        Menu Forge
      </span>
      <span className="titlebar-context" data-tauri-drag-region>
        {context}
      </span>
      <div className="titlebar-controls">
        <WindowButton icon="minus" label="Réduire" onClick={() => void appWindow.minimize()} />
        <WindowButton
          icon={maximized ? 'window-restore' : 'window-maximize'}
          label={maximized ? 'Restaurer' : 'Agrandir'}
          onClick={() => void appWindow.toggleMaximize()}
        />
        <WindowButton icon="close" label="Fermer" danger onClick={() => void appWindow.close()} />
      </div>
    </header>
  );
}
