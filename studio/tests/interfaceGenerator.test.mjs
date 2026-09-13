// Générateur d'interfaces : chaque combinaison d'options donne un menu valide contre le schéma, cohérent
// (slots dans la grille, états cités définis, couches et textes dans la fenêtre) et résolu sans erreur ;
// le titre composé de chaque état a toutes ses textures ; le mode « Essayer » suit les actions générées.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { measureImage } from '../src/export/image.ts';
import { composeTitle } from '../src/model/compose.ts';
import { DARK_COLORS } from '../src/model/darkStyles.ts';
import { MIN_LABEL_CONTRAST, contrastRatio } from '../src/model/generator.ts';
import { GRID_COLUMNS, WINDOW_WIDTH, chestCell, windowHeight } from '../src/model/geometry.ts';
import { PIXEL_ICONS, iconPixelCount, iconSize } from '../src/model/pixelIcons.ts';
import { INTERFACE_EXAMPLES, exampleId, exampleOptions, filterExamples } from '../src/model/interfaceExamples.ts';
import {
  INTERFACE_KINDS,
  INTERFACE_KIND_ORDER,
  LABEL_PADDING,
  LAYOUT_LABELS,
  MCRS_OPAQUE_PANEL,
  buttonColors,
  choiceCells,
  defaultInterfaceOptions,
  shortenTitle,
  generateInterface,
  normalizeOptions,
  placeButtons,
  placeRow,
  textBox,
} from '../src/model/interfaceGenerator.ts';
import { ID_PATTERN } from '../src/model/menu.ts';
import { DEFAULT_PREVIEW, buildPreviewContext, interpolate } from '../src/model/preview.ts';
import { resolveMenu } from '../src/model/resolve.ts';
import { clickSlot, currentFrame, startSession } from '../src/model/simulate.ts';
import { renderGeneratorImage } from '../src/model/textureRender.ts';
import { validate } from './jsonSchema.mjs';

const schema = JSON.parse(readFileSync(new URL('../../docs/menu.schema.json', import.meta.url), 'utf8'));
const FAMILIES = ['deepslate', 'mcrs', 'dark'];

function* everyOption() {
  for (const kind of INTERFACE_KIND_ORDER) {
    const info = INTERFACE_KINDS[kind];
    for (const family of FAMILIES) {
      for (let rows = info.minRows; rows <= 6; rows++) {
        for (let buttons = info.minButtons; buttons <= info.maxButtons; buttons++) {
          for (const layout of Object.keys(LAYOUT_LABELS)) {
            yield { ...defaultInterfaceOptions(kind, family), id: `gen_${kind}`, name: 'Essai', rows, buttons, layout };
          }
        }
      }
    }
  }
}

const cellsOf = ({ col, row, width = 1, height = 1 }) => {
  const cells = [];
  for (let dx = 0; dx < width; dx++) for (let dy = 0; dy < height; dy++) cells.push(`${col + dx},${row + dy}`);
  return cells;
};

/** Deux conditions ne peuvent pas être vraies ensemble : même état, valeurs différentes. */
const exclusive = (a, b) => a && b && 'state' in a && 'state' in b && a.state === b.state && 'is' in a && 'is' in b && a.is !== b.is;

/** Incohérences qu'aucun schéma ne voit : elles croisent plusieurs parties du menu. */
function problems(menu) {
  const errors = [];
  const rows = menu.container.rows;
  const height = windowHeight(rows);
  for (const key of ['layers', 'texts', 'slots']) {
    const ids = menu[key].map((element) => element.id);
    if (new Set(ids).size !== ids.length) errors.push(`${key} : identifiants en double`);
  }
  const occupied = new Map();
  for (const slot of menu.slots) {
    const { col, row, width = 1, height: tall = 1 } = slot.area;
    if (col < 0 || row < 0 || col + width > GRID_COLUMNS || row + tall > rows) errors.push(`${slot.id} : hors de la grille`);
    for (const cell of cellsOf(slot.area)) {
      for (const other of occupied.get(cell) ?? []) {
        if (!exclusive(slot.visibleWhen, other.visibleWhen)) errors.push(`${slot.id} et ${other.id} se chevauchent en ${cell}`);
      }
      occupied.set(cell, [...(occupied.get(cell) ?? []), slot]);
    }
    for (const action of slot.onClick ?? []) {
      if (action.type === 'setState') {
        const state = menu.state[action.state];
        if (state?.type !== 'enum' || !state.values.includes(action.value)) errors.push(`${slot.id} : setState ${action.state}=${action.value}`);
      }
      if (action.type === 'nextPage' || action.type === 'prevPage') {
        const page = Object.values(menu.state).find((state) => state.type === 'page' && state.list === action.list);
        if (!page) errors.push(`${slot.id} : ${action.type} sans état page pour ${action.list}`);
      }
    }
  }
  for (const layer of menu.layers) {
    const spec = layer.generator;
    if (layer.x < 0 || layer.y < 0 || layer.x + spec.width > WINDOW_WIDTH || layer.y + spec.height > height) errors.push(`${layer.id} : hors de la fenêtre`);
    if (layer.texture !== `generated/${menu.id}/${layer.id}.png`) errors.push(`${layer.id} : texture ${layer.texture}`);
  }
  // Les textes sont mesurés tels qu'affichés, variables remplacées par les valeurs les plus larges.
  const widest = { 'page.number': '99', 'page.count': '99' };
  for (const text of menu.texts) {
    const box = textBox({ ...text, value: interpolate(text.value, widest) });
    if (box.x < 0 || box.x + box.width > WINDOW_WIDTH || box.y < 0 || box.y + box.height > height) errors.push(`${text.id} : hors de la fenêtre`);
  }
  return errors;
}

test('exemples : les 22 réglages de la galerie donnent des menus valides et cohérents', () => {
  assert.equal(INTERFACE_EXAMPLES.length, 22);
  assert.equal(new Set(INTERFACE_EXAMPLES.map((entry) => entry.key)).size, INTERFACE_EXAMPLES.length, 'clés uniques');
  for (const entry of INTERFACE_EXAMPLES) {
    const id = exampleId(entry, []);
    assert.match(id, ID_PATTERN, `${entry.key} : identifiant valide`);
    const options = exampleOptions(entry, id);
    assert.deepEqual(normalizeOptions(options), options, `${entry.key} : réglages dans les bornes du type`);
    const menu = generateInterface(options);
    assert.deepEqual(JSON.parse(JSON.stringify(menu)), menu, `${entry.key} : aucune valeur indéfinie`);
    assert.deepEqual(validate(schema, menu), [], `${entry.key} : schéma`);
    assert.deepEqual(problems(menu), [], entry.key);
    assert.doesNotThrow(() => resolveMenu(menu, () => undefined), entry.key);
    assert.equal(menu.name, entry.name, `${entry.key} : nom`);
    assert.equal(menu.container.rows, entry.rows, `${entry.key} : lignes`);
    assert.equal(menu.texts.find((text) => text.id === 'title').value, entry.name, `${entry.key} : titre repris du nom`);
    assert.ok(JSON.stringify(menu).includes(entry.accent), `${entry.key} : accent repris`);
  }
});

test('exemples : filtres par type et par famille, identifiant toujours libre', () => {
  assert.equal(filterExamples(null, null).length, INTERFACE_EXAMPLES.length);
  for (const kind of INTERFACE_KIND_ORDER) {
    for (const family of FAMILIES) {
      const found = filterExamples(kind, family);
      assert.ok(found.length > 0, `${kind}/${family} : au moins un exemple`);
      assert.ok(found.every((entry) => entry.kind === kind && entry.family === family), `${kind}/${family} : filtre exact`);
    }
  }
  const market = INTERFACE_EXAMPLES.find((entry) => entry.name === 'Marché');
  assert.equal(exampleId(market, []), 'marche');
  assert.equal(exampleId(market, ['marche', 'marche_2']), 'marche_3');
});

test('placeButtons : à gauche, centrés, à droite, répartis', () => {
  assert.deepEqual(placeButtons(3, 1, 0, 9, 'start'), [0, 1, 2]);
  assert.deepEqual(placeButtons(3, 1, 0, 9, 'end'), [6, 7, 8]);
  assert.deepEqual(placeButtons(3, 1, 0, 9, 'center'), [3, 4, 5]);
  assert.deepEqual(placeButtons(3, 1, 0, 9, 'spread'), [0, 4, 8]);
  assert.deepEqual(placeButtons(2, 3, 0, 9, 'spread'), [0, 6]);
  assert.deepEqual(placeButtons(1, 3, 0, 9, 'spread'), [3]);
  assert.deepEqual(placeButtons(0, 1, 0, 9, 'center'), []);
});

test('placeRow : un reste impair ouvre une colonne au milieu, les marges restent égales (D6)', () => {
  // Deux boutons dans les sept colonnes d’une barre : 2 colonnes libres de chaque côté, pas 2 et 3.
  assert.deepEqual(placeButtons(2, 1, 1, 8, 'center'), [3, 5]);
  // Deux onglets de trois cases : une colonne libre de chaque côté.
  assert.deepEqual(placeButtons(2, 3, 0, 9, 'center'), [1, 5]);
  // Quatre onglets de deux cases : la colonne libre passe au milieu.
  assert.deepEqual(placeButtons(4, 2, 0, 9, 'center'), [0, 2, 5, 7]);
  // Six boutons répartis sur neuf colonnes : écart nul, reste impair recentré.
  assert.deepEqual(placeButtons(6, 1, 0, 9, 'spread'), [1, 2, 3, 5, 6, 7]);
  // Largeurs différentes (choix d’une modale) : la colonne libre suit le bouton du milieu.
  assert.deepEqual(placeRow([2, 2, 4], 0, 9, 'center'), [0, 2, 5]);
  assert.deepEqual(placeRow([2, 2, 4], 0, 9, 'start'), [0, 2, 4]);
  assert.deepEqual(placeRow([2, 2, 4], 0, 9, 'end'), [1, 3, 5]);
  // Toute rangée centrée d’une combinaison du générateur : marges gauche et droite égales.
  for (const [from, to] of [[0, 9], [1, 8]]) {
    for (const width of [1, 3]) {
      for (let count = 1; count * width <= to - from; count++) {
        const starts = placeButtons(count, width, from, to, 'center');
        const left = starts[0] - from;
        const right = to - (starts.at(-1) + width);
        assert.equal(left, right, `${count} × ${width} entre ${from} et ${to}`);
      }
    }
  }
});

test('toutes les combinaisons d’options donnent des menus valides et cohérents', () => {
  let count = 0;
  for (const options of everyOption()) {
    const menu = generateInterface(options);
    const label = `${options.kind}/${options.family}/${options.rows} lignes/${options.buttons} boutons/${options.layout}`;
    assert.deepEqual(JSON.parse(JSON.stringify(menu)), menu, `${label} : aucune valeur indéfinie`);
    assert.deepEqual(validate(schema, menu), [], `${label} : schéma`);
    assert.deepEqual(problems(menu), [], label);
    assert.doesNotThrow(() => resolveMenu(menu, () => undefined), label);
    count++;
  }
  assert.ok(count > 1000, `${count} combinaisons`);
});

test('le générateur est déterministe et borne ses options', () => {
  const options = { ...defaultInterfaceOptions('tabs'), id: 'onglets', name: 'Onglets' };
  assert.deepEqual(generateInterface(options), generateInterface(structuredClone(options)));
  const clamped = generateInterface({ ...options, rows: 12, buttons: 40, accent: 'rouge' });
  assert.equal(clamped.container.rows, 6);
  assert.equal(clamped.state.tab.values.length, INTERFACE_KINDS.tabs.maxButtons);
  const strip = clamped.layers.find((layer) => layer.id === 'title_strip');
  assert.equal(strip.generator.color, '#ffd933', 'accent invalide : or de mc-rs');
});

test('chaque état de chaque type a un titre composé complet (textures non vides)', () => {
  for (const kind of INTERFACE_KIND_ORDER) {
    for (const family of FAMILIES) {
      const menu = generateInterface({ ...defaultInterfaceOptions(kind, family), id: `gen_${kind}`, name: 'Essai' });
      const bounds = new Map(menu.layers.map((layer) => [layer.texture, measureImage(renderGeneratorImage(layer.generator, layer))]));
      const tabs = menu.state.tab?.values ?? [undefined];
      for (const tab of tabs) {
        for (const page of [1, 2, 3]) {
          const state = { ...(tab ? { tab } : {}), ...(menu.state.page ? { page } : {}) };
          const context = buildPreviewContext(menu, { ...DEFAULT_PREVIEW, state });
          const composition = composeTitle(menu, context, (texture) => bounds.get(texture));
          assert.deepEqual(composition.warnings, [], `${kind}/${family} ${JSON.stringify(state)}`);
          const glyphs = composition.tokens.filter((token) => token.kind === 'glyph').map((token) => token.layerId);
          assert.ok(glyphs.includes('background'), `${kind}/${family} : fond affiché`);
        }
      }
    }
  }
});

test('sombre à accent : store, cartouche, croix dessinée, onglets collés au panneau du contenu', () => {
  const layer = (menu, id) => menu.layers.find((candidate) => candidate.id === id);
  const shop = generateInterface({ ...defaultInterfaceOptions('shop', 'dark'), id: 'marche', name: 'Marché', accent: '#58d000' });
  assert.equal(layer(shop, 'awning').generator.style, 'dark_awning');
  assert.equal(layer(shop, 'awning').generator.color, '#58d000', 'store vert d’un marché');
  assert.equal(layer(shop, 'page_badge').generator.style, 'dark_badge');
  assert.equal(shop.texts.find((text) => text.id === 'page_label').align, 'center', 'numéro centré dans la cartouche');
  assert.equal(layer(shop, 'close').generator.style, 'dark_close');
  assert.equal(shop.texts.some((text) => text.id === 'close_label'), false, 'la croix est dessinée, pas écrite');
  assert.equal(shop.texts.find((text) => text.id === 'title').color, '#58d000', 'titre à l’accent');
  assert.equal(layer(shop, 'background').generator.cellStyle, 'dark_slot');

  const tabs = generateInterface({ ...defaultInterfaceOptions('tabs', 'dark'), id: 'profil', name: 'Profil' });
  const panel = layer(tabs, 'content_panel');
  assert.equal(panel.generator.cells.length, 1, 'cases dans le panneau du contenu');
  assert.equal(layer(tabs, 'background').generator.cells.length, 0);
  assert.equal(layer(tabs, 'tab_1_active').generator.state, 'pressed');
  const tab = layer(tabs, 'tab_2');
  assert.equal(tab.generator.style, 'dark_tab');
  assert.equal(tab.y + tab.generator.height, panel.y + 1, 'bas de l’onglet sur le cadre du panneau');
});

/** Menus des 22 exemples, sous leur clé. */
const exampleMenus = () => INTERFACE_EXAMPLES.map((entry) => [entry, generateInterface(exampleOptions(entry, exampleId(entry, [])))]);

/** Pixels d’une image égaux à une couleur `#rrggbb` (alpha plein). */
function countColor(image, hex) {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  let count = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset] === r && image.data[offset + 1] === g && image.data[offset + 2] === b && image.data[offset + 3] === 255) count++;
  }
  return count;
}

test('D1 : aucun bouton d’une case n’est vide – icône d’au moins 12 pixels, ou croix dessinée', () => {
  for (const [entry, menu] of exampleMenus()) {
    const labelled = new Set(menu.texts.map((text) => text.id.replace(/_label$/, '')));
    for (const layer of menu.layers) {
      const spec = layer.generator;
      const oneCell = spec.width === 16 && spec.height === 16 && !['dark_tab'].includes(spec.style);
      if (!oneCell || labelled.has(layer.id)) continue;
      const label = `${entry.key} : ${layer.id}`;
      if (spec.style === 'dark_close') {
        assert.ok(countColor(renderGeneratorImage(spec, layer), '#f8f8f8') >= 12, `${label} : croix dessinée`);
        continue;
      }
      assert.ok(spec.icon, `${label} : icône`);
      assert.ok(iconPixelCount(spec.icon) >= 12, `${label} : icône de ${iconPixelCount(spec.icon)} pixels`);
      assert.ok(countColor(renderGeneratorImage(spec, layer), spec.iconColor) >= 12, `${label} : icône peinte dans la texture`);
    }
  }
  // Toutes les combinaisons : jamais de bouton d’une case sans libellé, sans icône ni croix.
  for (const options of everyOption()) {
    const menu = generateInterface(options);
    const labelled = new Set(menu.texts.map((text) => text.id.replace(/_label$/, '')));
    for (const layer of menu.layers) {
      const spec = layer.generator;
      if (spec.width !== 16 || spec.height !== 16 || spec.style === 'dark_tab' || labelled.has(layer.id)) continue;
      assert.ok(spec.icon || spec.style === 'dark_close', `${options.kind}/${options.family}/${options.buttons} : ${layer.id} vide`);
    }
  }
});

test('icônes pixel : chaque icône tient dans un bouton d’une case avec 3 pixels de marge au moins', () => {
  for (const icon of PIXEL_ICONS) {
    const { width, height } = iconSize(icon);
    assert.ok(width >= 5 && width <= 10 && height >= 8 && height <= 10, `${icon} : ${width} × ${height}`);
    assert.ok(16 - width - 1 >= 6 && 16 - height - 1 >= 6, `${icon} : marges avec l’ombre`);
    assert.ok(iconPixelCount(icon) >= 12, `${icon} : lisible`);
  }
  // Le corps du bouton en relief exclut son ombre : l’icône y est centrée, pas dans toute la texture.
  const raised = renderGeneratorImage({ style: 'mcrs_raised', width: 16, height: 16, color: '#49a842', shadow: 2, icon: 'close', iconColor: '#f0f0f0' }, { x: 0, y: 0 });
  const rows = [];
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 16; col++) {
      const offset = (row * 16 + col) * 4;
      if (raised.data[offset] === 0xf0 && raised.data[offset + 1] === 0xf0 && raised.data[offset + 2] === 0xf0) rows.push(row);
    }
  }
  assert.equal(Math.min(...rows), 3, 'haut de l’icône : corps de 14 px, icône de 8 px');
  assert.equal(Math.max(...rows), 10);
});

test('D8 : libellés et icônes contrastés sur leur bouton (3:1 au moins, onglet actif mc-rs 4,5:1)', () => {
  const accents = ['#ffd933', '#ff9a1e', '#49a842', '#3a7bd5', '#20b8e8', '#a060ff', '#e83820', '#58d000', '#b048f0', '#33c8ff', '#e08a20', '#f0c020', '#ff5fa0', '#ffffff', '#000000'];
  for (const family of FAMILIES) {
    for (const accent of accents) {
      for (const { tone, fill, label } of buttonColors(family, accent)) {
        const ratio = contrastRatio(fill, label);
        assert.ok(ratio >= MIN_LABEL_CONTRAST, `${family} ${accent} ${tone} : ${ratio.toFixed(2)}:1 (${label} sur ${fill})`);
        if (family === 'mcrs' && tone === 'active') assert.ok(ratio >= 4.5, `${family} ${accent} onglet actif : ${ratio.toFixed(2)}:1`);
      }
    }
  }
  // Les exemples cités par le relevé : rose et cyan.
  for (const key of ['22-tabs-mcrs-pink', '19-tabs-mcrs-cyan']) {
    const menu = exampleMenus().find(([entry]) => entry.key === key)[1];
    const active = menu.texts.find((text) => text.id === 'tab_1_active_label');
    const fill = buttonColors('mcrs', INTERFACE_EXAMPLES.find((entry) => entry.key === key).accent).find((color) => color.tone === 'active').fill;
    assert.ok(contrastRatio(fill, active.color) >= 4.5, `${key} : ${contrastRatio(fill, active.color).toFixed(2)}:1`);
  }
});

test('D5 : chaque libellé garde au moins 4 px de marge intérieure de chaque côté de son bouton', () => {
  for (const options of everyOption()) {
    const menu = generateInterface(options);
    for (const text of menu.texts.filter((candidate) => candidate.id.endsWith('_label') && candidate.id !== 'page_label')) {
      const layer = menu.layers.find((candidate) => candidate.id === text.id.replace(/_label$/, ''));
      const box = textBox(text);
      const left = box.x - layer.x;
      const right = layer.x + layer.generator.width - (box.x + box.width);
      const label = `${options.kind}/${options.family}/${options.buttons}/${options.layout} : ${text.id} « ${text.value} »`;
      assert.ok(left >= LABEL_PADDING && right >= LABEL_PADDING, `${label} : marges ${left} et ${right}`);
      assert.ok(Math.abs(left - right) <= 1, `${label} : centré (${left} et ${right})`);
    }
  }
  assert.equal(choiceCells('Confirmer'), 4);
  assert.equal(choiceCells('Plus tard'), 4);
  assert.equal(choiceCells('Annuler'), 3);
  assert.equal(choiceCells('Oui'), 2);
});

test('D2, D4 : le numéro de page n’est jamais omis, ni posé sur le store', () => {
  for (const title of ['Boutique', 'Hôtel des ventes du royaume', 'Un titre vraiment beaucoup trop long pour la fenêtre']) {
    for (const options of everyOption()) {
      if (options.kind !== 'shop' && options.kind !== 'list') continue;
      const menu = generateInterface({ ...options, title });
      const label = `${options.kind}/${options.family}/${options.buttons}/${options.layout} « ${title} »`;
      const page = menu.texts.find((text) => text.id === 'page_label');
      assert.ok(page, `${label} : numéro de page`);
      const box = textBox({ ...page, value: '99/99' });
      const shown = menu.texts.find((text) => text.id === 'title');
      const titleBox = textBox(shown);
      const sameLine = Math.abs(page.y - shown.y) < 8;
      if (sameLine) assert.ok(titleBox.x + titleBox.width + 6 <= box.x, `${label} : numéro à droite du titre, sans chevauchement`);
      if (shown.value !== title) assert.ok(shown.value.endsWith('…') && sameLine, `${label} : titre raccourci « ${shown.value} »`);
      const awning = menu.layers.find((layer) => layer.id === 'awning');
      const badge = menu.layers.find((layer) => layer.id === 'page_badge');
      if (awning && badge) assert.ok(badge.y >= awning.y + awning.generator.height, `${label} : cartouche sous le store`);
    }
  }
  const auction = exampleMenus().find(([entry]) => entry.key === '06-shop-deepslate-red')[1];
  assert.equal(auction.texts.find((text) => text.id === 'title').value, 'Hôtel des ventes du royaume', 'titre gardé entier');
  assert.equal(auction.texts.find((text) => text.id === 'page_label').y, chestCell(0, 2).y + 5, 'numéro replié dans la barre');
  assert.equal(shortenTitle('Hôtel des ventes du royaume', 100), 'Hôtel des ventes…');
});

test('D3, D7, D9 : fond mc-rs opaque aux coins d’un pixel, croix « Fermer » toujours rouge', () => {
  for (const [entry, menu] of exampleMenus()) {
    const background = menu.layers.find((layer) => layer.id === 'background').generator;
    if (entry.family === 'mcrs') {
      assert.equal(background.color, MCRS_OPAQUE_PANEL, `${entry.key} : fond opaque`);
      assert.equal(background.radius, 1, `${entry.key} : rayon 1`);
      const image = renderGeneratorImage(background, { x: 0, y: 0 });
      for (let offset = 3; offset < image.data.length; offset += 4) {
        const index = (offset - 3) / 4;
        const x = index % image.width;
        const y = Math.floor(index / image.width);
        const corner = (x === 0 || x === image.width - 1) && (y === 0 || y === image.height - 1);
        assert.equal(image.data[offset], corner ? 0 : 255, `${entry.key} : alpha en ${x},${y}`);
      }
    }
    const close = menu.layers.find((layer) => layer.id === 'close');
    if (close?.generator.style === 'dark_close') assert.equal(close.generator.color, DARK_COLORS.accent, `${entry.key} : croix rouge`);
  }
});

test('onglets et pagination générés fonctionnent dans le mode « Essayer »', () => {
  const tabs = generateInterface({ ...defaultInterfaceOptions('tabs'), id: 'onglets', name: 'Onglets' });
  const lookupTabs = (id) => (id === tabs.id ? tabs : undefined);
  let session = clickSlot(startSession(tabs.id, DEFAULT_PREVIEW), lookupTabs, 'tab_3');
  assert.equal(currentFrame(session).values.state.tab, 'tab_3');
  const context = buildPreviewContext(tabs, currentFrame(session).values);
  const visible = tabs.slots.filter((slot) => slot.kind === 'list' && (!slot.visibleWhen || slot.visibleWhen.is === context.state.tab));
  assert.deepEqual(visible.map((slot) => slot.list), ['tab_3_items']);

  const list = generateInterface({ ...defaultInterfaceOptions('list'), id: 'liste', name: 'Liste' });
  const lookupList = (id) => (id === list.id ? list : undefined);
  session = clickSlot(startSession(list.id, DEFAULT_PREVIEW), lookupList, 'next');
  assert.equal(currentFrame(session).values.state.page, 2);
  session = clickSlot(session, lookupList, 'prev');
  assert.equal(currentFrame(session).values.state.page, 1);
  session = clickSlot(session, lookupList, 'back');
  assert.equal(session.closed, true, '« Retour » sur le premier menu ferme');
});
