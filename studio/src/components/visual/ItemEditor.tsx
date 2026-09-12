import { useId, useRef } from 'react';
import type { CSSProperties } from 'react';
import { ITEM_LORE_STYLE, ITEM_NAME_STYLE, NAMED_COLORS, parseMiniMessage } from '../../lib/miniMessage';
import type { MiniSpan } from '../../lib/miniMessage';
import type { ItemSpec } from '../../model/menu';
import { interpolate } from '../../model/preview';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/Icon';
import { Tooltip } from '../../ui/Tooltip';
import { Field } from '../fields';

type ItemMode = 'invisible' | 'material' | 'head' | 'ref';

const MODES: ReadonlyArray<{ mode: ItemMode; label: string; icon: IconName; hint: string }> = [
  { mode: 'invisible', label: 'Invisible', icon: 'eye-off', hint: 'Aucun rendu : le bouton est dessiné par une couche' },
  { mode: 'material', label: 'Matériau', icon: 'box', hint: 'Un item du jeu (DIAMOND, PAPER…)' },
  { mode: 'head', label: 'Tête', icon: 'user', hint: 'Tête de joueur : {viewer} ou un pseudo' },
  { mode: 'ref', label: 'Serveur', icon: 'link', hint: 'Item fourni par l’adaptateur du serveur (ref)' },
];

const COMMON_MATERIALS = [
  'PAPER',
  'BARRIER',
  'ARROW',
  'BOOK',
  'CHEST',
  'CLOCK',
  'COMPASS',
  'DIAMOND',
  'EMERALD',
  'GOLD_INGOT',
  'NAME_TAG',
  'OAK_SIGN',
  'LIME_DYE',
  'RED_DYE',
  'GRAY_DYE',
  'EXPERIENCE_BOTTLE',
];

/** Couleurs de la palette d’insertion, dans l’ordre du jeu. */
const PALETTE = Object.entries(NAMED_COLORS).filter(([name]) => !name.includes('grey'));

const FORMATS: ReadonlyArray<{ tag: string; label: string; text: string; style: CSSProperties }> = [
  { tag: 'b', label: 'Gras', text: 'G', style: { fontWeight: 700 } },
  { tag: 'i', label: 'Italique', text: 'I', style: { fontStyle: 'italic' } },
  { tag: 'u', label: 'Souligné', text: 'S', style: { textDecoration: 'underline' } },
  { tag: 'st', label: 'Barré', text: 'B', style: { textDecoration: 'line-through' } },
];

function itemMode(item: ItemSpec | undefined): ItemMode {
  if (item?.ref !== undefined) return 'ref';
  if (item?.invisible) return 'invisible';
  if (item?.head !== undefined || item?.material?.toUpperCase() === 'PLAYER_HEAD') return 'head';
  return 'material';
}

/** Item nettoyé : sans clés vides ; `undefined` s’il ne reste rien. */
function cleanItem(item: ItemSpec): ItemSpec | undefined {
  const next: ItemSpec = {};
  if (item.invisible) next.invisible = true;
  if (item.material) next.material = item.material;
  if (item.head !== undefined) next.head = item.head;
  if (item.ref !== undefined) next.ref = item.ref;
  if (item.name) next.name = item.name;
  if (item.lore && item.lore.length > 0) next.lore = item.lore;
  return Object.keys(next).length > 0 ? next : undefined;
}

function spanStyle(span: MiniSpan): CSSProperties {
  const decorations = [span.underlined && 'underline', span.strikethrough && 'line-through'].filter(Boolean).join(' ');
  return {
    color: span.color,
    fontWeight: span.bold ? 700 : undefined,
    fontStyle: span.italic ? 'italic' : undefined,
    textDecoration: decorations || undefined,
    filter: span.obfuscated ? 'blur(1.5px)' : undefined,
  };
}

/** Aperçu de l’infobulle d’item, telle que le jeu l’affichera (couleurs, variables remplacées). */
export function ItemTooltipPreview({ name, lore, variables }: { name?: string; lore?: string[]; variables: Record<string, string> }) {
  const lines = [
    ...(name ? parseMiniMessage(interpolate(name, variables), ITEM_NAME_STYLE) : []),
    ...(lore ?? []).flatMap((line) => parseMiniMessage(interpolate(line, variables), ITEM_LORE_STYLE)),
  ];
  if (lines.length === 0) return <p className="field-hint">Sans nom ni description : l’item garde son nom du jeu.</p>;
  return (
    <div className="mc-tooltip" role="img" aria-label="Aperçu de l’infobulle de l’item">
      {lines.map((spans, index) => (
        <div key={index} className="mc-line">
          {spans.map((span, position) => (
            <span key={position} style={spanStyle(span)}>
              {span.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

interface ItemEditorProps {
  item: ItemSpec | undefined;
  /** Variables de l’aperçu (pseudo, états), pour l’infobulle. */
  variables: Record<string, string>;
  onChange: (item: ItemSpec | undefined) => void;
}

/** Item d’un slot : rendu (invisible, matériau, tête, référence), nom et description en MiniMessage avec aperçu. */
export function ItemEditor({ item, variables, onChange }: ItemEditorProps) {
  const materialsId = useId();
  const mode = itemMode(item);
  const nameRef = useRef<HTMLInputElement>(null);
  const loreRef = useRef<HTMLTextAreaElement>(null);
  const lastField = useRef<'name' | 'lore'>('name');
  const patch = (changes: Partial<ItemSpec>) => onChange(cleanItem({ ...item, ...changes }));

  const setMode = (next: ItemMode) => {
    const text = { name: item?.name, lore: item?.lore };
    if (next === 'invisible') onChange(cleanItem({ ...text, invisible: true }));
    else if (next === 'material') {
      const material = item?.material && item.material.toUpperCase() !== 'PLAYER_HEAD' ? item.material : 'PAPER';
      onChange(cleanItem({ ...text, material }));
    } else if (next === 'head') onChange(cleanItem({ ...text, material: 'PLAYER_HEAD', head: item?.head ?? '{viewer}' }));
    else onChange(cleanItem({ ...text, ref: item?.ref ?? '' }));
  };

  /** Insère une balise au curseur du dernier champ utilisé (autour de la sélection s’il y en a une). */
  const insertTag = (open: string, close: string) => {
    const field = lastField.current === 'lore' ? loreRef.current : nameRef.current;
    if (!field) return;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const value = field.value;
    const next = value.slice(0, start) + open + value.slice(start, end) + (end > start ? close : '') + value.slice(end);
    if (lastField.current === 'lore') patch({ lore: next ? next.split('\n') : undefined });
    else patch({ name: next || undefined });
    requestAnimationFrame(() => {
      field.focus();
      const caret = start + open.length + (end - start) + (end > start ? close.length : 0);
      field.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="visual-block item-editor">
      <span className="field-label">Item affiché</span>
      <div className="segmented-mini" role="radiogroup" aria-label="Rendu de l’item">
        {MODES.map((entry) => (
          <Tooltip key={entry.mode} label={entry.label} hint={entry.hint}>
            {/* Nom accessible complet : la colonne étroite coupe le libellé par des points de suspension. */}
            <button type="button" role="radio" aria-checked={mode === entry.mode} aria-label={entry.label} onClick={() => setMode(entry.mode)}>
              <Icon name={entry.icon} />
              <span className="segmented-text">{entry.label}</span>
            </button>
          </Tooltip>
        ))}
      </div>
      {mode === 'material' && (
        <Field label="Matériau">
          <input
            className="mono"
            list={materialsId}
            value={item?.material ?? ''}
            placeholder="PAPER"
            onChange={(event) => patch({ material: event.target.value.toUpperCase() || undefined })}
          />
          <datalist id={materialsId}>
            {COMMON_MATERIALS.map((material) => (
              <option key={material} value={material} />
            ))}
          </datalist>
        </Field>
      )}
      {mode === 'head' && (
        <Field label="Tête de" hint="{viewer} : le joueur qui regarde ; sinon un pseudo ou un UUID">
          <input className="mono" value={item?.head ?? ''} placeholder="{viewer}" onChange={(event) => patch({ head: event.target.value })} />
        </Field>
      )}
      {mode === 'ref' && (
        <Field label="Référence" hint="Créée par l’ItemFactory du serveur (nom et description ci-dessous facultatifs)">
          <input className="mono" value={item?.ref ?? ''} placeholder="monserveur:bouton_vide" onChange={(event) => patch({ ref: event.target.value })} />
        </Field>
      )}
      <Field label="Nom (MiniMessage)" hint="Variables : {viewer.name}, {state.tab}, {page.number}…">
        <input
          ref={nameRef}
          value={item?.name ?? ''}
          placeholder="<gold>Boutique"
          onFocus={() => (lastField.current = 'name')}
          onChange={(event) => patch({ name: event.target.value || undefined })}
        />
      </Field>
      <Field label="Description (une ligne par entrée)">
        <textarea
          ref={loreRef}
          rows={3}
          value={(item?.lore ?? []).join('\n')}
          placeholder="<gray>Ouvre la boutique"
          onFocus={() => (lastField.current = 'lore')}
          onChange={(event) => patch({ lore: event.target.value ? event.target.value.split('\n') : undefined })}
        />
      </Field>
      <div className="format-bar" role="toolbar" aria-label="Insérer une balise MiniMessage">
        <div className="swatches">
          {PALETTE.map(([colorName, hex]) => (
            <Tooltip key={colorName} label={`<${colorName}>`} hint="Insère la couleur au curseur">
              <button
                type="button"
                className="swatch"
                aria-label={`Couleur ${colorName}`}
                style={{ background: hex }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertTag(`<${colorName}>`, `</${colorName}>`)}
              />
            </Tooltip>
          ))}
        </div>
        <div className="format-buttons">
          {FORMATS.map((format) => (
            <Tooltip key={format.tag} label={format.label} hint={`<${format.tag}>…</${format.tag}>`}>
              <button
                type="button"
                className="sm"
                aria-label={format.label}
                style={format.style}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertTag(`<${format.tag}>`, `</${format.tag}>`)}
              >
                {format.text}
              </button>
            </Tooltip>
          ))}
        </div>
      </div>
      <ItemTooltipPreview name={item?.name} lore={item?.lore} variables={variables} />
    </div>
  );
}
