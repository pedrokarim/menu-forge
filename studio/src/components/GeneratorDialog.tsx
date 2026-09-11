import { useEffect, useRef, useState } from 'react';
import { NBSP } from '../lib/format';
import { BUTTON_STATE_LABELS } from '../model/mcrs';
import { ID_PATTERN } from '../model/menu';
import type { ButtonState, CellStyle, GeneratorSpec, GeneratorStyle, SlotArea } from '../model/menu';
import {
  PRESETS_BY_FAMILY,
  STYLE_FAMILY_NAMES,
  STYLE_FAMILY_ORDER,
  STYLE_LABELS,
  defaultAccent,
  defaultBorderColor,
  defaultCellColor,
  imageToCanvas,
  paramNumber,
  renderGeneratorImage,
  styleFamily,
  styleParams,
} from '../model/textureRender';
import type { StyleFamilyId } from '../model/textureRender';
import { Icon } from '../ui/Icon';
import { Field, FieldError, Modal, NumberField } from './fields';
import './generator.css';

/** Modèles des trois familles, dans l’ordre du sélecteur (Deepslate, mc-rs, sombre à accent). */
const ALL_PRESETS = STYLE_FAMILY_ORDER.flatMap((family) => PRESETS_BY_FAMILY[family]);

/** Rang du premier modèle de chaque famille dans `ALL_PRESETS`. */
const PRESET_OFFSETS = Object.fromEntries(
  STYLE_FAMILY_ORDER.map((family, index) => [
    family,
    STYLE_FAMILY_ORDER.slice(0, index).reduce((sum, previous) => sum + PRESETS_BY_FAMILY[previous].length, 0),
  ]),
) as Record<StyleFamilyId, number>;

const PARAMS_LEGEND: Record<StyleFamilyId, string> = {
  deepslate: '',
  mcrs: 'Paramètres mc-rs',
  dark: `Paramètres «${NBSP}sombre à accent${NBSP}»`,
};

function borderColorLabel(style: GeneratorStyle): string {
  if (style === 'mcrs_grid') return 'Couleur des lignes';
  if (style === 'dark_awning') return 'Seconde bande';
  if (style === 'dark_close') return 'Couleur de la croix';
  return 'Couleur de bordure';
}

/** Garde les cellules de la spécification courante quand on change de modèle. */
function keepCells(next: GeneratorSpec, current: GeneratorSpec): GeneratorSpec {
  const spec: GeneratorSpec = { ...next };
  if (current.cells) spec.cells = current.cells;
  if (current.cellColor) spec.cellColor = current.cellColor;
  if (current.cellStyle) spec.cellStyle = current.cellStyle;
  return spec;
}

const clampInt = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

export interface GeneratorResult {
  layerId: string;
  x: number;
  y: number;
  spec: GeneratorSpec;
}

interface GeneratorDialogProps {
  mode: 'create' | 'edit';
  initial: GeneratorResult;
  rows: number;
  takenIds: string[];
  onCancel: () => void;
  onConfirm: (result: GeneratorResult) => Promise<void>;
}

const PREVIEW_MAX = 320;

/** Dialogue du générateur procédural : panneaux, boutons, cellules, voiles. */
export function GeneratorDialog({ mode, initial, rows, takenIds, onCancel, onConfirm }: GeneratorDialogProps) {
  const [layerId, setLayerId] = useState(initial.layerId);
  const [x, setX] = useState(initial.x);
  const [y, setY] = useState(initial.y);
  const [spec, setSpec] = useState<GeneratorSpec>(initial.spec);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const target = previewRef.current;
    const ctx = target?.getContext('2d');
    if (!target || !ctx) return;
    const source = imageToCanvas(renderGeneratorImage(spec, { x, y }));
    const scale = Math.max(1, Math.min(6, Math.floor(PREVIEW_MAX / Math.max(source.width, source.height))));
    target.width = source.width * scale;
    target.height = source.height * scale;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, target.width, target.height);
  }, [spec, x, y]);

  const cells = spec.cells?.[0];
  const setCells = (next: SlotArea | undefined) => setSpec({ ...spec, cells: next ? [next] : undefined });
  const family = styleFamily(spec.style);
  const params = styleParams(spec.style);
  /** Pose ou retire un paramètre (une clé absente reprend la valeur par défaut du style). */
  const setParam = <K extends keyof GeneratorSpec>(key: K, value: GeneratorSpec[K] | undefined) => {
    const next = { ...spec };
    if (value === undefined) delete next[key];
    else next[key] = value;
    setSpec(next);
  };
  const cellStyle = spec.cellStyle ?? 'cell';

  let idError: string | null = null;
  if (mode === 'create') {
    if (!ID_PATTERN.test(layerId)) idError = 'Lettres minuscules, chiffres et _ uniquement';
    else if (takenIds.includes(layerId)) idError = 'Identifiant déjà utilisé';
  }

  const confirm = async () => {
    if (idError) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ layerId, x, y, spec });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={mode === 'create' ? 'Générer une texture' : 'Modifier la texture générée'}
      onClose={onCancel}
      footer={
        <>
          {error && <FieldError>{error}</FieldError>}
          <button type="button" onClick={onCancel}>
            Annuler
          </button>
          <button type="button" className="primary" disabled={busy || Boolean(idError)} onClick={() => void confirm()}>
            <Icon name={busy ? 'loader' : 'sparkles'} />
            {busy ? 'Génération…' : mode === 'create' ? 'Créer la couche' : 'Mettre à jour'}
          </button>
        </>
      }
    >
      <div className="generator">
        <div className="generator-form">
          <Field label="Modèle">
            <select
              value=""
              onChange={(event) => {
                const preset = ALL_PRESETS[Number(event.target.value)];
                if (preset) setSpec(keepCells(preset.spec, spec));
              }}
            >
              <option value="">Partir d’un modèle…</option>
              {STYLE_FAMILY_ORDER.map((familyId) => (
                <optgroup key={familyId} label={STYLE_FAMILY_NAMES[familyId]}>
                  {PRESETS_BY_FAMILY[familyId].map((preset, index) => (
                    <option key={preset.label} value={PRESET_OFFSETS[familyId] + index}>
                      {preset.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          {mode === 'create' ? (
            <Field label="Identifiant de la couche">
              <input className="mono" value={layerId} onChange={(event) => setLayerId(event.target.value)} />
              {idError && <FieldError>{idError}</FieldError>}
            </Field>
          ) : (
            <p className="muted">Couche « {layerId} »</p>
          )}
          <Field label="Style">
            <select value={spec.style} onChange={(event) => setSpec({ ...spec, style: event.target.value as GeneratorStyle })}>
              {STYLE_FAMILY_ORDER.map((familyId) => (
                <optgroup key={familyId} label={STYLE_FAMILY_NAMES[familyId]}>
                  {Object.entries(STYLE_LABELS[familyId]).map(([style, label]) => (
                    <option key={style} value={style}>
                      {label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <div className="field-row">
            <NumberField label="Largeur" value={spec.width} min={1} max={256} onChange={(width) => setSpec({ ...spec, width })} />
            <NumberField label="Hauteur" value={spec.height} min={1} max={256} onChange={(height) => setSpec({ ...spec, height })} />
          </div>
          <div className="field-row">
            <NumberField label="Position x" value={x} onChange={setX} />
            <NumberField label="Position y" value={y} onChange={setY} />
          </div>
          <Field label="Couleur" hint="#rrggbb, ou #rrggbbaa pour la transparence">
            <div className="color-input">
              <input
                type="color"
                value={spec.color.slice(0, 7)}
                onChange={(event) => setSpec({ ...spec, color: event.target.value + spec.color.slice(7) })}
              />
              <input value={spec.color} onChange={(event) => setSpec({ ...spec, color: event.target.value })} />
            </div>
          </Field>
          {params.length > 0 && (
            <fieldset className="generator-params">
              <legend>{PARAMS_LEGEND[family]}</legend>
              <div className="field-row">
                {params.includes('radius') && (
                  <NumberField
                    label="Rayon des coins"
                    value={paramNumber(spec.style, spec, 'radius')}
                    min={0}
                    max={32}
                    onChange={(value) => setParam('radius', clampInt(value, 0, 32))}
                  />
                )}
                {params.includes('borderWidth') && (
                  <NumberField
                    label="Bordure (px)"
                    value={paramNumber(spec.style, spec, 'borderWidth')}
                    min={0}
                    max={32}
                    onChange={(value) => setParam('borderWidth', clampInt(value, 0, 32))}
                  />
                )}
                {params.includes('shadow') && (
                  <NumberField
                    label="Ombre (px)"
                    value={paramNumber(spec.style, spec, 'shadow')}
                    min={0}
                    max={32}
                    onChange={(value) => setParam('shadow', clampInt(value, 0, 32))}
                  />
                )}
                {params.includes('tile') && (
                  <NumberField
                    label={spec.style === 'dark_awning' ? 'Largeur des bandes (px)' : 'Côté des cases (px)'}
                    value={paramNumber(spec.style, spec, 'tile')}
                    min={2}
                    max={64}
                    onChange={(value) => setParam('tile', clampInt(value, 2, 64))}
                  />
                )}
                {params.includes('progress') && (
                  <NumberField
                    label="Progression (%)"
                    value={paramNumber(spec.style, spec, 'progress')}
                    min={0}
                    max={100}
                    onChange={(value) => setParam('progress', clampInt(value, 0, 100))}
                  />
                )}
                {params.includes('state') && (
                  <Field label="État">
                    <select value={spec.state ?? 'normal'} onChange={(event) => setParam('state', event.target.value as ButtonState)}>
                      {Object.entries(BUTTON_STATE_LABELS).map(([state, label]) => (
                        <option key={state} value={state}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>
              {params.includes('accent') && (
                <Field label="Accent" hint="Bordure du survol, fond et bordure du pressé">
                  <div className="color-input">
                    <input
                      type="color"
                      value={(spec.accent ?? defaultAccent(spec.style)).slice(0, 7)}
                      onChange={(event) => setParam('accent', event.target.value)}
                    />
                    <input value={spec.accent ?? defaultAccent(spec.style)} onChange={(event) => setParam('accent', event.target.value)} />
                  </div>
                </Field>
              )}
              {params.includes('borderColor') && (
                <div className="field">
                  <span className="field-label">{borderColorLabel(spec.style)}</span>
                  <div className="color-input generator-optional-color">
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={Boolean(spec.borderColor)}
                        onChange={(event) => setParam('borderColor', event.target.checked ? defaultBorderColor(spec.style) : undefined)}
                      />
                      Personnalisée
                    </label>
                    {spec.borderColor ? (
                      <input
                        type="color"
                        aria-label="Couleur de bordure"
                        value={spec.borderColor.slice(0, 7)}
                        onChange={(event) => setParam('borderColor', event.target.value)}
                      />
                    ) : (
                      <span className="muted small">
                        {spec.style === 'dark_awning' || spec.style === 'dark_close' ? 'blanc par défaut' : 'calculée depuis la couleur'}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </fieldset>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={Boolean(cells)}
              onChange={(event) => setCells(event.target.checked ? { col: 0, row: 0, width: 9, height: rows } : undefined)}
            />
            Dessiner des cellules de slots
          </label>
          {cells && (
            <>
              <div className="field-row">
                <NumberField label="Colonne" value={cells.col} min={0} max={8} onChange={(col) => setCells({ ...cells, col })} />
                <NumberField label="Ligne" value={cells.row} min={0} max={rows - 1} onChange={(row) => setCells({ ...cells, row })} />
              </div>
              <div className="field-row">
                <NumberField label="Largeur (cases)" value={cells.width ?? 1} min={1} max={9} onChange={(width) => setCells({ ...cells, width })} />
                <NumberField label="Hauteur (cases)" value={cells.height ?? 1} min={1} max={rows} onChange={(height) => setCells({ ...cells, height })} />
              </div>
              <div className="field-row">
                <Field label="Style des cellules">
                  <select
                    value={cellStyle}
                    onChange={(event) => {
                      const next = { ...spec, cellStyle: event.target.value as CellStyle };
                      delete next.cellColor;
                      setSpec(next);
                    }}
                  >
                    <option value="cell">Cellule Deepslate</option>
                    <option value="mcrs_slot">Case sombre mc-rs</option>
                    <option value="dark_slot">Case creusée (sombre à accent)</option>
                  </select>
                </Field>
                <Field label="Couleur des cellules">
                  <input
                    type="color"
                    value={(spec.cellColor ?? defaultCellColor(cellStyle)).slice(0, 7)}
                    onChange={(event) => setSpec({ ...spec, cellColor: event.target.value })}
                  />
                </Field>
              </div>
            </>
          )}
        </div>
        <div className="generator-preview">
          <canvas ref={previewRef} />
          <p className="muted small">
            {spec.width} × {spec.height} px
          </p>
        </div>
      </div>
    </Modal>
  );
}
