import { useState } from 'react';
import { ID_PATTERN, sanitizeId, uniqueId } from '../../model/menu';
import { Icon } from '../../ui/Icon';
import { Field, FieldError, Modal } from '../fields';

export interface NewComponentInput {
  id: string;
  name: string;
}

interface NewComponentDialogProps {
  /** Nombre d’éléments sélectionnés qui partiront dans le composant. */
  count: number;
  existingIds: string[];
  onCancel: () => void;
  onCreate: (input: NewComponentInput) => Promise<void>;
}

/** « Créer un composant avec la sélection » : nom et identifiant du nouveau composant. */
export function NewComponentDialog({ count, existingIds, onCancel, onCreate }: NewComponentDialogProps) {
  const [name, setName] = useState('Composant');
  const [id, setId] = useState(() => uniqueId('component', existingIds));
  const [idTouched, setIdTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  let idError: string | null = null;
  if (!ID_PATTERN.test(id)) idError = 'Lettres minuscules, chiffres et _ uniquement';
  else if (existingIds.includes(id)) idError = 'Un menu porte déjà cet identifiant';

  const create = async () => {
    if (idError) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ id, name: name.trim() || id });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Nouveau composant"
      onClose={onCancel}
      footer={
        <>
          {error && <FieldError>{error}</FieldError>}
          <button type="button" onClick={onCancel}>
            Annuler
          </button>
          <button type="button" className="primary" disabled={busy || Boolean(idError)} onClick={() => void create()}>
            <Icon name={busy ? 'loader' : 'component'} />
            {busy ? 'Création…' : 'Créer le composant'}
          </button>
        </>
      }
    >
      <p className="muted small">
        Les {count} éléments sélectionnés partent dans un nouveau fichier de composant ; ce menu en garde une instance, au même
        endroit. Tout menu peut ensuite l’inclure, et chaque instance suit les modifications du composant.
      </p>
      <div className="field-row">
        <Field label="Nom">
          <input
            value={name}
            autoFocus
            onChange={(event) => {
              setName(event.target.value);
              if (!idTouched) setId(uniqueId(sanitizeId(event.target.value), existingIds));
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create();
            }}
          />
        </Field>
        <Field label="Identifiant" hint="Nom du fichier">
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
    </Modal>
  );
}
