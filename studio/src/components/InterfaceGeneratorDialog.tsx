import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { NBSP, plural } from '../lib/format';
import { evaluateCondition } from '../model/conditions';
import { TEXT_HEIGHT, charAdvance } from '../model/fontMetrics';
import { drawPanelStyle } from '../model/generator';
import { GRID_COLUMNS, SLOT_SIZE, WINDOW_WIDTH, areaRect, chestCell, chestCellAt, playerCell, windowHeight } from '../model/geometry';
import {
  DEFAULT_ACCENTS,
  FAMILY_LABELS,
  INTERFACE_KINDS,
  INTERFACE_KIND_ORDER,
  LAYOUT_LABELS,
  generateInterface,
  normalizeOptions,
  textBox,
} from '../model/interfaceGenerator';
import type { ButtonLayout, InterfaceKind, StyleFamily } from '../model/interfaceGenerator';
import { ID_PATTERN, sanitizeId, uniqueId } from '../model/menu';
import type { Layer, MenuDefinition, SlotArea, StateValue } from '../model/menu';
import { DEFAULT_PREVIEW, buildPreviewContext, interpolate } from '../model/preview';
import type { PreviewValues } from '../model/preview';
import { imageToCanvas, renderGeneratorImage } from '../model/textureRender';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';
import { Field, FieldError, Modal, NumberField } from './fields';
import type { NewMenuInput } from './NewMenuDialog';
import { SLOT_COLORS } from './slotColors';
import './generator.css';

interface InterfaceGeneratorDialogProps {
  existingIds: string[];
  onCancel: () => void;
  /** Revenir au choix d’un gabarit (absent quand le dialogue est ouvert directement). */
  onBack?: () => void;
  onCreate: (input: NewMenuInput) => Promise<void>;
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

/** Texte au pas de la police vanilla, comme sur la toile de l’éditeur. */
function drawText(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${TEXT_HEIGHT * SCALE}px ui-monospace, Consolas, monospace`;
  ctx.textBaseline = 'top';
  let cursor = x;
  for (const char of value) {
    ctx.fillText(char, cursor, y, charAdvance(char) * SCALE);
    cursor += charAdvance(char) * SCALE;
  }
  ctx.restore();
}

/** Coffre vanilla sous le menu : panneau, cases du coffre et de l’inventaire du joueur. */
function drawChest(ctx: CanvasRenderingContext2D, rows: number) {
  drawPanelStyle(ctx, 'panel', 0, 0, WINDOW_WIDTH, windowHeight(rows), '#c6c6c6');
  for (let col = 0; col < GRID_COLUMNS; col++) {
    for (let row = 0; row < rows; row++) {
      const cell = chestCell(col, row);
      drawPanelStyle(ctx, 'cell', cell.x, cell.y, SLOT_SIZE, SLOT_SIZE, '#8b8b8b');
    }
    for (let row = 0; row < 4; row++) {
      const cell = playerCell(col, row, rows);
      drawPanelStyle(ctx, 'cell', cell.x, cell.y, SLOT_SIZE, SLOT_SIZE, '#8b8b8b');
    }
  }
}

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
 */
export function InterfaceGeneratorDialog({ existingIds, onCancel, onBack, onCreate }: InterfaceGeneratorDialogProps) {
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
  const textures = useRef(new Map<string, HTMLCanvasElement>());

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

  // Aperçu : coffre vanilla, couches visibles dans l’état d’aperçu, textes, zones de slots.
  useEffect(() => {
    const canvas = previewRef.current;
    const out = canvas?.getContext('2d');
    if (!canvas || !out) return;
    const height = windowHeight(menu.container.rows);
    const base = document.createElement('canvas');
    base.width = WINDOW_WIDTH;
    base.height = height;
    const ctx = base.getContext('2d');
    if (!ctx) return;
    drawChest(ctx, menu.container.rows);
    const view = buildPreviewContext(menu, preview);
    const cache = textures.current;
    if (cache.size > 300) cache.clear();
    const textureOf = (layer: Layer & { generator: NonNullable<Layer['generator']> }) => {
      const key = JSON.stringify([layer.generator, layer.x, layer.y]);
      let texture = cache.get(key);
      if (!texture) {
        texture = imageToCanvas(renderGeneratorImage(layer.generator, layer));
        cache.set(key, texture);
      }
      return texture;
    };
    for (const layer of menu.layers) {
      if (!layer.generator || !evaluateCondition(layer.visibleWhen, view)) continue;
      ctx.drawImage(textureOf({ ...layer, generator: layer.generator }), layer.x, layer.y);
    }

    canvas.width = WINDOW_WIDTH * SCALE;
    canvas.height = height * SCALE;
    out.imageSmoothingEnabled = false;
    out.drawImage(base, 0, 0, canvas.width, canvas.height);
    for (const text of menu.texts ?? []) {
      if (!evaluateCondition(text.visibleWhen, view)) continue;
      const value = interpolate(text.value, view.variables);
      const box = textBox({ ...text, value });
      drawText(out, value, box.x * SCALE, box.y * SCALE, text.color ?? '#404040');
    }
    if (showSlots) {
      out.save();
      out.lineWidth = 2;
      out.setLineDash([4, 3]);
      for (const slot of menu.slots ?? []) {
        if (!evaluateCondition(slot.visibleWhen, view)) continue;
        const rect = areaRect(slot.area);
        out.strokeStyle = SLOT_COLORS[slot.kind];
        out.strokeRect(rect.x * SCALE + 2, rect.y * SCALE + 2, rect.width * SCALE - 4, rect.height * SCALE - 4);
      }
      out.restore();
    }
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

  const create = async () => {
    if (idError) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ id, name, rows: menu.container.rows, template: generateInterface({ ...options, id }) });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };

  const stateSummary = Object.entries(context.state).map(([key, value]) => `${key}${NBSP}=${NBSP}${String(value)}`);

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
          <button type="button" className="primary" disabled={busy || Boolean(idError)} onClick={() => void create()}>
            <Icon name={busy ? 'loader' : 'sparkles'} />
            {busy ? 'Génération…' : 'Créer le menu'}
          </button>
        </>
      }
    >
      <div className="interface-generator">
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
    </Modal>
  );
}
