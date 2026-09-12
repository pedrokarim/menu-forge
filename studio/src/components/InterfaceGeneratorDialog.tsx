import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { NBSP, plural } from '../lib/format';
import { evaluateCondition } from '../model/conditions';
import { WINDOW_WIDTH, chestCellAt, windowHeight } from '../model/geometry';
import { INTERFACE_EXAMPLES, exampleId, exampleOptions } from '../model/interfaceExamples';
import type { InterfaceExample } from '../model/interfaceExamples';
import {
  DEFAULT_ACCENTS,
  FAMILY_LABELS,
  INTERFACE_KINDS,
  INTERFACE_KIND_ORDER,
  LAYOUT_LABELS,
  generateInterface,
  normalizeOptions,
} from '../model/interfaceGenerator';
import type { ButtonLayout, InterfaceKind, StyleFamily } from '../model/interfaceGenerator';
import { ID_PATTERN, sanitizeId, uniqueId } from '../model/menu';
import type { MenuDefinition, SlotArea, StateValue } from '../model/menu';
import { DEFAULT_PREVIEW, buildPreviewContext } from '../model/preview';
import type { PreviewValues } from '../model/preview';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';
import { Field, FieldError, Modal, NumberField } from './fields';
import { InterfaceExamplesGallery } from './InterfaceExamplesGallery';
import { drawInterfacePreview } from './interfacePreview';
import type { TextureCache } from './interfacePreview';
import type { NewMenuInput } from './NewMenuDialog';
import './generator.css';

/** Vue du dialogue : réglages du générateur, ou galerie d’exemples. */
export type GeneratorView = 'form' | 'examples';

interface InterfaceGeneratorDialogProps {
  existingIds: string[];
  onCancel: () => void;
  /** Revenir au choix d’un gabarit (absent quand le dialogue est ouvert directement). */
  onBack?: () => void;
  onCreate: (input: NewMenuInput) => Promise<void>;
  /** Vue à l’ouverture (« Voir les exemples » de l’accueil : la galerie). */
  initialView?: GeneratorView;
}

const KIND_ICONS: Record<InterfaceKind, IconName> = {
  shop: 'chest',
  grid: 'grid',
  confirm: 'alert',
  list: 'list',
  tabs: 'layers',
};

/** Échelle de l’aperçu (pixels écran par pixel de la fenêtre). */
const SCALE = 2;

function covers(area: SlotArea, cell: { col: number; row: number }): boolean {
  return cell.col >= area.col && cell.col < area.col + (area.width ?? 1) && cell.row >= area.row && cell.row < area.row + (area.height ?? 1);
}

function pageStateOf(menu: MenuDefinition, list: string): string | undefined {
  return Object.entries(menu.state ?? {}).find(([, definition]) => definition.type === 'page' && definition.list === list)?.[0];
}

/**
 * Générateur d’interfaces : type, lignes, boutons, famille de styles et accent
 * donnent un menu complet, visible en direct, créé comme un gabarit (ses
 * textures sont cuites à la création) et retouchable ensuite dans l’éditeur.
 * L’onglet « Exemples » propose des réglages tout faits : un clic les charge
 * dans le formulaire, un double-clic crée le menu.
 */
export function InterfaceGeneratorDialog({ existingIds, onCancel, onBack, onCreate, initialView = 'form' }: InterfaceGeneratorDialogProps) {
  const [view, setView] = useState<GeneratorView>(initialView);
  const [selectedExample, setSelectedExample] = useState<InterfaceExample | null>(null);
  const [kind, setKind] = useState<InterfaceKind>('shop');
  const [family, setFamily] = useState<StyleFamily>('mcrs');
  const [rows, setRows] = useState(INTERFACE_KINDS.shop.defaultRows);
  const [buttons, setButtons] = useState(INTERFACE_KINDS.shop.defaultButtons);
  const [layout, setLayout] = useState<ButtonLayout>(INTERFACE_KINDS.shop.defaultLayout);
  const [accent, setAccent] = useState<string>(DEFAULT_ACCENTS.mcrs);
  const [name, setName] = useState(INTERFACE_KINDS.shop.label);
  const [nameTouched, setNameTouched] = useState(false);
  const [title, setTitle] = useState(INTERFACE_KINDS.shop.label);
  const [titleTouched, setTitleTouched] = useState(false);
  // Identifiant proposé toujours libre : le dialogue ne s’ouvre jamais sur une erreur.
  const [id, setId] = useState(() => uniqueId(sanitizeId(INTERFACE_KINDS.shop.label), existingIds));
  const [idTouched, setIdTouched] = useState(false);
  const [preview, setPreview] = useState<PreviewValues>(DEFAULT_PREVIEW);
  const [showSlots, setShowSlots] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const textures = useRef<TextureCache>(new Map());

  const info = INTERFACE_KINDS[kind];
  let idError: string | null = null;
  if (!ID_PATTERN.test(id)) idError = 'Lettres minuscules, chiffres et _ uniquement';
  else if (existingIds.includes(id)) idError = 'Un menu porte déjà cet identifiant';

  const options = normalizeOptions({ id: idError ? 'menu' : id, name, title, kind, rows, buttons, layout, family, accent });
  const menu = useMemo(
    () => generateInterface(options),
    // Les options sont recalculées à chaque rendu : on dépend de leurs valeurs, pas de l’objet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options.id, options.name, options.title, options.kind, options.rows, options.buttons, options.layout, options.family, options.accent],
  );
  const context = buildPreviewContext(menu, preview);

  const chooseKind = (next: InterfaceKind) => {
    const nextInfo = INTERFACE_KINDS[next];
    setKind(next);
    setRows(nextInfo.defaultRows);
    setButtons(nextInfo.defaultButtons);
    setLayout(nextInfo.defaultLayout);
    setPreview(DEFAULT_PREVIEW);
    if (!nameTouched) {
      setName(nextInfo.label);
      if (!idTouched) setId(uniqueId(sanitizeId(nextInfo.label), existingIds));
    }
    if (!titleTouched) setTitle(nextInfo.label);
  };

  const chooseFamily = (next: StyleFamily) => {
    setFamily(next);
    // L’accent suit la famille tant qu’on ne l’a pas choisi soi-même.
    if (accent === DEFAULT_ACCENTS[family]) setAccent(DEFAULT_ACCENTS[next]);
  };

  /** Réglages d’un exemple dans le formulaire (nom, titre, identifiant libre compris). */
  const applyExample = (entry: InterfaceExample) => {
    setSelectedExample(entry);
    setKind(entry.kind);
    setFamily(entry.family);
    setRows(entry.rows);
    setButtons(entry.buttons);
    setLayout(entry.layout);
    setAccent(entry.accent);
    setName(entry.name);
    setNameTouched(true);
    setTitle(entry.name);
    setTitleTouched(true);
    setId(exampleId(entry, existingIds));
    setIdTouched(false);
    setPreview(DEFAULT_PREVIEW);
    setError(null);
  };

  // Aperçu : coffre vanilla, couches visibles dans l’état d’aperçu, textes, zones de slots.
  useEffect(() => {
    const canvas = previewRef.current;
    if (canvas) drawInterfacePreview(canvas, menu, preview, { scale: SCALE, showSlots, textures: textures.current });
  }, [menu, preview, showSlots]);

  /** Un clic sur un bouton de l’aperçu joue ses changements d’état et de page. */
  const clickPreview = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: ((event.clientX - rect.left) / rect.width) * WINDOW_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * windowHeight(menu.container.rows),
    };
    const cell = chestCellAt(point, menu.container.rows);
    if (!cell) return;
    const slot = (menu.slots ?? []).find(
      (candidate) =>
        candidate.kind === 'button' &&
        covers(candidate.area, cell) &&
        evaluateCondition(candidate.visibleWhen, context) &&
        evaluateCondition(candidate.enabledWhen, context),
    );
    if (!slot) return;
    const state: Record<string, StateValue> = { ...context.state };
    for (const action of slot.onClick ?? []) {
      if (action.type === 'setState') state[action.state] = action.value;
      if (action.type === 'nextPage' || action.type === 'prevPage') {
        const page = pageStateOf(menu, action.list);
        if (page) state[page] = Number(state[page]) + (action.type === 'nextPage' ? 1 : -1);
      }
    }
    setPreview({ ...preview, state });
  };

  const submit = async (input: NewMenuInput) => {
    setBusy(true);
    setError(null);
    try {
      await onCreate(input);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };

  const create = () => {
    if (idError || busy) return;
    void submit({ id, name, rows: menu.container.rows, template: generateInterface({ ...options, id }), form: null });
  };

  /** Crée le menu d’un exemple tel quel, sous un identifiant libre tiré de son nom. */
  const createFromExample = (entry: InterfaceExample) => {
    if (busy) return;
    const exampleMenuId = exampleId(entry, existingIds);
    const template = generateInterface(exampleOptions(entry, exampleMenuId));
    applyExample(entry);
    void submit({ id: exampleMenuId, name: entry.name, rows: template.container.rows, template, form: null });
  };

  const stateSummary = Object.entries(context.state).map(([key, value]) => `${key}${NBSP}=${NBSP}${String(value)}`);
  const creating = (label: string) => (
    <>
      <Icon name={busy ? 'loader' : 'sparkles'} />
      {busy ? 'Génération…' : label}
    </>
  );

  return (
    <Modal
      title="Générer une interface"
      wide
      onClose={onCancel}
      footer={
        <>
          {error && <FieldError>{error}</FieldError>}
          {onBack && (
            <button type="button" className="interface-back" onClick={onBack}>
              <Icon name="arrow-left" />
              Gabarits
            </button>
          )}
          <button type="button" onClick={onCancel}>
            Annuler
          </button>
          {view === 'examples' ? (
            <>
              <button type="button" disabled={!selectedExample} onClick={() => setView('form')}>
                <Icon name="sliders" />
                Personnaliser
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || !selectedExample}
                onClick={() => selectedExample && createFromExample(selectedExample)}
              >
                {creating('Utiliser cet exemple')}
              </button>
            </>
          ) : (
            <button type="button" className="primary" disabled={busy || Boolean(idError)} onClick={create}>
              {creating('Créer le menu')}
            </button>
          )}
        </>
      }
    >
      <div className="interface-root" data-view={view}>
        <div className="interface-views" role="tablist" aria-label="Vue du générateur">
          <button
            type="button"
            role="tab"
            id="interface-tab-form"
            aria-controls="interface-panel-form"
            aria-selected={view === 'form'}
            className={view === 'form' ? 'active' : ''}
            onClick={() => setView('form')}
          >
            <Icon name="sliders" />
            Réglages
          </button>
          <button
            type="button"
            role="tab"
            id="interface-tab-examples"
            aria-controls="interface-panel-examples"
            aria-selected={view === 'examples'}
            className={view === 'examples' ? 'active' : ''}
            onClick={() => setView('examples')}
          >
            <Icon name="grid" />
            Exemples
            <span className="count">{INTERFACE_EXAMPLES.length}</span>
          </button>
        </div>
        <div className="interface-generator" role="tabpanel" id="interface-panel-form" aria-labelledby="interface-tab-form" hidden={view !== 'form'}>
          <div className="interface-form">
            <div className="interface-kinds" role="radiogroup" aria-label="Type d’interface">
              {INTERFACE_KIND_ORDER.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  role="radio"
                  aria-checked={candidate === kind}
                  className={`interface-kind ${candidate === kind ? 'selected' : ''}`}
                  onClick={() => chooseKind(candidate)}
                >
                  <Icon name={KIND_ICONS[candidate]} />
                  {INTERFACE_KINDS[candidate].label}
                </button>
              ))}
            </div>
            <p className="muted interface-kind-description">{info.description}</p>
            <div className="field-row">
              <Field label="Nom">
                <input
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setNameTouched(true);
                    if (!idTouched) setId(uniqueId(sanitizeId(event.target.value), existingIds));
                    if (!titleTouched) setTitle(event.target.value);
                  }}
                />
              </Field>
              <Field label="Identifiant">
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
            <Field label="Titre affiché" hint="En haut à gauche de la fenêtre">
              <input
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setTitleTouched(true);
                }}
              />
            </Field>
            <div className="field-row">
              <Field label="Famille de styles">
                <select value={family} onChange={(event) => chooseFamily(event.target.value as StyleFamily)}>
                  {Object.entries(FAMILY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Accent">
                <div className="color-input">
                  <input type="color" value={options.accent} onChange={(event) => setAccent(event.target.value)} />
                  <input value={accent} onChange={(event) => setAccent(event.target.value)} />
                </div>
              </Field>
            </div>
            <div className="field-row">
              <NumberField
                label="Lignes du coffre"
                value={options.rows}
                min={info.minRows}
                max={6}
                onChange={(value) => setRows(Math.min(6, Math.max(info.minRows, value)))}
              />
              <NumberField
                label={info.buttonsLabel}
                value={options.buttons}
                min={info.minButtons}
                max={info.maxButtons}
                onChange={(value) => setButtons(Math.min(info.maxButtons, Math.max(info.minButtons, value)))}
              />
            </div>
            <Field label="Disposition des boutons">
              <select value={layout} onChange={(event) => setLayout(event.target.value as ButtonLayout)}>
                {Object.entries(LAYOUT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="interface-preview">
            <canvas
              ref={previewRef}
              role="img"
              aria-label="Aperçu du menu généré"
              title="Clic sur un onglet ou une flèche : change l’aperçu"
              onClick={clickPreview}
            />
            <label className="checkbox">
              <input type="checkbox" checked={showSlots} onChange={(event) => setShowSlots(event.target.checked)} />
              Zones de slots
            </label>
            <p className="interface-summary">
              <span>{plural(menu.layers.length, 'couche')}</span>
              <span>{plural((menu.slots ?? []).length, 'slot')}</span>
              <span>{plural((menu.texts ?? []).length, 'texte')}</span>
              {stateSummary.map((entry) => (
                <span key={entry}>{entry}</span>
              ))}
            </p>
          </div>
        </div>
        <div
          className="interface-examples-panel"
          role="tabpanel"
          id="interface-panel-examples"
          aria-labelledby="interface-tab-examples"
          hidden={view !== 'examples'}
        >
          <InterfaceExamplesGallery selectedKey={selectedExample?.key ?? null} onSelect={applyExample} onUse={createFromExample} />
        </div>
      </div>
    </Modal>
  );
}
