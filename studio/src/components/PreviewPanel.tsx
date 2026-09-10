import type { Composition, TitleToken } from '../model/compose';
import type { MenuDefinition, StateDefinition } from '../model/menu';
import type { PreviewValues } from '../model/preview';
import { DEFAULT_PAGE_COUNT } from '../model/preview';
import { Field } from './fields';

interface PreviewPanelProps {
  /** Menu résolu. */
  menu: MenuDefinition;
  values: PreviewValues;
  onChange: (values: PreviewValues) => void;
  composition: Composition | null;
  errors: string[];
}

function describeToken(token: TitleToken): string {
  switch (token.kind) {
    case 'shift':
      return `décalage ${token.amount > 0 ? '+' : ''}${token.amount}`;
    case 'glyph':
      return `${token.layerId} · x ${token.x} · ascent ${token.ascent} · hauteur ${token.height}${
        token.padded ? ' (complétée)' : ''
      } · avance ${token.advance}`;
    case 'text':
      return `texte « ${token.value} » · ascent ${token.ascent} · largeur ${token.width}`;
  }
}

function StateControl({
  name,
  definition,
  values,
  onChange,
}: {
  name: string;
  definition: StateDefinition;
  values: PreviewValues;
  onChange: (values: PreviewValues) => void;
}) {
  const setState = (value: string | number | boolean) =>
    onChange({ ...values, state: { ...values.state, [name]: value } });

  switch (definition.type) {
    case 'enum':
      return (
        <Field label={name}>
          <select value={String(values.state[name] ?? definition.default)} onChange={(event) => setState(event.target.value)}>
            {definition.values.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
      );
    case 'bool':
      return (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={Boolean(values.state[name] ?? definition.default)}
            onChange={(event) => setState(event.target.checked)}
          />
          {name}
        </label>
      );
    case 'int':
      return (
        <Field label={name}>
          <input
            type="number"
            value={Number(values.state[name] ?? definition.default)}
            onChange={(event) => setState(Number(event.target.value))}
          />
        </Field>
      );
    case 'page':
      return (
        <div className="field-row">
          <Field label={`${name} : page`}>
            <input
              type="number"
              min={1}
              value={Number(values.state[name] ?? 1)}
              onChange={(event) => setState(Number(event.target.value))}
            />
          </Field>
          <Field label="sur">
            <input
              type="number"
              min={1}
              value={values.pageCounts[name] ?? DEFAULT_PAGE_COUNT}
              onChange={(event) =>
                onChange({ ...values, pageCounts: { ...values.pageCounts, [name]: Number(event.target.value) } })
              }
            />
          </Field>
        </div>
      );
  }
}

export function PreviewPanel({ menu, values, onChange, composition, errors }: PreviewPanelProps) {
  const states = Object.entries(menu.state ?? {});
  return (
    <>
      <section className="panel-section">
        <h3>Aperçu de l’état</h3>
        {errors.map((error) => (
          <p key={error} className="warning">
            {error}
          </p>
        ))}
        {states.length === 0 && <p className="muted">Aucune variable d’état.</p>}
        {states.map(([name, definition]) => (
          <StateControl key={name} name={name} definition={definition} values={values} onChange={onChange} />
        ))}
        <Field label="Drapeaux actifs (un par ligne)" hint="Ex. viewer.isStaff">
          <textarea
            rows={2}
            value={values.flags.join('\n')}
            onChange={(event) => onChange({ ...values, flags: event.target.value.split('\n') })}
          />
        </Field>
        <Field label="Pseudo du joueur">
          <input value={values.viewerName} onChange={(event) => onChange({ ...values, viewerName: event.target.value })} />
        </Field>
      </section>
      {composition && (
        <section className="panel-section">
          <h3>Titre composé</h3>
          <p className="muted small">Ce que la lib écrira dans le titre, dans cet état.</p>
          {composition.warnings.map((warning) => (
            <p key={warning} className="warning">
              {warning}
            </p>
          ))}
          <ol className="token-list">
            {composition.tokens.map((token, index) => (
              <li key={index} className={`token token-${token.kind}`}>
                {describeToken(token)}
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
