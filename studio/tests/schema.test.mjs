// Schéma du format (docs/menu.schema.json) : les gabarits et exemples du dépôt le respectent, les
// documents mal formés sont refusés, et les listes du schéma suivent les types du studio.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { ACTION_TYPES } from '../src/model/actions.ts';
import { FORM_LAYOUTS } from '../src/model/bedrockForm.ts';
import { CONDITION_KINDS } from '../src/model/conditionText.ts';
import { STATE_TYPES } from '../src/model/stateEdit.ts';
import { validate } from './jsonSchema.mjs';

const repository = new URL('../../', import.meta.url);
const schema = JSON.parse(readFileSync(new URL('docs/menu.schema.json', repository), 'utf8'));
const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));
const menusIn = (relative) => {
  const directory = new URL(relative, repository);
  return readdirSync(directory)
    .filter((file) => file.endsWith('.menu.json'))
    .sort()
    .map((file) => ({ file: `${relative}${file}`, menu: readJson(new URL(file, directory)) }));
};
const assertValid = (label, document) => assert.deepEqual(validate(schema, document), [], `${label} devrait respecter le schéma`);

test('les gabarits fournis respectent le schéma', () => {
  const templates = menusIn('templates/');
  assert.ok(templates.length > 0);
  for (const { file, menu } of templates) assertValid(file, menu);
});

test('les menus de test de la lib respectent le schéma', () => {
  for (const { file, menu } of menusIn('lib/menu-forge-core/src/test/resources/menus/')) assertValid(file, menu);
});

test('les menus des fixtures de parité respectent le schéma', () => {
  const directory = new URL('lib/menu-forge-core/src/test/resources/parity/', repository);
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.json'))) {
    for (const testCase of readJson(new URL(file, directory)).cases) {
      for (const menu of testCase.menus) assertValid(`${file} · ${testCase.name} · ${menu.id}`, menu);
    }
  }
});

test('l’exemple complet de docs/format.md respecte le schéma', () => {
  const markdown = readFileSync(new URL('docs/format.md', repository), 'utf8');
  const example = /## Exemple complet[\s\S]*?```json\r?\n([\s\S]*?)```/.exec(markdown);
  assert.ok(example, 'bloc JSON introuvable après « Exemple complet »');
  assertValid('docs/format.md', JSON.parse(example[1]));
});

test('l’exemple de formulaire Bedrock de docs/format.md respecte le schéma', () => {
  const markdown = readFileSync(new URL('docs/format.md', repository), 'utf8');
  const example = /## Formulaire Bedrock[\s\S]*?```json\r?\n([\s\S]*?)```/.exec(markdown);
  assert.ok(example, 'bloc JSON introuvable après « Formulaire Bedrock »');
  const form = JSON.parse(example[1]);
  assert.ok(form.form && !form.container);
  assertValid('docs/format.md (formulaire)', form);
});

test('les formulaires Bedrock mal formés sont refusés', () => {
  const base = { formatVersion: 1, id: 'hub', form: { layout: 'grid', title: 'Hub', buttons: [{ id: 'a', text: 'A' }] } };
  const withButton = (button) => ({ ...base, form: { ...base.form, buttons: [{ id: 'a', text: 'A', ...button }] } });
  assertValid('formulaire minimal', base);
  const cases = [
    ['formulaire avec un coffre', { ...base, container: { type: 'chest', rows: 3 } }, '$.container'],
    ['formulaire avec des couches', { ...base, layers: [] }, '$.layers'],
    ['formulaire qui hérite', { ...base, extends: ['frame'] }, '$.extends'],
    ['disposition inconnue', { ...base, form: { ...base.form, layout: 'carousel' } }, '$.form.layout'],
    ['formulaire sans titre', { ...base, form: { layout: 'grid', buttons: [] } }, '$.form.title'],
    ['bouton sans identifiant', { ...base, form: { ...base.form, buttons: [{ text: 'A' }] } }, '$.form.buttons[0].id'],
    ['rôle inconnu', withButton({ role: 'tab' }), '$.form.buttons[0].role'],
    ['icône à deux clés', withButton({ icon: { path: 'textures/items/diamond', url: 'https://example.org/a.png' } }), '$.form.buttons[0].icon'],
    ['texture d’icône sans PNG', withButton({ icon: { texture: 'icons/a.jpg' } }), '$.form.buttons[0].icon'],
    ['action inconnue', withButton({ onClick: [{ type: 'teleport' }] }), '$.form.buttons[0].onClick[0]'],
  ];
  for (const [label, document, path] of cases) {
    const errors = validate(schema, document);
    assert.ok(errors.length > 0, `${label} : aurait dû être refusé`);
    assert.ok(errors.some((error) => error.startsWith(path)), `${label} : chemin ${path} attendu dans ${errors.join(' | ')}`);
  }
});

test('les documents mal formés sont refusés, avec le chemin de la clé fautive', () => {
  const base = { formatVersion: 1, id: 'menu', container: { type: 'chest', rows: 6 }, layers: [] };
  const button = { id: 's', kind: 'button', area: { col: 0, row: 0 } };
  const cases = [
    ['identifiant invalide', { ...base, id: 'Mon-Menu' }, '$.id'],
    ['version inconnue', { ...base, formatVersion: 2 }, '$.formatVersion'],
    ['clé inconnue', { ...base, colour: 'red' }, '$.colour'],
    ['coffre de 7 lignes', { ...base, container: { type: 'chest', rows: 7 } }, '$.container.rows'],
    ['couche sans texture', { ...base, layers: [{ id: 'a', x: 0, y: 0 }] }, '$.layers[0].texture'],
    ['texture qui n’est pas un PNG', { ...base, layers: [{ id: 'a', texture: 'a.jpg', x: 0, y: 0 }] }, '$.layers[0].texture'],
    ['couleur de texte', { ...base, texts: [{ id: 't', x: 8, y: 6, value: 'a', color: 'red' }] }, '$.texts[0].color'],
    ['slot liste sans source', { ...base, slots: [{ ...button, kind: 'list' }] }, '$.slots[0].list'],
    ['colonne hors de la grille', { ...base, slots: [{ ...button, area: { col: 9, row: 0 } }] }, '$.slots[0].area.col'],
    ['action inconnue', { ...base, slots: [{ ...button, onClick: [{ type: 'teleport' }] }] }, '$.slots[0].onClick[0]'],
    ['setState sans valeur', { ...base, slots: [{ ...button, onClick: [{ type: 'setState', state: 'tab' }] }] }, '$.slots[0].onClick[0].value'],
    ['exécutant de commande', { ...base, slots: [{ ...button, onClick: [{ type: 'command', command: 'spawn', as: 'op' }] }] }, '$.slots[0].onClick[0].as'],
    ['condition sans is ni in', { ...base, slots: [{ ...button, visibleWhen: { state: 'tab' } }] }, '$.slots[0].visibleWhen'],
    ['condition à deux clés', { ...base, slots: [{ ...button, visibleWhen: { flag: 'a', not: { flag: 'b' } } }] }, '$.slots[0].visibleWhen'],
    ['enum sans valeur', { ...base, state: { tab: { type: 'enum', values: [], default: 'a' } } }, '$.state.tab.values'],
    ['nom d’état avec un point', { ...base, state: { 'page.x': { type: 'bool', default: true } } }, '$.state.page.x'],
    ['type d’état inconnu', { ...base, state: { tab: { type: 'float', default: 1 } } }, '$.state.tab'],
    ['composant sans id', { ...base, includes: [{ prefix: 'a_' }] }, '$.includes[0].component'],
    ['préfixe invalide', { ...base, includes: [{ component: 'pager', prefix: 'Pager-' }] }, '$.includes[0].prefix'],
  ];
  for (const [label, document, path] of cases) {
    const errors = validate(schema, document);
    assert.ok(errors.length > 0, `${label} : aurait dû être refusé`);
    assert.ok(errors.some((error) => error.startsWith(path)), `${label} : chemin ${path} attendu dans ${errors.join(' | ')}`);
  }
});

test('le schéma et les types du studio listent les mêmes actions, conditions et états', () => {
  const branches = (definition) => schema.$defs[definition].oneOf;
  const actionTypes = branches('action').map((branch) => branch.properties.type.const);
  assert.deepEqual(actionTypes.sort(), ACTION_TYPES.map((info) => info.type).sort());
  const conditionKeys = branches('condition').map((branch) => (branch.properties.is ? 'is' : branch.properties.in ? 'in' : branch.required[0]));
  assert.deepEqual(conditionKeys.sort(), CONDITION_KINDS.map((info) => info.kind).sort());
  const stateTypes = branches('stateDefinition').map((branch) => branch.properties.type.const);
  assert.deepEqual(stateTypes.sort(), STATE_TYPES.map((info) => info.type).sort());
  assert.deepEqual([...schema.$defs.formLayout.enum].sort(), FORM_LAYOUTS.map((info) => info.layout).sort());
});
