// Renommer un menu : les autres menus qui l’héritent, l’ouvrent ou l’incluent (composant) suivent.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeReference, menuReferences, rewriteMenuReferences } from '../src/model/references.ts';

const pager = { formatVersion: 1, id: 'pager', name: 'Pagination', component: true, container: { type: 'chest', rows: 6 }, layers: [] };
const shop = {
  formatVersion: 1,
  id: 'shop',
  name: 'Boutique',
  container: { type: 'chest', rows: 6 },
  layers: [],
  includes: [{ component: 'pager', prefix: 'a_' }, { component: 'pager', prefix: 'b_', row: 1 }, { component: 'other' }],
  slots: [{ id: 'more', kind: 'button', area: { col: 0, row: 0 }, onClick: [{ type: 'open', menu: 'pager' }] }],
};

test('les instances d’un composant comptent parmi ses références', () => {
  const [reference] = menuReferences([pager, shop], 'pager');
  assert.equal(reference.id, 'shop');
  assert.equal(reference.includes, 2);
  assert.equal(reference.opens, 1);
  assert.equal(describeReference(reference), 'l’ouvre et l’inclut (2 instances)');
});

test('renommer un composant met à jour ses instances', () => {
  const draft = structuredClone(shop);
  assert.equal(rewriteMenuReferences(draft, 'pager', 'pagination'), true);
  assert.deepEqual(draft.includes.map((include) => include.component), ['pagination', 'pagination', 'other']);
  assert.equal(draft.includes[1].row, 1, 'le reste de l’instance ne bouge pas');
  assert.equal(rewriteMenuReferences(structuredClone(pager), 'shop', 'store'), false);
});
