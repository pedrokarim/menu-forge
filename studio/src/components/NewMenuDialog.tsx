import { Suspense, lazy, useState } from 'react';
import { FORM_LAYOUTS } from '../model/bedrockForm';
import { MAX_ROWS } from '../model/geometry';
import { ID_PATTERN, sanitizeId, uniqueId } from '../model/menu';
import type { FormLayout, MenuDefinition } from '../model/menu';
import { Icon } from '../ui/Icon';
import { Field, FieldError, Modal, NumberField } from './fields';

export interface NewMenuInput {
  id: string;
  name: string;
  rows: number;
  template: MenuDefinition | null;
  /** Formulaire Bedrock dans cette disposition, à la place d’un coffre. */
  form: FormLayout | null;
}

interface NewMenuDialogProps {
  templates: MenuDefinition[];
  existingIds: string[];
  /** Ouvrir directement le générateur d’interfaces (action rapide de l’accueil). */
  generate?: boolean;
  onCancel: () => void;
  onCreate: (input: NewMenuInput) => Promise<void>;
  /** Propose de décrire le menu à une IA plutôt que de partir d’un gabarit. */
  onGenerateWithAi?: () => void;
}

/** Générateur d’interfaces (styles, aperçu), chargé à sa première ouverture. */
const InterfaceGeneratorDialog = lazy(() =>
  import('./InterfaceGeneratorDialog').then((module) => ({ default: module.InterfaceGeneratorDialog })),
);

/** Création d’un menu, vierge, à partir d’un gabarit fourni ou généré, ou par IA. */
export function NewMenuDialog({ templates, existingIds, generate = false, onCancel, onCreate, onGenerateWithAi }: NewMenuDialogProps) {
  const [generating, setGenerating] = useState(generate);
  const [name, setName] = useState('Mon menu');
  // Identifiant proposé toujours libre : le dialogue ne s’ouvre jamais sur une erreur.
  const [id, setId] = useState(() => uniqueId('mon_menu', existingIds));
  const [idTouched, setIdTouched] = useState(false);
  const [rows, setRows] = useState(6);
  const [templateId, setTemplateId] = useState('');
  const [formLayout, setFormLayout] = useState<FormLayout | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = formLayout ? null : (templates.find((candidate) => candidate.id === templateId) ?? null);
  let idError: string | null = null;
  if (!ID_PATTERN.test(id)) idError = 'Lettres minuscules, chiffres et _ uniquement';
  else if (existingIds.includes(id)) idError = 'Un menu porte déjà cet identifiant';

  const create = async () => {
    if (idError) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ id, name, rows: template?.container.rows ?? rows, template, form: formLayout });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };

  const card = (key: string, title: string, description: string) => {
    const selected = formLayout === null && templateId === key;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        key={key || 'blank'}
        className={`template-card ${selected ? 'selected' : ''}`}
        onClick={() => {
          setTemplateId(key);
          setFormLayout(null);
        }}
      >
        <strong>
          {title}
          {selected && <Icon name="check" className="template-check" />}
        </strong>
        <span className="muted small">{description}</span>
      </button>
    );
  };

  if (generating) {
    return (
      <Suspense fallback={null}>
        <InterfaceGeneratorDialog
          existingIds={existingIds}
          onCancel={onCancel}
          onBack={generate ? undefined : () => setGenerating(false)}
          onCreate={onCreate}
        />
      </Suspense>
    );
  }

  return (
    <Modal
      title="Nouveau menu"
      onClose={onCancel}
      footer={
        <>
          {error && <FieldError>{error}</FieldError>}
          {onGenerateWithAi && (
            <button type="button" className="ghost" onClick={onGenerateWithAi}>
              <Icon name="sparkles" />
              Générer par IA…
            </button>
          )}
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
      <button type="button" className="template-card template-generate" onClick={() => setGenerating(true)}>
        <strong>
          <Icon name="sparkles" />
          Générer une interface…
        </strong>
        <span className="muted small">
          Boutique, grille, modale, liste paginée ou onglets, en style Deepslate, mc-rs ou sombre à accent, avec aperçu.
        </span>
      </button>
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
      <p className="field-label">Formulaire Bedrock&nbsp;: une disposition du pack mcrs_ui, sans rendu Java</p>
      <div className="template-gallery" role="radiogroup" aria-label="Formulaire Bedrock">
        {FORM_LAYOUTS.map((info) => {
          const selected = formLayout === info.layout;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              key={info.layout}
              className={`template-card ${selected ? 'selected' : ''}`}
              onClick={() => setFormLayout(info.layout)}
            >
              <strong>
                {info.label}
                {selected && <Icon name="check" className="template-check" />}
              </strong>
              <span className="muted small">{info.description}</span>
            </button>
          );
        })}
      </div>
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
      </div>
      {!template && !formLayout && (
        <NumberField label="Lignes du coffre" value={rows} min={1} max={MAX_ROWS} onChange={(value) => setRows(Math.min(MAX_ROWS, Math.max(1, value)))} />
      )}
    </Modal>
  );
}
