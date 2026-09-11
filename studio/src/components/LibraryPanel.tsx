import { useEffect, useMemo, useRef, useState } from 'react';
import type { Region } from '../asset/model';
import { fetchLibraries, fetchLibraryIndex, libraryRawUrl, looksLikeInterface, suggestedTop } from '../lib/libraryApi';
import type { LibraryIndex, LibrarySourceInfo, LibraryTexture } from '../lib/libraryApi';
import { ID_PATTERN, sanitizeId } from '../model/menu';
import { useContextMenu } from '../ui/menuContext';
import type { MenuEntry } from '../ui/menuContext';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import { CropDialog } from './CropDialog';

interface LibraryPanelProps {
  /** Ajoute une texture de la bibliothèque (couche du menu, image de l’asset). */
  onAddLayer: (source: LibrarySourceInfo, texture: LibraryTexture, top: number | null) => Promise<void>;
  /** Ajoute une partie seulement de la texture (sprite d’un atlas) ; absent = pas de rognage. */
  onAddRegion?: (source: LibrarySourceInfo, texture: LibraryTexture, region: Region) => Promise<void>;
  /** Crée un nouveau menu à partir d’une police du pack. */
  onImportFont: (source: LibrarySourceInfo, index: LibraryIndex, fontId: string, menuId: string) => Promise<void>;
  canAddLayer: boolean;
  /** Libellé de l’ajout dans le menu contextuel (« Ajouter comme couche », « Insérer dans l’asset »). */
  addLabel?: string;
}

const PAGE_SIZE = 240;
/** Côté utile de l’aperçu du volet (px). */
const PREVIEW_SIDE = 48;

function folderOf(path: string): string {
  return path.replace(/^assets\/[^/]+\/textures\//, '').split('/').slice(0, -1).join('/') || '(racine)';
}

function fileNameOf(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.png$/i, '');
}

function menuIdFor(fontId: string): string {
  return sanitizeId(fontId.split(/[:/]/).slice(-2).join('_'));
}

/** Aperçu net : agrandi d’un nombre entier de fois (×8 au plus), réduit s’il est plus grand que le cadre. */
function PixelPreview({ src, width, height }: { src: string; width: number; height: number }) {
  const ratio = Math.min(PREVIEW_SIDE / Math.max(width, 1), PREVIEW_SIDE / Math.max(height, 1));
  const scale = ratio >= 1 ? Math.min(8, Math.floor(ratio)) : ratio;
  return (
    <span className="pixel-preview">
      <img src={src} alt="" style={{ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }} />
    </span>
  );
}

/**
 * Navigation dans les packs branchés : vignettes, recherche, import de couches
 * et de menus entiers. La texture choisie s’affiche dans un volet épinglé en
 * bas de la colonne ; clic droit sur une vignette pour ses actions, double-clic
 * pour l’ajouter.
 */
export function LibraryPanel({ onAddLayer, onAddRegion, onImportFont, canAddLayer, addLabel = 'Ajouter comme couche' }: LibraryPanelProps) {
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
  const importRef = useRef<HTMLElement>(null);
  const openMenu = useContextMenu();

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

  /** Polices « menu » : au moins un glyphe-image haut (fond d’écran, panneau). */
  const menuFonts = useMemo(
    () => (index?.fonts ?? []).filter((font) => font.glyphs.some((glyph) => glyph.found && glyph.height >= 64)),
    [index],
  );
  const menuFontIds = useMemo(() => new Set(menuFonts.map((font) => font.id)), [menuFonts]);

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

  const addTexture = (texture: LibraryTexture) => {
    if (!source || busy || !canAddLayer) return;
    void run(() => onAddLayer(source, texture, suggestedTop(texture)));
  };

  /** Prépare l’import d’un menu depuis une police, et amène la section à l’écran. */
  const prepareFontImport = (font: string) => {
    setFontId(font);
    setMenuId(menuIdFor(font));
    // En haut de la colonne : en bas, le volet épinglé de la texture la cacherait.
    window.setTimeout(() => importRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0);
  };

  const thumbMenu = (texture: LibraryTexture): MenuEntry[] => {
    // Une police qui utilise la texture à plusieurs hauteurs n’apparaît qu’une fois.
    const fonts = [...new Map(texture.usages.filter((usage) => menuFontIds.has(usage.font)).map((usage) => [usage.font, usage])).values()].slice(0, 3);
    return [
      { heading: fileNameOf(texture.path) },
      { label: addLabel, icon: 'plus', disabled: busy || !canAddLayer, onSelect: () => addTexture(texture) },
      ...(onAddRegion
        ? [{ label: 'Rogner…', icon: 'crop' as const, disabled: !canAddLayer, onSelect: () => setCropping(true) }]
        : []),
      ...(fonts.length > 0 ? [{ separator: true as const }] : []),
      ...fonts.map((usage) => ({
        label: `Importer le menu « ${usage.font} »`,
        icon: 'chest' as const,
        onSelect: () => prepareFontImport(usage.font),
      })),
      { separator: true },
      {
        label: 'Copier le chemin',
        icon: 'copy',
        onSelect: () => void navigator.clipboard?.writeText(texture.path).catch(() => undefined),
      },
    ];
  };

  if (sources && sources.length === 0) {
    return (
      <section className="panel-section">
        <h3>Bibliothèque</h3>
        <p className="empty-hint">
          <Icon name="info" />
          <span>Aucune bibliothèque branchée. Ajoute un pack depuis l’écran Bibliothèques (Ctrl+3).</span>
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
        {error && !selected && (
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
            {visible.length} texture{visible.length > 1 ? 's' : ''} sur {index.textures.length} · clic droit pour les actions,
            double-clic pour ajouter
          </p>
        )}
      </section>

      {index && (
        <section className="panel-section">
          {visible.length === 0 && (
            <p className="empty-hint">
              <Icon name="search" />
              <span>Aucune texture ne correspond. Élargis la recherche ou décoche « interface seulement ».</span>
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
                    onDoubleClick={() => addTexture(texture)}
                    onContextMenu={(event) => {
                      setSelected(texture);
                      openMenu(event, thumbMenu(texture));
                    }}
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

      {index && menuFonts.length > 0 && source && (
        <section className="panel-section" ref={importRef}>
          <h3>Importer un menu depuis une police</h3>
          <p className="muted small">
            Chaque image de la police devient une couche à sa place. La première image de chaque police (fond, barre de
            navigation) est visible ; les autres s’activent par les drapeaux <code>show.&lt;couche&gt;</code> de l’aperçu.
          </p>
          <select
            value={fontId}
            onChange={(event) => {
              setFontId(event.target.value);
              setMenuId(menuIdFor(event.target.value));
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

      {selected && source && (
        <section className="library-dock" aria-label="Texture sélectionnée">
          <div className="library-dock-head">
            <PixelPreview src={libraryRawUrl(sourceId, selected.path)} width={selected.width} height={selected.height} />
            <div className="library-dock-info">
              <strong title={selected.path}>{fileNameOf(selected.path)}</strong>
              <span
                className="muted small"
                title={top !== null ? `Placée à y = ${top} (ascent ${13 - top})` : undefined}
              >
                {selected.width} × {selected.height} px{top !== null ? ` · y = ${top}` : ''}
              </span>
              <span className="muted small" title={selected.path}>
                {folderOf(selected.path)}
              </span>
            </div>
            <IconButton icon="close" label="Désélectionner" variant="ghost" onClick={() => setSelected(null)} />
          </div>
          {error && (
            <p className="field-error">
              <Icon name="alert" />
              {error}
            </p>
          )}
          <div className="button-row">
            <button type="button" className="primary" disabled={busy || !canAddLayer} onClick={() => addTexture(selected)}>
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
          title={`Rogner « ${fileNameOf(selected.path)} »`}
          url={libraryRawUrl(sourceId, selected.path)}
          primary={{ label: 'Ajouter', run: (region) => onAddRegion(source, selected, region) }}
          secondary={{ label: 'Ajouter et continuer', run: (region) => onAddRegion(source, selected, region) }}
          onClose={() => setCropping(false)}
        />
      )}
    </div>
  );
}
