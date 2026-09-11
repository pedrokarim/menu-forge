import { charAdvance } from '../model/fontMetrics';
import { createFont } from './minecraftFont';
import type { Glyph, MinecraftFont, Sheet } from './minecraftFont';

/**
 * Police pixel de Menu Forge, prête à dessiner : les glyphes de
 * `pixelFontGlyphs.ts` (chargés à la demande) sont peints en blanc sur une
 * planche, puis servis par le même moteur que la police du jeu (teinte,
 * ombre, gras, codes « § »). Les avances sont celles de `fontMetrics.ts`,
 * donc celles du jeu et de la lib.
 */

/** Colonnes de la planche ; une case fait 6 px de large (le plus large dessin). */
const SHEET_COLUMNS = 16;
const CELL_WIDTH = 6;

let pending: Promise<MinecraftFont> | null = null;

async function buildPixelFont(): Promise<MinecraftFont> {
  const { CELL_ROWS, GLYPH_TOP, PIXEL_BLANKS, pixelGlyphs } = await import('./pixelFontGlyphs');
  const glyphs = pixelGlyphs();
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_COLUMNS * CELL_WIDTH;
  canvas.height = Math.ceil(glyphs.length / SHEET_COLUMNS) * CELL_ROWS;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible');
  const image = ctx.createImageData(canvas.width, canvas.height);
  const sheet: Sheet = { source: canvas, width: canvas.width, height: canvas.height, tints: new Map() };
  const table = new Map<number, Glyph>();

  glyphs.forEach((glyph, index) => {
    const sx = (index % SHEET_COLUMNS) * CELL_WIDTH;
    const sy = Math.floor(index / SHEET_COLUMNS) * CELL_ROWS;
    glyph.rows.forEach((row, y) => {
      for (let x = 0; x < glyph.width; x++) {
        if (row[x] === '#') image.data.set([255, 255, 255, 255], ((sy + y) * canvas.width + sx + x) * 4);
      }
    });
    table.set(glyph.char.codePointAt(0) ?? 0, {
      advance: charAdvance(glyph.char),
      sheet,
      sx,
      sy,
      sw: glyph.width,
      sh: CELL_ROWS,
      width: glyph.width,
      height: CELL_ROWS,
      top: GLYPH_TOP,
    });
  });
  ctx.putImageData(image, 0, 0);

  for (const char of PIXEL_BLANKS) {
    table.set(char.codePointAt(0) ?? 0, { advance: charAdvance(char), sheet: null, sx: 0, sy: 0, sw: 0, sh: 0, width: 0, height: 0, top: 0 });
  }
  return createFont(table);
}

/** Charge la police pixel (une seule fois ; un échec n’est pas mis en cache). */
export function loadPixelFont(): Promise<MinecraftFont> {
  if (!pending) {
    pending = buildPixelFont();
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}
