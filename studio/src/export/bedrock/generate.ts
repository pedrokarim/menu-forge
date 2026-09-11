import { NBSP } from '../../lib/format';
import type { Action, Condition, ItemSpec, MenuDefinition, Slot, SlotArea, SlotKind, StateDefinition, TextAlign } from '../../model/menu';
import { cropAndPad, measureImage } from '../image';
import type { RgbaImage } from '../image';
import { prettyJson, utf8 } from '../json';
import { DEFAULT_NAMESPACE, isValidNamespace } from '../pack';
import type { TextureLoader } from '../pack';
import { encodePng } from '../png';
import {
  CELL,
  COLUMNS,
  DEFAULT_TEXT_COLOR,
  GRID_X,
  GRID_Y,
  INERT_MARKER,
  MAX_ROWS,
  MENU_FORGE_FLAG,
  PACK_DIR,
  ROUTER_NAMESPACE,
  RUNTIME_FILE,
  RUNTIME_FORMAT,
  RUNTIME_FORMAT_VERSION,
  TEXTURE_ROOT,
  TEXT_MARKER,
  UI_DIR,
  WHITE_TEXTURE,
  layerToken,
  menuNamespace,
  menuToken,
  textEntryPrefix,
  textToken,
} from './constants';
import { bedrockIcon, bedrockSound, hexToUiColor, miniMessageToLegacy } from './convert';

/**
 * Export Bedrock d’un ensemble de menus **résolus** (voir `docs/bedrock.md`) :
 * le pack de ressources (manifest, dispositions JSON UI, textures recadrées)
 * et le descripteur d’exécution lu par le serveur. Génération déterministe :
 * mêmes menus, textures, espace de noms et version donnent les mêmes octets.
 */

export type PackVersion = [number, number, number];

/** Élément figé conditionnel : le serveur ajoute `token` au titre si `visibleWhen` est vraie. */
export interface RuntimeToken {
  token: string;
  /** Identifiant de la couche (ou `text` pour un texte figé). */
  layer?: string;
  text?: string;
  visibleWhen: Condition;
}

/** Texte dynamique : l’entrée `entry` vaut `prefix` + valeur interpolée. */
export interface RuntimeText {
  id: string;
  entry: number;
  prefix: string;
  value: string;
  visibleWhen?: Condition;
}

export interface RuntimeSlot {
  id: string;
  kind: SlotKind;
  /** Index des cases couvertes (`colonne + 9 × ligne`), en ordre de lecture. */
  cells: number[];
  /** Texte du bouton (codes `§`) ; vide pour une liste ou un slot `input`. */
  label: string;
  /** Chemin de texture Bedrock de l’icône, ou `null`. */
  icon: string | null;
  list?: string;
  onClick?: Action[];
  visibleWhen?: Condition;
  enabledWhen?: Condition;
}

export interface RuntimeMenu {
  id: string;
  name: string;
  rows: number;
  /** Nombre de boutons à envoyer : `9 × rows` cases puis les textes dynamiques. */
  entries: number;
  token: string;
  state: Record<string, StateDefinition>;
  tokens: RuntimeToken[];
  texts: RuntimeText[];
  slots: RuntimeSlot[];
}

export interface RuntimeDescriptor {
  format: typeof RUNTIME_FORMAT;
  formatVersion: typeof RUNTIME_FORMAT_VERSION;
  flag: string;
  pack: { name: string; uuid: string; version: PackVersion };
  warnings: string[];
  menus: RuntimeMenu[];
}

export interface BedrockOptions {
  /** Version du pack (voir `nextPackVersion`). */
  version: PackVersion;
  /** Espace de noms d’export : sert à dériver les uuid du pack. */
  namespace?: string;
}

export interface BedrockExport {
  /** Chemin relatif au dossier cible (`pack/…`, `runtime.json`) → contenu, triés par chemin. */
  files: Map<string, Uint8Array>;
  runtime: RuntimeDescriptor;
  warnings: string[];
}

export const PACK_NAME = 'Menu Forge';
const PACK_DESCRIPTION = 'Menus Menu Forge pour Bedrock (générés par le studio)';
const MIN_ENGINE_VERSION = [1, 21, 0];
/** Variables `{nom}` : mêmes noms que `interpolate` (model/preview). */
const VARIABLE = /\{[A-Za-z0-9_.:-]+\}/;

/** Version suivante du pack : `[1, 0, 0]` au premier export, sinon le dernier chiffre + 1. */
export function nextPackVersion(previous: readonly unknown[] | null | undefined): PackVersion {
  const valid =
    Array.isArray(previous) &&
    previous.length === 3 &&
    previous.every((part) => typeof part === 'number' && Number.isInteger(part) && part >= 0);
  if (!valid) return [1, 0, 0];
  const [major, minor, patch] = previous as number[];
  return [major, minor, patch + 1];
}

/** uuid stable dérivé d’un texte (SHA-256, version 8 « personnalisée » de la RFC 9562). */
export async function derivedUuid(seed: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed)));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Un texte peut être figé dans le pack s’il n’a pas de variable et n’est pas lu comme une liaison (`#…`) ou une variable (`$…`) par le JSON UI. */
export function isStaticText(value: string): boolean {
  return !VARIABLE.test(value) && !value.startsWith('#') && !value.startsWith('$');
}

function jsonFile(value: unknown): Uint8Array {
  return utf8(`${prettyJson(value)}\n`);
}

const titleBinding = () => ({
  binding_type: 'global',
  binding_condition: 'none',
  binding_name: '#title_text',
  binding_name_override: '#title_text',
});

/** Expression JSON UI : vrai si `text` contient `token` (la soustraction retire la sous-chaîne). */
const contains = (text: string, token: string) => `(not ((${text} - '${token}') = ${text}))`;

const view = (source: string, target: string) => ({
  binding_type: 'view',
  source_property_name: source,
  target_property_name: target,
});

/** Liaisons d’un élément visible seulement si le titre contient `token`. */
const titleTokenBindings = (token: string) => [titleBinding(), view(contains('#title_text', token), '#visible')];

const collectionBinding = (name: string, override?: string) =>
  override === undefined
    ? { binding_type: 'collection', binding_collection_name: 'form_buttons', binding_name: name }
    : { binding_type: 'collection', binding_collection_name: 'form_buttons', binding_name: name, binding_name_override: override };

const ANCHORS: Record<TextAlign, string> = { left: 'top_left', center: 'top_middle', right: 'top_right' };

/** Bouton actif : texte non vide, ni inerte, ni texte dynamique. */
const ACTIVE_BUTTON = `(not ((#form_button_text = '') or ${contains('#form_button_text', INERT_MARKER)} or ${contains('#form_button_text', TEXT_MARKER)}))`;

function textureFileName(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9_.-]/gu, '_');
}

/** Cases couvertes par une zone, en ordre de lecture, rognées à la grille. */
function slotCells(area: SlotArea, rows: number): { cells: number[]; clipped: boolean } {
  const cells: number[] = [];
  const width = area.width ?? 1;
  const height = area.height ?? 1;
  let clipped = false;
  for (let row = area.row; row < area.row + height; row++) {
    for (let col = area.col; col < area.col + width; col++) {
      if (col < 0 || row < 0 || col >= COLUMNS || row >= rows) {
        clipped = true;
        continue;
      }
      cells.push(col + COLUMNS * row);
    }
  }
  return { cells, clipped };
}

function itemIcon(item: ItemSpec, warn: (message: string) => void): string | null {
  if (item.invisible) return null;
  if (item.head !== undefined) {
    warn('tête de joueur sans rendu dans un formulaire Bedrock : pas d’icône');
    return null;
  }
  if (item.ref !== undefined) {
    warn(`item « ${item.ref} » fourni par l’adaptateur du serveur : pas d’icône à l’export`);
    return null;
  }
  if (!item.material) return null;
  const icon = bedrockIcon(item.material);
  if (icon.approximate) warn(`icône de ${item.material} devinée (${icon.path})`);
  return icon.path;
}

function bedrockAction(action: Action, warn: (message: string) => void): Action {
  if (action.type !== 'sound') return structuredClone(action);
  const mapped = bedrockSound(action.sound);
  if (!mapped.known) warn(`son « ${action.sound} » sans correspondance Bedrock connue, gardé tel quel`);
  return { ...action, sound: mapped.sound };
}

function runtimeSlot(slot: Slot, rows: number, warn: (message: string) => void): RuntimeSlot {
  const slotWarn = (message: string) => warn(`slot « ${slot.id} », ${message}`);
  const { cells, clipped } = slotCells(slot.area, rows);
  if (clipped) slotWarn('zone hors de la grille, rognée');
  let label = '';
  let icon: string | null = null;
  if (slot.kind === 'button' || slot.kind === 'decoration') {
    const item = slot.item ?? {};
    label = item.name ? miniMessageToLegacy(item.name, slotWarn) : '';
    if (label.trim() === '') label = slot.id;
    icon = itemIcon(item, slotWarn);
  } else if (slot.kind === 'input') {
    slotWarn('type input sans équivalent dans un formulaire Bedrock, ignoré');
  }
  const runtime: RuntimeSlot = { id: slot.id, kind: slot.kind, cells, label, icon };
  if (slot.list !== undefined) runtime.list = slot.list;
  if (slot.onClick && slot.onClick.length > 0) runtime.onClick = slot.onClick.map((action) => bedrockAction(action, slotWarn));
  if (slot.visibleWhen) runtime.visibleWhen = structuredClone(slot.visibleWhen);
  if (slot.enabledWhen) runtime.enabledWhen = structuredClone(slot.enabledWhen);
  return runtime;
}

function textColor(color: string | undefined, warn: (message: string) => void, id: string): [number, number, number] {
  const parsed = hexToUiColor(color ?? DEFAULT_TEXT_COLOR);
  if (parsed) return parsed;
  warn(`texte « ${id} », couleur « ${color} » invalide, remplacée par ${DEFAULT_TEXT_COLOR}`);
  return hexToUiColor(DEFAULT_TEXT_COLOR) as [number, number, number];
}

interface BuiltMenu {
  layout: unknown;
  textures: Map<string, Uint8Array>;
  runtime: RuntimeMenu;
}

async function buildMenu(menu: MenuDefinition, images: ReadonlyMap<string, RgbaImage>, warnings: string[]): Promise<BuiltMenu> {
  const id = menu.id;
  const namespace = menuNamespace(id);
  const warn = (message: string) => warnings.push(`${id}${NBSP}: ${message}`);
  const rows = Math.min(MAX_ROWS, Math.max(1, Math.trunc(menu.container.rows)));
  const cellCount = COLUMNS * rows;
  const texts = menu.texts ?? [];

  const textures = new Map<string, Uint8Array>();
  const controls: unknown[] = [];
  const tokens: RuntimeToken[] = [];
  const usedFileNames = new Set<string>();

  // Couches : une image recadrée par couche non vide, empilées dans l’ordre du menu.
  for (const [index, layer] of menu.layers.entries()) {
    const image = images.get(layer.texture);
    const bounds = image ? measureImage(image) : null;
    if (!image || !bounds) continue;
    let fileName = textureFileName(layer.id);
    if (usedFileNames.has(fileName)) fileName = `${fileName}_${index}`;
    usedFileNames.add(fileName);
    const texture = `${TEXTURE_ROOT}/${id}/${fileName}`;
    textures.set(`${texture}.png`, await encodePng(cropAndPad(image, bounds, bounds.height)));
    const control: Record<string, unknown> = {
      type: 'image',
      texture,
      size: [bounds.width, bounds.height],
      offset: [layer.x + bounds.cropX, layer.y + bounds.cropY],
      anchor_from: 'top_left',
      anchor_to: 'top_left',
      layer: index + 1,
    };
    if (layer.visibleWhen) {
      const token = layerToken(index);
      control.bindings = titleTokenBindings(token);
      tokens.push({ token, layer: layer.id, visibleWhen: structuredClone(layer.visibleWhen) });
    }
    controls.push({ [`layer_${index}`]: control });
  }

  // Textes : figés dans le pack, ou portés par une entrée de la grille s’ils ont des variables.
  const dynamicTexts: RuntimeText[] = [];
  const cellLabels: unknown[] = [];
  for (const [index, text] of texts.entries()) {
    const color = textColor(text.color, warn, text.id);
    const anchor = ANCHORS[text.align ?? 'left'];
    if (isStaticText(text.value)) {
      const control: Record<string, unknown> = {
        type: 'label',
        text: text.value,
        localize: false,
        color,
        shadow: false,
        size: ['default', 'default'],
        offset: [text.x, text.y],
        anchor_from: 'top_left',
        anchor_to: anchor,
        layer: menu.layers.length + index + 1,
      };
      if (text.visibleWhen) {
        const token = textToken(index);
        control.bindings = titleTokenBindings(token);
        tokens.push({ token, text: text.id, visibleWhen: structuredClone(text.visibleWhen) });
      }
      controls.push({ [`text_${index}`]: control });
      continue;
    }
    const k = dynamicTexts.length;
    const entry = cellCount + k;
    const prefix = textEntryPrefix(k);
    const hostX = GRID_X + CELL * (entry % COLUMNS);
    const hostY = GRID_Y + CELL * Math.floor(entry / COLUMNS);
    cellLabels.push({
      [`text_${index}`]: {
        type: 'label',
        text: '#text',
        localize: false,
        color,
        shadow: false,
        size: ['default', 'default'],
        offset: [text.x - hostX, text.y - hostY],
        anchor_from: 'top_left',
        anchor_to: anchor,
        layer: 3,
        bindings: [
          collectionBinding('#form_button_text'),
          view(`(#form_button_text - '${prefix}')`, '#text'),
          view(contains('#form_button_text', prefix), '#visible'),
        ],
      },
    });
    const runtimeText: RuntimeText = { id: text.id, entry, prefix, value: text.value };
    if (text.visibleWhen) runtimeText.visibleWhen = structuredClone(text.visibleWhen);
    dynamicTexts.push(runtimeText);
  }

  // Grille des slots (et, dessous, les lignes qui portent les textes dynamiques).
  const gridRows = rows + Math.ceil(dynamicTexts.length / COLUMNS);
  controls.push({
    slots: {
      type: 'grid',
      grid_dimensions: [COLUMNS, gridRows],
      size: [COLUMNS * CELL, gridRows * CELL],
      offset: [GRID_X, GRID_Y],
      anchor_from: 'top_left',
      anchor_to: 'top_left',
      layer: menu.layers.length + texts.length + 1,
      grid_item_template: `${namespace}.cell`,
      collection_name: 'form_buttons',
      bindings: [{ binding_name: '#form_button_length', binding_name_override: '#maximum_grid_items' }],
    },
  });

  const layout = {
    namespace,
    main_panel: {
      type: 'panel',
      size: [176, 114 + CELL * rows],
      anchor_from: 'center',
      anchor_to: 'center',
      controls,
    },
    cell: {
      type: 'panel',
      size: [CELL, CELL],
      bindings: [{ binding_type: 'collection_details', binding_collection_name: 'form_buttons' }],
      controls: [
        {
          icon: {
            type: 'image',
            size: [16, 16],
            layer: 1,
            bindings: [
              collectionBinding('#form_button_texture', '#texture'),
              collectionBinding('#form_button_texture_file_system', '#texture_file_system'),
              view("(not ((#texture = '') or (#texture = 'loading')))", '#visible'),
            ],
          },
        },
        { [`button@${namespace}.cell_button`]: { layer: 2 } },
        ...cellLabels,
      ],
    },
    'cell_button@common.button': {
      size: [CELL, CELL],
      default_control: 'default',
      hover_control: 'hover',
      pressed_control: 'pressed',
      $pressed_button_name: 'button.form_button_click',
      controls: [
        { [`default@${namespace}.cell_face`]: { $state: 'default' } },
        { [`hover@${namespace}.cell_face`]: { $state: 'hover' } },
        { [`pressed@${namespace}.cell_face`]: { $state: 'pressed' } },
      ],
      bindings: [
        { binding_type: 'collection', binding_condition: 'none', binding_collection_name: 'form_buttons' },
        { binding_type: 'collection_details', binding_collection_name: 'form_buttons' },
        collectionBinding('#form_button_text'),
        view(ACTIVE_BUTTON, '#visible'),
      ],
    },
    cell_face: {
      type: 'panel',
      size: [CELL, CELL],
      '$highlight_alpha|default': 0,
      variables: [
        { requires: "($state = 'hover')", $highlight_alpha: 0.45 },
        { requires: "($state = 'pressed')", $highlight_alpha: 0.7 },
      ],
      controls: [
        {
          highlight: {
            type: 'image',
            texture: WHITE_TEXTURE,
            color: [1, 1, 1],
            alpha: '$highlight_alpha',
            size: [16, 16],
            layer: 1,
          },
        },
      ],
    },
  };

  const runtime: RuntimeMenu = {
    id,
    name: menu.name,
    rows,
    entries: cellCount + dynamicTexts.length,
    token: menuToken(id),
    state: structuredClone(menu.state ?? {}),
    tokens,
    texts: dynamicTexts,
    slots: (menu.slots ?? []).map((slot) => runtimeSlot(slot, rows, warn)),
  };
  return { layout, textures, runtime };
}

/** Routeur : voile, une disposition par menu (visible si le titre contient son jeton), bouton de fermeture. */
function routerLayout(menus: readonly MenuDefinition[]): unknown {
  const controls: unknown[] = [
    {
      backdrop: {
        type: 'image',
        texture: WHITE_TEXTURE,
        color: [0, 0, 0],
        alpha: 0.55,
        size: ['100%', '100%'],
        layer: 0,
      },
    },
    ...menus.map((menu) => {
      const visible = contains('#title_text', menuToken(menu.id));
      return {
        [`menu_${menu.id}@${menuNamespace(menu.id)}.main_panel`]: {
          // Visibilité seulement : une liaison sur `#enabled` n'est pas pilotée par Bedrock, le menu
          // resterait désactivé (affiché mais sans clic possible, constaté en jeu).
          visible: false,
          layer: 1,
          bindings: [titleBinding(), view(visible, '#visible')],
        },
      };
    }),
    { 'close@common.close_button': { anchor_from: 'top_right', anchor_to: 'top_right', offset: [-4, 4], layer: 50 } },
  ];
  return { namespace: ROUTER_NAMESPACE, main_panel: { type: 'panel', size: ['100%', '100%'], controls } };
}

function whiteImage(): RgbaImage {
  return { width: 2, height: 2, data: new Uint8Array(2 * 2 * 4).fill(255) };
}

/**
 * Génère l’export Bedrock des menus **résolus** (gabarits et composants ne
 * sont pas exportés).
 *
 * @throws si une texture est introuvable, l’espace de noms ou la version invalide
 */
export async function generateBedrockExport(
  menus: readonly MenuDefinition[],
  load: TextureLoader,
  options: BedrockOptions,
): Promise<BedrockExport> {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  if (!isValidNamespace(namespace)) {
    throw new Error(`Espace de noms invalide « ${namespace} » (attendu${NBSP}: [a-z0-9_.-]+)`);
  }
  const version = options.version;
  if (version.length !== 3 || !version.every((part) => Number.isInteger(part) && part >= 0)) {
    throw new Error(`Version de pack invalide${NBSP}: ${JSON.stringify(version)}`);
  }

  const exported = menus.filter((menu) => !menu.template && !menu.component);
  const images = new Map<string, RgbaImage>();
  for (const menu of exported) {
    for (const layer of menu.layers) {
      if (images.has(layer.texture)) continue;
      const image = await load(layer.texture);
      if (!image) throw new Error(`Texture introuvable${NBSP}: « ${layer.texture} »`);
      images.set(layer.texture, image);
    }
  }

  const warnings: string[] = [];
  const files = new Map<string, Uint8Array>();
  const runtimeMenus: RuntimeMenu[] = [];
  for (const menu of exported) {
    const built = await buildMenu(menu, images, warnings);
    files.set(`${PACK_DIR}/${UI_DIR}/${menu.id}.json`, jsonFile(built.layout));
    for (const [path, data] of built.textures) files.set(`${PACK_DIR}/${path}`, data);
    runtimeMenus.push(built.runtime);
  }
  files.set(`${PACK_DIR}/${UI_DIR}/router.json`, jsonFile(routerLayout(exported)));
  files.set(
    `${PACK_DIR}/ui/_ui_defs.json`,
    jsonFile({ ui_defs: [`${UI_DIR}/router.json`, ...exported.map((menu) => `${UI_DIR}/${menu.id}.json`)] }),
  );
  files.set(`${PACK_DIR}/${WHITE_TEXTURE}.png`, await encodePng(whiteImage()));

  const headerUuid = await derivedUuid(`menu-forge:bedrock:${namespace}:header`);
  const moduleUuid = await derivedUuid(`menu-forge:bedrock:${namespace}:module`);
  files.set(
    `${PACK_DIR}/manifest.json`,
    jsonFile({
      format_version: 2,
      header: {
        name: PACK_NAME,
        description: PACK_DESCRIPTION,
        uuid: headerUuid,
        version: [...version],
        min_engine_version: MIN_ENGINE_VERSION,
      },
      modules: [{ type: 'resources', uuid: moduleUuid, version: [...version] }],
    }),
  );

  const runtime: RuntimeDescriptor = {
    format: RUNTIME_FORMAT,
    formatVersion: RUNTIME_FORMAT_VERSION,
    flag: MENU_FORGE_FLAG,
    pack: { name: PACK_NAME, uuid: headerUuid, version: [...version] as PackVersion },
    warnings: [...warnings],
    menus: runtimeMenus,
  };
  files.set(RUNTIME_FILE, jsonFile(runtime));

  const sorted = new Map([...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { files: sorted, runtime, warnings };
}
