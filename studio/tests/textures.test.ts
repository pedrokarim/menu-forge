// Textures générées : formes au pixel près, couleurs des états, et cuisson reproductible octet pour octet.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { RgbaImage } from '../src/export/image.ts';
import { decodePng } from '../src/export/png.ts';
import { GENERATOR_PRESETS } from '../src/model/generator.ts';
import { MCRS_COLORS, MCRS_PRESETS, MCRS_STYLES, roundedSpan } from '../src/model/mcrs.ts';
import type { GeneratorSpec } from '../src/model/menu.ts';
import { renderGeneratorImage, renderGeneratorPng } from '../src/model/textureRender.ts';

const pixel = (image: RgbaImage, x: number, y: number) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
const render = (spec: GeneratorSpec) => renderGeneratorImage(spec, { x: 0, y: 0 });
/** Motif d’une image : `#` pour un pixel opaque, `.` pour un pixel transparent. */
const mask = (image: RgbaImage) =>
  Array.from({ length: image.height }, (_, y) =>
    Array.from({ length: image.width }, (_, x) => (pixel(image, x, y)[3] === 0 ? '.' : '#')).join(''),
  );

test('les coins arrondis retirent un pixel, un « L » de trois, puis un arc', () => {
  assert.deepEqual(roundedSpan(0, 12, 12, 1), [1, 11]);
  assert.deepEqual(roundedSpan(1, 12, 12, 1), [0, 12]);
  assert.deepEqual(roundedSpan(0, 12, 12, 2), [2, 10]);
  assert.deepEqual(roundedSpan(1, 12, 12, 2), [1, 11]);
  assert.deepEqual(roundedSpan(2, 12, 12, 2), [0, 12]);
  assert.deepEqual(roundedSpan(11, 12, 12, 2), [2, 10]);
  assert.deepEqual(roundedSpan(0, 12, 12, 3), [3, 9]);
  assert.deepEqual(roundedSpan(1, 12, 12, 3), [1, 11]);
  assert.equal(roundedSpan(12, 12, 12, 1), null);
  // Le rayon est ramené à la moitié du plus petit côté.
  assert.deepEqual(roundedSpan(0, 4, 2, 5), [1, 3]);
});

test('la bordure arrondie a la forme de celle du pack mc-rs (coin plein, un pixel)', () => {
  const border = render({ style: 'mcrs_border', width: 12, height: 12, color: '#ffffff', radius: 1, borderWidth: 1 });
  const inner = '#..........#';
  assert.deepEqual(mask(border), ['.##########.', '##........##', ...Array(8).fill(inner), '##........##', '.##########.']);
  assert.deepEqual(pixel(border, 5, 0), [255, 255, 255, 255]);
});

test('bouton plat mc-rs : les trois états de generate_assets.py', () => {
  const base: GeneratorSpec = { style: 'mcrs_button', width: 16, height: 16, color: MCRS_COLORS.button, radius: 0, borderColor: MCRS_COLORS.panelBorder };
  const normal = render(base);
  // Même bordure et même fond que button_default.png.
  assert.deepEqual(pixel(normal, 0, 0), [60, 60, 80, 255]);
  assert.deepEqual(pixel(normal, 8, 8), [30, 30, 46, 230]);

  const hover = render({ ...base, borderColor: undefined, state: 'hover' });
  assert.deepEqual(pixel(hover, 0, 5), [255, 217, 51, 255], 'bordure or');
  assert.deepEqual(pixel(hover, 8, 8), [57, 57, 71, 250], 'fond éclairci');

  const pressed = render({ ...base, borderColor: undefined, state: 'pressed' });
  assert.deepEqual(pixel(pressed, 15, 15), [255, 154, 30, 255], 'bordure orange de mc-rs, tirée de l’or');
  assert.deepEqual(pixel(pressed, 8, 8), [77, 65, 15, 255], 'or assombri');

  const green = render({ ...base, state: 'hover', accent: '#40c060' });
  assert.deepEqual(pixel(green, 0, 5), [64, 192, 96, 255], 'l’accent remplace l’or');
});

test('bouton en relief : ombre portée sous le corps, disparue quand il est pressé', () => {
  const spec: GeneratorSpec = { style: 'mcrs_raised', width: 20, height: 16, color: MCRS_COLORS.green, shadow: 2 };
  const normal = render(spec);
  assert.deepEqual(pixel(normal, 0, 0), [0, 0, 0, 0], 'coin arrondi');
  assert.deepEqual(pixel(normal, 5, 0), [128, 194, 123, 255], 'reflet du haut');
  assert.deepEqual(pixel(normal, 5, 13), [42, 97, 38, 255], 'lèvre sombre');
  assert.deepEqual(pixel(normal, 5, 15), [0, 0, 0, 99], 'ombre portée de mc-rs');

  const pressed = render({ ...spec, state: 'pressed' });
  assert.deepEqual(pixel(pressed, 5, 0), [0, 0, 0, 0], 'le corps est descendu');
  assert.equal(pixel(pressed, 5, 15)[3], 255, 'plus d’ombre : le corps l’occupe');
});

test('panneau mc-rs : alpha conservé, cases sombres creusées à leur place dans la grille', () => {
  const panel = render({ ...MCRS_PRESETS[0].spec, cells: [{ col: 0, row: 0, width: 9, height: 6 }], cellStyle: 'mcrs_slot' });
  assert.deepEqual(pixel(panel, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(panel, 1, 1), [60, 60, 80, 255], 'bordure du panneau');
  assert.deepEqual(pixel(panel, 5, 5), [12, 12, 25, 245], 'fond bleu nuit semi-transparent');
  // Case (0, 0) : de (7, 17) à (24, 34), coin coupé, ombre en haut à gauche, reflet en bas à droite.
  assert.deepEqual(pixel(panel, 7, 17), [12, 12, 25, 245], 'coin de la case : le panneau');
  assert.deepEqual(pixel(panel, 8, 17), [15, 15, 25, 255], 'ombre intérieure');
  assert.deepEqual(pixel(panel, 24, 30), [54, 54, 71, 255], 'reflet intérieur');
  assert.deepEqual(pixel(panel, 15, 25), [27, 27, 46, 255], 'fond de la case');
});

test('styles Deepslate dans le tampon : même biseau que sur la toile', () => {
  const panel = render({ style: 'panel', width: 20, height: 20, color: '#c6c6c6' });
  assert.deepEqual(pixel(panel, 0, 0), [0, 0, 0, 0], 'coin coupé');
  assert.deepEqual(pixel(panel, 1, 0), [0, 0, 0, 255], 'bordure noire');
  assert.deepEqual(pixel(panel, 2, 2), [255, 255, 255, 255], 'reflet');
  assert.deepEqual(pixel(panel, 17, 17), [85, 85, 85, 255], 'ombre');
  assert.deepEqual(pixel(panel, 10, 10), [198, 198, 198, 255], 'fond');
  const veil = render({ style: 'veil', width: 4, height: 4, color: '#00000088' });
  assert.deepEqual(pixel(veil, 2, 2), [0, 0, 0, 136]);
});

/** Empreintes SHA-256 des PNG des modèles : un changement de rendu doit être voulu (et ces valeurs mises à jour). */
const GOLDEN: Record<string, string> = {
  'Panneau vanilla': '896750f32b7d01b1',
  'Bouton bleu': 'ae361d380763723b',
  'Bouton vert': 'f8677beefec7a07e',
  'Bouton orange': '882eaee3afc07f1e',
  'Bouton rouge': 'd313db63aeadd213',
  'Bouton gris': 'd2befcad8bd2c389',
  'Cellule de slot': '5d588c2b0cd1a9d5',
  'Voile de modale': 'e8277e92d2448899',
  'Aplat sombre': '459158470cb5f2b6',
  'Panneau mc-rs': 'd1e30abc2fc53c4e',
  'Bordure arrondie or': '1a502a22b63756c5',
  'Bouton mc-rs': 'ca448cc25cb1e7c6',
  'Bouton mc-rs survolé': '0dfd4812bd97d2c2',
  'Bouton mc-rs pressé': '5c16fc983f059ad0',
  'Bouton vert en relief': '3bceb78b5f5cfa00',
  'Bouton spécial': 'dd1497ef8dfe1125',
  'Bouton en relief': 'c5350e26ec1c1259',
  'Bande or': 'd5ed002f11e60086',
  'Bande orange': '107e9dc598b5d84b',
  'Case sombre': 'e176351c388a59d1',
  'Grille de chargement': 'd76a4f1308665f36',
};

test('cuisson reproductible : mêmes octets à chaque fois, PNG relu identique au tampon', async () => {
  const hashes: Record<string, string> = {};
  for (const preset of [...GENERATOR_PRESETS, ...MCRS_PRESETS]) {
    const first = await renderGeneratorPng(preset.spec, { x: 0, y: 0 });
    const second = await renderGeneratorPng(structuredClone(preset.spec), { x: 0, y: 0 });
    assert.deepEqual(first, second, preset.label);
    const decoded = await decodePng(first);
    assert.deepEqual(decoded.data, render(preset.spec).data, `${preset.label} : PNG relu`);
    hashes[preset.label] = createHash('sha256').update(first).digest('hex').slice(0, 16);
  }
  if (Object.keys(GOLDEN).length === 0) console.log(JSON.stringify(hashes, null, 2));
  else assert.deepEqual(hashes, GOLDEN);
});

test('chaque style mc-rs a un modèle et dessine quelque chose', () => {
  for (const style of MCRS_STYLES) {
    const preset = MCRS_PRESETS.find((candidate) => candidate.spec.style === style);
    assert.ok(preset, `modèle pour ${style}`);
    const image = render(preset.spec);
    assert.ok(image.data.some((value, index) => index % 4 === 3 && value > 0), `${style} n’est pas vide`);
  }
});
