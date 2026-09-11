// Parité de la résolution (gabarits, composants) entre le studio et la lib : mêmes fixtures que le
// test Java ParityFixturesTest (lib/menu-forge-core/src/test/resources/parity), même projection.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { resolveMenu } from '../src/model/resolve.ts';
import { projectMenu } from './projection.mjs';

const directory = new URL('../../lib/menu-forge-core/src/test/resources/parity/', import.meta.url);

for (const file of readdirSync(directory).filter((name) => name.endsWith('.json')).sort()) {
  const fixture = JSON.parse(readFileSync(new URL(file, directory), 'utf8'));
  for (const testCase of fixture.cases) {
    test(`${file} · ${testCase.name}`, () => {
      const byId = new Map(testCase.menus.map((menu) => [menu.id, menu]));
      const resolved = resolveMenu(byId.get(testCase.resolve), (id) => byId.get(id));
      if (testCase.error) {
        assert.ok(
          resolved.errors.some((error) => error.toLowerCase().includes(testCase.error)),
          `erreur « ${testCase.error} » attendue, reçu : ${resolved.errors.join(' | ') || 'aucune'}`,
        );
        return;
      }
      assert.deepEqual(resolved.errors, []);
      assert.deepEqual(projectMenu(resolved.menu), testCase.expected);
    });
  }
}
