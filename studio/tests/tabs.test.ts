// Onglets de l’éditeur : ouverture sans doublon, fermeture qui revient au précédent, onglet qui suit
// son document, session d’un espace enregistrée puis relue.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_TABS, closeTabs, cycleTab, moveTab, openTab, restoreSession, retargetTab, serializeSession } from '../src/shell/tabs.ts';

const keys = (state: { tabs: Array<{ key: string }> }) => state.tabs.map((tab) => tab.key);

test('ouvrir un document déjà ouvert affiche son onglet ; un nouveau s’ajoute après l’onglet affiché', () => {
  let state = openTab(EMPTY_TABS, 'menus', 'shop', 'a');
  state = openTab(state, 'assets', 'logo', 'b');
  state = openTab(state, 'menus', 'shop', 'c');
  assert.deepEqual(keys(state), ['a', 'b']);
  assert.equal(state.active, 'a');
  state = openTab(state, 'pixels', 'coin', 'd');
  assert.deepEqual(keys(state), ['a', 'd', 'b'], 'inséré juste après l’onglet affiché');
});

test('un type sans document précis : le dernier onglet de ce type, sinon un onglet vide', () => {
  let state = openTab(EMPTY_TABS, 'menus', 'shop', 'a');
  state = openTab(state, 'assets', 'logo', 'b');
  state = openTab(state, 'menus', null, 'c');
  assert.equal(state.active, 'a');
  state = openTab(state, 'pixels', null, 'd');
  assert.equal(state.active, 'd');
  assert.equal(state.tabs.find((tab) => tab.key === 'd')?.id, null, 'onglet vide');
});

test('fermer l’onglet affiché revient au plus récemment affiché', () => {
  let state = openTab(EMPTY_TABS, 'menus', 'a', 'a');
  state = openTab(state, 'menus', 'b', 'b');
  state = openTab(state, 'menus', 'c', 'c');
  state = openTab(state, 'menus', 'a', 'x');
  state = closeTabs(state, ['a']);
  assert.equal(state.active, 'c');
  state = closeTabs(state, ['c', 'b']);
  assert.equal(state.active, null);
  assert.deepEqual(state.tabs, []);
});

test('l’onglet suit son document ; un doublon est fermé au profit de l’onglet existant', () => {
  let state = openTab(EMPTY_TABS, 'menus', 'shop', 'a');
  state = openTab(state, 'menus', null, 'b');
  state = openTab(state, 'assets', null, 'c');
  state = retargetTab(state, 'c', 'assets', 'logo');
  assert.equal(state.tabs.find((tab) => tab.key === 'c')?.id, 'logo');
  state = openTab(state, 'pixels', null, 'e');
  state = retargetTab(state, 'e', 'menus', 'shop');
  assert.ok(!keys(state).includes('e'));
  assert.equal(state.active, 'a', 'le doublon affiché laisse la place à l’onglet existant');
});

test('onglet suivant et précédent en boucle, déplacement', () => {
  let state = openTab(EMPTY_TABS, 'menus', 'a', 'a');
  state = openTab(state, 'menus', 'b', 'b');
  state = openTab(state, 'menus', 'c', 'c');
  assert.equal(cycleTab(state, 1).active, 'a');
  assert.equal(cycleTab(state, -1).active, 'b');
  assert.deepEqual(keys(moveTab(state, 'c', 0)), ['c', 'a', 'b']);
});

test('session : seuls les documents sont gardés ; une valeur abîmée donne une session vide', () => {
  let state = openTab(EMPTY_TABS, 'menus', 'shop', 'a');
  state = openTab(state, 'pixels', 'coin', 'b');
  state = openTab(state, 'assets', null, 'c');
  state = openTab(state, 'pixels', 'coin', 'z');
  const stored = serializeSession(state);
  assert.deepEqual(stored, { tabs: [{ mode: 'menus', id: 'shop' }, { mode: 'pixels', id: 'coin' }], active: 1 });
  const restored = restoreSession(JSON.parse(JSON.stringify(stored)));
  assert.deepEqual(restored.tabs.map(({ mode, id }) => ({ mode, id })), stored.tabs);
  assert.equal(restored.active, restored.tabs[1].key);
  assert.deepEqual(restoreSession({ tabs: [{ mode: 'nope', id: 'x' }, null, { mode: 'menus', id: '' }] }), EMPTY_TABS);
  assert.deepEqual(restoreSession('abîmé'), EMPTY_TABS);
});
