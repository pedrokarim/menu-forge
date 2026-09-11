// Export Bedrock (docs/bedrock.md) : pack JSON UI, textures recadrées, manifest
// versionné et descripteur d’exécution, générés de façon déterministe.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INERT_MARKER, MENU_FORGE_FLAG, TEXT_MARKER } from '../src/export/bedrock/constants.ts';
import { bedrockIcon, bedrockSound, hexToUiColor, miniMessageToLegacy, nearestLegacyCode } from '../src/export/bedrock/convert.ts';
import { derivedUuid, generateBedrockExport, isStaticText, nextPackVersion } from '../src/export/bedrock/generate.ts';
import type { BedrockExport, RuntimeMenu } from '../src/export/bedrock/generate.ts';
import type { RgbaImage } from '../src/export/image.ts';
import { decodePng } from '../src/export/png.ts';
import type { MenuDefinition } from '../src/model/menu.ts';

/** Image de `width` × `height` dont seul le rectangle (`x`, `y`, `w`, `h`) est opaque. */
function image(width: number, height: number, x = 0, y = 0, w = width, h = height): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) data.set([200, 100, 50, 255], (row * width + col) * 4);
  }
  return { width, height, data };
}

const TEXTURES: Record<string, RgbaImage> = {
  'shop/bg.png': image(176, 90),
  // Pixels visibles en (4, 2)–(13, 9) : la couche est recadrée et décalée d’autant.
  'shop/tab_on.png': image(20, 12, 4, 2, 10, 8),
  'shop/empty.png': image(8, 8, 0, 0, 0, 0),
};

async function load(path: string): Promise<RgbaImage | null> {
  return TEXTURES[path] ?? null;
}

function shop(): MenuDefinition {
  return {
    formatVersion: 1,
    id: 'shop',
    name: 'Boutique (test)',
    container: { type: 'chest', rows: 3 },
    state: { tab: { type: 'enum', values: ['a', 'b'], default: 'a' } },
    layers: [
      { id: 'background', texture: 'shop/bg.png', x: 0, y: 0 },
      { id: 'tab_on', texture: 'shop/tab_on.png', x: 30, y: 40, visibleWhen: { state: 'tab', is: 'b' } },
      { id: 'nothing', texture: 'shop/empty.png', x: 0, y: 0 },
    ],
    texts: [
      { id: 'title', x: 8, y: 6, value: 'Boutique', color: '#ffaa00' },
      { id: 'hint', x: 88, y: 60, align: 'center', value: 'Onglet B', visibleWhen: { state: 'tab', is: 'b' } },
      { id: 'greeting', x: 168, y: 70, align: 'right', value: 'Bonjour {viewer.name}' },
    ],
    slots: [
      {
        id: 'tab_b',
        kind: 'button',
        area: { col: 1, row: 0, width: 2 },
        item: { invisible: true, name: '<green>Onglet <bold>B' },
        enabledWhen: { state: 'tab', is: 'a' },
        onClick: [
          { type: 'setState', state: 'tab', value: 'b' },
          { type: 'sound', sound: 'minecraft:ui.button.click', volume: 0.5 },
        ],
      },
      { id: 'gem', kind: 'decoration', area: { col: 8, row: 2 }, item: { material: 'DIAMOND', name: '<#123456>Joyau' } },
      { id: 'sell', kind: 'input', area: { col: 4, row: 1 } },
      { id: 'wide', kind: 'button', area: { col: 7, row: 1, width: 3 }, onClick: [{ type: 'close' }] },
    ],
  };
}

function other(): MenuDefinition {
  return {
    formatVersion: 1,
    id: 'other',
    name: 'Autre',
    container: { type: 'chest', rows: 1 },
    layers: [{ id: 'background', texture: 'shop/bg.png', x: 0, y: 0 }],
    slots: [{ id: 'back', kind: 'button', area: { col: 0, row: 0 }, onClick: [{ type: 'back' }] }],
  };
}

const TEMPLATE: MenuDefinition = { ...other(), id: 'frame', template: true };

async function generate(version: [number, number, number] = [1, 0, 3]): Promise<BedrockExport> {
  return generateBedrockExport([other(), shop(), TEMPLATE], load, { version, namespace: 'menuforge' });
}

function json(result: BedrockExport, path: string): Record<string, unknown> {
  const bytes = result.files.get(path);
  assert.ok(bytes, `${path} manquant`);
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

/** Tous les objets imbriqués qui portent la clé `key`. */
function findKey(value: unknown, key: string, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) for (const item of value) findKey(item, key, out);
  else if (value && typeof value === 'object') {
    for (const [name, child] of Object.entries(value)) {
      if (name === key && child && typeof child === 'object') out.push(child as Record<string, unknown>);
      findKey(child, key, out);
    }
  }
  return out;
}

function shopRuntime(result: BedrockExport): RuntimeMenu {
  const menu = result.runtime.menus.find((candidate) => candidate.id === 'shop');
  assert.ok(menu);
  return menu;
}

test('fichiers écrits : pack, dispositions, textures recadrées, descripteur', async () => {
  const result = await generate();
  assert.deepEqual([...result.files.keys()], [
    'pack/manifest.json',
    'pack/textures/menu_forge/_white.png',
    'pack/textures/menu_forge/other/background.png',
    'pack/textures/menu_forge/shop/background.png',
    'pack/textures/menu_forge/shop/tab_on.png',
    'pack/ui/_ui_defs.json',
    'pack/ui/menu_forge/other.json',
    'pack/ui/menu_forge/router.json',
    'pack/ui/menu_forge/shop.json',
    'runtime.json',
  ]);
  assert.deepEqual(json(result, 'pack/ui/_ui_defs.json'), {
    ui_defs: ['ui/menu_forge/router.json', 'ui/menu_forge/other.json', 'ui/menu_forge/shop.json'],
  });
  const tab = await decodePng(result.files.get('pack/textures/menu_forge/shop/tab_on.png') as Uint8Array);
  assert.deepEqual([tab.width, tab.height], [10, 8]);
});

test('génération déterministe : mêmes entrées, mêmes octets', async () => {
  const [first, second] = [await generate(), await generate()];
  assert.deepEqual([...first.files.keys()], [...second.files.keys()]);
  for (const [path, bytes] of first.files) assert.ok(Buffer.from(bytes).equals(Buffer.from(second.files.get(path) as Uint8Array)), path);
});

test('manifest : uuid dérivés et stables, version fournie', async () => {
  const manifest = json(await generate([1, 0, 7]), 'pack/manifest.json') as {
    header: { uuid: string; version: number[]; name: string };
    modules: { uuid: string; version: number[]; type: string }[];
  };
  assert.equal(manifest.header.uuid, await derivedUuid('menu-forge:bedrock:menuforge:header'));
  assert.equal(manifest.modules[0].uuid, await derivedUuid('menu-forge:bedrock:menuforge:module'));
  assert.notEqual(manifest.header.uuid, manifest.modules[0].uuid);
  assert.match(manifest.header.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(manifest.header.version, [1, 0, 7]);
  assert.deepEqual(manifest.modules[0].version, [1, 0, 7]);
  assert.equal(manifest.modules[0].type, 'resources');

  assert.deepEqual(nextPackVersion(null), [1, 0, 0]);
  assert.deepEqual(nextPackVersion([1, 2, 9]), [1, 2, 10]);
  assert.deepEqual(nextPackVersion([1, 'x', 0]), [1, 0, 0]);
  await assert.rejects(generateBedrockExport([shop()], load, { version: [1, 0, -1] }), /Version de pack invalide/);
  await assert.rejects(generateBedrockExport([shop()], load, { version: [1, 0, 0], namespace: 'Bad' }), /Espace de noms invalide/);
  await assert.rejects(
    generateBedrockExport([{ ...shop(), layers: [{ id: 'x', texture: 'absent.png', x: 0, y: 0 }] }], load, { version: [1, 0, 0] }),
    /Texture introuvable/,
  );
});

test('descripteur : jetons, textes dynamiques, cases, libellés, actions', async () => {
  const result = await generate();
  const runtime = result.runtime;
  assert.equal(runtime.format, 'menu-forge-bedrock');
  assert.equal(runtime.formatVersion, 1);
  assert.equal(runtime.flag, MENU_FORGE_FLAG);
  assert.deepEqual(runtime.pack.version, [1, 0, 3]);
  assert.deepEqual(runtime.menus.map((menu) => menu.id), ['other', 'shop'], 'gabarits exclus, ordre conservé');
  assert.deepEqual(json(result, 'runtime.json'), JSON.parse(JSON.stringify(runtime)));

  const menu = shopRuntime(result);
  assert.equal(menu.rows, 3);
  assert.equal(menu.entries, 27 + 1, '27 cases puis un texte dynamique');
  assert.equal(menu.token, '[mf:shop]');
  assert.deepEqual(menu.state, { tab: { type: 'enum', values: ['a', 'b'], default: 'a' } });
  assert.deepEqual(menu.tokens, [
    { token: '(1)', layer: 'tab_on', visibleWhen: { state: 'tab', is: 'b' } },
    { token: '(t1)', text: 'hint', visibleWhen: { state: 'tab', is: 'b' } },
  ]);
  assert.deepEqual(menu.texts, [{ id: 'greeting', entry: 27, prefix: '{t0}', value: 'Bonjour {viewer.name}' }]);

  const [tab, gem, sell, wide] = menu.slots;
  assert.deepEqual(tab.cells, [1, 2]);
  assert.equal(tab.label, '§aOnglet §lB');
  assert.equal(tab.icon, null);
  assert.deepEqual(tab.enabledWhen, { state: 'tab', is: 'a' });
  assert.deepEqual(tab.onClick, [
    { type: 'setState', state: 'tab', value: 'b' },
    { type: 'sound', sound: 'random.click', volume: 0.5 },
  ]);
  assert.deepEqual([gem.kind, gem.cells, gem.icon, gem.label], ['decoration', [26], 'textures/items/diamond', '§8Joyau']);
  assert.deepEqual([sell.kind, sell.cells, sell.label], ['input', [13], '']);
  assert.deepEqual([wide.cells, wide.label], [[16, 17], 'wide'], 'zone rognée à la grille, libellé = identifiant');

  const warnings = result.warnings.join('\n');
  assert.match(warnings, /sell.*input/);
  assert.match(warnings, /#123456/);
  assert.match(warnings, /wide.*rognée/);
  assert.deepEqual(runtime.warnings, result.warnings);
});

test('disposition : couches au pixel, jetons, textes, grille des slots', async () => {
  const result = await generate();
  const layout = json(result, 'pack/ui/menu_forge/shop.json') as { namespace: string; main_panel: { size: number[]; controls: unknown[] } };
  assert.equal(layout.namespace, 'menu_forge_shop');
  assert.deepEqual(layout.main_panel.size, [176, 114 + 3 * 18]);

  const [background] = findKey(layout, 'layer_0');
  assert.deepEqual([background.texture, background.size, background.offset, background.layer], [
    'textures/menu_forge/shop/background', [176, 90], [0, 0], 1,
  ]);
  const [tab] = findKey(layout, 'layer_1');
  assert.deepEqual([tab.size, tab.offset], [[10, 8], [34, 42]], 'recadrée sur ses pixels visibles');
  assert.match(JSON.stringify(tab.bindings), /#title_text - '\(1\)'/);
  assert.equal(findKey(layout, 'layer_2').length, 0, 'couche transparente omise');

  const [title] = findKey(layout, 'text_0');
  assert.deepEqual([title.text, title.color, title.offset, title.anchor_to, title.bindings], [
    'Boutique', [1, 0.667, 0], [8, 6], 'top_left', undefined,
  ]);
  const [hint] = findKey(layout, 'text_1');
  assert.equal(hint.anchor_to, 'top_middle');
  assert.match(JSON.stringify(hint.bindings), /#title_text - '\(t1\)'/);

  const [grid] = findKey(layout, 'slots');
  assert.deepEqual([grid.type, grid.grid_dimensions, grid.size, grid.offset, grid.collection_name, grid.grid_item_template], [
    'grid', [9, 4], [162, 72], [7, 17], 'form_buttons', 'menu_forge_shop.cell',
  ]);
  assert.deepEqual(grid.bindings, [{ binding_name: '#form_button_length', binding_name_override: '#maximum_grid_items' }]);

  // Texte dynamique : étiquette de la case qui porte l’entrée 27 (colonne 0, ligne 3 → (7, 71)).
  const [greeting] = findKey(layout, 'text_2');
  assert.deepEqual([greeting.offset, greeting.anchor_to], [[168 - 7, 70 - 71], 'top_right']);
  assert.match(JSON.stringify(greeting.bindings), /#form_button_text - '\{t0\}'/);

  const button = (layout as unknown as Record<string, Record<string, unknown>>)['cell_button@common.button'];
  const visibility = JSON.stringify(button.bindings);
  assert.ok(visibility.includes(INERT_MARKER) && visibility.includes(TEXT_MARKER), 'entrées inertes et textes sans bouton');
  assert.equal(button.$pressed_button_name, 'button.form_button_click');
});

test('routeur : une disposition par menu, choisie par le jeton du titre', async () => {
  const router = json(await generate(), 'pack/ui/menu_forge/router.json') as { namespace: string };
  assert.equal(router.namespace, 'menu_forge_router');
  for (const id of ['other', 'shop']) {
    const [child] = findKey(router, `menu_${id}@menu_forge_${id}.main_panel`);
    assert.ok(child, id);
    assert.match(JSON.stringify(child.bindings), new RegExp(`#title_text - '\\[mf:${id}\\]'`));
    assert.equal(child.visible, false);
  }
  assert.equal(findKey(router, 'menu_frame@menu_forge_frame.main_panel').length, 0);
});

test('conversions : MiniMessage, couleurs, sons, icônes, textes figés', () => {
  const warnings: string[] = [];
  assert.equal(miniMessageToLegacy('<gold>Or</gold> <italic>i <u>s', (message) => warnings.push(message)), '§6Or§r §oi s');
  assert.equal(miniMessageToLegacy('<color:#ff5555>x<rainbow>', (message) => warnings.push(message)), '§cx');
  assert.equal(warnings.length, 2);
  assert.equal(nearestLegacyCode(250, 250, 250), 'f');
  assert.deepEqual(hexToUiColor('#404040'), [0.251, 0.251, 0.251]);
  assert.deepEqual(hexToUiColor('#fff'), [1, 1, 1]);
  assert.equal(hexToUiColor('rouge'), null);
  assert.deepEqual(bedrockSound('minecraft:entity.player.levelup'), { sound: 'random.levelup', known: true });
  assert.deepEqual(bedrockSound('random.click'), { sound: 'random.click', known: true });
  assert.deepEqual(bedrockSound('custom.thing'), { sound: 'custom.thing', known: false });
  assert.deepEqual(bedrockIcon('STONE'), { path: 'textures/blocks/stone', approximate: false });
  assert.deepEqual(bedrockIcon('minecraft:golden_apple'), { path: 'textures/items/apple_golden', approximate: false });
  assert.deepEqual(bedrockIcon('WARPED_FUNGUS'), { path: 'textures/items/warped_fungus', approximate: true });
  assert.equal(isStaticText('Page 1'), true);
  assert.equal(isStaticText('{page.number}/{page.count}'), false);
  assert.equal(isStaticText('#1 du classement'), false);
});
