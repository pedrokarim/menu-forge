// Génération d’interfaces par IA : lecture du JSON, validation par le schéma et les règles de
// la lib (src/ai/menuCheck.ts), boucle de correction bornée (src/ai/correction.ts). Le modèle
// est une fonction factice : aucun appel réseau.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { correctionMessage, extractJson, generateWithCorrections } from '../src/ai/correction.ts';
import type { ChatMessage } from '../src/ai/correction.ts';
import { checkMenu } from '../src/ai/menuCheck.ts';
import type { MenuCheckContext } from '../src/ai/menuCheck.ts';
import { interfaceSystemPrompt } from '../src/ai/prompts.ts';
import type { MenuDefinition } from '../src/model/menu.ts';

const repository = new URL('../../', import.meta.url);
const schemaText = readFileSync(new URL('docs/menu.schema.json', repository), 'utf8');
const schema: unknown = JSON.parse(schemaText);

const context: MenuCheckContext = {
  schema,
  menuId: 'boutique',
  rows: 3,
  textures: new Set(['shop/fond.png']),
  menus: [{ id: 'accueil', name: 'Accueil' }],
  allowGenerated: true,
};

const good = () =>
  ({
    formatVersion: 1,
    id: 'boutique',
    name: 'Boutique',
    container: { type: 'chest', rows: 3 },
    state: { page: { type: 'page', list: 'objets' }, onglet: { type: 'enum', values: ['armes', 'armures'], default: 'armes' } },
    layers: [
      { id: 'fond', texture: 'shop/fond.png', x: 0, y: 0 },
      { id: 'bouton', texture: 'ce/chemin/est/remplace.png', x: 151, y: 53, generator: { style: 'button', width: 18, height: 18, color: '#52a535' } },
    ],
    texts: [{ id: 'titre', x: 8, y: 6, value: 'Boutique · page {page.number}' }],
    slots: [
      { id: 'grille', kind: 'list', list: 'objets', area: { col: 0, row: 0, width: 8, height: 3 } },
      {
        id: 'suivant',
        kind: 'button',
        area: { col: 8, row: 2 },
        item: { invisible: true, name: '<gray>Suivant' },
        visibleWhen: { state: 'onglet', is: 'armes' },
        onClick: [{ type: 'nextPage', list: 'objets' }, { type: 'setState', state: 'onglet', value: 'armures' }, { type: 'open', menu: 'accueil' }],
      },
    ],
  }) as Record<string, unknown> & { layers: Array<Record<string, unknown>>; texts: Array<Record<string, unknown>>; slots: Array<Record<string, unknown>> };

test('le JSON est lu brut, en bloc de code ou entouré de texte', () => {
  assert.deepEqual(extractJson('{"a":1}'), { value: { a: 1 } });
  assert.deepEqual(extractJson('Voici :\n```json\n{"a":2}\n```\nBonne journée'), { value: { a: 2 } });
  assert.deepEqual(extractJson('Réponse : {"a":{"b":3}} fin'), { value: { a: { b: 3 } } });
  const broken = extractJson('{"a":');
  assert.ok('error' in broken && broken.error.startsWith('$ : JSON illisible'));
  assert.ok('error' in extractJson('[1, 2]'));
});

test('un menu conforme passe, et ses textures générées sont rangées par le studio', () => {
  const result = checkMenu(good(), context);
  assert.deepEqual(result.errors, []);
  assert.equal(result.value?.layers[1].texture, 'generated/boutique/bouton.png');
});

test('chaque règle refuse le menu avec le chemin de la clé fautive', () => {
  const cases: Array<[string, (menu: ReturnType<typeof good>) => void, string, Partial<MenuCheckContext>?]> = [
    ['clé inconnue (schéma)', (menu) => (menu.colour = 'red'), '$.colour'],
    ['couleur de texte (schéma)', (menu) => (menu.texts[0].color = 'rouge'), '$.texts[0].color'],
    ['identifiant imposé', (menu) => (menu.id = 'autre'), '$.id'],
    ['taille imposée', (menu) => ((menu.container as { rows: number }).rows = 6), '$.container.rows'],
    ['héritage refusé', (menu) => (menu.extends = ['navigation']), '$.extends'],
    ['texte trop haut', (menu) => (menu.texts[0].y = 2), '$.texts[0].y'],
    ['zone hors du coffre', (menu) => (menu.slots[0].area = { col: 2, row: 1, width: 8, height: 1 }), '$.slots[0].area'],
    ['texture inconnue', (menu) => (menu.layers[0].texture = 'nulle/part.png'), '$.layers[0].texture'],
    ['identifiant en double', (menu) => (menu.slots[1].id = 'grille'), '$.slots[1].id'],
    ['état inconnu dans une condition', (menu) => (menu.slots[1].visibleWhen = { state: 'mode', is: 'x' }), '$.slots[1].visibleWhen'],
    ['setState hors des valeurs', (menu) => ((menu.slots[1].onClick as unknown[])[1] = { type: 'setState', state: 'onglet', value: 'bijoux' }), '$.slots[1].onClick[1]'],
    ['nextPage sans état page', (menu) => ((menu.slots[1].onClick as unknown[])[0] = { type: 'nextPage', list: 'autre' }), '$.slots[1].onClick[0]'],
    ['open vers un menu absent', (menu) => ((menu.slots[1].onClick as unknown[])[2] = { type: 'open', menu: 'fantome' }), '$.slots[1].onClick[2]'],
    ['texture générée trop grande', (menu) => ((menu.layers[1].generator as { width: number }).width = 400), '$.layers[1].generator'],
    ['couleur générée invalide', (menu) => ((menu.layers[1].generator as { color: string }).color = 'vert'), '$.layers[1].generator.color'],
    ['textures générées interdites', () => undefined, '$.layers[1].generator', { allowGenerated: false }],
  ];
  for (const [label, mutate, path, extra] of cases) {
    const menu = good();
    mutate(menu);
    const { errors, value } = checkMenu(menu, { ...context, ...extra });
    assert.equal(value, undefined, `${label} : aurait dû être refusé`);
    assert.ok(errors.some((error) => error.startsWith(path)), `${label} : ${path} attendu dans ${errors.join(' | ')}`);
  }
});

test('l’exemple donné au modèle respecte lui-même toutes les règles', () => {
  const prompt = interfaceSystemPrompt({ schemaText, menuId: 'x', name: 'X', rows: 3, textures: [], menus: [], allowGenerated: true });
  const line = prompt.split('\n').find((text) => text.startsWith('EXEMPLE valide'));
  assert.ok(line);
  const example: unknown = JSON.parse(line.slice(line.indexOf('{')));
  const result = checkMenu(example, { ...context, menuId: 'exemple', textures: new Set(), menus: [] });
  assert.deepEqual(result.errors, []);
  assert.ok(prompt.includes('"id": "x"') && prompt.includes('SCHÉMA JSON : {"$schema"'));
});

test('les erreurs sont renvoyées au modèle jusqu’à un document valide', async () => {
  const broken = good();
  broken.texts[0].y = 1;
  const answers = [JSON.stringify(broken), `Voici la correction :\n\`\`\`json\n${JSON.stringify(good())}\n\`\`\``];
  const calls: ChatMessage[][] = [];
  const result = await generateWithCorrections<MenuDefinition>({
    request: 'Une boutique',
    maxAttempts: 3,
    send: async (messages) => {
      calls.push(messages);
      return answers[calls.length - 1];
    },
    validate: (value) => checkMenu(value, context),
  });
  assert.equal(result.attempts.length, 2);
  assert.equal(result.value?.id, 'boutique');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].map((message) => message.role), ['user', 'assistant', 'user']);
  assert.ok(calls[1][2].content.includes('$.texts[0].y'));
  assert.ok(calls[1][2].content.includes('document COMPLET corrigé'));
});

test('le nombre d’essais est borné (de 1 à 5) : jamais de boucle sans fin', async () => {
  for (const [asked, expected] of [[3, 3], [99, 5], [0, 1]]) {
    let count = 0;
    const result = await generateWithCorrections({
      request: 'x',
      maxAttempts: asked,
      send: async () => {
        count++;
        return 'pas du JSON';
      },
      validate: () => ({ errors: ['$ : jamais valide'] }),
    });
    assert.equal(count, expected);
    assert.equal(result.value, null);
    assert.equal(result.attempts.length, expected);
  }
});

test('une génération annulée ne contacte plus le modèle', async () => {
  const controller = new AbortController();
  controller.abort();
  let count = 0;
  await assert.rejects(
    generateWithCorrections({ request: 'x', signal: controller.signal, send: async () => String(++count), validate: () => ({ errors: [] }) }),
    { name: 'AbortError' },
  );
  assert.equal(count, 0);
});

test('les erreurs très nombreuses sont résumées', () => {
  const message = correctionMessage(Array.from({ length: 50 }, (_, index) => `$.slots[${index}] : problème`));
  assert.ok(message.includes('$.slots[39]'));
  assert.ok(!message.includes('$.slots[40]'));
  assert.ok(message.includes('10 autres erreurs'));
});
