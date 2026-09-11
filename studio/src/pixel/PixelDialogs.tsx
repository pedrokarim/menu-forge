import { useState } from 'react';
import { Field, FieldError, Modal, NumberField } from '../components/fields';
import { NBSP } from '../lib/format';
import { ID_PATTERN, sanitizeId, uniqueId } from '../model/menu';
import { Icon } from '../ui/Icon';
import { MAX_PIXEL_SIZE } from './document';

/** Dialogues de l’éditeur de pixels : nouvelle image, taille de la toile. */

const SIZE_PRESETS: ReadonlyArray<{ label: string; width: number; height: number }> = [
  { label: 'Icône d’item', width: 16, height: 16 },
  { label: 'Case d’inventaire', width: 18, height: 18 },
  { label: 'Item détaillé', width: 32, height: 32 },
  { label: 'Bouton', width: 64, height: 20 },
  { label: 'Fenêtre de coffre (6 lignes)', width: 176, height: 222 },
  { label: 'Grande texture', width: 256, height: 256 },
];

const clampSize = (value: number) => Math.min(MAX_PIXEL_SIZE, Math.max(1, Math.round(value)));

export type BackgroundFill = 'transparent' | 'white' | 'black';

export interface NewPixelInput {
  id: string;
  name: string;
  width: number;
  height: number;
  background: BackgroundFill;
}

export function NewPixelDialog({
  existingIds,
  onCancel,
  onCreate,
}: {
  existingIds: string[];
  onCancel: () => void;
  onCreate: (input: NewPixelInput) => Promise<void>;
}) {
  const [name, setName] = useState('Mon image');
  // Identifiant proposé toujours libre : le dialogue ne s’ouvre jamais sur une erreur.
  const [id, setId] = useState(() => uniqueId('mon_image', existingIds));
  const [idTouched, setIdTouched] = useState(false);
  const [width, setWidth] = useState(16);
  const [height, setHeight] = useState(16);
  const [background, setBackground] = useState<BackgroundFill>('transparent');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  let idError: string | null = null;
  if (!ID_PATTERN.test(id)) idError = 'Lettres minuscules, chiffres et _ uniquement';
  else if (existingIds.includes(id)) idError = 'Une image porte déjà cet identifiant';

  const create = async () => {
    if (idError || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ id, name: name.trim(), width, height, background });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Nouvelle image"
      onClose={onCancel}
      footer={
        <>
          {error && <FieldError>{error}</FieldError>}
          <button type="button" onClick={onCancel}>
            Annuler
          </button>
          <button type="button" className="primary" disabled={busy || Boolean(idError) || !name.trim()} onClick={() => void create()}>
            <Icon name={busy ? 'loader' : 'check'} />
            {busy ? 'Création…' : 'Créer'}
          </button>
        </>
      }
    >
      <div className="field-row">
        <Field label="Nom">
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (!idTouched) setId(uniqueId(sanitizeId(event.target.value) || 'image', existingIds));
            }}
          />
        </Field>
        <Field label="Identifiant" hint="Nom du fichier pixels/<id>.pixel.json et du PNG exporté">
          <input
            className="mono"
            value={id}
            onChange={(event) => {
              setIdTouched(true);
              setId(event.target.value);
            }}
          />
          {idError && <FieldError>{idError}</FieldError>}
        </Field>
      </div>
      <Field label="Taille type">
        <select
          value=""
          onChange={(event) => {
            const preset = SIZE_PRESETS[Number(event.target.value)];
            if (preset) {
              setWidth(preset.width);
              setHeight(preset.height);
            }
          }}
        >
          <option value="">Choisir…</option>
          {SIZE_PRESETS.map((preset, index) => (
            <option key={preset.label} value={index}>
              {preset.label} · {preset.width} × {preset.height}
            </option>
          ))}
        </select>
      </Field>
      <div className="field-row">
        <NumberField label="Largeur" value={width} min={1} max={MAX_PIXEL_SIZE} onChange={(value) => setWidth(clampSize(value))} />
        <NumberField label="Hauteur" value={height} min={1} max={MAX_PIXEL_SIZE} onChange={(value) => setHeight(clampSize(value))} />
      </div>
      <Field label="Fond">
        <select value={background} onChange={(event) => setBackground(event.target.value as BackgroundFill)}>
          <option value="transparent">Transparent</option>
          <option value="white">Blanc</option>
          <option value="black">Noir</option>
        </select>
      </Field>
    </Modal>
  );
}

/** Coin ou bord gardé en place quand la toile change de taille (0, ½ ou 1 sur chaque axe). */
export interface Anchor {
  x: 0 | 0.5 | 1;
  y: 0 | 0.5 | 1;
}

export interface ResizeInput {
  /** `canvas`  agrandir ou recadrer la toile ; `scale`  mettre l’image à l’échelle (plus proche voisin). */
  mode: 'canvas' | 'scale';
  width: number;
  height: number;
  anchor: Anchor;
}

const ANCHOR_LABELS: Record<string, string> = {
  '0,0': 'En haut à gauche',
  '0.5,0': 'En haut',
  '1,0': 'En haut à droite',
  '0,0.5': 'À gauche',
  '0.5,0.5': 'Au centre',
  '1,0.5': 'À droite',
  '0,1': 'En bas à gauche',
  '0.5,1': 'En bas',
  '1,1': 'En bas à droite',
};

const ANCHOR_STEPS: ReadonlyArray<0 | 0.5 | 1> = [0, 0.5, 1];

export function ResizeDialog({
  width: initialWidth,
  height: initialHeight,
  onCancel,
  onApply,
}: {
  width: number;
  height: number;
  onCancel: () => void;
  onApply: (input: ResizeInput) => void;
}) {
  const [mode, setMode] = useState<ResizeInput['mode']>('canvas');
  const [width, setWidth] = useState(initialWidth);
  const [height, setHeight] = useState(initialHeight);
  const [keepRatio, setKeepRatio] = useState(true);
  const [anchor, setAnchor] = useState<Anchor>({ x: 0.5, y: 0.5 });
  const unchanged = width === initialWidth && height === initialHeight;

  const changeWidth = (value: number) => {
    const next = clampSize(value);
    setWidth(next);
    if (mode === 'scale' && keepRatio) setHeight(clampSize((next * initialHeight) / initialWidth));
  };
  const changeHeight = (value: number) => {
    const next = clampSize(value);
    setHeight(next);
    if (mode === 'scale' && keepRatio) setWidth(clampSize((next * initialWidth) / initialHeight));
  };

  return (
    <Modal
      title="Taille de l’image"
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel}>
            Annuler
          </button>
          <button type="button" className="primary" disabled={unchanged} onClick={() => onApply({ mode, width, height, anchor })}>
            <Icon name="check" />
            Appliquer
          </button>
        </>
      }
    >
      <div className="segmented" role="group" aria-label="Mode">
        <button type="button" className={mode === 'canvas' ? 'active' : ''} aria-pressed={mode === 'canvas'} onClick={() => setMode('canvas')}>
          <Icon name="crop" />
          Toile (agrandir, recadrer)
        </button>
        <button type="button" className={mode === 'scale' ? 'active' : ''} aria-pressed={mode === 'scale'} onClick={() => setMode('scale')}>
          <Icon name="resize" />
          Mise à l’échelle
        </button>
      </div>
      <p className="muted small">
        {mode === 'canvas'
          ? 'Les pixels gardent leur taille : la toile s’agrandit (bords transparents) ou se recadre autour du point d’ancrage.'
          : `Chaque pixel est agrandi ou réduit au plus proche voisin${NBSP}: l’image reste nette.`}
      </p>
      <div className="field-row">
        <NumberField label="Largeur" value={width} min={1} max={MAX_PIXEL_SIZE} onChange={changeWidth} />
        <NumberField label="Hauteur" value={height} min={1} max={MAX_PIXEL_SIZE} onChange={changeHeight} />
      </div>
      {mode === 'scale' ? (
        <label className="checkbox">
          <input type="checkbox" checked={keepRatio} onChange={(event) => setKeepRatio(event.target.checked)} />
          Garder les proportions
        </label>
      ) : (
        <div className="field">
          <span className="field-label">Ancrage</span>
          <div className="pixel-anchor" role="radiogroup" aria-label="Ancrage">
            {ANCHOR_STEPS.map((y) =>
              ANCHOR_STEPS.map((x) => {
                const selected = anchor.x === x && anchor.y === y;
                return (
                  <button
                    key={`${x},${y}`}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={ANCHOR_LABELS[`${x},${y}`]}
                    title={ANCHOR_LABELS[`${x},${y}`]}
                    className={selected ? 'active' : ''}
                    onClick={() => setAnchor({ x, y })}
                  >
                    {selected && <span className="pixel-anchor-dot" />}
                  </button>
                );
              }),
            )}
          </div>
        </div>
      )}
      <p className="muted small">
        {initialWidth} × {initialHeight} px → {width} × {height} px
      </p>
    </Modal>
  );
}
