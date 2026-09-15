import { useEffect, useRef } from 'react';
import { Modal } from '../components/fields';
import { NBSP } from '../lib/format';
import { answered, useQuestion } from './dialogs';
import type { ConfirmQuestion, UnsavedChoice, UnsavedQuestion } from './dialogs';
import { Icon } from './Icon';

/** Affiche les questions de `dialogs.ts`, une à la fois ; fermer le dialogue vaut « Annuler ». */
export function DialogHost() {
  const question = useQuestion();
  if (!question) return null;
  return question.kind === 'unsaved' ? <UnsavedDialog key={questionKey(question)} question={question} /> : <ConfirmDialog question={question} />;
}

function questionKey(question: UnsavedQuestion): string {
  return `${question.action}:${question.documents.join('|')}`;
}

function UnsavedDialog({ question }: { question: UnsavedQuestion }) {
  const saveButton = useRef<HTMLButtonElement>(null);
  const reply = (choice: UnsavedChoice) => {
    answered(question);
    question.resolve(choice);
  };
  // Entrée enregistre (bouton principal focalisé), Échap annule.
  useEffect(() => {
    saveButton.current?.focus();
  }, []);
  const { documents, discardOnly } = question;
  const single = documents.length === 1;
  return (
    <Modal
      title={question.action}
      onClose={() => reply('cancel')}
      footer={
        <>
          <button type="button" onClick={() => reply('cancel')}>
            Annuler
          </button>
          <button type="button" className={discardOnly ? 'danger' : undefined} onClick={() => reply('discard')}>
            <Icon name="trash" />
            {discardOnly ? 'Abandonner les modifications' : 'Ne pas enregistrer'}
          </button>
          {!discardOnly && (
            <button ref={saveButton} type="button" className="primary" onClick={() => reply('save')}>
              <Icon name="save" />
              {single ? 'Enregistrer' : 'Tout enregistrer'}
            </button>
          )}
        </>
      }
    >
      <div className="unsaved-dialog">
        <Icon name="warning" size={36} />
        <div>
          {single ? (
            <p>
              «{NBSP}
              <strong>{documents[0]}</strong>
              {NBSP}» a des modifications non enregistrées.
            </p>
          ) : (
            <>
              <p>{documents.length} documents ont des modifications non enregistrées{NBSP}:</p>
              <ul>
                {documents.map((name, index) => (
                  <li key={`${name}-${index}`}>
                    <strong>{name}</strong>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="muted">
            {discardOnly
              ? 'Ces modifications n’existent que dans le studio : elles seront perdues.'
              : 'Sans enregistrement, les modifications seront perdues.'}
          </p>
        </div>
      </div>
    </Modal>
  );
}

function ConfirmDialog({ question }: { question: ConfirmQuestion }) {
  const reply = (confirmed: boolean) => {
    answered(question);
    question.resolve(confirmed);
  };
  return (
    <Modal
      title={question.title}
      onClose={() => reply(false)}
      footer={
        <>
          <button type="button" onClick={() => reply(false)}>
            Annuler
          </button>
          <button type="button" className={question.danger ? 'danger' : 'primary'} onClick={() => reply(true)}>
            {question.confirmLabel}
          </button>
        </>
      }
    >
      <p>{question.message}</p>
    </Modal>
  );
}
