import { useState } from 'react';
import { MAX_ASSET_SIZE } from '../asset/model';
import { ID_PATTERN, sanitizeId, uniqueId } from '../model/menu';
import { Icon } from '../ui/Icon';
import { Field, FieldError, Modal, NumberField } from './fields';

export interface NewAssetInput {
  id: string;
  name: string;
  width: number;
  height: number;
}

interface NewAssetDialogProps {
  existingIds: string[];
  onCancel: () => void;
  onCreate: (input: NewAssetInput) => Promise<void>;
}

const SIZE_PRESETS: Array<{ label: string; width: number; height: number }> = [
  { label: 'Encart (comme l’aide du menu pause)', width: 176, height: 44 },
  { label: 'Bulle de touche', width: 20, height: 16 },
  { label: 'Icône', width: 16, height: 16 },
  { label: 'Bannière', width: 256, height: 32 },
];

/** Création d’un asset du mode libre (composition figée exportée en PNG). */
export function NewAssetDialog({ existingIds, onCancel, onCreate }: NewAssetDialogProps) {
  const [name, setName] = useState('Mon asset');
  // Identifiant proposé toujours libre : le dialogue ne s’ouvre jamais sur une erreur.
  const [id, setId] = useState(() => uniqueId('mon_asset', existingIds));
  const [idTouched, setIdTouched] = useState(false);
  const [width, setWidth] = useState(176);
  const [height, setHeight] = useState(44);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  let idError: string | null = null;
  if (!ID_PATTERN.test(id)) idError = 'Lettres minuscules, chiffres et _ uniquement';
  else if (existingIds.includes(id)) idError = 'Un asset porte déjà cet identifiant';
  const clamp = (value: number) => Math.min(MAX_ASSET_SIZE, Math.max(1, value));

  const create = async () => {
    if (idError) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ id, name, width, height });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Nouvel asset"
      onClose={onCancel}
      footer={
        <>
          {error && <FieldError>{error}</FieldError>}
          <button type="button" onClick={onCancel}>
            Annuler
          </button>
          <button type="button" className="primary" disabled={busy || Boolean(idError)} onClick={() => void create()}>
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
              if (!idTouched) setId(uniqueId(sanitizeId(event.target.value), existingIds));
            }}
          />
        </Field>
        <Field label="Identifiant" hint="Nom du fichier, du PNG exporté et du glyphe proposé">
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
        <NumberField label="Largeur" value={width} min={1} max={MAX_ASSET_SIZE} onChange={(value) => setWidth(clamp(value))} />
        <NumberField label="Hauteur" value={height} min={1} max={MAX_ASSET_SIZE} onChange={(value) => setHeight(clamp(value))} />
      </div>
    </Modal>
  );
}
