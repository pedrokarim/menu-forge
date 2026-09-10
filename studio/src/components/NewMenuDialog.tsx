import { useState } from 'react';
import { MAX_ROWS } from '../model/geometry';
import { ID_PATTERN, sanitizeId } from '../model/menu';
import type { MenuDefinition } from '../model/menu';
import { Field, Modal, NumberField } from './fields';

export interface NewMenuInput {
  id: string;
  name: string;
  rows: number;
  template: MenuDefinition | null;
}

interface NewMenuDialogProps {
  templates: MenuDefinition[];
  existingIds: string[];
  onCancel: () => void;
  onCreate: (input: NewMenuInput) => Promise<void>;
}

/** Création d’un menu, vierge ou à partir d’un gabarit fourni. */
export function NewMenuDialog({ templates, existingIds, onCancel, onCreate }: NewMenuDialogProps) {
  const [name, setName] = useState('Mon menu');
  const [id, setId] = useState('mon_menu');
  const [idTouched, setIdTouched] = useState(false);
  const [rows, setRows] = useState(6);
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = templates.find((candidate) => candidate.id === templateId) ?? null;
  let idError: string | null = null;
  if (!ID_PATTERN.test(id)) idError = 'Lettres minuscules, chiffres et _ uniquement';
  else if (existingIds.includes(id)) idError = 'Un menu porte déjà cet identifiant';

  const create = async () => {
    if (idError) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ id, name, rows: template?.container.rows ?? rows, template });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Nouveau menu"
      onClose={onCancel}
      footer={
        <>
          {error && <span className="field-error">{error}</span>}
          <button type="button" onClick={onCancel}>
            Annuler
          </button>
          <button type="button" className="primary" disabled={busy || Boolean(idError)} onClick={() => void create()}>
            {busy ? 'Création…' : 'Créer'}
          </button>
        </>
      }
    >
      <div className="template-gallery" role="radiogroup" aria-label="Point de départ">
        <button
          type="button"
          role="radio"
          aria-checked={templateId === ''}
          className={`template-card ${templateId === '' ? 'selected' : ''}`}
          onClick={() => setTemplateId('')}
        >
          <strong>Vierge</strong>
          <span className="muted small">Un coffre vide, sans couche.</span>
        </button>
        {templates.map((candidate) => (
          <button
            type="button"
            role="radio"
            aria-checked={templateId === candidate.id}
            key={candidate.id}
            className={`template-card ${templateId === candidate.id ? 'selected' : ''}`}
            onClick={() => setTemplateId(candidate.id)}
          >
            <strong>{candidate.name}</strong>
            <span className="muted small">
              {candidate.template ? 'Gabarit partiel, à hériter' : 'Écran complet'} · {candidate.layers.length} couche
              {candidate.layers.length > 1 ? 's' : ''} · {(candidate.slots ?? []).length} slot
              {(candidate.slots ?? []).length > 1 ? 's' : ''}
            </span>
          </button>
        ))}
      </div>
      <Field label="Nom">
        <input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (!idTouched) setId(sanitizeId(event.target.value));
          }}
        />
      </Field>
      <Field label="Identifiant" hint="Nom du fichier et de la police générée">
        <input
          value={id}
          onChange={(event) => {
            setIdTouched(true);
            setId(event.target.value);
          }}
        />
        {idError && <span className="field-error">{idError}</span>}
      </Field>
      {!template && (
        <NumberField label="Lignes du coffre" value={rows} min={1} max={MAX_ROWS} onChange={(value) => setRows(Math.min(MAX_ROWS, Math.max(1, value)))} />
      )}
    </Modal>
  );
}
