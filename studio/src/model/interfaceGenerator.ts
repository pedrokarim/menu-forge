import { NBSP } from '../lib/format';
import { alignedStart, textWidth } from './fontMetrics';
import { GRID_COLUMNS, MAX_ROWS, SLOT_SIZE, TITLE_X, TITLE_Y, WINDOW_WIDTH, chestCell } from './geometry';
import type { Rect } from './geometry';
import { DARK_COLORS } from './darkStyles';
import { composite, darken, lighten, parseColor, readableColor, toHex } from './generator';
import { MCRS_COLORS } from './mcrs';
import type {
  Action,
  Condition,
  GeneratorSpec,
  Layer,
  MenuDefinition,
  PixelIcon,
  Slot,
  SlotArea,
  StateDefinition,
  TextAlign,
  TextElement,
} from './menu';
import { generatedTexturePath } from './menuEdit';
import { digitIcon } from './pixelIcons';

/**
 * Générateur d’interfaces : à partir d’un type (boutique, grille, modale,
 * liste paginée, onglets), d’un nombre de lignes, de boutons et d’une famille
 * de styles, construit un menu complet – couches aux textures générées, zones
 * de slots avec leurs actions, textes, états – prêt à retoucher à la main.
 * Fonction pure : mêmes options, même menu (le studio et les tests s’en servent).
 */

export type InterfaceKind = 'shop' | 'grid' | 'confirm' | 'list' | 'tabs';
export type StyleFamily = 'deepslate' | 'mcrs' | 'dark';
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
  dark: 'Sombre à accent (plat)',
};

export const DEFAULT_ACCENTS: Record<StyleFamily, string> = {
  deepslate: '#52a535',
  mcrs: MCRS_COLORS.gold,
  dark: DARK_COLORS.accent,
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
 * Colonnes de départ de boutons de largeurs `widths` (en cases) entre les
 * colonnes `from` (incluse) et `to` (exclue), selon la disposition.
 *
 * Les cases sont entières : centrer un groupe dont le reste est impair
 * laisserait une demi-case de plus d’un côté. En « centrés » comme en
 * « répartis », une colonne vide est alors insérée au milieu du groupe (entre
 * les deux boutons du milieu, ou juste après celui du milieu) : les deux
 * marges restent égales. Un bouton seul n’a pas ce cas dans le générateur (sa
 * largeur a toujours la parité de la zone).
 */
export function placeRow(widths: readonly number[], from: number, to: number, layout: ButtonLayout): number[] {
  const count = widths.length;
  if (count === 0) return [];
  const available = to - from;
  const total = widths.reduce((sum, width) => sum + width, 0);
  const gap = layout === 'spread' && count > 1 ? Math.max(0, Math.floor((available - total) / (count - 1))) : 0;
  const gaps = Array.from({ length: count - 1 }, () => gap);
  let leftover = available - total - gap * (count - 1);
  if ((layout === 'center' || layout === 'spread') && count > 1 && leftover > 0 && leftover % 2 === 1) {
    gaps[Math.floor((count - 1) / 2)] += 1;
    leftover -= 1;
  }
  let cursor = from;
  if (layout === 'end') cursor = from + leftover;
  else if (layout === 'center' || layout === 'spread') cursor = from + Math.floor(leftover / 2);
  return widths.map((width, index) => {
    const start = cursor;
    cursor += width + (gaps[index] ?? 0);
    return start;
  });
}

/** `count` boutons de même largeur `width` : cf. `placeRow`. */
export function placeButtons(count: number, width: number, from: number, to: number, layout: ButtonLayout): number[] {
  return placeRow(Array.from({ length: Math.max(0, count) }, () => width), from, to, layout);
}

/** Marge intérieure minimale, en pixels, entre un libellé et chaque bord de son bouton. */
export const LABEL_PADDING = 4;

/** Le libellé tient-il dans un bouton de `width` pixels, marges comprises ? */
export function fitsLabel(label: string, width: number): boolean {
  return textWidth(label) + 2 * LABEL_PADDING <= width;
}

/** Numéro de page le plus large affiché (les variables sont remplacées en jeu). */
const PAGE_SAMPLE = '99/99';
const PAGE_VALUE = '{page.number}/{page.count}';
const ELLIPSIS = '…';

/**
 * Titre raccourci pour tenir dans `room` pixels : coupé au dernier mot entier
 * suivi de « … », ou au dernier caractère si le premier mot est trop long.
 */
export function shortenTitle(value: string, room: number): string {
  if (textWidth(value) <= room) return value;
  const words = value.split(' ');
  for (let count = words.length - 1; count >= 1; count--) {
    const candidate = `${words.slice(0, count).join(' ').replace(/[\s,;:.]+$/, '')}${ELLIPSIS}`;
    if (textWidth(candidate) <= room) return candidate;
  }
  const chars = [...value];
  for (let count = chars.length - 1; count >= 1; count--) {
    const candidate = `${chars.slice(0, count).join('').trimEnd()}${ELLIPSIS}`;
    if (textWidth(candidate) <= room) return candidate;
  }
  return ELLIPSIS;
}

/* Thèmes */

/** Rôle visuel d’un bouton. */
type Tone = 'neutral' | 'accent' | 'confirm' | 'danger' | 'special' | 'off' | 'active';

/** Couche de décor posée juste au-dessus du fond (bande de titre, store…). */
interface HeaderLayer {
  id: string;
  x: number;
  y: number;
  spec: GeneratorSpec;
}

interface Theme {
  background(height: number, cells: SlotArea[]): GeneratorSpec;
  header(kind: InterfaceKind): HeaderLayer[];
  /** Ordonnée du titre et des textes de sa ligne (centrés dans la bande du thème). */
  titleY(kind: InterfaceKind): number;
  button(width: number, height: number, tone: Tone): GeneratorSpec;
  /** Couleur opaque du corps d’un bouton, sur laquelle se lit son libellé. */
  buttonFill(tone: Tone): string;
  /** Bouton « Fermer » dessiné (croix), sans libellé. */
  closeButton?: (width: number, height: number) => GeneratorSpec;
  /** Onglet plat, actif ou non. */
  tab?: (width: number, height: number, active: boolean) => GeneratorSpec;
  /** Panneau sous le contenu des onglets, où ceux-ci viennent se coller. */
  contentPanel?: (width: number, height: number, cells: SlotArea[]) => GeneratorSpec;
  /** Cartouche derrière le numéro de page. */
  pageBadge?: (width: number, height: number) => GeneratorSpec;
  titleColor: string;
  /** Autres textes : message, numéro de page, onglet courant. */
  textColor: string;
  /** Couleur du libellé ou de l’icône d’un bouton, lisible sur son corps (éteint : volontairement terne). */
  labelColor(tone: Tone): string;
  /** Décalage vertical du libellé : les boutons en relief ont leur corps plus haut. */
  labelOffset(tone: Tone): number;
}

/**
 * Couleur de libellé d’un thème : la couleur préférée du ton si elle atteint
 * le contraste minimal sur le corps du bouton, sinon la plus contrastée d’une
 * claire et d’une foncée. Un bouton éteint garde sa couleur terne.
 */
function labelColors(theme: {
  fill: (tone: Tone) => string;
  preferred: (tone: Tone) => string;
  light: string;
  dark: string;
  off: string;
}): (tone: Tone) => string {
  return (tone) => (tone === 'off' ? theme.off : readableColor(theme.fill(tone), theme.preferred(tone), [theme.light, theme.dark]));
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
  const fill = (tone: Tone) => colors[tone];
  return {
    background: (height, cells) => ({ style: 'panel', width: WINDOW_WIDTH, height, color: '#c6c6c6', cells }),
    header: () => [],
    titleY: () => TITLE_Y,
    button: (width, height, tone) => ({ style: 'button', width, height, color: colors[tone] }),
    buttonFill: fill,
    titleColor: '#404040',
    textColor: '#404040',
    labelColor: labelColors({ fill, preferred: () => '#ffffff', light: '#ffffff', dark: '#303030', off: '#5a5a5a' }),
    labelOffset: () => 4,
  };
}

/** Fond mc-rs des interfaces générées : opaque, pour masquer entièrement les cases du coffre vanilla. */
export const MCRS_OPAQUE_PANEL = toHex(parseColor(MCRS_COLORS.panel));

function mcrsTheme(accent: string): Theme {
  const raised: Partial<Record<Tone, string>> = { confirm: MCRS_COLORS.green, danger: MCRS_COLORS.red, special: MCRS_COLORS.special };
  const panel = parseColor(MCRS_OPAQUE_PANEL);
  const base = parseColor(MCRS_COLORS.button);
  const hovered = { ...lighten(base, 0.12), a: Math.min(255, base.a + 20) };
  const fill = (tone: Tone): string => {
    const color = raised[tone];
    if (color) return color;
    if (tone === 'off') return toHex(composite(parseColor('#15151fcc'), panel));
    if (tone === 'active') return toHex(darken(parseColor(accent), 0.7));
    return toHex(composite(tone === 'accent' ? hovered : base, panel));
  };
  return {
    background: (height, cells) => ({
      style: 'mcrs_panel',
      width: WINDOW_WIDTH,
      height,
      color: MCRS_OPAQUE_PANEL,
      cells,
      cellStyle: 'mcrs_slot',
      // Rayon 1 : seul le pixel du coin est retiré, là où la fenêtre vanilla est déjà transparente.
      radius: 1,
      borderWidth: 1,
      borderColor: MCRS_COLORS.panelBorder,
    }),
    header: () => [
      { id: 'title_strip', x: TITLE_X, y: TITLE_Y + 9, spec: { style: 'mcrs_strip', width: WINDOW_WIDTH - 2 * TITLE_X, height: 1, color: accent } },
    ],
    titleY: () => TITLE_Y,
    button: (width, height, tone) => {
      const color = raised[tone];
      if (color) return { style: 'mcrs_raised', width, height, color, shadow: 2 };
      if (tone === 'off') return { style: 'mcrs_button', width, height, color: '#15151fcc', borderColor: '#26263a' };
      const state = tone === 'active' ? 'pressed' : tone === 'accent' ? 'hover' : 'normal';
      return { style: 'mcrs_button', width, height, color: MCRS_COLORS.button, state, accent };
    },
    buttonFill: fill,
    titleColor: MCRS_COLORS.text,
    textColor: MCRS_COLORS.text,
    // Onglet actif : l’accent éclairci (il reste reconnaissable), jamais l’accent pur sur sa propre teinte.
    labelColor: labelColors({
      fill,
      preferred: (tone) => (tone === 'active' ? toHex(lighten(parseColor(accent), 0.6)) : MCRS_COLORS.text),
      light: MCRS_COLORS.text,
      dark: '#15151f',
      off: '#6c6c80',
    }),
    labelOffset: (tone) => (raised[tone] ? 3 : 4),
  };
}

/**
 * Sombre à accent : fenêtre plate à cadre fin, bandeau de titre, titre à
 * l’accent, boutons plats, croix rouge pour fermer, onglets collés au panneau
 * du contenu, store rayé au-dessus d’une boutique, numéro de page en cartouche.
 */
function darkTheme(accent: string): Theme {
  const pressed: Partial<Record<Tone, string>> = { active: accent, confirm: DARK_COLORS.market, danger: DARK_COLORS.accent, special: '#8a3ab0' };
  const band = (height: number): GeneratorSpec => ({ style: 'flat', width: WINDOW_WIDTH - 4, height, color: DARK_COLORS.band });
  const fill = (tone: Tone): string => {
    const color = pressed[tone];
    if (color) return color;
    if (tone === 'off') return '#202028';
    if (tone === 'accent') return toHex(lighten(parseColor('#303038'), 0.05));
    return '#303038';
  };
  return {
    background: (height, cells) => ({
      style: 'dark_panel',
      width: WINDOW_WIDTH,
      height,
      color: DARK_COLORS.panel,
      borderWidth: 1,
      cells,
      cellStyle: 'dark_slot',
    }),
    // Boutique : store de 4 px puis bandeau de 11 px (y 5 à 15), où titre et cartouche se centrent.
    header: (kind) =>
      kind === 'shop'
        ? [
            { id: 'awning', x: 2, y: 1, spec: { style: 'dark_awning', width: WINDOW_WIDTH - 4, height: 4, color: accent, tile: 4 } },
            { id: 'title_band', x: 2, y: 5, spec: band(11) },
          ]
        : [{ id: 'title_band', x: 2, y: 2, spec: band(13) }],
    titleY: (kind) => (kind === 'shop' ? TITLE_Y + 1 : TITLE_Y),
    button: (width, height, tone) => {
      const color = pressed[tone];
      if (color) return { style: 'dark_button', width, height, color: DARK_COLORS.panel, state: 'pressed', accent: color };
      if (tone === 'off') return { style: 'dark_button', width, height, color: '#202028', borderColor: '#303038' };
      if (tone === 'accent') return { style: 'dark_button', width, height, color: '#303038', state: 'hover', accent };
      return { style: 'dark_button', width, height, color: '#303038' };
    },
    buttonFill: fill,
    // Fermer reste rouge quel que soit l’accent : une croix verte ou cyan passerait pour une validation.
    closeButton: (width, height) => ({ style: 'dark_close', width, height, color: DARK_COLORS.accent }),
    tab: (width, height, active) =>
      active ? { style: 'dark_tab', width, height, color: '#303038', state: 'pressed', accent } : { style: 'dark_tab', width, height, color: '#303038' },
    contentPanel: (width, height, cells) => ({ style: 'dark_panel', width, height, color: '#202028', borderWidth: 1, cells, cellStyle: 'dark_slot' }),
    pageBadge: (width, height) => ({ style: 'dark_badge', width, height, color: DARK_COLORS.hollow, accent }),
    titleColor: accent,
    textColor: DARK_COLORS.text,
    labelColor: labelColors({ fill, preferred: () => DARK_COLORS.text, light: DARK_COLORS.text, dark: DARK_COLORS.hollow, off: DARK_COLORS.muted }),
    labelOffset: () => 4,
  };
}

const THEMES: Record<StyleFamily, (accent: string) => Theme> = {
  deepslate: deepslateTheme,
  mcrs: mcrsTheme,
  dark: darkTheme,
};

/** Corps et libellé des boutons d’un menu généré, pour les contrôles de contraste. */
export function buttonColors(family: StyleFamily, accent: string): Array<{ tone: string; fill: string; label: string }> {
  const theme = THEMES[family](accent);
  const tones: Tone[] = ['neutral', 'accent', 'confirm', 'danger', 'special', 'active'];
  return tones.map((tone) => ({ tone, fill: theme.buttonFill(tone), label: theme.labelColor(tone) }));
}

/* Construction */

interface ButtonDef {
  id: string;
  label: string;
  /** Icône pixel d’un bouton d’une case (le libellé complet n’y tient pas). */
  icon?: PixelIcon;
  tone: Tone;
  /** Balise MiniMessage de couleur du nom de l’item. */
  tag: string;
  actions: Action[];
}

/** Contenu d’un bouton : un libellé écrit, ou une icône peinte dans sa texture. */
interface ButtonContent {
  label?: string;
  icon?: PixelIcon;
}

class MenuBuilder {
  readonly layers: Layer[] = [];
  readonly texts: TextElement[] = [];
  readonly slots: Slot[] = [];
  readonly state: Record<string, StateDefinition> = {};
  readonly cells: SlotArea[] = [];
  /** Cellules dessinées dans le panneau du contenu (onglets), plutôt que dans le fond. */
  readonly panelCells: SlotArea[] = [];
  readonly menuId: string;
  readonly theme: Theme;
  /** Ordonnée de la ligne du titre. */
  readonly titleY: number;

  constructor(menuId: string, theme: Theme, titleY = TITLE_Y) {
    this.menuId = menuId;
    this.theme = theme;
    this.titleY = titleY;
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

  /** Place libre à droite du titre, 6 px d’écart compris. */
  titleRoom(): number {
    const title = this.texts.find((text) => text.id === 'title');
    return WINDOW_WIDTH - 2 * TITLE_X - (title ? textWidth(title.value) : 0) - 6;
  }

  /**
   * Texte aligné à droite dans la ligne du titre, s’il tient à côté du titre.
   * `sample` = la valeur affichée la plus large (les variables sont remplacées en jeu).
   */
  titleSide(id: string, value: string, visibleWhen?: Condition, sample = value) {
    if (textWidth(sample) <= this.titleRoom()) this.text(id, WINDOW_WIDTH - TITLE_X, this.titleY, value, this.theme.textColor, 'right', visibleWhen);
  }

  /** Bouton dessiné (couche, et libellé ou icône) sur une zone d’une ligne. */
  buttonLayer(id: string, area: SlotArea, tone: Tone, content: ButtonContent, visibleWhen?: Condition, spec?: GeneratorSpec) {
    const rect = buttonRect(area);
    const color = this.theme.labelColor(tone);
    const base = spec ?? this.theme.button(rect.width, rect.height, tone);
    this.layer(id, rect.x, rect.y, content.icon ? { ...base, icon: content.icon, iconColor: color } : base, visibleWhen);
    if (content.label && fitsLabel(content.label, rect.width)) {
      this.text(`${id}_label`, rect.x + Math.floor(rect.width / 2), rect.y + this.theme.labelOffset(tone), content.label, color, 'center', visibleWhen);
    }
  }

  button(def: ButtonDef, area: SlotArea) {
    const wide = (area.width ?? 1) > 1;
    const rect = buttonRect(area);
    const drawn = def.icon === 'close' && this.theme.closeButton ? this.theme.closeButton(rect.width, rect.height) : undefined;
    this.buttonLayer(def.id, area, def.tone, drawn ? {} : wide ? { label: def.label } : { icon: def.icon }, undefined, drawn);
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
      { id: 'prev', col: 0, flag: 'page.hasPrev', type: 'prevPage', icon: 'prev', name: 'Page précédente' },
      { id: 'next', col: GRID_COLUMNS - 1, flag: 'page.hasNext', type: 'nextPage', icon: 'next', name: 'Page suivante' },
    ] as const;
    for (const arrow of arrows) {
      const area = { col: arrow.col, row };
      const on: Condition = { flag: arrow.flag };
      const off: Condition = { not: { flag: arrow.flag } };
      this.buttonLayer(`${arrow.id}_off`, area, 'off', { icon: arrow.icon }, off);
      this.buttonLayer(`${arrow.id}_on`, area, 'accent', { icon: arrow.icon }, on);
      this.slots.push({
        id: arrow.id,
        kind: 'button',
        area,
        item: { invisible: true, name: `<gray>${arrow.name}` },
        enabledWhen: on,
        onClick: [{ type: arrow.type, list }],
      });
    }
  }

  /** Plus longue suite de colonnes sans slot sur la ligne `row`, entre les flèches (première en cas d’égalité). */
  freeRun(row: number): { start: number; length: number } | null {
    const taken = new Set<number>();
    for (const slot of this.slots) {
      const { col, row: top, width = 1, height = 1 } = slot.area;
      if (row >= top && row < top + height) for (let dx = 0; dx < width; dx++) taken.add(col + dx);
    }
    let best: { start: number; length: number } | null = null;
    let start = -1;
    for (let col = 1; col <= GRID_COLUMNS - 1; col++) {
      const free = col < GRID_COLUMNS - 1 && !taken.has(col);
      if (free && start < 0) start = col;
      if (!free && start >= 0) {
        if (!best || col - start > best.length) best = { start, length: col - start };
        start = -1;
      }
    }
    return best;
  }

  /**
   * Numéro de page, jamais omis : en haut à droite s’il tient à côté du titre ;
   * sinon dans la plus longue suite de cases libres de la barre `row` ; sinon
   * le titre est raccourci au dernier mot entier, suivi de « … », pour lui
   * faire place. Dans une cartouche si le thème en dessine une.
   */
  pageLabel(row: number) {
    const badge = this.theme.pageBadge;
    const textSize = textWidth(PAGE_SAMPLE);
    const width = badge ? textSize + 6 : textSize;
    const run = this.freeRun(row);
    if (width > this.titleRoom() && run && run.length * SLOT_SIZE >= width + 2 * (LABEL_PADDING - 1)) {
      // Au milieu des cases libres, centré verticalement dans la case (glyphes de 7 px).
      const cell = chestCell(run.start, row);
      const center = cell.x + (run.length * SLOT_SIZE) / 2;
      if (badge) this.layer('page_badge', center - width / 2, cell.y + 3, badge(width, 11));
      this.text('page_label', center, cell.y + 5, PAGE_VALUE, this.theme.textColor, 'center');
      return;
    }
    if (width > this.titleRoom()) {
      const title = this.texts.find((text) => text.id === 'title');
      if (title) title.value = shortenTitle(title.value, WINDOW_WIDTH - 2 * TITLE_X - 6 - width);
    }
    if (!badge) {
      this.text('page_label', WINDOW_WIDTH - TITLE_X, this.titleY, PAGE_VALUE, this.theme.textColor, 'right');
      return;
    }
    const x = WINDOW_WIDTH - TITLE_X - width;
    this.layer('page_badge', x, this.titleY - 2, badge(width, 11));
    this.text('page_label', x + width / 2, this.titleY, PAGE_VALUE, this.theme.textColor, 'center');
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

const CLOSE: ButtonDef = {
  id: 'close',
  label: 'Fermer',
  icon: 'close',
  tone: 'danger',
  tag: '<red>',
  actions: [{ type: 'close' }],
};
const BACK: ButtonDef = { id: 'back', label: 'Retour', icon: 'back', tone: 'neutral', tag: '<white>', actions: [{ type: 'back' }] };

function customButton(index: number): ButtonDef {
  return {
    id: `action_${index}`,
    label: `Action ${index}`,
    icon: digitIcon(index),
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
  { id: 'sell_all', label: 'Tout vendre', icon: 'sell', tone: 'accent', tag: '<gold>', actions: [{ type: 'custom', id: 'shop_sell_all' }] },
  { id: 'balance', label: 'Mon solde', icon: 'balance', tone: 'neutral', tag: '<yellow>', actions: [{ type: 'command', command: 'balance', as: 'player' }] },
  { id: 'help', label: 'Aide', icon: 'help', tone: 'special', tag: '<light_purple>', actions: [{ type: 'custom', id: 'shop_help' }] },
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

/** Largeur en cases d’un choix de modale (au moins deux) : son libellé y tient avec ses marges. */
export function choiceCells(label: string): number {
  let cells = 2;
  while (!fitsLabel(label, SLOT_SIZE * cells - 2) && cells < GRID_COLUMNS) cells++;
  return cells;
}

function buildShop(b: MenuBuilder, options: InterfaceOptions) {
  const list = 'shop_items';
  const bar = options.rows - 1;
  b.state.page = { type: 'page', list };
  b.list('articles', list, { col: 0, row: 0, width: GRID_COLUMNS, height: bar });
  b.pager(list, bar);
  const defs = SHOP_BUTTONS.slice(0, options.buttons);
  placeButtons(defs.length, 1, 1, GRID_COLUMNS - 1, options.layout).forEach((col, index) => b.button(defs[index], rowArea(col, bar)));
  b.pageLabel(bar);
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
  b.text('message', WINDOW_WIDTH / 2, top + 5, `Confirmer cette action${NBSP}?`, b.theme.textColor, 'center');
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
  // Même largeur pour tous les choix quand la rangée le permet, sinon chacun la sienne.
  const needed = defs.map((def) => choiceCells(def.label));
  const widest = Math.max(...needed);
  const widths = widest * defs.length <= GRID_COLUMNS ? defs.map(() => widest) : needed;
  placeRow(widths, 0, GRID_COLUMNS, options.layout).forEach((col, index) => b.button(defs[index], rowArea(col, row, widths[index])));
}

function buildList(b: MenuBuilder, options: InterfaceOptions) {
  const list = 'items';
  const bar = options.rows - 1;
  b.state.page = { type: 'page', list };
  b.list('entries', list, { col: 0, row: 0, width: GRID_COLUMNS, height: bar });
  b.pager(list, bar);
  const defs = barButtons(options.buttons, BACK);
  placeButtons(defs.length, 1, 1, GRID_COLUMNS - 1, options.layout).forEach((col, index) => b.button(defs[index], rowArea(col, bar)));
  b.pageLabel(bar);
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
    const text = fitsLabel(label, rect.width) ? label : String(index + 1);
    const tab = b.theme.tab;
    b.buttonLayer(value, area, 'neutral', { label: text }, { not: active }, tab?.(rect.width, rect.height, false));
    b.buttonLayer(`${value}_active`, area, 'active', { label: text }, active, tab?.(rect.width, rect.height, true));
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
  if (b.theme.contentPanel) b.panelCells.push(content);
  else b.cells.push(content);
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
  const theme = THEMES[options.family](options.accent);
  const builder = new MenuBuilder(options.id, theme, theme.titleY(options.kind));
  builder.text('title', TITLE_X, builder.titleY, options.title, theme.titleColor);
  BUILDERS[options.kind](builder, options);

  const decor = new MenuBuilder(options.id, theme);
  decor.layer('background', 0, 0, theme.background(backgroundHeight(options.rows), builder.cells));
  for (const header of theme.header(options.kind)) decor.layer(header.id, header.x, header.y, header.spec);
  if (builder.panelCells.length > 0 && theme.contentPanel) {
    // Panneau du contenu des onglets : deux pixels autour des cases ; son cadre du haut passe sous les onglets.
    const top = chestCell(0, 1).y - 2;
    const height = chestCell(0, options.rows).y + 1 - top;
    decor.layer('content_panel', 5, top, theme.contentPanel(WINDOW_WIDTH - 10, height, builder.panelCells));
  }

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
