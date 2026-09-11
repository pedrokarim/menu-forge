import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { addLibrary, reindexLibrary, removeLibrary } from '../lib/appApi';
import type { LibrarySetting, SettingsPatch, StudioSettings } from '../lib/appApi';
import { NBSP, plural } from '../lib/format';
import { fetchLibraryIndex } from '../lib/libraryApi';
import type { LibraryOwnership } from '../lib/libraryApi';
import { isTauri, pickFolder, revealInExplorer } from '../lib/native';
import { Field, FieldError } from '../components/fields';
import { Notice, ScreenFrame } from '../shell/ScreenFrame';
import { useContextMenu } from '../ui/menuContext';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';

const LIBRARY_ID = /^[a-z0-9_-]+$/;
const BACKSLASH = String.fromCharCode(92);

type Counts = { textures: number; fonts: number } | { error: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Dernier segment d’un chemin Windows ou Unix. */
function folderName(path: string): string {
  return path.replaceAll(BACKSLASH, '/').split('/').filter(Boolean).pop() ?? '';
}

/** Identifiant de bibliothèque proposé d’après le nom du dossier. */
function suggestId(path: string, taken: string[]): string {
  const base =
    folderName(path)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'pack';
  let candidate = base;
  for (let index = 2; taken.includes(candidate); index++) candidate = `${base}_${index}`;
  return candidate;
}

const OWNERSHIP_LABELS: Record<LibraryOwnership, string> = { own: 'Maison', 'third-party': 'Tiers · local' };

interface LibrariesScreenProps {
  pill: ReactNode;
  settings: StudioSettings | null;
  /** Bibliothèques imposées pour la session (option --libraries). */
  sessionOverride: boolean;
  confirmRemoval: boolean;
  onPatch: (patch: SettingsPatch) => Promise<void>;
  /** Après un ajout ou un retrait : relire les réglages et la liste de l’éditeur. */
  onChanged: () => Promise<void>;
}

/** Bibliothèques : packs branchés en lecture seule, ajout, réindexation, retrait. */
export function LibrariesScreen({ pill, settings, sessionOverride, confirmRemoval, onPatch, onChanged }: LibrariesScreenProps) {
  const openMenu = useContextMenu();
  const libraries = settings?.libraries;
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [editing, setEditing] = useState<LibrarySetting | null>(null);
  const [draft, setDraft] = useState({ root: '', id: '', name: '', ownership: 'third-party' as LibraryOwnership });
  const [idTouched, setIdTouched] = useState(false);
  const requested = useRef(new Set<string>());

  // Nombres de textures et de polices : l’index de chaque pack est lu une fois (depuis son cache si possible).
  useEffect(() => {
    for (const library of libraries ?? []) {
      if (requested.current.has(library.id)) continue;
      requested.current.add(library.id);
      fetchLibraryIndex(library.id).then(
        (index) => setCounts((previous) => ({ ...previous, [library.id]: { textures: index.textures.length, fonts: index.fonts.length } })),
        (error: unknown) => setCounts((previous) => ({ ...previous, [library.id]: { error: errorMessage(error) } })),
      );
    }
  }, [libraries]);

  const taken = (libraries ?? []).map((library) => library.id);
  let idError: string | null = null;
  if (draft.id && !LIBRARY_ID.test(draft.id)) idError = 'Lettres minuscules, chiffres, « _ » et « - » seulement';
  else if (taken.includes(draft.id)) idError = 'Une bibliothèque porte déjà cet identifiant';

  const run = async (key: string, action: () => Promise<void>, failure: string) => {
    setBusy(key);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice({ kind: 'error', text: `${failure}${NBSP}: ${errorMessage(error)}` });
    } finally {
      setBusy(null);
    }
  };

  const setRoot = (root: string) =>
    setDraft((previous) => ({
      ...previous,
      root,
      id: idTouched ? previous.id : suggestId(root, taken),
      name: previous.name && previous.name !== folderName(previous.root) ? previous.name : folderName(root),
    }));

  const browse = () =>
    void run(
      'add',
      async () => {
        const chosen = await pickFolder('Choisir un resource pack extrait');
        if (chosen) setRoot(chosen);
      },
      'Sélecteur de dossier indisponible',
    );

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.root.trim() || !draft.id || idError) return;
    void run(
      'add',
      async () => {
        await addLibrary({ id: draft.id, name: draft.name.trim() || draft.id, root: draft.root.trim(), ownership: draft.ownership });
        await onChanged();
        setNotice({ kind: 'ok', text: `Bibliothèque « ${draft.name.trim() || draft.id} » branchée` });
        setDraft({ root: '', id: '', name: '', ownership: 'third-party' });
        setIdTouched(false);
      },
      'Impossible d’ajouter ce pack',
    );
  };

  const reindex = (library: LibrarySetting) =>
    void run(
      library.id,
      async () => {
        const result = await reindexLibrary(library.id);
        setCounts((previous) => ({ ...previous, [library.id]: { textures: result.textures, fonts: result.fonts } }));
        setNotice({ kind: 'ok', text: `« ${library.name} » réindexée : ${plural(result.textures, 'texture')}, ${plural(result.fonts, 'police')}` });
      },
      'Réindexation impossible',
    );

  const remove = (library: LibrarySetting) => {
    if (confirmRemoval && !window.confirm(`Débrancher « ${library.name} »${NBSP}? Le pack reste intact sur le disque.`)) return;
    void run(
      library.id,
      async () => {
        await removeLibrary(library.id);
        requested.current.delete(library.id);
        await onChanged();
        setNotice({ kind: 'ok', text: `« ${library.name} » débranchée (rien n’a été supprimé)` });
      },
      'Impossible de débrancher ce pack',
    );
  };

  const saveEdit = () => {
    if (!editing || !libraries) return;
    const name = editing.name.trim();
    if (!name) return;
    void run(
      editing.id,
      async () => {
        await onPatch({ libraries: libraries.map((library) => (library.id === editing.id ? { ...library, name, ownership: editing.ownership } : library)) });
        setEditing(null);
        setNotice({ kind: 'ok', text: `« ${name} » modifiée` });
      },
      'Modification impossible',
    );
  };

  return (
    <ScreenFrame title="Bibliothèques" icon="library" pill={pill}>
      <p className="notice is-warning">
        <Icon name="warning" />
        Les packs tiers restent sur ce poste&nbsp;: ils sont lus sur place, jamais copiés dans un dépôt ni publiés. Seules les
        textures que tu importes dans un espace de travail y sont copiées.
      </p>
      {sessionOverride && (
        <p className="notice">
          <Icon name="info" />
          Bibliothèques imposées pour cette session (option <code>--libraries</code>)&nbsp;: une modification les remplace par
          celles des réglages.
        </p>
      )}

      <section className="screen-section" aria-labelledby="libraries-list">
        <div className="screen-section-head">
          <h2 id="libraries-list" className="screen-section-title">
            Packs branchés
          </h2>
          {libraries && <span className="count">{plural(libraries.length, 'pack')}</span>}
        </div>
        <Notice notice={notice} />
        {!libraries ? (
          <p className="muted">Chargement…</p>
        ) : libraries.length === 0 ? (
          <div className="empty-state">
            <Icon name="library" size={48} />
            <h2>Aucun pack branché</h2>
            <p className="muted">Ajoute le dossier d’un resource pack extrait pour parcourir ses textures et ses polices.</p>
          </div>
        ) : (
          <div className="row-list">
            {libraries.map((library) => {
              const count = counts[library.id];
              const isEditing = editing?.id === library.id;
              return (
                <div
                  key={library.id}
                  className="row-card"
                  onContextMenu={(event) =>
                    openMenu(event, [
                      { heading: library.name },
                      { label: 'Modifier le nom et la propriété', icon: 'pencil', onSelect: () => setEditing(library) },
                      { label: 'Réindexer', icon: 'reload', disabled: busy !== null, onSelect: () => reindex(library) },
                      ...(isTauri
                        ? [
                            {
                              label: 'Afficher dans l’explorateur',
                              icon: 'open' as const,
                              onSelect: () => void run(library.id, () => revealInExplorer(library.root), 'Explorateur indisponible'),
                            },
                          ]
                        : []),
                      {
                        label: 'Copier le chemin',
                        icon: 'copy',
                        onSelect: () => void navigator.clipboard?.writeText(library.root).catch(() => undefined),
                      },
                      { separator: true },
                      { label: 'Débrancher', icon: 'trash', danger: true, disabled: busy !== null, onSelect: () => remove(library) },
                    ])
                  }
                >
                  <span className="row-icon">
                    <Icon name="library" size={24} />
                  </span>
                  <span className="row-main">
                    {isEditing ? (
                      <span className="row-edit">
                        <input
                          aria-label="Nom de la bibliothèque"
                          value={editing.name}
                          onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') saveEdit();
                            if (event.key === 'Escape') setEditing(null);
                          }}
                        />
                        <select
                          aria-label="Propriété"
                          value={editing.ownership}
                          onChange={(event) => setEditing({ ...editing, ownership: event.target.value as LibraryOwnership })}
                        >
                          <option value="own">Maison</option>
                          <option value="third-party">Tiers · local</option>
                        </select>
                      </span>
                    ) : (
                      <span className="row-title">
                        <span className="row-title-text">{library.name}</span>
                        <span className={library.ownership === 'own' ? 'badge badge-own' : 'badge badge-third'}>
                          {library.ownership === 'own' ? 'maison' : 'tiers · local'}
                        </span>
                      </span>
                    )}
                    <span className="row-path">{library.root}</span>
                    <span className="row-meta">
                      <span className="mono">{library.id}</span>
                      {count === undefined ? (
                        <span>indexation…</span>
                      ) : 'error' in count ? (
                        <span className="row-meta-error">index illisible</span>
                      ) : (
                        <>
                          <span>{plural(count.textures, 'texture')}</span>
                          <span>{plural(count.fonts, 'police')}</span>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="row-actions">
                    {isEditing ? (
                      <>
                        <button type="button" onClick={() => setEditing(null)}>
                          Annuler
                        </button>
                        <button type="button" className="primary" disabled={busy !== null || !editing.name.trim()} onClick={saveEdit}>
                          <Icon name="check" />
                          Enregistrer
                        </button>
                      </>
                    ) : (
                      <>
                        <IconButton icon="pencil" label="Modifier le nom et la propriété" size={24} onClick={() => setEditing(library)} />
                        <IconButton
                          icon="reload"
                          label="Réindexer"
                          hint="Relit le pack en ignorant les caches"
                          size={24}
                          disabled={busy !== null}
                          onClick={() => reindex(library)}
                        />
                        {isTauri && (
                          <IconButton
                            icon="open"
                            label="Afficher dans l’explorateur"
                            size={24}
                            onClick={() => void run(library.id, () => revealInExplorer(library.root), 'Explorateur indisponible')}
                          />
                        )}
                        <IconButton
                          icon="trash"
                          label="Débrancher"
                          hint="Le pack reste intact sur le disque"
                          variant="danger"
                          size={24}
                          disabled={busy !== null}
                          onClick={() => remove(library)}
                        />
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="screen-section" aria-labelledby="libraries-add">
        <h2 id="libraries-add" className="screen-section-title">
          Ajouter un pack
        </h2>
        <form className="card form-grid" onSubmit={add}>
          <div className="span-2">
            <Field label="Dossier du pack" hint="Le dossier qui contient assets/ (resource pack extrait).">
              <span className="path-input">
                <input
                  className="mono"
                  value={draft.root}
                  placeholder="C:/…/mon-pack"
                  onChange={(event) => setRoot(event.target.value)}
                />
                {isTauri && (
                  <button type="button" disabled={busy !== null} onClick={browse}>
                    <Icon name="folder" />
                    Parcourir…
                  </button>
                )}
              </span>
            </Field>
          </div>
          <Field label="Nom affiché">
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Field>
          <Field label="Identifiant" hint="Fixé à l’ajout ; sert de nom au cache d’index.">
            <input
              className="mono"
              value={draft.id}
              onChange={(event) => {
                setIdTouched(true);
                setDraft({ ...draft, id: event.target.value });
              }}
            />
            {idError && <FieldError>{idError}</FieldError>}
          </Field>
          <Field label="Propriété" hint="« Maison » : assets à vous ; « tiers » : restent en usage local.">
            <select value={draft.ownership} onChange={(event) => setDraft({ ...draft, ownership: event.target.value as LibraryOwnership })}>
              <option value="third-party">{OWNERSHIP_LABELS['third-party']}</option>
              <option value="own">{OWNERSHIP_LABELS.own}</option>
            </select>
          </Field>
          <div className="form-actions form-actions-end">
            <button type="submit" className="primary" disabled={busy !== null || !draft.root.trim() || !draft.id || Boolean(idError)}>
              <Icon name={busy === 'add' ? 'loader' : 'plus'} />
              Brancher le pack
            </button>
          </div>
        </form>
      </section>
    </ScreenFrame>
  );
}
