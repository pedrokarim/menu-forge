// Lecture et écriture de PNG, archives zip et préparation des menus à exporter.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync, inflateRawSync } from 'node:zlib';
import { crc32 } from '../src/export/crc32.ts';
import { menusForExport, texturesOf } from '../src/export/exportWorkspace.ts';
import { decodePng, encodePng } from '../src/export/png.ts';
import { createZip } from '../src/export/zip.ts';
import type { WorkspaceSnapshot } from '../src/lib/api.ts';
import type { MenuDefinition } from '../src/model/menu.ts';

/** PNG construit à la main : en-tête, lignes déjà filtrées, palette et transparence éventuelles. */
function rawPng(width: number, height: number, bitDepth: number, colorType: number, rows: Uint8Array, extra: Buffer[] = []) {
  const chunk = (type: string, data: Uint8Array) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(data.length, 0);
    header.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 0);
    return Buffer.concat([header, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    ...extra.map((data, index) => chunk(index === 0 && colorType === 3 ? 'PLTE' : 'tRNS', data)),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

test('un PNG RVBA écrit puis relu garde chaque pixel, alpha compris', async () => {
  const data = new Uint8Array(5 * 3 * 4).map((_, index) => (index * 37) % 256);
  const decoded = await decodePng(await encodePng({ width: 5, height: 3, data }));
  assert.equal(decoded.width, 5);
  assert.equal(decoded.height, 3);
  assert.deepEqual([...decoded.data], [...data]);
});

test('les filtres Sub, Up, Average et Paeth sont défaits', async () => {
  // Gris 8 bits, 3 × 4 : une ligne par filtre. Valeurs cibles 10, 20, 30 puis +5 par ligne.
  const target = [
    [10, 20, 30],
    [15, 25, 35],
    [20, 30, 40],
    [25, 35, 45],
  ];
  const rows = new Uint8Array([
    1, 10, 10, 10, // Sub : écart avec la gauche
    2, 5, 5, 5, // Up : écart avec la ligne du dessus
    3, 20 - Math.floor((0 + 15) / 2), 30 - Math.floor((20 + 25) / 2), 40 - Math.floor((30 + 35) / 2), // Average
    4, 25 - 20, 35 - 30, 45 - 40, // Paeth (prédicteur = pixel du dessus ici)
  ]);
  const image = await decodePng(rawPng(3, 4, 8, 0, rows));
  const grays = [...image.data].filter((_, index) => index % 4 === 0);
  assert.deepEqual(grays, target.flat());
});

test('palette 4 bits avec transparence', async () => {
  const palette = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]);
  const alpha = Buffer.from([255, 0]);
  // Une ligne de 3 pixels : indices 0, 1, 2 → octets 0x01, 0x20.
  const image = await decodePng(rawPng(3, 1, 4, 3, new Uint8Array([0, 0x01, 0x20]), [palette, alpha]));
  assert.deepEqual([...image.data], [255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 255]);
});

test('une archive zip se relit entrée par entrée', async () => {
  const text = new TextEncoder().encode('menu-forge '.repeat(50));
  const binary = new Uint8Array([1, 2, 3]);
  const zip = Buffer.from(
    await createZip([
      { path: 'pack.mcmeta', data: text },
      { path: 'assets/menuforge/é.bin', data: binary },
    ]),
  );
  // Fin de répertoire central.
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.equal(zip.readUInt16LE(end + 10), 2);
  let offset = zip.readUInt32LE(end + 16);
  const read: Record<string, Uint8Array> = {};
  for (let index = 0; index < 2; index++) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50);
    const method = zip.readUInt16LE(offset + 10);
    const crc = zip.readUInt32LE(offset + 16);
    const compressed = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    const start = local + 30 + zip.readUInt16LE(local + 26);
    const body = zip.subarray(start, start + compressed);
    const data = method === 8 ? inflateRawSync(body) : body;
    assert.equal(crc32(data), crc, name);
    read[name] = new Uint8Array(data);
    offset += 46 + nameLength;
  }
  assert.deepEqual(read['pack.mcmeta'], text);
  assert.deepEqual(read['assets/menuforge/é.bin'], binary);
});

test('les menus exportés sont résolus, sans gabarit ni métadonnée du studio', () => {
  const frame: MenuDefinition = {
    formatVersion: 1, id: 'frame', name: 'Cadre', template: true, container: { type: 'chest', rows: 6 },
    layers: [{ id: 'bar', texture: 'common/bar.png', x: 0, y: 0 }],
  };
  const shop: MenuDefinition = {
    formatVersion: 1, id: 'shop', name: 'Boutique', extends: ['frame'], container: { type: 'chest', rows: 6 },
    layers: [{ id: 'bg', texture: 'shop/bg.png', x: 0, y: 30, generator: { style: 'panel', width: 176, height: 90, color: '#c6c6c6' } }],
  };
  const snapshot: WorkspaceSnapshot = { root: '', menus: [shop, frame], assets: [], templates: [], textures: [] };
  const menus = menusForExport(snapshot);
  assert.deepEqual(menus.map((menu) => menu.id), ['shop']);
  assert.deepEqual(menus[0].layers.map((layer) => layer.id), ['bar', 'bg']);
  assert.equal('extends' in menus[0], false);
  assert.equal('generator' in menus[0].layers[1], false);
  assert.ok(shop.layers[0].generator, 'le document de l’espace n’est pas modifié');
  assert.deepEqual(texturesOf(menus), ['common/bar.png', 'shop/bg.png']);

  assert.throws(() => menusForExport({ ...snapshot, menus: [{ ...shop, extends: ['nope'] }] }), /Gabarit introuvable/);
  assert.throws(() => menusForExport({ ...snapshot, menus: [frame] }), /Aucun menu/);
});
