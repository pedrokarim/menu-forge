// Chaîne de contrainte des textures générées par IA (src/ai/constrain.ts) : réduction au plus
// proche voisin sur la grille, détourage du fond, alpha net, recadrage, palette imposée.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanAlpha,
  constrainTexture,
  extractPalette,
  hasTransparency,
  medianCutPalette,
  parsePalette,
  quantize,
  removeBackground,
  subjectBounds,
} from '../src/ai/constrain.ts';
import type { Bitmap } from '../src/pixel/raster.ts';

type Rgba = [number, number, number, number];

function make(width: number, height: number, paint: (x: number, y: number) => Rgba): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4);
  return { width, height, data };
}

const at = (bitmap: Bitmap, x: number, y: number): Rgba => {
  const offset = (y * bitmap.width + x) * 4;
  return [...bitmap.data.subarray(offset, offset + 4)] as Rgba;
};

/** Petit dessin 4 × 4 (quatre couleurs), tel qu’un modèle le rendrait agrandi ×16. */
const ART: Rgba[][] = [
  [[0, 0, 0, 255], [255, 255, 255, 255], [255, 255, 255, 255], [0, 0, 0, 255]],
  [[255, 255, 255, 255], [198, 198, 198, 255], [198, 198, 198, 255], [255, 255, 255, 255]],
  [[255, 255, 255, 255], [198, 198, 198, 255], [85, 85, 85, 255], [255, 255, 255, 255]],
  [[0, 0, 0, 255], [255, 255, 255, 255], [255, 255, 255, 255], [0, 0, 0, 255]],
];
const ART_PALETTE = parsePalette(['#000000', '#ffffff', '#c6c6c6', '#555555']);

const upscaled = (noise = 0) =>
  make(64, 64, (x, y) => {
    const [r, g, b, a] = ART[Math.floor(y / 16)][Math.floor(x / 16)];
    // Bruit déterministe (±noise), comme les artefacts d’un modèle.
    const n = noise ? (((x * 7 + y * 13) % (2 * noise + 1)) - noise) : 0;
    return [r + n, g + n, b + n, a];
  });

const free = { removeBackground: false, backgroundTolerance: 48, cropToSubject: false, alphaThreshold: 128 };

test('la réduction au plus proche voisin retrouve la grille des pixels', () => {
  const { bitmap } = constrainTexture(upscaled(), { ...free, width: 4, height: 4, palette: { kind: 'free' } });
  assert.equal(bitmap.width, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) assert.deepEqual(at(bitmap, x, y), ART[y][x], `(${x}, ${y})`);
});

test('la palette imposée efface le bruit du modèle', () => {
  const { bitmap, report } = constrainTexture(upscaled(6), { ...free, width: 4, height: 4, palette: { kind: 'fixed', colors: ART_PALETTE } });
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) assert.deepEqual(at(bitmap, x, y), ART[y][x], `(${x}, ${y})`);
  assert.equal(report.colors, 4);
});

test('chaque pixel visible prend une couleur de la palette', () => {
  const gradient = make(32, 32, (x, y) => [x * 8, y * 8, 128, 255]);
  const palette = parsePalette(['#ff0000', '#00ff00', '#202080']);
  const result = quantize(gradient, palette);
  const allowed = new Set(['255,0,0', '0,255,0', '32,32,128']);
  for (let offset = 0; offset < result.data.length; offset += 4) {
    assert.ok(allowed.has(`${result.data[offset]},${result.data[offset + 1]},${result.data[offset + 2]}`));
  }
});

test('le fond relié aux bords est détouré, pas l’intérieur du sujet', () => {
  const MAGENTA: Rgba = [255, 0, 255, 255];
  const GREY: Rgba = [120, 120, 120, 255];
  const image = make(32, 32, (x, y) => {
    const inSquare = x >= 8 && x < 24 && y >= 8 && y < 24;
    const inHole = x >= 14 && x < 18 && y >= 14 && y < 18;
    return inSquare && !inHole ? GREY : inSquare ? MAGENTA : [253, 2, 250, 255];
  });
  const { bitmap, removed } = removeBackground(image, 24);
  assert.equal(at(bitmap, 0, 0)[3], 0);
  assert.equal(at(bitmap, 31, 20)[3], 0);
  assert.deepEqual(at(bitmap, 10, 10), GREY);
  // Le « trou » de même couleur que le fond, mais fermé, reste opaque.
  assert.equal(at(bitmap, 15, 15)[3], 255);
  assert.equal(removed, 32 * 32 - 16 * 16);
});

test('l’alpha est nettoyé : ni halo translucide, ni couleur cachée', () => {
  const image = make(2, 1, (x) => (x === 0 ? [200, 10, 10, 100] : [200, 10, 10, 200]));
  const clean = cleanAlpha(image, 128);
  assert.deepEqual(at(clean, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(at(clean, 1, 0), [200, 10, 10, 255]);
});

test('recadrage sur le sujet, gardé dans ses proportions et centré', () => {
  const image = make(100, 100, (x, y) => (x >= 60 && x < 80 && y >= 10 && y < 30 ? [0, 128, 0, 255] : [0, 0, 0, 0]));
  assert.deepEqual(subjectBounds(image), { x: 60, y: 10, width: 20, height: 20 });
  const options = { ...free, cropToSubject: true, palette: { kind: 'free' as const } };
  const square = constrainTexture(image, { ...options, width: 10, height: 10 }).bitmap;
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) assert.equal(at(square, x, y)[3], 255);
  const tall = constrainTexture(image, { ...options, width: 10, height: 20 }).bitmap;
  assert.equal(at(tall, 5, 4)[3], 0);
  assert.equal(at(tall, 5, 5)[3], 255);
  assert.equal(at(tall, 5, 14)[3], 255);
  assert.equal(at(tall, 5, 15)[3], 0);
});

test('une image déjà transparente n’est pas détourée une seconde fois', () => {
  const image = make(20, 20, (x, y) => (x > 4 && x < 15 && y > 4 && y < 15 ? [255, 255, 255, 255] : [255, 255, 255, 0]));
  assert.ok(hasTransparency(image));
  const { report, bitmap } = constrainTexture(image, { ...free, removeBackground: true, cropToSubject: true, width: 5, height: 5, palette: { kind: 'free' } });
  assert.equal(report.sourceHadAlpha, true);
  assert.equal(report.backgroundRemoved, 0);
  assert.deepEqual(at(bitmap, 2, 2), [255, 255, 255, 255]);
});

test('chaîne complète : fond uni détouré, taille visée, palette automatique réduite', () => {
  const image = make(256, 256, (x, y) => {
    const inside = x >= 64 && x < 192 && y >= 64 && y < 192;
    if (!inside) return [255, 0, 255, 255];
    return [40 + Math.floor(x / 32) * 20, 90, 200 - Math.floor(y / 32) * 20, 255];
  });
  const { bitmap, report } = constrainTexture(image, {
    width: 16,
    height: 16,
    removeBackground: true,
    backgroundTolerance: 48,
    cropToSubject: true,
    alphaThreshold: 128,
    palette: { kind: 'auto', count: 4 },
  });
  assert.equal(bitmap.width * bitmap.height, 256);
  assert.ok(report.colors <= 4, `${report.colors} couleurs`);
  assert.ok(report.backgroundRemoved > 0.7);
  for (let offset = 3; offset < bitmap.data.length; offset += 4) assert.ok(bitmap.data[offset] === 0 || bitmap.data[offset] === 255);
});

test('palettes : extraites par fréquence, coupe médiane déterministe et bornée', () => {
  const image = make(10, 10, (x) => (x < 7 ? [10, 20, 30, 255] : [200, 100, 0, 255]));
  assert.deepEqual(extractPalette(image, 8), [{ r: 10, g: 20, b: 30 }, { r: 200, g: 100, b: 0 }]);
  const noisy = upscaled(6);
  const first = medianCutPalette(noisy, 6);
  assert.ok(first.length <= 6 && first.length >= 4);
  assert.deepEqual(medianCutPalette(noisy, 6), first);
  assert.deepEqual(parsePalette(['#FFFFFF', 'ffffff', 'nope', '#000000']), [{ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }]);
});
