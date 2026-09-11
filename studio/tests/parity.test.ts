// Parité avec la lib Java : la fixture partagée de
// lib/menu-forge-core/src/test/resources/parity (menus + textures), passée au
// générateur du studio, doit donner exactement les fichiers attendus écrits
// par la lib (ParityFixtureTest) : polices octet pour octet, textures pixel
// pour pixel, titres identiques.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../src/export/png.ts';
import type { RgbaImage } from '../src/export/image.ts';
import { measureImage } from '../src/export/image.ts';
import { fontCodepoints, generatePack, renderTitleJson, toLibTokens } from '../src/export/pack.ts';
import { composeTitle } from '../src/model/compose.ts';
import type { MenuDefinition } from '../src/model/menu.ts';
import { buildPreviewContext } from '../src/model/preview.ts';
import { resolveMenu } from '../src/model/resolve.ts';

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../lib/menu-forge-core/src/test/resources/parity',
);
const NAMESPACE = 'menuforge';

function listFiles(root: string): string[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => !readdirSafe(path.join(root, file)))
    .sort();
}

function readdirSafe(file: string): boolean {
  try {
    readdirSync(file);
    return true;
  } catch {
    return false;
  }
}

/** Menus de la fixture, gabarits résolus, triés par id (comme côté Java). */
function resolvedMenus(): MenuDefinition[] {
  const menusDir = path.join(FIXTURE, 'menus');
  const all = readdirSync(menusDir)
    .sort()
    .map((file) => JSON.parse(readFileSync(path.join(menusDir, file), 'utf8')) as MenuDefinition);
  const byId = new Map(all.map((menu) => [menu.id, menu]));
  return all
    .filter((menu) => !menu.template)
    .map((menu) => {
      const resolved = resolveMenu(menu, (id) => byId.get(id));
      assert.deepEqual(resolved.errors, []);
      return resolved.menu;
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

async function loadTexture(texture: string): Promise<RgbaImage | null> {
  try {
    return await decodePng(readFileSync(path.join(FIXTURE, 'textures', texture)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

test('le pack du studio est identique à celui de la lib', async () => {
  const files = await generatePack(resolvedMenus(), loadTexture, NAMESPACE);
  const expectedDir = path.join(FIXTURE, 'expected', 'pack');
  assert.deepEqual([...files.keys()], listFiles(expectedDir), 'liste des fichiers');

  for (const [file, bytes] of files) {
    const expected = readFileSync(path.join(expectedDir, file));
    if (file.endsWith('.png')) {
      const [want, got] = await Promise.all([decodePng(expected), decodePng(bytes)]);
      assert.equal(got.width, want.width, `${file} : largeur`);
      assert.equal(got.height, want.height, `${file} : hauteur`);
      assert.ok(Buffer.from(got.data).equals(Buffer.from(want.data)), `${file} : pixels`);
    } else {
      assert.equal(new TextDecoder().decode(bytes), expected.toString('utf8'), file);
    }
  }
});

test('les titres du studio sont identiques à ceux de la lib', async () => {
  const expected = JSON.parse(readFileSync(path.join(FIXTURE, 'expected', 'titles.json'), 'utf8')) as Record<
    string,
    { tokens: unknown[]; json: string }
  >;
  const menus = resolvedMenus();
  assert.deepEqual(menus.map((menu) => menu.id), Object.keys(expected).sort());

  for (const menu of menus) {
    const bounds = new Map<string, ReturnType<typeof measureImage>>();
    for (const layer of menu.layers) {
      const image = await loadTexture(layer.texture);
      bounds.set(layer.texture, image ? measureImage(image) : null);
    }
    const boundsOf = (texture: string) => bounds.get(texture) ?? null;
    const context = buildPreviewContext(menu, { state: {}, pageCounts: {}, flags: [], viewerName: 'Steve' });
    const tokens = toLibTokens(composeTitle(menu, context, boundsOf), menu);
    assert.deepEqual(tokens, expected[menu.id].tokens, `${menu.id} : jetons`);
    const json = renderTitleJson(menu.id, tokens, fontCodepoints(menu, boundsOf), NAMESPACE);
    assert.equal(json, expected[menu.id].json, `${menu.id} : composant JSON`);
  }
});
