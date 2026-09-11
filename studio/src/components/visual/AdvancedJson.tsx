import { useState } from 'react';
import { Icon } from '../../ui/Icon';
import { FieldError } from '../fields';

/**
 * Accès « Avancé (JSON) » replié sous un éditeur visuel : édition libre,
 * validée à la sortie du champ (JSON bien formé, puis forme attendue). Vide =
 * valeur absente.
 */
export function AdvancedJson<T>({
  value,
  onCommit,
  validate,
  rows = 4,
  label = 'Avancé (JSON)',
}: {
  value: T | undefined;
  onCommit: (value: T | undefined) => void;
  /** Raison du refus d’une valeur bien formée, ou `null`. */
  validate?: (parsed: unknown) => string | null;
  rows?: number;
  label?: string;
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError('JSON invalide');
      return;
    }
    const problem = validate?.(parsed) ?? null;
    setError(problem);
    if (!problem) onCommit(parsed as T);
  };

  return (
    <details className="advanced-json" open={error !== null || undefined}>
      <summary>
        <Icon name="braces" />
        {label}
      </summary>
      <textarea
        className="code"
        value={text}
        rows={rows}
        spellCheck={false}
        aria-label={label}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
      />
      {error && <FieldError>{error}</FieldError>}
    </details>
  );
}
