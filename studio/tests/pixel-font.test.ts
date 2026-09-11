// Police pixel de Menu Forge : ses métriques doivent être celles de Minecraft
// (tables de `fontMetrics.ts`, identiques à `CharWidths` de la lib), quel que
// soit le dessin des lettres.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CELL_ROWS, GLYPH_TOP, PIXEL_BLANKS, pixelGlyphs } from '../src/lib/pixelFontGlyphs.ts';
import { charAdvance } from '../src/model/fontMetrics.ts';

const glyphs = pixelGlyphs();
const byChar = new Map(glyphs.map((glyph) => [glyph.char, glyph]));
/** Rangée de la case qui correspond au haut de la ligne. */
const LINE_TOP = -GLYPH_TOP;

function lastInkColumn(rows: string[]): number {
  return Math.max(...rows.map((row) => row.lastIndexOf('#')));
}

test('chaque glyphe est une case complète, sans doublon', () => {
  assert.equal(byChar.size, glyphs.length, 'caractère dessiné deux fois');
  for (const { char, width, rows } of glyphs) {
    assert.equal(rows.length, CELL_ROWS, `« ${char} » : nombre de rangées`);
    for (const row of rows) assert.match(row, new RegExp(`^[#.]{${width}}$`), `« ${char} » : rangée « ${row} »`);
    assert.ok(rows.some((row) => row.includes('#')), `« ${char} » : glyphe vide`);
  }
});

test('le dessin tient dans l’avance du jeu (avance − 1, 1 px d’espacement)', () => {
  for (const { char, width } of glyphs) {
    assert.ok(width <= charAdvance(char) - 1, `« ${char} » : largeur ${width}, avance ${charAdvance(char)}`);
  }
});

test('ASCII imprimable : couvert, sur la ligne de 8 px, avance = dernière colonne encrée + 2', () => {
  for (let code = 0x21; code <= 0x7e; code++) {
    const char = String.fromCharCode(code);
    const glyph = byChar.get(char);
    assert.ok(glyph, `« ${char} » manquant`);
    assert.equal(lastInkColumn(glyph.rows) + 2, charAdvance(char), `« ${char} » : dernière colonne encrée`);
    for (const row of glyph.rows.slice(0, LINE_TOP)) assert.ok(!row.includes('#'), `« ${char} » dépasse au-dessus de la ligne`);
  }
  assert.ok(PIXEL_BLANKS.includes(' '));
  assert.ok(!byChar.has(' '));
});

test('caractères français couverts', () => {
  const french = 'àâäéèêëîïôöùûüÿçœæÀÂÄÉÈÊËÎÏÔÖÙÛÜŸÇŒÆ«»’‘“”…–—€';
  for (const char of french) assert.ok(byChar.has(char), `« ${char} » manquant`);
  // Espaces insécables : sans dessin (pas de glyphe « manquant »), avance du jeu.
  for (const code of [0xa0, 0x202f]) assert.ok(PIXEL_BLANKS.includes(String.fromCharCode(code)));
});

test('accents : au-dessus de l’œil des minuscules, jusqu’à 3 px au-dessus de la ligne pour les capitales', () => {
  const inkRows = (char: string) =>
    byChar.get(char)!.rows.flatMap((row, index) => (row.includes('#') ? [index - LINE_TOP] : []));
  assert.deepEqual(inkRows('é').slice(0, 2), [-1, 0]);
  assert.deepEqual(inkRows('É').slice(0, 2), [-3, -2]);
  assert.equal(Math.max(...inkRows('ç')), 7);
});
