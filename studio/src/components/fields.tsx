import { useState } from 'react';
import type { ReactNode } from 'react';

/** Champs de formulaire partagés par l’inspecteur et les dialogues. */

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (event.target.value !== '' && Number.isFinite(next)) onChange(Math.round(next));
        }}
      />
    </Field>
  );
}

/** Champ texte validé à la sortie du champ (ou sur Entrée), pour les renommages. */
export function CommitField({
  label,
  value,
  onCommit,
  validate,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  validate?: (value: string) => string | null;
}) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  // Resynchronise le brouillon quand la valeur change de l’extérieur (annuler, autre sélection).
  const [base, setBase] = useState(value);
  if (base !== value) {
    setBase(value);
    setText(value);
    setError(null);
  }

  const commit = () => {
    if (text === value) return;
    const problem = validate?.(text) ?? null;
    setError(problem);
    if (!problem) onCommit(text);
  };

  return (
    <Field label={label}>
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setText(value);
        }}
      />
      {error && <span className="field-error">{error}</span>}
    </Field>
  );
}

/** Édition JSON libre, validée à la sortie du champ. Vide = valeur absente. */
export function JsonField<T>({
  label,
  value,
  onCommit,
  rows = 4,
  placeholder,
}: {
  label: string;
  value: T | undefined;
  onCommit: (value: T | undefined) => void;
  rows?: number;
  placeholder?: string;
}) {
  const serialized = value === undefined ? '' : JSON.stringify(value, null, 2);
  const [text, setText] = useState(serialized);
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState(serialized);
  if (base !== serialized) {
    setBase(serialized);
    setText(serialized);
    setError(null);
  }

  const commit = () => {
    if (text === serialized) return;
    if (text.trim() === '') {
      setError(null);
      onCommit(undefined);
      return;
    }
    try {
      onCommit(JSON.parse(text) as T);
      setError(null);
    } catch {
      setError('JSON invalide');
    }
  };

  return (
    <Field label={label}>
      <textarea
        className="code"
        value={text}
        rows={rows}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
      />
      {error && <span className="field-error">{error}</span>}
    </Field>
  );
}

export function Modal({
  title,
  children,
  footer,
  onClose,
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
        <footer className="modal-footer">{footer}</footer>
      </div>
    </div>
  );
}
