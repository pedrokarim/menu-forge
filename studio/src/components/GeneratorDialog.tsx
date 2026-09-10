import { useEffect, useRef, useState } from 'react';
import { GENERATOR_PRESETS, PANEL_STYLE_LABELS, renderGenerator } from '../model/generator';
import { ID_PATTERN } from '../model/menu';
import type { GeneratorSpec, PanelStyle, SlotArea } from '../model/menu';
import { Field, Modal, NumberField } from './fields';

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
    const source = renderGenerator(spec, { x, y });
    const scale = Math.max(1, Math.min(6, Math.floor(PREVIEW_MAX / Math.max(source.width, source.height))));
    target.width = source.width * scale;
    target.height = source.height * scale;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, target.width, target.height);
  }, [spec, x, y]);

  const cells = spec.cells?.[0];
  const setCells = (next: SlotArea | undefined) => setSpec({ ...spec, cells: next ? [next] : undefined });

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
          {error && <span className="field-error">{error}</span>}
          <button type="button" onClick={onCancel}>
            Annuler
          </button>
          <button type="button" className="primary" disabled={busy || Boolean(idError)} onClick={() => void confirm()}>
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
                const preset = GENERATOR_PRESETS[Number(event.target.value)];
                if (preset) setSpec({ ...preset.spec, cells: spec.cells, cellColor: spec.cellColor });
              }}
            >
              <option value="">Partir d’un modèle…</option>
              {GENERATOR_PRESETS.map((preset, index) => (
                <option key={preset.label} value={index}>
                  {preset.label}
                </option>
              ))}
            </select>
          </Field>
          {mode === 'create' ? (
            <Field label="Identifiant de la couche">
              <input value={layerId} onChange={(event) => setLayerId(event.target.value)} />
              {idError && <span className="field-error">{idError}</span>}
            </Field>
          ) : (
            <p className="muted">Couche « {layerId} »</p>
          )}
          <Field label="Style">
            <select value={spec.style} onChange={(event) => setSpec({ ...spec, style: event.target.value as PanelStyle })}>
              {Object.entries(PANEL_STYLE_LABELS).map(([style, label]) => (
                <option key={style} value={style}>
                  {label}
                </option>
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
              <Field label="Couleur des cellules">
                <input
                  type="color"
                  value={spec.cellColor ?? '#8b8b8b'}
                  onChange={(event) => setSpec({ ...spec, cellColor: event.target.value })}
                />
              </Field>
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
