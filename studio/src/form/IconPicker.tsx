import { useRef, useState } from 'react';
import { textureUrl } from '../lib/api';
import type { FormIcon } from '../model/menu';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';

type IconSource = 'workspace' | 'vanilla' | 'url';

/** Textures Bedrock vanilla courantes, proposées à la saisie (chemins sans extension). */
const VANILLA_ICONS = [
  'textures/items/compass_item',
  'textures/items/clock_item',
  'textures/items/map_filled',
  'textures/items/book_normal',
  'textures/items/book_writable',
  'textures/items/diamond',
  'textures/items/emerald',
  'textures/items/gold_ingot',
  'textures/items/iron_ingot',
  'textures/items/nether_star',
  'textures/items/ender_pearl',
  'textures/items/diamond_sword',
  'textures/items/iron_sword',
  'textures/items/diamond_pickaxe',
  'textures/items/bed_red',
  'textures/items/apple',
  'textures/items/bread',
  'textures/items/paper',
  'textures/items/redstone_dust',
  'textures/items/totem',
  'textures/items/experience_bottle',
  'textures/blocks/grass_side_carried',
  'textures/blocks/crafting_table_front',
  'textures/blocks/bookshelf',
  'textures/blocks/sapling_oak',
  'textures/blocks/tnt_side',
];

/** Nombre de vignettes de l’espace affichées à la fois. */
const THUMBNAILS = 48;

interface IconPickerProps {
  icon: FormIcon | undefined;
  onChange: (icon: FormIcon | undefined) => void;
  /** Textures de l’espace de travail (chemins relatifs à `textures/`). */
  textures: readonly string[];
  textureVersions: Record<string, number>;
  /** Dessine une nouvelle icône dans l’éditeur de pixels. */
  onDraw: () => void;
  /** Importe un PNG du disque dans l’espace ; renvoie son chemin. */
  onImport: (file: File) => Promise<string>;
  /** Affiche la bibliothèque : un clic sur une texture en fait l’icône du bouton. */
  onShowLibrary: () => void;
}

function sourceOf(icon: FormIcon | undefined): IconSource {
  if (!icon || 'texture' in icon) return 'workspace';
  return 'path' in icon ? 'vanilla' : 'url';
}

/** Origine de l’icône et sa valeur (chemin ou adresse), affichées sur deux lignes. */
function describe(icon: FormIcon): { kind: string; value: string } {
  if ('texture' in icon) return { kind: 'Texture de l’espace', value: icon.texture };
  if ('path' in icon) return { kind: 'Texture Bedrock', value: icon.path };
  return { kind: 'Adresse', value: icon.url };
}

/** Choix de l’icône d’un bouton de formulaire : texture de l’espace, texture Bedrock vanilla ou adresse web. */
export function IconPicker({ icon, onChange, textures, textureVersions, onDraw, onImport, onShowLibrary }: IconPickerProps) {
  const [source, setSource] = useState<IconSource>(() => sourceOf(icon));
  const [query, setQuery] = useState('');
  const [path, setPath] = useState(icon && 'path' in icon ? icon.path : '');
  const [url, setUrl] = useState(icon && 'url' in icon ? icon.url : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const matches = textures.filter((texture) => texture.toLowerCase().includes(query.trim().toLowerCase())).slice(0, THUMBNAILS);
  const currentTexture = icon && 'texture' in icon ? icon.texture : null;

  const commitPath = () => {
    const value = path.trim().replace(/\.png$/iu, '');
    if (value === '') return;
    if (!value.startsWith('textures/')) {
      setError('Un chemin Bedrock commence par « textures/ » (ex. textures/items/diamond)');
      return;
    }
    setError(null);
    onChange({ path: value });
  };

  const commitUrl = () => {
    const value = url.trim();
    if (value === '') return;
    if (!/^https?:\/\//u.test(value)) {
      setError('Adresse attendue : https://…');
      return;
    }
    setError(null);
    onChange({ url: value });
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange({ texture: await onImport(file) });
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="visual-block icon-picker">
      <div className="visual-block-head">
        <span className="field-label">Icône</span>
        {icon && <IconButton icon="close" label="Sans icône" hint="Retirer l’image du bouton" variant="ghost" onClick={() => onChange(undefined)} />}
      </div>
      <div className="icon-current">
        {icon && 'texture' in icon ? (
          <img src={textureUrl(icon.texture, textureVersions[icon.texture] ?? 0)} alt="" />
        ) : (
          <Icon name={icon ? 'image' : 'box'} />
        )}
        {icon ? (
          <span className="icon-current-text">
            <span className="muted small">{describe(icon).kind}</span>
            <span className="icon-path">{describe(icon).value}</span>
          </span>
        ) : (
          <span className="muted small">Aucune image : la disposition affiche le texte seul.</span>
        )}
      </div>
      <div className="segmented-mini" role="radiogroup" aria-label="Origine de l’icône">
        {(
          [
            ['workspace', 'Espace'],
            ['vanilla', 'Vanilla'],
            ['url', 'Adresse'],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={source === value} onClick={() => setSource(value)}>
            {label}
          </button>
        ))}
      </div>
      {source === 'workspace' && (
        <>
          <div className="inline-control">
            <input type="search" placeholder="Filtrer les textures" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          {matches.length === 0 ? (
            <p className="muted small">Aucune texture{query ? ' ne correspond' : ' dans l’espace'}.</p>
          ) : (
            <ul className="icon-grid" aria-label="Textures de l’espace">
              {matches.map((texture) => (
                <li key={texture}>
                  <Tooltip label={texture}>
                    <button
                      type="button"
                      className={texture === currentTexture ? 'is-current' : undefined}
                      aria-pressed={texture === currentTexture}
                      onClick={() => onChange({ texture })}
                    >
                      <img src={textureUrl(texture, textureVersions[texture] ?? 0)} alt={texture} loading="lazy" />
                    </button>
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}
          <div className="button-row wrap">
            <Tooltip label="Importer un PNG" hint="Copié dans textures/imported/ de l’espace, puis exporté dans le pack Menu Forge">
              <button type="button" className="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
                <Icon name={busy ? 'loader' : 'upload'} />
                Importer
              </button>
            </Tooltip>
            <Tooltip label="Dessiner l’icône" hint="Nouvelle image de 32 × 32 dans l’éditeur de pixels">
              <button type="button" className="sm" onClick={onDraw}>
                <Icon name="pencil" />
                Dessiner
              </button>
            </Tooltip>
            <Tooltip label="Bibliothèque" hint="Un clic sur une texture d’un pack branché en fait l’icône du bouton">
              <button type="button" className="sm" onClick={onShowLibrary}>
                <Icon name="library" />
                Bibliothèque
              </button>
            </Tooltip>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/png"
            hidden
            onChange={(event) => {
              void importFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </>
      )}
      {source === 'vanilla' && (
        <div className="inline-control">
          <input
            className="mono"
            list="form-vanilla-icons"
            placeholder="textures/items/diamond"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            onBlur={commitPath}
            onKeyDown={(event) => event.key === 'Enter' && commitPath()}
          />
          <datalist id="form-vanilla-icons">
            {VANILLA_ICONS.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </div>
      )}
      {source === 'url' && (
        <div className="inline-control">
          <input
            className="mono"
            type="url"
            placeholder="https://…"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onBlur={commitUrl}
            onKeyDown={(event) => event.key === 'Enter' && commitUrl()}
          />
        </div>
      )}
      {source === 'vanilla' && (
        <p className="field-hint">Texture du jeu ou d’un pack du serveur, sans extension : le studio ne l’affiche pas, le client la trouve.</p>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
