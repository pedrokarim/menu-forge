/**
 * Espace de travail de démonstration des captures.
 *
 * Uniquement des textures générées par le studio (générateur de panneaux et de
 * boutons) et le logo du projet : aucun asset tiers, aucune bibliothèque de
 * pack. Les PNG sont « cuits » dans le navigateur par le code du studio
 * lui-même (`renderGenerator`, `renderAsset`), voir `capture.mjs`.
 *
 * Géométrie du coffre (docs/rendering.md) : cellule d’un slot en
 * (7 + 18 × col, 17 + 18 × ligne), 18 × 18 px ; titre en (8, 6).
 */

/** Coin haut-gauche de la cellule d’un slot du coffre. */
const cell = (col, row) => ({ x: 7 + 18 * col, y: 17 + 18 * row });

/** Couche générée : sa texture vit dans `generated/<menu>/<couche>.png`, comme dans le studio. */
function generated(menuId, id, position, spec, extra = {}) {
  return { id, texture: `generated/${menuId}/${id}.png`, x: position.x, y: position.y, ...extra, generator: spec };
}

const button = (width, height, color) => ({ style: 'button', width, height, color });

const SHOP_TABS = [
  { id: 'blocks', name: '<green>Blocs' },
  { id: 'tools', name: '<aqua>Outils' },
  { id: 'food', name: '<yellow>Nourriture' },
  { id: 'misc', name: '<light_purple>Divers' },
];

/** Boutique à onglets, liste paginée et bouton d’achat : le menu vedette des captures. */
const shop = {
  formatVersion: 1,
  id: 'shop',
  name: 'Boutique',
  container: { type: 'chest', rows: 6 },
  state: {
    tab: { type: 'enum', values: SHOP_TABS.map((tab) => tab.id), default: 'blocks' },
    page: { type: 'page', list: 'shop' },
  },
  layers: [
    generated('shop', 'background', { x: 0, y: 0 }, {
      style: 'panel',
      width: 176,
      height: 134,
      color: '#c6c6c6',
      cells: [{ col: 0, row: 1, width: 9, height: 3 }],
      cellColor: '#8b8b8b',
    }),
    ...SHOP_TABS.map((tab, index) => generated('shop', `tab_${tab.id}`, cell(index, 0), button(18, 18, '#7d7d86'))),
    ...SHOP_TABS.map((tab, index) =>
      generated('shop', `tab_${tab.id}_active`, cell(index, 0), button(18, 18, '#52a535'), {
        visibleWhen: { state: 'tab', is: tab.id },
      }),
    ),
    generated('shop', 'balance', cell(5, 0), { style: 'flat', width: 54, height: 18, color: '#373737' }),
    generated('shop', 'close', cell(8, 0), button(18, 18, '#d04545')),
    generated('shop', 'buy', cell(3, 4), button(54, 18, '#52a535')),
    generated('shop', 'previous', cell(0, 5), button(18, 18, '#e0892b')),
    generated('shop', 'next', cell(8, 5), button(18, 18, '#e0892b')),
  ],
  texts: [
    { id: 'title', x: 8, y: 6, color: '#404040', value: 'Boutique' },
    { id: 'balance_label', x: 147, y: 22, align: 'right', color: '#ffd84a', value: '1250' },
    { id: 'close_label', x: 160, y: 22, align: 'center', color: '#ffffff', value: 'x' },
    { id: 'buy_label', x: 88, y: 94, align: 'center', color: '#ffffff', value: 'Acheter' },
    { id: 'previous_label', x: 16, y: 112, align: 'center', color: '#ffffff', value: '<' },
    { id: 'next_label', x: 160, y: 112, align: 'center', color: '#ffffff', value: '>' },
    { id: 'page_label', x: 88, y: 112, align: 'center', color: '#404040', value: '{page.number}/{page.count}' },
  ],
  slots: [
    ...SHOP_TABS.map((tab, index) => ({
      id: `tab_${tab.id}`,
      kind: 'button',
      area: { col: index, row: 0 },
      item: { invisible: true, name: tab.name },
      onClick: [{ type: 'setState', state: 'tab', value: tab.id }],
    })),
    {
      id: 'balance',
      kind: 'decoration',
      area: { col: 5, row: 0, width: 3 },
      item: { invisible: true, name: '<gold>Solde : 1250 pièces' },
    },
    {
      id: 'close',
      kind: 'button',
      area: { col: 8, row: 0 },
      item: { invisible: true, name: '<red>Fermer' },
      onClick: [{ type: 'close' }],
    },
    { id: 'items', kind: 'list', list: 'shop', area: { col: 0, row: 1, width: 9, height: 3 } },
    {
      id: 'buy',
      kind: 'button',
      area: { col: 3, row: 4, width: 3 },
      item: { invisible: true, name: '<green>Acheter', lore: ['<gray>Ouvre la confirmation'] },
      onClick: [
        { type: 'sound', sound: 'ui.button.click' },
        { type: 'open', menu: 'confirmation' },
      ],
    },
    {
      id: 'previous',
      kind: 'button',
      area: { col: 0, row: 5 },
      item: { invisible: true, name: '<gray>Page précédente' },
      enabledWhen: { flag: 'page.hasPrev' },
      onClick: [{ type: 'prevPage', list: 'shop' }],
    },
    {
      id: 'next',
      kind: 'button',
      area: { col: 8, row: 5 },
      item: { invisible: true, name: '<gray>Page suivante' },
      enabledWhen: { flag: 'page.hasNext' },
      onClick: [{ type: 'nextPage', list: 'shop' }],
    },
  ],
};

/** Modale de confirmation : voile, panneau centré, deux boutons. */
const confirmation = {
  formatVersion: 1,
  id: 'confirmation',
  name: 'Confirmation d’achat',
  container: { type: 'chest', rows: 6 },
  layers: [
    generated('confirmation', 'veil', { x: 0, y: 0 }, { style: 'veil', width: 176, height: 222, color: '#00000088' }),
    generated('confirmation', 'panel', { x: 16, y: 40 }, {
      style: 'panel',
      width: 144,
      height: 80,
      color: '#c6c6c6',
      cells: [{ col: 4, row: 2 }],
      cellColor: '#8b8b8b',
    }),
    generated('confirmation', 'yes', cell(2, 4), button(36, 18, '#52a535')),
    generated('confirmation', 'no', cell(5, 4), button(36, 18, '#d04545')),
  ],
  texts: [
    { id: 'question', x: 88, y: 44, align: 'center', color: '#404040', value: 'Confirmer l’achat ?' },
    { id: 'price', x: 88, y: 76, align: 'center', color: '#404040', value: '16 diamants : 640 pièces' },
    { id: 'yes_label', x: 61, y: 94, align: 'center', color: '#ffffff', value: 'Oui' },
    { id: 'no_label', x: 115, y: 94, align: 'center', color: '#ffffff', value: 'Non' },
  ],
  slots: [
    { id: 'preview', kind: 'decoration', area: { col: 4, row: 2 }, item: { material: 'DIAMOND', name: '<aqua>Diamant' } },
    {
      id: 'yes',
      kind: 'button',
      area: { col: 2, row: 4, width: 2 },
      item: { invisible: true, name: '<green>Confirmer' },
      onClick: [
        { type: 'command', command: 'shop buy diamond 16', as: 'player' },
        { type: 'back' },
      ],
    },
    {
      id: 'no',
      kind: 'button',
      area: { col: 5, row: 4, width: 2 },
      item: { invisible: true, name: '<red>Annuler' },
      onClick: [{ type: 'back' }],
    },
  ],
};

/** Profil sur trois lignes : tête du joueur dans un cadre doré, succès, barre d’expérience. */
const profile = {
  formatVersion: 1,
  id: 'profile',
  name: 'Profil',
  container: { type: 'chest', rows: 3 },
  layers: [
    generated('profile', 'background', { x: 0, y: 0 }, {
      style: 'panel',
      width: 176,
      height: 79,
      color: '#c6c6c6',
      cells: [{ col: 3, row: 1, width: 5 }],
      cellColor: '#8b8b8b',
    }),
    generated('profile', 'head_frame', { x: 23, y: 33 }, {
      style: 'button',
      width: 22,
      height: 22,
      color: '#d9ad32',
      cells: [{ col: 1, row: 1 }],
      cellColor: '#8b8b8b',
    }),
    generated('profile', 'xp_track', { x: 61, y: 57 }, { style: 'flat', width: 90, height: 8, color: '#373737' }),
    generated('profile', 'xp_fill', { x: 61, y: 57 }, button(58, 8, '#3b8fd6')),
    generated('profile', 'back', cell(0, 2), button(18, 18, '#e0892b')),
  ],
  texts: [
    { id: 'title', x: 8, y: 6, color: '#404040', value: 'Profil de {viewer.name}' },
    { id: 'badges_label', x: 62, y: 24, color: '#404040', value: 'Succès' },
    { id: 'back_label', x: 16, y: 58, align: 'center', color: '#ffffff', value: '<' },
  ],
  slots: [
    {
      id: 'head',
      kind: 'decoration',
      area: { col: 1, row: 1 },
      item: { material: 'PLAYER_HEAD', head: '{viewer}', name: '{viewer.name}' },
    },
    { id: 'badges', kind: 'list', list: 'badges', area: { col: 3, row: 1, width: 5 } },
    {
      id: 'back',
      kind: 'button',
      area: { col: 0, row: 2 },
      item: { invisible: true, name: '<gray>Retour' },
      onClick: [{ type: 'back' }],
    },
  ],
};

/** Encart d’aide du mode libre : logo du projet, cadres procéduraux, texte. */
const helpBanner = {
  formatVersion: 1,
  id: 'help_banner',
  name: 'Encart d’aide',
  size: { width: 176, height: 44 },
  background: null,
  elements: [
    {
      id: 'logo_box',
      type: 'box',
      x: 0,
      y: 0,
      width: 44,
      height: 44,
      style: { kind: 'procedural', preset: 'flat', color: '#2a2233', border: '#6a3cf2' },
    },
    { id: 'logo', type: 'image', x: 10, y: 10, texture: 'brand/logo.png', scale: 1 },
    {
      id: 'text_box',
      type: 'box',
      x: 48,
      y: 0,
      width: 128,
      height: 44,
      style: { kind: 'procedural', preset: 'flat', color: '#1b1c21', border: '#6a3cf2' },
    },
    {
      id: 'text',
      type: 'text',
      x: 54,
      y: 7,
      text: 'Besoin d’aide ?\n§7Tape §e/aide§7 dans le chat\n§7ou demande au staff.',
      color: '#ffffff',
      shadow: false,
      lineHeight: 10,
      align: 'left',
    },
  ],
  export: { ascent: 7 },
};

/** Bulle de touche à glisser dans une ligne de texte. */
const keyHint = {
  formatVersion: 1,
  id: 'key_hint',
  name: 'Bulle de touche',
  size: { width: 60, height: 20 },
  background: null,
  elements: [
    {
      id: 'key',
      type: 'box',
      x: 1,
      y: 1,
      width: 18,
      height: 18,
      style: { kind: 'procedural', preset: 'button', color: '#8b8b8b' },
    },
    { id: 'key_label', type: 'text', x: 10, y: 6, text: 'E', color: '#ffffff', shadow: true, align: 'center' },
    { id: 'label', type: 'text', x: 24, y: 6, text: 'Ouvrir', color: '#ffffff', shadow: true, align: 'left' },
  ],
  export: { ascent: 7 },
};

/** Badge doré : panneau et cellule, pour une liste de succès. */
const goldBadge = {
  formatVersion: 1,
  id: 'gold_badge',
  name: 'Badge doré',
  size: { width: 32, height: 32 },
  background: null,
  elements: [
    {
      id: 'frame',
      type: 'box',
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      style: { kind: 'procedural', preset: 'panel', color: '#d9ad32' },
    },
    {
      id: 'socket',
      type: 'box',
      x: 7,
      y: 7,
      width: 18,
      height: 18,
      style: { kind: 'procedural', preset: 'cell', color: '#8f6c14' },
    },
  ],
  export: { ascent: 7 },
};

/**
 * Ordre d’écriture = ordre des « documents récents » à rebours : la boutique,
 * écrite en dernier, apparaît en tête de l’accueil.
 */
export const DEMO_ASSETS = [goldBadge, keyHint, helpBanner];
export const DEMO_MENUS = [profile, confirmation, shop];

/** Nom affiché de l’espace de démonstration. */
export const DEMO_WORKSPACE_NAME = 'serveur-demo';
