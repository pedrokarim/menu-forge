import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Field } from '../components/fields';

/** Champs propres à l’éditeur d’assets (couleur, texture, choix segmenté). */

const HEX_COLOR = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Libellé de champ sans `<label>` (pour les groupes de boutons, qu’un label activerait). */
export function StaticField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

/** Couleur `#rrggbb` ou `#rrggbbaa` : pipette + saisie libre, appliquée dès qu’elle est valide. */
export function ColorField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  const [text, setText] = useState(value);
  const [base, setBase] = useState(value);
  if (base !== value) {
    setBase(value);
    setText(value);
  }
  const opaque = HEX_COLOR.test(value) ? value.slice(0, 7).toLowerCase() : '#000000';
  const alpha = HEX_COLOR.test(value) ? value.slice(7) : '';

  return (
    <Field label={label} hint={hint}>
      <div className="color-input">
        <input type="color" value={opaque} onChange={(event) => onChange(event.target.value + alpha)} />
        <input
          value={text}
          spellCheck={false}
          onChange={(event) => {
            setText(event.target.value);
            if (HEX_COLOR.test(event.target.value)) onChange(event.target.value.toLowerCase());
          }}
          onBlur={() => setText(value)}
        />
      </div>
      {!HEX_COLOR.test(text) && <span className="field-error">Format attendu : #rrggbb ou #rrggbbaa</span>}
    </Field>
  );
}

/** Choix d’une texture de l’espace de travail, avec recherche (liste proposée par le navigateur). */
export function TextureField({
  label,
  value,
  textures,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  textures: readonly string[];
  onChange: (value: string) => void;
  hint?: string;
}) {
  const listId = useId();
  const known = useMemo(() => new Set(textures), [textures]);
  const [text, setText] = useState(value);
  const [base, setBase] = useState(value);
  if (base !== value) {
    setBase(value);
    setText(value);
  }

  return (
    <Field label={label} hint={hint}>
      <input
        list={listId}
        value={text}
        placeholder="Chercher une texture…"
        spellCheck={false}
        onChange={(event) => {
          setText(event.target.value);
          if (known.has(event.target.value)) onChange(event.target.value);
        }}
        onBlur={() => {
          if (!known.has(text)) setText(value);
        }}
      />
      <datalist id={listId}>
        {textures.map((texture) => (
          <option key={texture} value={texture} />
        ))}
      </datalist>
      {text !== '' && text !== value && !known.has(text) && (
        <span className="field-hint">Choisis une texture dans la liste proposée.</span>
      )}
    </Field>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string; title?: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="asset-segmented" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'active' : ''}
          title={option.title}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
