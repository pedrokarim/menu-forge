import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { DocumentType } from '../lib/appApi';
import { ID_PATTERN } from '../model/menu';
import { describeReference } from '../model/references';
import type { MenuReference } from '../model/references';
import { Icon } from '../ui/Icon';
import { Field, FieldError, Modal } from './fields';

interface RenameDocumentDialogProps {
  type: DocumentType;
  id: string;
  name: string;
  /** Identifiants déjà pris par les documents du même type. */
  existingIds: readonly string[];
  /** Menus qui font référence au menu renommé (`extends`, `open`). */
  references: readonly MenuReference[];
  onCancel: () => void;
  /** Lève une erreur en cas d’échec (affichée dans le dialogue). */
  onConfirm: (to: string, name: string, updateReferences: boolean) => Promise<void>;
}

/** Renommer un menu ou un asset : identifiant (fichier) et nom, avec l’avertissement des références. */
export function RenameDocumentDialog(props: RenameDocumentDialogProps) {
  const { type, references } = props;
  const [id, setId] = useState(props.id);
  const [name, setName] = useState(props.name);
  const [updateReferences, setUpdateReferences] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noun = type === 'menu' ? 'menu' : 'asset';

  let idError: string | null = null;
  if (!ID_PATTERN.test(id)) idError = 'Lettres minuscules, chiffres et _ uniquement';
  else if (id !== props.id && props.existingIds.includes(id)) idError = `Un ${noun} porte déjà cet identifiant`;
  const nameError = name.trim() ? null : 'Nom requis';
  const unchanged = id === props.id && name.trim() === props.name;
  const idChanged = id !== props.id;

  const submit = async () => {
    if (idError || nameError || unchanged || busy) return;
    setBusy(true);
    setError(null);
    try {
      await props.onConfirm(id, name.trim(), updateReferences);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };
  const onEnter = (event: KeyboardEvent) => {
    if (event.key === 'Enter') void submit();
  };

  return (
    <Modal
      title={`Renommer le ${noun} « ${props.name} »`}
      onClose={props.onCancel}
      footer={
        <>
          {error && <FieldError>{error}</FieldError>}
          <button type="button" onClick={props.onCancel}>
            Annuler
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || Boolean(idError) || Boolean(nameError) || unchanged}
            onClick={() => void submit()}
          >
            <Icon name={busy ? 'loader' : 'check'} />
            {busy ? 'Renommage…' : 'Renommer'}
          </button>
        </>
      }
    >
      <div className="field-row">
        <Field
          label="Identifiant"
          hint={type === 'menu' ? 'Nom du fichier et de la police générée' : 'Nom du fichier, du PNG exporté et du glyphe'}
        >
          <input className="mono" value={id} onChange={(event) => setId(event.target.value)} onKeyDown={onEnter} />
          {idError && <FieldError>{idError}</FieldError>}
        </Field>
        <Field label="Nom">
          <input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={onEnter} />
          {nameError && <FieldError>{nameError}</FieldError>}
        </Field>
      </div>
      {type === 'menu' && idChanged && references.length > 0 && (
        <div className="warning rename-references" role="note">
          <p>
            <Icon name="warning" /> {references.length > 1 ? `${references.length} menus font` : 'Un menu fait'} référence à
            «&nbsp;{props.id}&nbsp;»&nbsp;:
          </p>
          <ul>
            {references.map((reference) => (
              <li key={reference.id}>
                <strong>{reference.name}</strong> <span className="mono">({reference.id})</span> {describeReference(reference)}
              </li>
            ))}
          </ul>
          <label className="checkbox">
            <input type="checkbox" checked={updateReferences} onChange={(event) => setUpdateReferences(event.target.checked)} />
            Mettre à jour ces références (sinon elles viseront un menu introuvable)
          </label>
        </div>
      )}
      {type === 'asset' && idChanged && (
        <p className="field-hint">
          Le PNG exporté est recopié sous le nouveau nom ; l’ancien reste en place pour les menus qui l’utilisent comme couche.
        </p>
      )}
      {type === 'menu' && idChanged && (
        <p className="field-hint">Les textures générées du menu sont recopiées sous le nouveau nom ; les originales restent en place.</p>
      )}
    </Modal>
  );
}
