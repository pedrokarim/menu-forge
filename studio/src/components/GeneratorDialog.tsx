import { useEffect, useRef, useState } from 'react';
import { GENERATOR_PRESETS, PANEL_STYLE_LABELS } from '../model/generator';
import {
  BUTTON_STATE_LABELS,
  DEFAULT_TILE,
  MCRS_COLORS,
  MCRS_PARAMS,
  MCRS_PRESETS,
  MCRS_STYLE_LABELS,
  isMcrsStyle,
  mcrsNumber,
} from '../model/mcrs';
import { ID_PATTERN } from '../model/menu';
import type { ButtonState, CellStyle, GeneratorSpec, GeneratorStyle, SlotArea } from '../model/menu';
import { defaultCellColor, imageToCanvas, renderGeneratorImage } from '../model/textureRender';
import { Icon } from '../ui/Icon';
import { Field, FieldError, Modal, NumberField } from './fields';
import './generator.css';

/** Modèles des deux familles, dans l’ordre du sélecteur (Deepslate puis mc-rs). */
const ALL_PRESETS = [...GENERATOR_PRESETS, ...MCRS_PRESETS];

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
  const mcrs = isMcrsStyle(spec.style) ? spec.style : null;
  const params = mcrs ? MCRS_PARAMS[mcrs] : [];
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
              <optgroup label="Deepslate">
                {GENERATOR_PRESETS.map((preset, index) => (
                  <option key={preset.label} value={index}>
                    {preset.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="mc-rs">
                {MCRS_PRESETS.map((preset, index) => (
                  <option key={preset.label} value={GENERATOR_PRESETS.length + index}>
                    {preset.label}
                  </option>
                ))}
              </optgroup>
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
              <optgroup label="Deepslate">
                {Object.entries(PANEL_STYLE_LABELS).map(([style, label]) => (
                  <option key={style} value={style}>
                    {label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="mc-rs">
                {Object.entries(MCRS_STYLE_LABELS).map(([style, label]) => (
                  <option key={style} value={style}>
                    {label}
                  </option>
                ))}
              </optgroup>
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
          {mcrs && (
            <fieldset className="generator-params">
              <legend>Paramètres mc-rs</legend>
              <div className="field-row">
                {params.includes('radius') && (
                  <NumberField
                    label="Rayon des coins"
                    value={spec.radius ?? mcrsNumber(mcrs, spec, 'radius')}
                    min={0}
                    max={32}
                    onChange={(value) => setParam('radius', clampInt(value, 0, 32))}
                  />
                )}
                {params.includes('borderWidth') && (
                  <NumberField
                    label="Bordure (px)"
                    value={spec.borderWidth ?? mcrsNumber(mcrs, spec, 'borderWidth')}
                    min={0}
                    max={32}
                    onChange={(value) => setParam('borderWidth', clampInt(value, 0, 32))}
                  />
                )}
                {params.includes('shadow') && (
                  <NumberField
                    label="Ombre (px)"
                    value={spec.shadow ?? mcrsNumber(mcrs, spec, 'shadow')}
                    min={0}
                    max={32}
                    onChange={(value) => setParam('shadow', clampInt(value, 0, 32))}
                  />
                )}
                {params.includes('tile') && (
                  <NumberField
                    label="Côté des cases (px)"
                    value={spec.tile ?? DEFAULT_TILE}
                    min={2}
                    max={64}
                    onChange={(value) => setParam('tile', clampInt(value, 2, 64))}
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
                      value={(spec.accent ?? MCRS_COLORS.gold).slice(0, 7)}
                      onChange={(event) => setParam('accent', event.target.value)}
                    />
                    <input value={spec.accent ?? MCRS_COLORS.gold} onChange={(event) => setParam('accent', event.target.value)} />
                  </div>
                </Field>
              )}
              {params.includes('borderColor') && (
                <div className="field">
                  <span className="field-label">{mcrs === 'mcrs_grid' ? 'Couleur des lignes' : 'Couleur de bordure'}</span>
                  <div className="color-input generator-optional-color">
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={Boolean(spec.borderColor)}
                        onChange={(event) => setParam('borderColor', event.target.checked ? MCRS_COLORS.panelBorder : undefined)}
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
                      <span className="muted small">calculée depuis la couleur</span>
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
