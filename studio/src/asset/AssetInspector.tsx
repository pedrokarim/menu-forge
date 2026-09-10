import { useRef } from 'react';
import { CommitField, Field, NumberField } from '../components/fields';
import { PANEL_STYLE_LABELS } from '../model/generator';
import { ID_PATTERN } from '../model/menu';
import type { PanelStyle } from '../model/menu';
import { ColorField, Segmented, StaticField, TextureField } from './AssetFields';
import { RegionPicker } from './RegionPicker';
import { clamp, clampInsets, clampRegion } from './geometry';
import type { Rect } from './geometry';
import type { Recipe } from './history';
import { DEFAULT_LINE_HEIGHT, IMAGE_SCALES, MAX_ASSET_SIZE } from './model';
import type {
  AssetDefinition,
  AssetElement,
  AssetTextElement,
  BoxElement,
  ImageElement,
  Insets,
  Region,
} from './model';
import { BOX_PRESETS, FORMAT_CODES, scaleLabel } from './presets';
import type { RenderResources } from './render';
import { imageSize } from './render';

type Update<T> = (mutate: (draft: T) => void, key: string) => void;

interface EditingProps<T extends AssetElement> {
  element: T;
  textures: readonly string[];
  resources: RenderResources;
  /** Modification enregistrée dans l’historique (regroupée par champ). */
  update: Update<T>;
  /** Modification continue pendant un geste à la souris (sans entrée d’historique). */
  live: (mutate: (draft: T) => void) => void;
  checkpoint: () => void;
}

interface AssetInspectorProps {
  asset: AssetDefinition;
  selected: AssetElement | null;
  selectedBounds: Rect | null;
  textures: readonly string[];
  resources: RenderResources;
  onChange: (recipe: Recipe, coalesce?: string) => void;
  onLive: (recipe: Recipe) => void;
  onCheckpoint: () => void;
  onRename: (from: string, to: string) => void;
}

const TYPE_LABELS: Record<AssetElement['type'], string> = {
  box: 'Box',
  image: 'Image',
  text: 'Texte',
};

const MAX_OFFSET = MAX_ASSET_SIZE * 2;

/** Inspecteur : réglages de l’asset (rien de sélectionné) ou de l’élément sélectionné. */
export function AssetInspector(props: AssetInspectorProps) {
  const { asset, selected, selectedBounds, textures, resources, onChange, onLive, onCheckpoint } = props;
  if (!selected) return <AssetSettings asset={asset} onChange={onChange} />;

  const id = selected.id;
  const recipeFor =
    <T extends AssetElement>(mutate: (draft: T) => void): Recipe =>
    (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === id);
      if (element && element.type === selected.type) mutate(element as T);
    };
  const update = <T extends AssetElement>(mutate: (draft: T) => void, key: string) =>
    onChange(recipeFor(mutate), `${id}.${key}`);
  const live = <T extends AssetElement>(mutate: (draft: T) => void) => onLive(recipeFor(mutate));

  const validateId = (value: string): string | null => {
    if (!ID_PATTERN.test(value)) return 'Lettres minuscules, chiffres et _ uniquement';
    if (asset.elements.some((element) => element.id === value && element.id !== id)) return 'Identifiant déjà utilisé';
    return null;
  };

  return (
    <>
      <section className="panel-section">
        <header className="section-header">
          <h3>{TYPE_LABELS[selected.type]}</h3>
          <span className="badge">{selected.id}</span>
        </header>
        <CommitField label="Identifiant" value={selected.id} validate={validateId} onCommit={(value) => props.onRename(id, value)} />
        <div className="field-row">
          <NumberField
            label="x"
            value={selected.x}
            min={-MAX_OFFSET}
            max={MAX_OFFSET}
            onChange={(value) => update((draft) => void (draft.x = value), 'x')}
          />
          <NumberField
            label="y"
            value={selected.y}
            min={-MAX_OFFSET}
            max={MAX_OFFSET}
            onChange={(value) => update((draft) => void (draft.y = value), 'y')}
          />
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={Boolean(selected.hidden)}
            onChange={(event) => {
              const hidden = event.target.checked;
              update((draft) => {
                if (hidden) draft.hidden = true;
                else delete draft.hidden;
              }, 'hidden');
            }}
          />
          Masqué (ni affiché ni exporté)
        </label>
        {selectedBounds && (
          <p className="muted small">
            Occupe {selectedBounds.width} × {selectedBounds.height} px à partir de ({selectedBounds.x}, {selectedBounds.y}).
          </p>
        )}
      </section>
      <section className="panel-section">
        {selected.type === 'box' && (
          <BoxInspector
            key={id}
            element={selected}
            textures={textures}
            resources={resources}
            update={update}
            live={live}
            checkpoint={onCheckpoint}
          />
        )}
        {selected.type === 'image' && (
          <ImageInspector
            key={id}
            element={selected}
            textures={textures}
            resources={resources}
            update={update}
            live={live}
            checkpoint={onCheckpoint}
          />
        )}
        {selected.type === 'text' && (
          <TextInspector
            key={id}
            element={selected}
            textures={textures}
            resources={resources}
            update={update}
            live={live}
            checkpoint={onCheckpoint}
          />
        )}
      </section>
    </>
  );
}

function AssetSettings({ asset, onChange }: { asset: AssetDefinition; onChange: (recipe: Recipe, coalesce?: string) => void }) {
  return (
    <section className="panel-section">
      <header className="section-header">
        <h3>Asset</h3>
        <span className="badge">{asset.id}</span>
      </header>
      <CommitField
        label="Nom"
        value={asset.name}
        validate={(value) => (value.trim() ? null : 'Nom requis')}
        onCommit={(value) => onChange((draft) => void (draft.name = value.trim()))}
      />
      <div className="field-row">
        <NumberField
          label="Largeur"
          value={asset.size.width}
          min={1}
          max={MAX_ASSET_SIZE}
          onChange={(value) => onChange((draft) => void (draft.size.width = clamp(value, 1, MAX_ASSET_SIZE)), 'size.width')}
        />
        <NumberField
          label="Hauteur"
          value={asset.size.height}
          min={1}
          max={MAX_ASSET_SIZE}
          onChange={(value) => onChange((draft) => void (draft.size.height = clamp(value, 1, MAX_ASSET_SIZE)), 'size.height')}
        />
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={asset.background === null}
          onChange={(event) => {
            const transparent = event.target.checked;
            onChange((draft) => void (draft.background = transparent ? null : '#3b2f2aff'));
          }}
        />
        Fond transparent (cas normal)
      </label>
      {asset.background !== null && (
        <ColorField
          label="Couleur de fond"
          value={asset.background}
          hint="#rrggbbaa (les deux derniers chiffres règlent l’opacité)"
          onChange={(color) => onChange((draft) => void (draft.background = color), 'background')}
        />
      )}
      <p className="muted small">
        Identifiant fixé à la création : <code>{asset.id}</code>. Sélectionne un élément sur la toile ou dans la liste pour le
        modifier.
      </p>
    </section>
  );
}

function BoxInspector({ element, textures, resources, update, live, checkpoint }: EditingProps<BoxElement>) {
  const style = element.style;
  const sliceTexture = style.kind === 'slice' && style.texture ? resources.textures.get(style.texture) : null;

  let emptyCenter = false;
  if (style.kind === 'slice' && sliceTexture) {
    const area = clampRegion(style.source, sliceTexture.width, sliceTexture.height);
    const insets = clampInsets(style.insets, area);
    emptyCenter = area.width - insets.left - insets.right <= 0 || area.height - insets.top - insets.bottom <= 0;
  }

  const setRegion = (region: Region | undefined, isLive: boolean) => {
    const mutate = (draft: BoxElement) => {
      if (draft.style.kind !== 'slice') return;
      if (region) draft.style.source = region;
      else delete draft.style.source;
    };
    if (isLive) live(mutate);
    else update(mutate, 'source');
  };
  const setInsets = (insets: Insets, isLive: boolean) => {
    const mutate = (draft: BoxElement) => {
      if (draft.style.kind === 'slice') draft.style.insets = insets;
    };
    if (isLive) live(mutate);
    else update(mutate, 'insets');
  };

  return (
    <>
      <div className="field-row">
        <NumberField
          label="Largeur"
          value={element.width}
          min={1}
          max={MAX_ASSET_SIZE}
          onChange={(value) => update((draft) => void (draft.width = clamp(value, 1, MAX_ASSET_SIZE)), 'width')}
        />
        <NumberField
          label="Hauteur"
          value={element.height}
          min={1}
          max={MAX_ASSET_SIZE}
          onChange={(value) => update((draft) => void (draft.height = clamp(value, 1, MAX_ASSET_SIZE)), 'height')}
        />
      </div>
      <Field label="Préréglage">
        <select
          value=""
          onChange={(event) => {
            const preset = BOX_PRESETS.find((candidate) => candidate.id === event.target.value);
            if (preset) update((draft) => void (draft.style = structuredClone(preset.style)), 'preset');
          }}
        >
          <option value="">Appliquer un préréglage…</option>
          {BOX_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </Field>
      <StaticField label="Style">
        <Segmented
          value={style.kind}
          options={[
            { value: 'procedural', label: 'Procédural', title: 'Dessiné par le studio (panneau, bouton, aplat…)' },
            { value: 'slice', label: 'Nine-slice', title: 'Découpé dans une texture : coins copiés, bords répétés' },
          ]}
          onChange={(kind) => {
            if (kind === style.kind) return;
            update((draft) => {
              draft.style =
                kind === 'slice'
                  ? { kind: 'slice', texture: '', insets: { top: 3, right: 3, bottom: 3, left: 3 } }
                  : { kind: 'procedural', preset: 'flat', color: '#3b2f2a', border: '#2e8b86' };
            }, 'kind');
          }}
        />
      </StaticField>

      {style.kind === 'procedural' && (
        <>
          <Field label="Rendu">
            <select
              value={style.preset}
              onChange={(event) => {
                const preset = event.target.value as PanelStyle;
                update((draft) => {
                  if (draft.style.kind === 'procedural') draft.style.preset = preset;
                }, 'style.preset');
              }}
            >
              {Object.entries(PANEL_STYLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <ColorField
            label="Couleur"
            value={style.color}
            hint="#rrggbb, ou #rrggbbaa pour la transparence"
            onChange={(color) =>
              update((draft) => {
                if (draft.style.kind === 'procedural') draft.style.color = color;
              }, 'style.color')
            }
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={style.border !== undefined}
              onChange={(event) => {
                const enabled = event.target.checked;
                update((draft) => {
                  if (draft.style.kind !== 'procedural') return;
                  if (enabled) draft.style.border = '#2e8b86';
                  else delete draft.style.border;
                }, 'style.border.toggle');
              }}
            />
            Bordure personnalisée (contour d’1 px)
          </label>
          {style.border !== undefined && (
            <ColorField
              label="Couleur de bordure"
              value={style.border}
              onChange={(color) =>
                update((draft) => {
                  if (draft.style.kind === 'procedural') draft.style.border = color;
                }, 'style.border')
              }
            />
          )}
        </>
      )}

      {style.kind === 'slice' && (
        <>
          <TextureField
            label="Texture"
            value={style.texture}
            textures={textures}
            hint="Par exemple l’encart d’un menu existant, importé depuis la bibliothèque."
            onChange={(texture) =>
              update((draft) => {
                if (draft.style.kind !== 'slice') return;
                draft.style.texture = texture;
                delete draft.style.source;
              }, 'style.texture')
            }
          />
          {style.texture ? (
            <RegionPicker
              texture={resources.textures.get(style.texture)}
              region={style.source}
              insets={style.insets}
              onBeginEdit={checkpoint}
              onRegionChange={setRegion}
              onInsetsChange={setInsets}
            />
          ) : (
            <p className="muted small">Choisis la texture à découper.</p>
          )}
          {emptyCenter && (
            <p className="warning">Zone centrale vide : les bords et le centre ne peuvent pas être remplis. Réduis les insets.</p>
          )}
          <p className="field-hint">Coins copiés tels quels, bords et centre répétés en mosaïque (jamais étirés).</p>
        </>
      )}
    </>
  );
}

function ImageInspector({ element, textures, resources, update, live, checkpoint }: EditingProps<ImageElement>) {
  const texture = element.texture ? resources.textures.get(element.texture) : null;
  const size = texture ? imageSize(element, texture) : null;

  const setRegion = (region: Region | undefined, isLive: boolean) => {
    const mutate = (draft: ImageElement) => {
      if (region) draft.source = region;
      else delete draft.source;
    };
    if (isLive) live(mutate);
    else update(mutate, 'source');
  };

  return (
    <>
      <TextureField
        label="Texture"
        value={element.texture}
        textures={textures}
        onChange={(path) =>
          update((draft) => {
            draft.texture = path;
            delete draft.source;
          }, 'texture')
        }
      />
      <StaticField label="Zone source" hint="Trace la zone à récupérer (le « E » dans une plus grande image, par exemple).">
        <RegionPicker
          texture={element.texture ? texture : null}
          region={element.source}
          onBeginEdit={checkpoint}
          onRegionChange={setRegion}
        />
      </StaticField>
      <Field label="Échelle" hint="Rendu au plus proche voisin : pixels nets, aucun lissage.">
        <select
          value={element.scale ?? 1}
          onChange={(event) => {
            const scale = Number(event.target.value);
            update((draft) => {
              if (scale === 1) delete draft.scale;
              else draft.scale = scale;
            }, 'scale');
          }}
        >
          {IMAGE_SCALES.map((scale) => (
            <option key={scale} value={scale}>
              {scaleLabel(scale)}
            </option>
          ))}
        </select>
      </Field>
      {size && (
        <p className="muted small">
          Taille rendue : {size.width} × {size.height} px.
        </p>
      )}
    </>
  );
}

function TextInspector({ element, update }: EditingProps<AssetTextElement>) {
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const insertCode = (code: string) => {
    const area = areaRef.current;
    const start = area?.selectionStart ?? element.text.length;
    const end = area?.selectionEnd ?? start;
    const next = element.text.slice(0, start) + code + element.text.slice(end);
    update((draft) => void (draft.text = next), 'text');
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(start + code.length, start + code.length);
    });
  };

  return (
    <>
      <Field label="Texte" hint="Une ligne par ligne de texte ; codes « § » acceptés.">
        <textarea
          ref={areaRef}
          className="code"
          rows={4}
          spellCheck={false}
          value={element.text}
          onChange={(event) => {
            const text = event.target.value;
            update((draft) => void (draft.text = text), 'text');
          }}
        />
      </Field>
      <StaticField label="Codes de format" hint="Clic : insère le code au curseur. Une couleur annule aussi le gras, « §r » revient au style de l’élément.">
        <div className="asset-code-palette">
          {FORMAT_CODES.map((format) => (
            <button key={format.code} type="button" title={format.label} onClick={() => insertCode(`§${format.code}`)}>
              {format.color && <span className="asset-swatch" style={{ background: format.color }} />}§{format.code}
            </button>
          ))}
        </div>
      </StaticField>
      <ColorField
        label="Couleur"
        value={element.color ?? '#ffffff'}
        onChange={(color) => update((draft) => void (draft.color = color), 'color')}
      />
      <div className="field-row">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={element.shadow ?? false}
            onChange={(event) => {
              const shadow = event.target.checked;
              update((draft) => void (draft.shadow = shadow), 'shadow');
            }}
          />
          Ombre
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={element.bold ?? false}
            onChange={(event) => {
              const bold = event.target.checked;
              update((draft) => void (draft.bold = bold), 'bold');
            }}
          />
          Gras
        </label>
      </div>
      <NumberField
        label="Interligne (px)"
        value={element.lineHeight ?? DEFAULT_LINE_HEIGHT}
        min={1}
        max={64}
        onChange={(value) => update((draft) => void (draft.lineHeight = clamp(value, 1, 64)), 'lineHeight')}
      />
      <StaticField label="Alignement" hint="Par rapport à x.">
        <Segmented
          value={element.align ?? 'left'}
          options={[
            { value: 'left', label: 'Gauche', icon: 'align-left' },
            { value: 'center', label: 'Centre', icon: 'align-center' },
            { value: 'right', label: 'Droite', icon: 'align-right' },
          ]}
          onChange={(align) => update((draft) => void (draft.align = align), 'align')}
        />
      </StaticField>
    </>
  );
}
