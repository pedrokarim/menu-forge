// Schéma des assets (docs/asset.schema.json) : l’exemple de docs/assets.md, l’asset neuf du studio et
// un asset qui emploie tous les types d’éléments le respectent ; les assets mal formés sont refusés.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { IMAGE_SCALES, createEmptyAsset } from '../src/asset/model.ts';
import { validate } from './jsonSchema.mjs';

const repository = new URL('../../', import.meta.url);
const schema = JSON.parse(readFileSync(new URL('docs/asset.schema.json', repository), 'utf8'));

const complete = {
  ...createEmptyAsset('complet', 'Tous les éléments', 176, 44),
  background: '#00000080',
  groups: [{ id: 'header', name: 'En-tête' }],
  elements: [
    { id: 'frame', type: 'box', group: 'header', x: 0, y: 0, width: 44, height: 44, style: { kind: 'procedural', preset: 'flat', color: '#3b2f2a', border: '#2e8b86' } },
    {
      id: 'slice', type: 'box', x: 48, y: 0, width: 64, height: 20, locked: true,
      style: { kind: 'slice', texture: 'ui/frame.png', source: { x: 0, y: 0, width: 22, height: 22 }, insets: { top: 3, right: 3, bottom: 3, left: 3 } },
    },
    { id: 'veil', type: 'box', x: 0, y: 0, width: 8, height: 8, hidden: true, style: { kind: 'procedural', preset: 'veil', color: '#00000088' } },
    { id: 'logo', type: 'image', group: 'header', x: 6, y: 6, texture: 'logo.png', source: { x: 0, y: 0, width: 128, height: 128 }, scale: 0.25 },
    { id: 'title', type: 'text', x: 54, y: 6, text: 'Aide\n§5site', color: '#ffffff', shadow: false, bold: true, lineHeight: 10, align: 'left' },
  ],
};

test('l’exemple de docs/assets.md respecte le schéma', () => {
  const markdown = readFileSync(new URL('docs/assets.md', repository), 'utf8');
  const example = /## Exemple[\s\S]*?```json\r?\n([\s\S]*?)```/.exec(markdown);
  assert.ok(example, 'bloc JSON introuvable après « Exemple »');
  assert.deepEqual(validate(schema, JSON.parse(example[1])), []);
});

test('un asset neuf du studio et un asset complet respectent le schéma', () => {
  assert.deepEqual(validate(schema, createEmptyAsset('vide', 'Vide')), []);
  assert.deepEqual(validate(schema, complete), []);
});

test('les assets mal formés sont refusés, avec le chemin de la clé fautive', () => {
  const box = complete.elements[0];
  const cases = [
    ['fond sans alpha', { ...complete, background: '#ffffff' }, '$.background'],
    ['taille trop grande', { ...complete, size: { width: 2000, height: 10 } }, '$.size.width'],
    ['type d’élément inconnu', { ...complete, elements: [{ ...box, type: 'circle' }] }, '$.elements[0]'],
    ['échelle non admise', { ...complete, elements: [{ id: 'i', type: 'image', x: 0, y: 0, texture: 'a.png', scale: 1.5 }] }, '$.elements[0].scale'],
    ['box sans style', { ...complete, elements: [{ id: 'b', type: 'box', x: 0, y: 0, width: 4, height: 4 }] }, '$.elements[0].style'],
    ['nine-slice sans marges', { ...complete, elements: [{ ...box, style: { kind: 'slice', texture: 'a.png' } }] }, '$.elements[0].style'],
    ['alignement inconnu', { ...complete, elements: [{ id: 't', type: 'text', x: 0, y: 0, text: 'a', align: 'justify' }] }, '$.elements[0].align'],
    ['clé inconnue', { ...complete, author: 'moi' }, '$.author'],
    ['groupe mal nommé', { ...complete, groups: [{ id: 'En-tête' }] }, '$.groups[0].id'],
  ];
  for (const [label, document, path] of cases) {
    const errors = validate(schema, document);
    assert.ok(errors.length > 0, `${label} : aurait dû être refusé`);
    assert.ok(errors.some((error) => error.startsWith(path)), `${label} : chemin ${path} attendu dans ${errors.join(' | ')}`);
  }
});

test('le schéma admet les mêmes échelles d’image que le studio', () => {
  const image = schema.$defs.element.oneOf.find((branch) => branch.properties.type.const === 'image');
  assert.deepEqual(image.properties.scale.enum, [...IMAGE_SCALES]);
});
