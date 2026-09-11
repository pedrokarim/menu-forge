import { NBSP } from '../lib/format';
import { alignedStart, textWidth } from './fontMetrics';
import { GRID_COLUMNS, MAX_ROWS, SLOT_SIZE, TITLE_X, TITLE_Y, WINDOW_WIDTH, chestCell } from './geometry';
import type { Rect } from './geometry';
import { MCRS_COLORS } from './mcrs';
import type {
  Action,
  Condition,
  GeneratorSpec,
  Layer,
  MenuDefinition,
  Slot,
  SlotArea,
  StateDefinition,
  TextAlign,
  TextElement,
} from './menu';
import { generatedTexturePath } from './menuEdit';

/**
 * Générateur d’interfaces : à partir d’un type (boutique, grille, modale,
 * liste paginée, onglets), d’un nombre de lignes, de boutons et d’une famille
 * de styles, construit un menu complet – couches aux textures générées, zones
 * de slots avec leurs actions, textes, états – prêt à retoucher à la main.
 * Fonction pure : mêmes options, même menu (le studio et les tests s’en servent).
 */

export type InterfaceKind = 'shop' | 'grid' | 'confirm' | 'list' | 'tabs';
export type StyleFamily = 'deepslate' | 'mcrs';
export type ButtonLayout = 'start' | 'center' | 'end' | 'spread';

export interface InterfaceOptions {
  id: string;
  name: string;
  /** Texte du titre, en haut à gauche de la fenêtre. */
  title: string;
  kind: InterfaceKind;
  rows: number;
  /** Boutons de la barre d’actions, choix d’une modale ou onglets, selon le type. */
  buttons: number;
  layout: ButtonLayout;
  family: StyleFamily;
  /** Couleur d’accent `#rrggbb`. */
  accent: string;
}

export interface InterfaceKindInfo {
  label: string;
  description: string;
  minRows: number;
  defaultRows: number;
  minButtons: number;
  maxButtons: number;
  defaultButtons: number;
  buttonsLabel: string;
  defaultLayout: ButtonLayout;
}

export const INTERFACE_KINDS: Record<InterfaceKind, InterfaceKindInfo> = {
  shop: {
    label: 'Boutique',
    description: 'Grille d’articles paginée et barre d’actions.',
    minRows: 3,
    defaultRows: 6,
    minButtons: 0,
    maxButtons: 5,
    defaultButtons: 2,
    buttonsLabel: 'Boutons de la barre',
    defaultLayout: 'center',
  },
  grid: {
    label: 'Grille simple',
    description: 'Une grille d’items et une rangée de boutons.',
    minRows: 2,
    defaultRows: 4,
    minButtons: 0,
    maxButtons: 9,
    defaultButtons: 1,
    buttonsLabel: 'Boutons',
    defaultLayout: 'end',
  },
  confirm: {
    label: 'Modale de confirmation',
    description: 'Un message, l’objet concerné et un à trois choix.',
    minRows: 3,
    defaultRows: 3,
    minButtons: 1,
    maxButtons: 3,
    defaultButtons: 2,
    buttonsLabel: 'Choix',
    defaultLayout: 'spread',
  },
  list: {
    label: 'Liste paginée',
    description: 'Entrées d’une source, pages précédente et suivante.',
    minRows: 3,
    defaultRows: 6,
    minButtons: 0,
    maxButtons: 5,
    defaultButtons: 1,
    buttonsLabel: 'Boutons entre les flèches',
    defaultLayout: 'center',
  },
  tabs: {
    label: 'Barre d’onglets',
    description: 'Des onglets qui changent l’état et le contenu affiché.',
    minRows: 2,
    defaultRows: 6,
    minButtons: 2,
    maxButtons: 9,
    defaultButtons: 4,
    buttonsLabel: 'Onglets',
    defaultLayout: 'start',
  },
};

export const INTERFACE_KIND_ORDER: readonly InterfaceKind[] = ['shop', 'grid', 'confirm', 'list', 'tabs'];

export const FAMILY_LABELS: Record<StyleFamily, string> = {
  deepslate: 'Deepslate (biseauté)',
  mcrs: 'mc-rs (sombre, arrondi)',
};

export const DEFAULT_ACCENTS: Record<StyleFamily, string> = {
  deepslate: '#52a535',
  mcrs: MCRS_COLORS.gold,
};

export const LAYOUT_LABELS: Record<ButtonLayout, string> = {
  start: 'À gauche',
  center: 'Centrés',
  end: 'À droite',
  spread: 'Répartis',
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Options par défaut d’un type (identifiant et nom à fournir). */
export function defaultInterfaceOptions(kind: InterfaceKind, family: StyleFamily = 'mcrs'): Omit<InterfaceOptions, 'id' | 'name'> {
  const info = INTERFACE_KINDS[kind];
  return {
    title: info.label,
    kind,
    rows: info.defaultRows,
    buttons: info.defaultButtons,
    layout: info.defaultLayout,
    family,
    accent: DEFAULT_ACCENTS[family],
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));
}

/** Options ramenées dans les bornes du type (lignes, boutons, couleur). */
export function normalizeOptions(options: InterfaceOptions): InterfaceOptions {
  const info = INTERFACE_KINDS[options.kind];
  return {
    ...options,
    rows: clamp(options.rows, info.minRows, MAX_ROWS),
    buttons: clamp(options.buttons, info.minButtons, info.maxButtons),
    accent: HEX_COLOR.test(options.accent) ? options.accent.toLowerCase() : DEFAULT_ACCENTS[options.family],
  };
}

/**
 * Colonnes de départ de `count` boutons de `width` cases entre les colonnes
 * `from` (incluse) et `to` (exclue), selon la disposition.
 */
export function placeButtons(count: number, width: number, from: number, to: number, layout: ButtonLayout): number[] {
  if (count <= 0) return [];
  const available = to - from;
  const total = count * width;
  const gap = layout === 'spread' && count > 1 ? Math.max(0, Math.floor((available - total) / (count - 1))) : 0;
  const used = total + gap * (count - 1);
  let start = from;
  if (layout === 'end') start = to - used;
  else if (layout === 'center' || layout === 'spread') start = from + Math.floor((available - used) / 2);
  return Array.from({ length: count }, (_, index) => start + index * (width + gap));
}

/* Thèmes */

/** Rôle visuel d’un bouton. */
type Tone = 'neutral' | 'accent' | 'confirm' | 'danger' | 'special' | 'off' | 'active';

interface Theme {
  background(height: number, cells: SlotArea[]): GeneratorSpec;
  titleStrip: GeneratorSpec | null;
  button(width: number, height: number, tone: Tone): GeneratorSpec;
  titleColor: string;
  labelColor(tone: Tone): string;
  /** Décalage vertical du libellé : les boutons en relief ont leur corps plus haut. */
  labelOffset(tone: Tone): number;
}

function deepslateTheme(accent: string): Theme {
  const colors: Record<Tone, string> = {
    neutral: '#9a9a9a',
    accent,
    confirm: '#52a535',
    danger: '#d04545',
    special: '#8a4fd0',
    off: '#8a8a8a',
    active: accent,
  };
  return {
    background: (height, cells) => ({ style: 'panel', width: WINDOW_WIDTH, height, color: '#c6c6c6', cells }),
    titleStrip: null,
    button: (width, height, tone) => ({ style: 'button', width, height, color: colors[tone] }),
    titleColor: '#404040',
    labelColor: (tone) => (tone === 'off' ? '#5a5a5a' : '#ffffff'),
    labelOffset: () => 4,
  };
}

function mcrsTheme(accent: string): Theme {
  const raised: Partial<Record<Tone, string>> = { confirm: MCRS_COLORS.green, danger: MCRS_COLORS.red, special: MCRS_COLORS.special };
  return {
    background: (height, cells) => ({
      style: 'mcrs_panel',
      width: WINDOW_WIDTH,
      height,
      color: MCRS_COLORS.panel,
      cells,
      cellStyle: 'mcrs_slot',
      radius: 2,
      borderWidth: 1,
      borderColor: MCRS_COLORS.panelBorder,
    }),
    titleStrip: { style: 'mcrs_strip', width: WINDOW_WIDTH - 2 * TITLE_X, height: 1, color: accent },
    button: (width, height, tone) => {
      const color = raised[tone];
      if (color) return { style: 'mcrs_raised', width, height, color, shadow: 2 };
      if (tone === 'off') return { style: 'mcrs_button', width, height, color: '#15151fcc', borderColor: '#26263a' };
      const state = tone === 'active' ? 'pressed' : tone === 'accent' ? 'hover' : 'normal';
      return { style: 'mcrs_button', width, height, color: MCRS_COLORS.button, state, accent };
    },
    titleColor: MCRS_COLORS.text,
    labelColor: (tone) => (tone === 'off' ? '#6c6c80' : tone === 'active' ? accent : MCRS_COLORS.text),
    labelOffset: (tone) => (raised[tone] ? 3 : 4),
  };
}

/* Construction */

interface ButtonDef {
  id: string;
  label: string;
  /** Libellé court (un caractère) pour un bouton d’une case. */
  symbol?: string;
  tone: Tone;
  /** Balise MiniMessage de couleur du nom de l’item. */
  tag: string;
  actions: Action[];
}

class MenuBuilder {
  readonly layers: Layer[] = [];
  readonly texts: TextElement[] = [];
  readonly slots: Slot[] = [];
  readonly state: Record<string, StateDefinition> = {};
  readonly cells: SlotArea[] = [];
  readonly menuId: string;
  readonly theme: Theme;

  constructor(menuId: string, theme: Theme) {
    this.menuId = menuId;
    this.theme = theme;
  }

  layer(id: string, x: number, y: number, generator: GeneratorSpec, visibleWhen?: Condition) {
    this.layers.push({
      id,
      texture: generatedTexturePath(this.menuId, id),
      x,
      y,
      ...(visibleWhen ? { visibleWhen } : {}),
      generator,
    });
  }

  text(id: string, x: number, y: number, value: string, color: string, align: TextAlign = 'left', visibleWhen?: Condition) {
    this.texts.push({ id, x, y, ...(align !== 'left' ? { align } : {}), color, value, ...(visibleWhen ? { visibleWhen } : {}) });
  }

  /**
   * Texte aligné à droite dans la ligne du titre, s’il tient à côté du titre.
   * `sample` = la valeur affichée la plus large (les variables sont remplacées en jeu).
   */
  titleSide(id: string, value: string, visibleWhen?: Condition, sample = value) {
    const title = this.texts.find((text) => text.id === 'title');
    const room = WINDOW_WIDTH - 2 * TITLE_X - (title ? textWidth(title.value) : 0) - 6;
    if (textWidth(sample) <= room) this.text(id, WINDOW_WIDTH - TITLE_X, TITLE_Y, value, this.theme.titleColor, 'right', visibleWhen);
  }

  /** Bouton dessiné (couche + libellé éventuel) sur une zone d’une ligne. */
  buttonLayer(id: string, area: SlotArea, tone: Tone, label: string | undefined, visibleWhen?: Condition) {
    const rect = buttonRect(area);
    this.layer(id, rect.x, rect.y, this.theme.button(rect.width, rect.height, tone), visibleWhen);
    if (label && textWidth(label) <= rect.width - 2) {
      this.text(
        `${id}_label`,
        rect.x + Math.floor(rect.width / 2),
        rect.y + this.theme.labelOffset(tone),
        label,
        this.theme.labelColor(tone),
        'center',
        visibleWhen,
      );
    }
  }

  button(def: ButtonDef, area: SlotArea) {
    const wide = (area.width ?? 1) > 1;
    this.buttonLayer(def.id, area, def.tone, wide ? def.label : def.symbol);
    this.slots.push({
      id: def.id,
      kind: 'button',
      area,
      item: { invisible: true, name: `${def.tag}${def.label}` },
      onClick: def.actions,
    });
  }

  /** Flèches de pagination aux deux bouts de la ligne `row` : couches éteinte et allumée, slots actifs selon la page. */
  pager(list: string, row: number) {
    const arrows = [
      { id: 'prev', col: 0, flag: 'page.hasPrev', type: 'prevPage', symbol: '<', name: 'Page précédente' },
      { id: 'next', col: GRID_COLUMNS - 1, flag: 'page.hasNext', type: 'nextPage', symbol: '>', name: 'Page suivante' },
    ] as const;
    for (const arrow of arrows) {
      const area = { col: arrow.col, row };
      const on: Condition = { flag: arrow.flag };
      const off: Condition = { not: { flag: arrow.flag } };
      this.buttonLayer(`${arrow.id}_off`, area, 'off', arrow.symbol, off);
      this.buttonLayer(`${arrow.id}_on`, area, 'accent', arrow.symbol, on);
      this.slots.push({
        id: arrow.id,
        kind: 'button',
        area,
        item: { invisible: true, name: `<gray>${arrow.name}` },
        enabledWhen: on,
        onClick: [{ type: arrow.type, list }],
      });
    }
    this.titleSide('page_label', '{page.number}/{page.count}', undefined, '99/99');
  }

  list(id: string, list: string, area: SlotArea, visibleWhen?: Condition) {
    this.cells.push(area);
    this.slots.push({ id, kind: 'list', list, area, ...(visibleWhen ? { visibleWhen } : {}) });
  }
}

/** Rectangle de la texture d’un bouton posé sur une zone : la case moins un pixel de chaque côté. */
function buttonRect(area: SlotArea): Rect {
  const cell = chestCell(area.col, area.row);
  return { x: cell.x + 1, y: cell.y + 1, width: SLOT_SIZE * (area.width ?? 1) - 2, height: SLOT_SIZE - 2 };
}

/** Zone d’une ligne, sans `width` quand elle vaut 1 (forme écrite par l’éditeur). */
function rowArea(col: number, row: number, width = 1): SlotArea {
  return width > 1 ? { col, row, width } : { col, row };
}

const CLOSE: ButtonDef = { id: 'close', label: 'Fermer', symbol: 'x', tone: 'danger', tag: '<red>', actions: [{ type: 'close' }] };
const BACK: ButtonDef = { id: 'back', label: 'Retour', tone: 'neutral', tag: '<white>', actions: [{ type: 'back' }] };

function customButton(index: number): ButtonDef {
  return {
    id: `action_${index}`,
    label: `Action ${index}`,
    tone: 'accent',
    tag: '<gold>',
    actions: [{ type: 'custom', id: `action_${index}` }],
  };
}

/** Retour en tête, Fermer en dernier, actions du serveur entre les deux. */
function barButtons(count: number, first: ButtonDef): ButtonDef[] {
  if (count <= 0) return [];
  if (count === 1) return [first];
  const middle = Array.from({ length: count - 2 }, (_, index) => customButton(index + 1));
  return [first === CLOSE ? BACK : first, ...middle, CLOSE];
}

const SHOP_BUTTONS: readonly ButtonDef[] = [
  CLOSE,
  BACK,
  { id: 'sell_all', label: 'Tout vendre', tone: 'accent', tag: '<gold>', actions: [{ type: 'custom', id: 'shop_sell_all' }] },
  { id: 'balance', label: 'Mon solde', tone: 'neutral', tag: '<yellow>', actions: [{ type: 'command', command: 'balance', as: 'player' }] },
  { id: 'help', label: 'Aide', tone: 'special', tag: '<light_purple>', actions: [{ type: 'custom', id: 'shop_help' }] },
];

const CONFIRM_ACTIONS: Action[] = [{ type: 'custom', id: 'confirm' }, { type: 'close' }];

function confirmButtons(count: number): ButtonDef[] {
  if (count <= 1) return [{ id: 'ok', label: 'Compris', tone: 'confirm', tag: '<green>', actions: [{ type: 'close' }] }];
  if (count === 2) {
    return [
      { id: 'confirm', label: 'Confirmer', tone: 'confirm', tag: '<green>', actions: CONFIRM_ACTIONS },
      { id: 'cancel', label: 'Annuler', tone: 'danger', tag: '<red>', actions: [{ type: 'back' }] },
    ];
  }
  return [
    { id: 'yes', label: 'Oui', tone: 'confirm', tag: '<green>', actions: CONFIRM_ACTIONS },
    { id: 'no', label: 'Non', tone: 'danger', tag: '<red>', actions: [{ type: 'back' }] },
    { id: 'later', label: 'Plus tard', tone: 'neutral', tag: '<gray>', actions: [{ type: 'close' }] },
  ];
}

function buildShop(b: MenuBuilder, options: InterfaceOptions) {
  const list = 'shop_items';
  const bar = options.rows - 1;
  b.state.page = { type: 'page', list };
  b.list('articles', list, { col: 0, row: 0, width: GRID_COLUMNS, height: bar });
  b.pager(list, bar);
  const defs = SHOP_BUTTONS.slice(0, options.buttons);
  placeButtons(defs.length, 1, 1, GRID_COLUMNS - 1, options.layout).forEach((col, index) => b.button(defs[index], rowArea(col, bar)));
}

function buildGrid(b: MenuBuilder, options: InterfaceOptions) {
  const hasBar = options.buttons > 0;
  const height = hasBar ? options.rows - 1 : options.rows;
  b.list('entries', 'items', { col: 0, row: 0, width: GRID_COLUMNS, height });
  const defs = barButtons(options.buttons, CLOSE);
  placeButtons(defs.length, 1, 0, GRID_COLUMNS, options.layout).forEach((col, index) =>
    b.button(defs[index], rowArea(col, options.rows - 1)),
  );
}

function buildConfirm(b: MenuBuilder, options: InterfaceOptions) {
  const top = chestCell(0, 0).y;
  b.text('message', WINDOW_WIDTH / 2, top + 5, `Confirmer cette action${NBSP}?`, b.theme.titleColor, 'center');
  const subject = { col: 4, row: Math.max(1, Math.floor((options.rows - 1) / 2)) };
  b.cells.push(subject);
  b.slots.push({
    id: 'subject',
    kind: 'decoration',
    area: subject,
    item: { material: 'PAPER', name: '<yellow>Objet concerné', lore: ['<gray>Remplacé par le serveur'] },
  });
  const defs = confirmButtons(options.buttons);
  const row = options.rows - 1;
  placeButtons(defs.length, 3, 0, GRID_COLUMNS, options.layout).forEach((col, index) => b.button(defs[index], rowArea(col, row, 3)));
}

function buildList(b: MenuBuilder, options: InterfaceOptions) {
  const list = 'items';
  const bar = options.rows - 1;
  b.state.page = { type: 'page', list };
  b.list('entries', list, { col: 0, row: 0, width: GRID_COLUMNS, height: bar });
  b.pager(list, bar);
  const defs = barButtons(options.buttons, BACK);
  placeButtons(defs.length, 1, 1, GRID_COLUMNS - 1, options.layout).forEach((col, index) => b.button(defs[index], rowArea(col, bar)));
}

function buildTabs(b: MenuBuilder, options: InterfaceOptions) {
  const count = options.buttons;
  const width = count <= 3 ? 3 : count === 4 ? 2 : 1;
  const values = Array.from({ length: count }, (_, index) => `tab_${index + 1}`);
  b.state.tab = { type: 'enum', values, default: values[0] };
  const content = { col: 0, row: 1, width: GRID_COLUMNS, height: options.rows - 1 };
  placeButtons(count, width, 0, GRID_COLUMNS, options.layout).forEach((col, index) => {
    const value = values[index];
    const label = `Onglet ${index + 1}`;
    const area = rowArea(col, 0, width);
    const active: Condition = { state: 'tab', is: value };
    const rect = buttonRect(area);
    const text = textWidth(label) <= rect.width - 2 ? label : String(index + 1);
    b.buttonLayer(value, area, 'neutral', text, { not: active });
    b.buttonLayer(`${value}_active`, area, 'active', text, active);
    b.slots.push({
      id: value,
      kind: 'button',
      area,
      item: { invisible: true, name: `<white>${label}` },
      onClick: [{ type: 'setState', state: 'tab', value }],
    });
    b.slots.push({ id: `content_${index + 1}`, kind: 'list', list: `${value}_items`, area: content, visibleWhen: active });
    b.titleSide(`${value}_title`, label, active);
  });
  b.cells.push(content);
}

const BUILDERS: Record<InterfaceKind, (builder: MenuBuilder, options: InterfaceOptions) => void> = {
  shop: buildShop,
  grid: buildGrid,
  confirm: buildConfirm,
  list: buildList,
  tabs: buildTabs,
};

/** Hauteur du panneau de fond : bandeau du titre, grille, deux pixels de bord. */
export function backgroundHeight(rows: number): number {
  return chestCell(0, rows).y + 2;
}

export function generateInterface(input: InterfaceOptions): MenuDefinition {
  const options = normalizeOptions(input);
  const theme = options.family === 'mcrs' ? mcrsTheme(options.accent) : deepslateTheme(options.accent);
  const builder = new MenuBuilder(options.id, theme);
  builder.text('title', TITLE_X, TITLE_Y, options.title, theme.titleColor);
  BUILDERS[options.kind](builder, options);

  const decor = new MenuBuilder(options.id, theme);
  decor.layer('background', 0, 0, theme.background(backgroundHeight(options.rows), builder.cells));
  if (theme.titleStrip) decor.layer('title_strip', TITLE_X, TITLE_Y + 9, theme.titleStrip);

  return {
    formatVersion: 1,
    id: options.id,
    name: options.name,
    container: { type: 'chest', rows: options.rows },
    state: builder.state,
    layers: [...decor.layers, ...builder.layers],
    texts: builder.texts,
    slots: builder.slots,
  };
}

/** Rectangle occupé par un texte (même règle que la composition du titre). */
export function textBox(text: TextElement): Rect {
  const width = textWidth(text.value);
  return { x: alignedStart(text.x, width, text.align), y: text.y, width, height: 8 };
}
