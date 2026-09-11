import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { WorkspaceList } from '../lib/appApi';
import { NBSP, formatDate, formatRelative, plural } from '../lib/format';
import { isTauri, pickFolder, revealInExplorer } from '../lib/native';
import { Notice, ScreenFrame } from '../shell/ScreenFrame';
import { Field } from '../components/fields';
import { useContextMenu } from '../ui/menuContext';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface WorkspacesScreenProps {
  pill: ReactNode;
  list: WorkspaceList | null;
  /** Premier lancement : l’espace par défaut vient d’être préparé. */
  welcome: boolean;
  /** Demander avant de retirer un espace de la liste. */
  confirmRemoval: boolean;
  onOpen: (path: string) => Promise<void>;
  onForget: (path: string) => Promise<void>;
  onContinue: () => void;
}

/** Sélection de l’espace de travail : espaces connus, ouverture d’un dossier. */
export function WorkspacesScreen({ pill, list, welcome, confirmRemoval, onOpen, onForget, onContinue }: WorkspacesScreenProps) {
  const openMenu = useContextMenu();
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const active = list?.workspaces.find((candidate) => candidate.active) ?? null;

  const run = async (action: () => Promise<void>, failure: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice({ kind: 'error', text: `${failure}${NBSP}: ${errorMessage(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const browse = () =>
    void run(async () => {
      const chosen = await pickFolder('Choisir un espace de travail', active?.path);
      if (chosen) await onOpen(chosen);
    }, 'Impossible d’ouvrir ce dossier');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = path.trim();
    if (!trimmed) return;
    void run(() => onOpen(trimmed), 'Impossible d’ouvrir ce dossier');
  };

  const forget = (target: string, name: string) => {
    if (confirmRemoval && !window.confirm(`Retirer « ${name} » de la liste${NBSP}? Aucun fichier n’est supprimé.`)) return;
    void run(async () => {
      await onForget(target);
      setNotice({ kind: 'ok', text: `« ${name} » retiré de la liste (le dossier est intact)` });
    }, 'Impossible de retirer cet espace');
  };

  return (
    <ScreenFrame title="Espaces de travail" icon="folder" pill={pill}>
      {welcome && active && (
        <div className="card welcome-card">
          <h2 className="screen-section-title">Bienvenue dans Menu Forge</h2>
          <p className="screen-lead">
            Un espace de travail par défaut est prêt, avec ses dossiers <code>menus/</code>, <code>assets/</code> et{' '}
            <code>textures/</code>. Garde-le ou ouvre le dossier de ton choix.
          </p>
          <p className="row-path">{active.path}</p>
          <div className="form-actions">
            <button type="button" className="primary" onClick={onContinue}>
              <Icon name="check" />
              Continuer avec cet espace
            </button>
          </div>
        </div>
      )}

      <section className="screen-section" aria-labelledby="workspaces-open">
        <h2 id="workspaces-open" className="screen-section-title">
          Ouvrir un dossier
        </h2>
        <div className="card">
          {isTauri ? (
            <div className="open-folder">
              <p className="screen-lead">
                Un espace de travail est un dossier ordinaire&nbsp;: le studio y range tes menus, tes assets et leurs
                textures. S’il est vide, les sous-dossiers sont créés.
              </p>
              <button type="button" className="primary" disabled={busy} onClick={browse}>
                <Icon name="folder-plus" />
                Ouvrir un dossier…
              </button>
            </div>
          ) : (
            <form className="inline-form" onSubmit={submit}>
              <Field
                label="Chemin du dossier"
                hint="Mode navigateur : chemin absolu d’un dossier existant. Les sous-dossiers menus/, assets/ et textures/ sont créés si besoin."
              >
                <input
                  className="mono"
                  value={path}
                  placeholder="C:/Users/…/Documents/menu-forge"
                  onChange={(event) => setPath(event.target.value)}
                />
              </Field>
              <button type="submit" className="primary" disabled={busy || path.trim() === ''}>
                <Icon name="folder-plus" />
                Ouvrir
              </button>
            </form>
          )}
        </div>
        <Notice notice={notice} />
      </section>

      <section className="screen-section" aria-labelledby="workspaces-known">
        <div className="screen-section-head">
          <h2 id="workspaces-known" className="screen-section-title">
            Espaces connus
          </h2>
          {list && <span className="count">{plural(list.workspaces.length, 'espace')}</span>}
        </div>
        {!list ? (
          <p className="muted">Chargement…</p>
        ) : (
          <div className="row-list">
            {list.workspaces.map((candidate) => (
              <div
                key={candidate.path}
                className={['row-card', candidate.active ? 'is-active' : '', candidate.exists ? '' : 'is-missing'].join(' ').trim()}
                onContextMenu={(event) =>
                  openMenu(event, [
                    { heading: candidate.name },
                    {
                      label: 'Ouvrir',
                      icon: 'folder',
                      disabled: busy || candidate.active || !candidate.exists,
                      onSelect: () => void run(() => onOpen(candidate.path), 'Impossible d’ouvrir cet espace'),
                    },
                    ...(isTauri
                      ? [
                          {
                            label: 'Afficher dans l’explorateur',
                            icon: 'open' as const,
                            disabled: !candidate.exists,
                            onSelect: () => void run(() => revealInExplorer(candidate.path), 'Explorateur indisponible'),
                          },
                        ]
                      : []),
                    {
                      label: 'Copier le chemin',
                      icon: 'copy',
                      onSelect: () => void navigator.clipboard?.writeText(candidate.path).catch(() => undefined),
                    },
                    { separator: true },
                    {
                      label: 'Retirer de la liste',
                      icon: 'trash',
                      danger: true,
                      disabled: busy || candidate.active,
                      onSelect: () => forget(candidate.path, candidate.name),
                    },
                  ])
                }
              >
                <span className="row-icon">
                  <Icon name="folder" size={24} />
                </span>
                <span className="row-main">
                  <span className="row-title">
                    <span className="row-title-text">{candidate.name}</span>
                    {candidate.active && <span className="badge badge-active">actif</span>}
                    {!candidate.exists && <span className="badge badge-missing">dossier introuvable</span>}
                  </span>
                  <span className="row-path">{candidate.path}</span>
                  <span className="row-meta">
                    <span>{plural(candidate.menus, 'menu')}</span>
                    <span>{plural(candidate.assets, 'asset')}</span>
                    <span>{plural(candidate.textures, 'texture')}</span>
                    <span title={candidate.lastOpened ? formatDate(candidate.lastOpened) : undefined}>
                      ouvert {candidate.lastOpened ? formatRelative(candidate.lastOpened) : 'jamais'}
                    </span>
                  </span>
                </span>
                <span className="row-actions">
                  {!candidate.active && (
                    <button
                      type="button"
                      disabled={busy || !candidate.exists}
                      onClick={() => void run(() => onOpen(candidate.path), 'Impossible d’ouvrir cet espace')}
                    >
                      Ouvrir
                    </button>
                  )}
                  {isTauri && (
                    <IconButton
                      icon="open"
                      label="Afficher dans l’explorateur"
                      variant="ghost"
                      size={24}
                      disabled={!candidate.exists}
                      onClick={() => void run(() => revealInExplorer(candidate.path), 'Explorateur indisponible')}
                    />
                  )}
                  <IconButton
                    icon="trash"
                    label="Retirer de la liste"
                    hint={candidate.active ? 'Ouvre d’abord un autre espace' : 'Aucun fichier n’est supprimé'}
                    variant="danger"
                    size={24}
                    disabled={busy || candidate.active}
                    onClick={() => forget(candidate.path, candidate.name)}
                  />
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </ScreenFrame>
  );
}
