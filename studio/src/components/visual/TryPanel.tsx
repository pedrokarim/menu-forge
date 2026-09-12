import { useCallback } from 'react';
import type { MenuDefinition } from '../../model/menu';
import type { LogTone, TrySession } from '../../model/simulate';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/Icon';
import { IconButton } from '../../ui/IconButton';
import { Tooltip } from '../../ui/Tooltip';

const TONE_ICONS: Record<LogTone, IconName> = {
  click: 'cursor',
  state: 'sliders',
  nav: 'open',
  info: 'info',
  warn: 'warning',
};

interface TrySessionPanelProps {
  session: TrySession;
  /** Menus résolus, pour les noms de la pile. */
  lookup: (id: string) => MenuDefinition | undefined;
  onBack: () => void;
  onReopen: () => void;
  onRestart: () => void;
  onExit: () => void;
  /** Document essayé : menu coffre (toile) ou formulaire Bedrock (aperçu). */
  subject?: TrySubject;
}

type TrySubject = 'menu' | 'form';

/** Consigne du mode « Essayer », selon le document essayé. */
const TRY_HINTS: Record<TrySubject, { panel: string; journal: string; closed: string }> = {
  menu: {
    panel: 'Clique les slots de la toile : leurs actions s’exécutent sur l’état d’aperçu. Le menu édité n’est jamais modifié.',
    journal: 'Clique un bouton sur la toile : chaque action déclenchée s’inscrit ici (état changé, menu ouvert, commande, son…).',
    closed: 'Inventaire fermé (action « close » ou retour sur le premier menu).',
  },
  form: {
    panel: 'Clique les boutons de l’aperçu : leurs actions s’exécutent sur l’état d’aperçu. Le formulaire édité n’est jamais modifié.',
    journal: 'Clique un bouton de l’aperçu : chaque action déclenchée s’inscrit ici (état changé, menu ouvert, commande, son…).',
    closed: 'Formulaire fermé (action « close » ou retour sur le premier formulaire).',
  },
};

/** Mode « Essayer », colonne de droite : pile des menus ouverts, retour, fermeture, sortie. */
export function TrySessionPanel({ session, lookup, onBack, onReopen, onRestart, onExit, subject = 'menu' }: TrySessionPanelProps) {
  const name = (id: string) => lookup(id)?.name ?? id;
  // La colonne gardait le défilement de l’inspecteur : le panneau d’essai s’affiche en haut.
  const reveal = useCallback((node: HTMLElement | null) => node?.closest('.sidebar')?.scrollTo({ top: 0 }), []);
  return (
    <section ref={reveal} className="panel-section inspector try-panel">
      <header className="section-header">
        <h3>Essai</h3>
        <span className="pill">
          <Icon name="play" />
          en jeu, simulé
        </span>
      </header>
      <p className="field-hint">{TRY_HINTS[subject].panel}</p>
      <ol className="try-stack" aria-label="Pile des menus ouverts">
        {session.stack.map((frame, index) => (
          <li key={`${frame.menuId}-${index}`} className={index === session.stack.length - 1 ? 'is-current' : undefined}>
            <Icon name={index === 0 ? 'chest' : 'open'} />
            <span className="try-stack-name">{name(frame.menuId)}</span>
            <span className="muted small mono">{frame.menuId}</span>
          </li>
        ))}
      </ol>
      {session.closed && (
        <p className="warning" role="status">
          <Icon name="close" />
          <span>{TRY_HINTS[subject].closed}</span>
        </p>
      )}
      <div className="button-row wrap">
        {session.closed ? (
          <button type="button" className="sm" onClick={onReopen}>
            <Icon name="reload" />
            Rouvrir
          </button>
        ) : (
          <Tooltip label="Retour" hint="Comme l’action « back » : menu précédent, ou fermeture" shortcut="Retour arrière">
            <button type="button" className="sm" onClick={onBack}>
              <Icon name="back" />
              Retour
            </button>
          </Tooltip>
        )}
        <Tooltip label="Recommencer" hint="Repart du menu édité, dans l’état d’aperçu de départ">
          <button type="button" className="sm" onClick={onRestart}>
            <Icon name="reload" />
            Recommencer
          </button>
        </Tooltip>
        <Tooltip label="Revenir à l’édition" shortcut="Échap">
          <button type="button" className="sm primary" onClick={onExit}>
            <Icon name="stop" />
            Terminer l’essai
          </button>
        </Tooltip>
      </div>
    </section>
  );
}

/** Mode « Essayer », colonne de gauche : journal des actions déclenchées, le plus récent en haut. */
export function TryJournal({ session, onClear, subject = 'menu' }: { session: TrySession; onClear: () => void; subject?: TrySubject }) {
  const entries = [...session.log].reverse();
  return (
    <section className="panel-section try-journal">
      <header className="section-header">
        <h3>Journal</h3>
        <span className="count">{session.log.length}</span>
        <IconButton icon="trash" label="Vider le journal" variant="ghost" disabled={session.log.length === 0} onClick={onClear} />
      </header>
      {entries.length === 0 ? (
        <p className="empty-hint">
          <Icon name="cursor" />
          <span>{TRY_HINTS[subject].journal}</span>
        </p>
      ) : (
        <ol className="try-log" aria-live="polite">
          {entries.map((entry) => (
            <li key={entry.id} className={`try-log-entry tone-${entry.tone}`}>
              <Icon name={TONE_ICONS[entry.tone]} />
              <span>{entry.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
