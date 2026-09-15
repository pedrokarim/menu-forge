/**
 * Éditeur de pixels : nouvelle image, outils principaux (crayon, ligne,
 * rectangle plein, sélection et Suppr, pot de peinture, gomme, pipette),
 * calques, annuler / rétablir, export PNG relu octet pour octet.
 */
import { closeOtherTabs, inspectorField, modal, open, readJson, readPng, waitStatus, workspacePath } from '../lib/studio.mjs';

export const title = 'Éditeur de pixels';

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const YELLOW = [255, 255, 0, 255];
const WHITE = [255, 255, 255, 255];

/** Toile « Ajuster » : image centrée dans la zone, au zoom affiché par la barre d’outils. */
async function pixelCanvas(page, width, height) {
  const box = await page.locator('canvas.pixel-canvas').first().boundingBox();
  const zoom = Number(await page.locator('select.pixel-zoom').first().inputValue());
  const ox = Math.round((Math.floor(box.width) - width * zoom) / 2);
  const oy = Math.round((Math.floor(box.height) - height * zoom) / 2);
  return { zoom, at: (x, y) => ({ x: box.x + ox + (x + 0.5) * zoom, y: box.y + oy + (y + 0.5) * zoom }) };
}

/** Couleur principale saisie en hexadécimal, puis le focus rendu à la page (raccourcis). */
async function setColor(page, hex) {
  const field = page.getByLabel('Code hexadécimal (#rrggbb ou #rrggbbaa)');
  await field.fill(hex);
  await field.evaluate((node) => node.blur());
}

const layerNames = (page) => page.locator('.pixel-layer-list .outline-name').allTextContents();

export const tests = [
  {
    name: 'nouvelle image, outils, calques, export relu octet pour octet',
    async run(t) {
      const { page } = t;
      await open(t, '#/editeur/pixels/shop_tab_icon');
      t.equal(await layerNames(page), ['Reflets', 'Pièce', 'Fond'], 'calques de l’image de démonstration');
      await page.getByRole('button', { name: 'Nouvelle image', exact: true }).click();
      const dialog = modal(page, 'Nouvelle image');
      await inspectorField(page, 'Nom', '.modal').fill('E2E pixels');
      t.equal(await inspectorField(page, 'Identifiant', '.modal').inputValue(), 'e2e_pixels', 'identifiant déduit du nom');
      await inspectorField(page, 'Largeur', '.modal').fill('8');
      await inspectorField(page, 'Hauteur', '.modal').fill('8');
      await dialog.getByRole('button', { name: 'Créer', exact: true }).click();
      await waitStatus(t, 'Image « e2e_pixels » créée');
      await closeOtherTabs(page);
      await page.locator('canvas.pixel-canvas[aria-label^="Toile de 8 × 8"]').waitFor();
      await t.wait(300);
      const canvas = await pixelCanvas(page, 8, 8);
      t.check(canvas.zoom >= 8, `zoom « Ajuster » (×${canvas.zoom})`);
      const click = async (x, y) => {
        const point = canvas.at(x, y);
        await page.mouse.click(point.x, point.y);
        await t.wait(60);
      };
      const stroke = async (points) => {
        const [first, ...rest] = points.map(([x, y]) => canvas.at(x, y));
        await page.mouse.move(first.x, first.y);
        await page.mouse.down();
        for (const point of rest) await page.mouse.move(point.x, point.y, { steps: 4 });
        await page.mouse.up();
        await t.wait(60);
      };

      await setColor(page, '#ff0000');
      await page.keyboard.press('b');
      await click(0, 0);
      await setColor(page, '#0000ff');
      await page.keyboard.press('l');
      t.equal(await page.getByRole('button', { name: 'Ligne', exact: true }).getAttribute('aria-pressed'), 'true', 'L : outil Ligne');
      await stroke([[0, 7], [7, 7]]);
      await setColor(page, '#00ff00');
      await page.keyboard.press('u');
      await page.getByRole('group', { name: 'Remplissage' }).getByRole('button', { name: 'Plein', exact: true }).click();
      await stroke([[2, 2], [4, 4]]);
      // Sélection d’un seul pixel, vidée par Suppr.
      await page.keyboard.press('m');
      await stroke([[3, 3], [4, 4], [3, 3]]);
      await t.waitFor(async () => (await page.locator('.pixel-readout').textContent())?.includes('sélection 1 × 1'), 'sélection rectangulaire d’un pixel');
      await page.keyboard.press('Delete');
      await page.keyboard.press('Control+d');
      await setColor(page, '#ffff00');
      await page.keyboard.press('g');
      await click(2, 2);

      await page.locator('.pixel-layers').getByRole('button', { name: 'Nouveau calque', exact: true }).click();
      await t.waitEqual(async () => (await layerNames(page)).length, 2, 'nouveau calque');
      await setColor(page, '#ffffff');
      await page.keyboard.press('b');
      await click(6, 1);
      await page.locator('.pixel-layer-list .outline-item').last().click();
      await page.keyboard.press('e');
      await click(7, 7);
      await page.keyboard.press('Control+z');
      await t.waitFor(() => page.getByRole('button', { name: 'Rétablir', exact: true }).isEnabled(), 'Ctrl+Z : la gomme est annulée');
      await page.keyboard.press('Control+y');
      await t.waitFor(() => page.getByRole('button', { name: 'Rétablir', exact: true }).isDisabled(), 'Ctrl+Y : rétablie');
      await page.keyboard.press('i');
      await click(6, 1);
      await t.waitFor(async () => (await page.getByLabel('Code hexadécimal (#rrggbb ou #rrggbbaa)').inputValue()).startsWith('#ffffff'), 'pipette : couleur prise sur l’image');

      const top = page.locator('.pixel-layer-list .outline-item').first();
      await top.getByRole('button', { name: 'Masquer', exact: true }).click();
      await t.waitFor(async () => (await top.getAttribute('class')).includes('hidden-by-state'), 'calque masqué');
      await top.getByRole('button', { name: 'Afficher', exact: true }).click();

      await page.keyboard.press('Control+s');
      await waitStatus(t, 'Image « e2e_pixels » enregistrée et exportée dans textures/pixels/e2e_pixels.png');
      const expected = new Uint8Array(8 * 8 * 4);
      const set = (x, y, color) => expected.set(color, (y * 8 + x) * 4);
      set(0, 0, RED);
      for (let x = 0; x < 7; x++) set(x, 7, BLUE);
      for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) if (x !== 3 || y !== 3) set(x, y, YELLOW);
      set(6, 1, WHITE);
      const png = readPng(workspacePath(t, 'textures', 'pixels', 'e2e_pixels.png'));
      t.equal([png.width, png.height], [8, 8], 'PNG de 8 × 8 px');
      const differences = [];
      for (let index = 0; index < 64; index++) {
        const got = [...png.data.subarray(index * 4, index * 4 + 4)];
        const want = [...expected.subarray(index * 4, index * 4 + 4)];
        if (got.join() !== want.join()) differences.push(`(${index % 8}, ${Math.floor(index / 8)}) ${got.join('/')} au lieu de ${want.join('/')}`);
      }
      t.equal(differences, [], 'PNG exporté identique octet pour octet');
      const document = readJson(workspacePath(t, 'pixels', 'e2e_pixels.pixel.json'));
      t.equal(document.size, { width: 8, height: 8 }, 'taille du document');
      t.equal(document.layers.length, 2, 'deux calques enregistrés');
      t.equal(document.export.texture, 'pixels/e2e_pixels.png', 'texture d’export');
    },
  },
  {
    name: 'calques : fusion, duplication, retournement annulé',
    async run(t) {
      const { page } = t;
      await open(t, '#/editeur/pixels/shop_tab_icon');
      await page.locator('.pixel-layer-list .outline-item').first().click();
      await page.locator('.pixel-layers').getByRole('button', { name: 'Fusionner vers le bas', exact: true }).click();
      await t.waitEqual(() => layerNames(page), ['Pièce', 'Fond'], 'fusion vers le bas');
      await page.keyboard.press('Control+z');
      await t.waitEqual(() => layerNames(page), ['Reflets', 'Pièce', 'Fond'], 'Ctrl+Z : trois calques');
      await page.keyboard.press('Control+j');
      await t.waitEqual(() => layerNames(page), ['Reflets (copie)', 'Reflets', 'Pièce', 'Fond'], 'Ctrl+J : calque dupliqué');
      await page.keyboard.press('Shift+H');
      await t.waitFor(() => page.getByRole('button', { name: 'Enregistrer', exact: true }).first().isEnabled(), 'Maj+H : image retournée, modifications à enregistrer');
      await page.keyboard.press('Control+z');
      await page.keyboard.press('Control+z');
      await t.waitEqual(() => layerNames(page), ['Reflets', 'Pièce', 'Fond'], 'tout est annulé');
      await t.waitFor(() => page.getByRole('button', { name: 'Enregistré', exact: true }).first().isVisible(), 'rien à enregistrer après annulation');
    },
  },
];
