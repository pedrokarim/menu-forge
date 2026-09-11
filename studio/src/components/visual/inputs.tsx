import { useState } from 'react';
import type { StateDefinition, StateValue } from '../../model/menu';
import { Field, FieldError } from '../fields';

/** Petits champs des éditeurs visuels (valeurs d’état, nombres facultatifs, saisie validée). */

/** Champ texte validé à la sortie (ou sur Entrée) ; Échap annule la saisie. Sans libellé : à placer dans une ligne. */
export function InlineCommitInput({
  value,
  onCommit,
  validate,
  className,
  placeholder,
  label,
}: {
  value: string;
  onCommit: (value: string) => void;
  validate?: (value: string) => string | null;
  className?: string;
  placeholder?: string;
  /** Nom accessible du champ. */
  label: string;
}) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState(value);
  if (base !== value) {
    setBase(value);
    setText(value);
    setError(null);
  }
  const commit = () => {
    if (text === value) {
      setError(null);
      return;
    }
    const problem = validate?.(text) ?? null;
    setError(problem);
    if (!problem) onCommit(text);
  };
  return (
    <span className="inline-commit">
      <input
        className={className}
        value={text}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') {
            event.stopPropagation();
            setText(value);
            setError(null);
          }
        }}
      />
      {error && <FieldError>{error}</FieldError>}
    </span>
  );
}

/** Champ qui ajoute une valeur à une liste sur Entrée. */
export function AddValueInput({
  onAdd,
  validate,
  placeholder,
  label,
}: {
  onAdd: (value: string) => void;
  validate?: (value: string) => string | null;
  placeholder: string;
  label: string;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const value = text.trim();
    if (!value) return;
    const problem = validate?.(value) ?? null;
    setError(problem);
    if (problem) return;
    onAdd(value);
    setText('');
  };
  return (
    <span className="inline-commit">
      <input
        value={text}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => setText(event.target.value)}
        onBlur={add}
        onKeyDown={(event) => {
          if (event.key === 'Enter') add();
        }}
      />
      {error && <FieldError>{error}</FieldError>}
    </span>
  );
}

/** Nombre facultatif : vide = clé absente. */
export function OptionalNumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  integer = true,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  integer?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(event) => {
          if (event.target.value === '') {
            onChange(undefined);
            return;
          }
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(integer ? Math.round(next) : next);
        }}
      />
    </Field>
  );
}

/**
 * Valeur d’une variable d’état, avec le contrôle adapté à son type : liste
 * pour `enum`, case pour `bool`, nombre borné pour `int` et `page`, texte
 * libre si l’état est inconnu.
 */
export function StateValueInput({
  definition,
  value,
  onChange,
  label,
}: {
  definition: StateDefinition | undefined;
  value: StateValue | undefined;
  onChange: (value: StateValue) => void;
  label: string;
}) {
  if (!definition) {
    return <input value={value === undefined ? '' : String(value)} aria-label={label} onChange={(event) => onChange(event.target.value)} />;
  }
  switch (definition.type) {
    case 'enum': {
      const current = value === undefined ? '' : String(value);
      return (
        <select value={current} aria-label={label} onChange={(event) => onChange(event.target.value)}>
          {!definition.values.includes(current) && <option value={current}>{current || 'Choisir…'} (hors liste)</option>}
          {definition.values.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }
    case 'bool':
      return (
        <span className="checkbox state-bool">
          <input type="checkbox" aria-label={label} checked={value === true} onChange={(event) => onChange(event.target.checked)} />
          {value === true ? 'vrai' : 'faux'}
        </span>
      );
    case 'int':
    case 'page': {
      const min = definition.type === 'page' ? 1 : definition.min;
      const max = definition.type === 'page' ? undefined : definition.max;
      return (
        <input
          type="number"
          aria-label={label}
          value={typeof value === 'number' ? value : ''}
          min={min}
          max={max}
          step={1}
          title={min !== undefined || max !== undefined ? `De ${min ?? '−∞'} à ${max ?? '+∞'} (la lib ramène la valeur dans les bornes)` : undefined}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (event.target.value !== '' && Number.isFinite(next)) onChange(Math.round(next));
          }}
        />
      );
    }
  }
}
