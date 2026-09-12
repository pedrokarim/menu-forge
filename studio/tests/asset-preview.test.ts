// Aperçus de l’export d’un asset : échelle choisie pour tenir dans la colonne (src/asset/canvasUtils.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitScale } from '../src/asset/canvasUtils.ts';

test('l’échelle voulue quand elle tient', () => {
  assert.equal(fitScale(2, 176, 352), 2);
  assert.equal(fitScale(1, 176, 292), 1);
});

test('sinon le plus grand entier qui tient', () => {
  // Encart d’aide (176 px) dans la colonne par défaut à 1440 px : 292 px utiles.
  assert.equal(fitScale(2, 176, 292), 1);
  assert.equal(fitScale(4, 100, 350), 3);
});

test('sinon la réduction juste nécessaire', () => {
  assert.equal(fitScale(1, 400, 232), 0.58);
  assert.ok(400 * fitScale(2, 400, 232) <= 232);
});

test('largeur nulle ou colonne vide : sans effet de bord', () => {
  assert.equal(fitScale(2, 0, 100), 2);
  assert.equal(fitScale(1, 100, 0), 0);
});
