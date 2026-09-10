import type { ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';

interface ScreenFrameProps {
  title: string;
  icon: IconName;
  /** Pastille de l’espace de travail, calée à droite de l’en-tête. */
  pill?: ReactNode;
  children: ReactNode;
}

/**
 * Cadre commun des écrans « pleine page » : en-tête de la même hauteur que la
 * barre d’outils de l’éditeur, puis un corps centré qui défile.
 */
export function ScreenFrame({ title, icon, pill, children }: ScreenFrameProps) {
  return (
    <section className="screen" aria-label={title}>
      <header className="screen-header">
        <h1 className="screen-title">
          <Icon name={icon} size={24} />
          {title}
        </h1>
        {pill && <div className="screen-header-end">{pill}</div>}
      </header>
      <div className="screen-scroll">
        <div className="screen-body">{children}</div>
      </div>
    </section>
  );
}

/** Message d’état d’un écran (réussite ou échec d’une action). */
export function Notice({ notice }: { notice: { kind: 'ok' | 'error'; text: string } | null }) {
  if (!notice) return null;
  return (
    <p className={`notice is-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <Icon name={notice.kind === 'error' ? 'alert' : 'check'} />
      {notice.text}
    </p>
  );
}
