import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';

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

/** Message d’erreur de champ, précédé du picto d’alerte. */
export function FieldError({ children }: { children: ReactNode }) {
  return (
    <span className="field-error">
      <Icon name="alert" />
      {children}
    </span>
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
      {error && <FieldError>{error}</FieldError>}
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
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

export function Modal({
  title,
  children,
  footer,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  /** Dialogue plus large (aide-mémoire des raccourcis). */
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Le focus entre dans le dialogue à l’ouverture (Échap et Tab y agissent aussitôt),
  // puis revient à l’élément qui l’avait ouvert.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => opener?.focus();
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      onKeyDown={(event) => {
        // Aucune touche tapée dans un dialogue n’atteint les raccourcis de l’éditeur en dessous
        // (Suppr, flèches, Ctrl+Z…) ; Échap le ferme.
        event.stopPropagation();
        if (event.key === 'Escape') onClose();
      }}
    >
      <div ref={dialogRef} className={wide ? 'modal modal-wide' : 'modal'} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <header className="modal-header">
          <h2>{title}</h2>
          <IconButton icon="close" label="Fermer" shortcut="Échap" variant="ghost" size={24} onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        <footer className="modal-footer">{footer}</footer>
      </div>
    </div>
  );
}
