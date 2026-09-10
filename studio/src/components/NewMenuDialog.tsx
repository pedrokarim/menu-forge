import { useState } from 'react';
import { MAX_ROWS } from '../model/geometry';
import { ID_PATTERN, sanitizeId } from '../model/menu';
import type { MenuDefinition } from '../model/menu';
import { Icon } from '../ui/Icon';
import { Field, FieldError, Modal, NumberField } from './fields';

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

  const card = (key: string, title: string, description: string) => {
    const selected = templateId === key;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        key={key || 'blank'}
        className={`template-card ${selected ? 'selected' : ''}`}
        onClick={() => setTemplateId(key)}
      >
        <strong>
          {title}
          {selected && <Icon name="check" className="template-check" />}
        </strong>
        <span className="muted small">{description}</span>
      </button>
    );
  };

  return (
    <Modal
      title="Nouveau menu"
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
      <div className="template-gallery" role="radiogroup" aria-label="Point de départ">
        {card('', 'Vierge', 'Un coffre vide, sans couche.')}
        {templates.map((candidate) => {
          const layerCount = candidate.layers.length;
          const slotCount = (candidate.slots ?? []).length;
          return card(
            candidate.id,
            candidate.name,
            `${candidate.template ? 'Gabarit partiel, à hériter' : 'Écran complet'} · ${layerCount} couche${
              layerCount > 1 ? 's' : ''
            } · ${slotCount} slot${slotCount > 1 ? 's' : ''}`,
          );
        })}
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
          className="mono"
          value={id}
          onChange={(event) => {
            setIdTouched(true);
            setId(event.target.value);
          }}
        />
        {idError && <FieldError>{idError}</FieldError>}
      </Field>
      {!template && (
        <NumberField label="Lignes du coffre" value={rows} min={1} max={MAX_ROWS} onChange={(value) => setRows(Math.min(MAX_ROWS, Math.max(1, value)))} />
      )}
    </Modal>
  );
}
