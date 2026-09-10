import { useEffect, useMemo, useState } from 'react';
import type { Region } from '../asset/model';
import { fetchLibraries, fetchLibraryIndex, libraryRawUrl, looksLikeInterface, suggestedTop } from '../lib/libraryApi';
import type { LibraryIndex, LibrarySourceInfo, LibraryTexture } from '../lib/libraryApi';
import { ID_PATTERN, sanitizeId } from '../model/menu';
import { Icon } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';
import { CropDialog } from './CropDialog';

interface LibraryPanelProps {
  /** Ajoute une texture de la bibliothèque comme couche du menu ouvert. */
  onAddLayer: (source: LibrarySourceInfo, texture: LibraryTexture, top: number | null) => Promise<void>;
  /** Ajoute une partie seulement de la texture (sprite d’un atlas) ; absent = pas de rognage. */
  onAddRegion?: (source: LibrarySourceInfo, texture: LibraryTexture, region: Region) => Promise<void>;
  /** Crée un nouveau menu à partir d’une police du pack. */
  onImportFont: (source: LibrarySourceInfo, index: LibraryIndex, fontId: string, menuId: string) => Promise<void>;
  canAddLayer: boolean;
}

const PAGE_SIZE = 240;

function folderOf(path: string): string {
  return path.replace(/^assets\/[^/]+\/textures\//, '').split('/').slice(0, -1).join('/') || '(racine)';
}

function fileNameOf(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.png$/i, '');
}

/** Navigation dans les packs branchés : vignettes, recherche, import de couches et de menus entiers. */
export function LibraryPanel({ onAddLayer, onAddRegion, onImportFont, canAddLayer }: LibraryPanelProps) {
  const [cropping, setCropping] = useState(false);
  const [sources, setSources] = useState<LibrarySourceInfo[] | null>(null);
  const [sourceId, setSourceId] = useState('');
  const [indexes, setIndexes] = useState<Record<string, LibraryIndex>>({});
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [interfaceOnly, setInterfaceOnly] = useState(true);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<LibraryTexture | null>(null);
  const [fontId, setFontId] = useState('');
  const [menuId, setMenuId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchLibraries()
      .then((list) => {
        setSources(list);
        if (list[0]) setSourceId(list[0].id);
      })
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
  }, []);

  // Un index par pack, chargé à la première ouverture (le serveur le garde en cache).
  useEffect(() => {
    if (!sourceId || indexes[sourceId]) return;
    let cancelled = false;
    fetchLibraryIndex(sourceId)
      .then((result) => {
        if (!cancelled) setIndexes((previous) => ({ ...previous, [sourceId]: result }));
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [sourceId, indexes]);

  const index = indexes[sourceId] ?? null;
  const loading = sourceId !== '' && index === null && error === null;
  const source = sources?.find((candidate) => candidate.id === sourceId) ?? null;

  const changeSource = (id: string) => {
    setSourceId(id);
    setSelected(null);
    setFolder('');
    setFontId('');
    setError(null);
    setLimit(PAGE_SIZE);
  };

  const scoped = useMemo(
    () => (index?.textures ?? []).filter((texture) => !interfaceOnly || looksLikeInterface(texture.path)),
    [index, interfaceOnly],
  );
  const folders = useMemo(() => [...new Set(scoped.map((texture) => folderOf(texture.path)))].sort(), [scoped]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return scoped.filter(
      (texture) => (!folder || folderOf(texture.path) === folder) && (!needle || texture.path.toLowerCase().includes(needle)),
    );
  }, [scoped, folder, query]);

  /** Polices « menu » : au moins un glyphe-image haut (fond d’écran, panneau). */
  const menuFonts = useMemo(
    () => (index?.fonts ?? []).filter((font) => font.glyphs.some((glyph) => glyph.found && glyph.height >= 64)),
    [index],
  );

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  if (sources && sources.length === 0) {
    return (
      <section className="panel-section">
        <h3>Bibliothèque</h3>
        <p className="empty-hint">
          <Icon name="info" />
          <span>
            Aucune bibliothèque. Déclare des packs extraits dans <code>libraries.local.json</code> (modèle :{' '}
            <code>libraries.example.json</code>), puis relance le studio.
          </span>
        </p>
      </section>
    );
  }

  const top = selected ? suggestedTop(selected) : null;
  const menuIdError = menuId && !ID_PATTERN.test(menuId) ? 'Lettres minuscules, chiffres et _ uniquement' : null;

  return (
    <div className="library">
      <section className="panel-section">
        <header className="section-header">
          <h3>Bibliothèque</h3>
          {source && (
            <span className={`badge ${source.ownership === 'own' ? 'badge-own' : 'badge-third'}`}>
              {source.ownership === 'own' ? 'maison' : 'tiers · local'}
            </span>
          )}
        </header>
        <select value={sourceId} onChange={(event) => changeSource(event.target.value)} aria-label="Pack">
          {(sources ?? []).map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
        <input
          className="search-input"
          placeholder="Rechercher (nom, dossier)…"
          value={query}
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(PAGE_SIZE);
          }}
        />
        <select
          value={folder}
          onChange={(event) => {
            setFolder(event.target.value);
            setLimit(PAGE_SIZE);
          }}
          aria-label="Dossier"
        >
          <option value="">Tous les dossiers ({folders.length})</option>
          {folders.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <label className="checkbox">
          <input type="checkbox" checked={interfaceOnly} onChange={(event) => setInterfaceOnly(event.target.checked)} />
          Assets d’interface seulement
        </label>
        {error && (
          <p className="field-error">
            <Icon name="alert" />
            {error}
          </p>
        )}
        {loading && (
          <p className="muted small loading-line">
            <Icon name="loader" />
            Indexation du pack… (la toute première fois, jusqu’à une minute)
          </p>
        )}
        {index && (
          <p className="muted small">
            {visible.length} texture{visible.length > 1 ? 's' : ''} sur {index.textures.length}
          </p>
        )}
      </section>

      {index && (
        <section className="panel-section">
          {visible.length === 0 && (
            <p className="empty-hint">
              <Icon name="search" />
              <span>Aucune texture ne correspond. Élargis la recherche ou décoche « interface seulement ».</span>
            </p>
          )}
          <div className="thumb-grid">
            {visible.slice(0, limit).map((texture) => {
              const name = fileNameOf(texture.path);
              const isSelected = selected?.path === texture.path;
              return (
                <Tooltip
                  key={texture.path}
                  label={name}
                  hint={`${folderOf(texture.path)} · ${texture.width} × ${texture.height} px`}
                >
                  <button
                    type="button"
                    className={`thumb ${isSelected ? 'selected' : ''}`}
                    aria-label={texture.path}
                    aria-pressed={isSelected}
                    onClick={() => setSelected(texture)}
                  >
                    <span className="thumb-image">
                      <img src={libraryRawUrl(sourceId, texture.path)} alt="" loading="lazy" />
                    </span>
                    <span className="thumb-name">{name}</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
          {visible.length > limit && (
            <button type="button" className="wide" onClick={() => setLimit(limit + PAGE_SIZE)}>
              <Icon name="chevron-down" />
              Afficher {Math.min(PAGE_SIZE, visible.length - limit)} de plus
            </button>
          )}
        </section>
      )}

      {selected && source && (
        <section className="panel-section">
          <header className="section-header">
            <h3>Texture</h3>
            <span className="count">
              {selected.width} × {selected.height} px
            </span>
          </header>
          <div className="thumb-preview">
            <img src={libraryRawUrl(sourceId, selected.path)} alt="" />
          </div>
          <p className="small mono-break">{selected.path}</p>
          {top !== null && <p className="muted small">Placée à y = {top} (ascent {13 - top})</p>}
          {selected.usages.length > 0 && (
            <ul className="usage-list small">
              {selected.usages.slice(0, 6).map((usage) => (
                <li key={`${usage.font}@${usage.ascent}`}>
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      setFontId(usage.font);
                      setMenuId(sanitizeId(usage.font.split(/[:/]/).slice(-2).join('_')));
                    }}
                  >
                    {usage.font}
                  </button>{' '}
                  <span className="muted">ascent {usage.ascent} · hauteur {usage.height}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="button-row">
            <button
              type="button"
              className="primary"
              disabled={busy || !canAddLayer}
              onClick={() => void run(() => onAddLayer(source, selected, top))}
            >
              <Icon name={busy ? 'loader' : 'plus'} />
              Ajouter
            </button>
            {onAddRegion && (
              <Tooltip label="Rogner et ajouter" hint="Une partie seulement : un sprite d’un atlas, une case, une zone">
                <button type="button" disabled={busy || !canAddLayer} onClick={() => setCropping(true)}>
                  <Icon name="crop" />
                  Rogner…
                </button>
              </Tooltip>
            )}
          </div>
          {!canAddLayer && <p className="field-hint">Ouvre d’abord un menu.</p>}
        </section>
      )}

      {cropping && selected && source && onAddRegion && (
        <CropDialog
          title={`Rogner « ${fileNameOf(selected.path)} »`}
          url={libraryRawUrl(sourceId, selected.path)}
          primary={{ label: 'Ajouter', run: (region) => onAddRegion(source, selected, region) }}
          secondary={{ label: 'Ajouter et continuer', run: (region) => onAddRegion(source, selected, region) }}
          onClose={() => setCropping(false)}
        />
      )}

      {index && menuFonts.length > 0 && source && (
        <section className="panel-section">
          <h3>Importer un menu depuis une police</h3>
          <p className="muted small">
            Chaque image de la police devient une couche à sa place. La première image de chaque police (fond, barre de
            navigation) est visible ; les autres s’activent par les drapeaux <code>show.&lt;couche&gt;</code> de l’aperçu.
          </p>
          <select
            value={fontId}
            onChange={(event) => {
              setFontId(event.target.value);
              setMenuId(sanitizeId(event.target.value.split(/[:/]/).slice(-2).join('_')));
            }}
            aria-label="Police"
          >
            <option value="">Choisir une police ({menuFonts.length})…</option>
            {menuFonts.map((font) => (
              <option key={font.id} value={font.id}>
                {font.id} · {font.glyphs.length} image{font.glyphs.length > 1 ? 's' : ''}
              </option>
            ))}
          </select>
          {fontId && (
            <>
              <input
                className="mono"
                value={menuId}
                onChange={(event) => setMenuId(event.target.value)}
                placeholder="Identifiant du nouveau menu"
              />
              {menuIdError && (
                <span className="field-error">
                  <Icon name="alert" />
                  {menuIdError}
                </span>
              )}
              <button
                type="button"
                className="primary"
                disabled={busy || !menuId || Boolean(menuIdError)}
                onClick={() => void run(() => onImportFont(source, index, fontId, menuId))}
              >
                <Icon name={busy ? 'loader' : 'chest'} />
                {busy ? 'Import…' : 'Créer le menu'}
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );
}
