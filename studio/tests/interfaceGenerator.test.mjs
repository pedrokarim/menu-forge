// Générateur d'interfaces : chaque combinaison d'options donne un menu valide contre le schéma, cohérent
// (slots dans la grille, états cités définis, couches et textes dans la fenêtre) et résolu sans erreur ;
// le titre composé de chaque état a toutes ses textures ; le mode « Essayer » suit les actions générées.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { measureImage } from '../src/export/image.ts';
import { composeTitle } from '../src/model/compose.ts';
import { GRID_COLUMNS, WINDOW_WIDTH, windowHeight } from '../src/model/geometry.ts';
import { INTERFACE_EXAMPLES, exampleId, exampleOptions, filterExamples } from '../src/model/interfaceExamples.ts';
import {
  INTERFACE_KINDS,
  INTERFACE_KIND_ORDER,
  LAYOUT_LABELS,
  defaultInterfaceOptions,
  generateInterface,
  normalizeOptions,
  placeButtons,
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
  assert.deepEqual(placeButtons(2, 1, 1, 8, 'center'), [3, 4]);
  assert.deepEqual(placeButtons(0, 1, 0, 9, 'center'), []);
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
