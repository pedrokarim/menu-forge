/**
 * Éditeur d’assets : nouvel asset, boîtes, textes, images, groupes,
 * déplacement au clavier, presse-papiers, masquage, export PNG relu sur le
 * disque.
 */
import { existsSync } from 'node:fs';
import { closeOtherTabs, inspectorField, inspectorNumber, modal, open, readJson, readPng, textOf, waitStatus, workspacePath } from '../lib/studio.mjs';
import { pixelAt } from '../lib/png.mjs';

export const title = 'Éditeur d’assets';

const SCOPE = '.asset-editor .inspector';
const assetStatus = (page) => page.locator('.asset-editor .asset-status');

/** Point de la page au centre d’un pixel de l’asset (marge de 24 px autour de la toile). */
async function assetCanvas(page, width) {
  const box = await page.locator('canvas.asset-canvas').first().boundingBox();
  const zoom = (box.width - 48) / width;
  return { zoom, at: (x, y) => ({ x: box.x + 24 + (x + 0.5) * zoom, y: box.y + 24 + (y + 0.5) * zoom }) };
}

// L’éditeur de l’onglet affiché vient en premier dans la page (les onglets cachés suivent).
const listNames = (page) => page.locator('.asset-editor').first().locator('.outline-list .outline-name').allTextContents();
const listRow = (page, name) =>
  page.locator('.asset-editor .outline-list .outline-item').filter({ has: page.locator('.outline-name', { hasText: new RegExp(`^${name}$`) }) }).first();

export const tests = [
  {
    name: 'asset de démonstration et extraits d’export',
    async run(t) {
      const { page } = t;
      await open(t, '#/editeur/assets/help_banner');
      await t.waitEqual(() => page.getByLabel('Asset ouvert').first().inputValue(), 'help_banner', 'asset ouvert par l’adresse');
      t.equal(await listNames(page), ['text', 'text_box', 'logo', 'logo_box'], 'éléments, du dessus vers le dessous');
      t.check((await textOf(page.locator('.asset-snippet').first())).startsWith('help_banner:'), 'extrait de glyphe prêt à copier');
      t.equal(await textOf(page.locator('.asset-snippet').nth(1)), '<glyph:help_banner>', 'usage dans un texte');
    },
  },
  {
    name: 'boîte, texte, image, groupe, presse-papiers, export PNG',
    async run(t) {
      const { page } = t;
      await open(t, '#/editeur/assets/help_banner');
      await page.getByRole('button', { name: 'Nouvel asset', exact: true }).click();
      const dialog = modal(page, 'Nouvel asset');
      await inspectorField(page, 'Nom', '.modal').fill('E2E asset');
      t.equal(await inspectorField(page, 'Identifiant', '.modal').inputValue(), 'e2e_asset', 'identifiant déduit du nom');
      await inspectorField(page, 'Largeur', '.modal').fill('64');
      await inspectorField(page, 'Hauteur', '.modal').fill('32');
      await dialog.getByRole('button', { name: 'Créer', exact: true }).click();
      await waitStatus(t, 'Asset « e2e_asset » créé');
      await closeOtherTabs(page);
      t.check(existsSync(workspacePath(t, 'assets', 'e2e_asset.asset.json')), 'fichier de l’asset écrit');
      await t.waitFor(async () => (await page.locator('.asset-coords').first().textContent())?.startsWith('64 × 32 px'), 'toile de 64 × 32 px');

      // Chaque outil peut ajouter un réglage à la barre d’outils : la toile est remesurée après.
      await page.keyboard.press('b');
      let canvas = await assetCanvas(page, 64);
      const from = canvas.at(2, 2);
      const to = canvas.at(21, 13);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 6 });
      await page.mouse.up();
      await t.waitEqual(() => listNames(page), ['box'], 'outil Box : boîte tracée');
      t.equal(
        [await inspectorNumber(page, 'x', SCOPE), await inspectorNumber(page, 'y', SCOPE), await inspectorNumber(page, 'Largeur', SCOPE), await inspectorNumber(page, 'Hauteur', SCOPE)],
        [2, 2, 20, 12],
        'boîte de 20 × 12 px en (2, 2)',
      );

      await page.keyboard.press('t');
      canvas = await assetCanvas(page, 64);
      const textPoint = canvas.at(30, 4);
      await page.mouse.click(textPoint.x, textPoint.y);
      await t.waitEqual(() => listNames(page), ['text', 'box'], 'outil Texte : texte posé');
      await inspectorField(page, 'Texte', SCOPE).fill('Salut');
      await t.waitFor(async () => (await textOf(listRow(page, 'text'))).includes('« Salut »'), 'le texte suit la saisie');

      await page.locator('.asset-editor canvas.asset-canvas').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('i');
      const texture = page.locator('.asset-toolbar-texture input');
      await texture.fill('brand/logo.png');
      await texture.evaluate((node) => node.blur());
      canvas = await assetCanvas(page, 64);
      const imagePoint = canvas.at(40, 4);
      await page.mouse.click(imagePoint.x, imagePoint.y);
      await t.waitEqual(() => listNames(page), ['logo', 'text', 'box'], 'outil Image : image posée');
      t.equal([await inspectorNumber(page, 'x', SCOPE), await inspectorNumber(page, 'y', SCOPE)], [40, 4], 'image au point cliqué');

      await listRow(page, 'box').click();
      await listRow(page, 'text').click({ modifiers: ['Control'] });
      await page.keyboard.press('Control+g');
      await waitStatus(t, '2 éléments groupés dans « Groupe 1 »', 'Ctrl+G : groupe créé', assetStatus(page));
      t.equal(await page.locator('.asset-editor .group-row .outline-name').allTextContents(), ['Groupe 1'], 'groupe dans la liste');
      await page.keyboard.press('Control+Shift+g');
      await waitStatus(t, 'Groupe dissous', 'Ctrl+Maj+G : groupe dissous', assetStatus(page));
      t.equal(await page.locator('.asset-editor .group-row').count(), 0, 'plus de groupe');

      await listRow(page, 'box').click();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Shift+ArrowDown');
      await t.waitEqual(async () => [await inspectorNumber(page, 'x', SCOPE), await inspectorNumber(page, 'y', SCOPE)], [3, 12], 'flèches : 1 px, Maj : 10 px');

      await listRow(page, 'text').click();
      await page.keyboard.press('Control+c');
      await page.keyboard.press('Control+v');
      await t.waitFor(async () => (await listNames(page)).includes('text_2'), 'Ctrl+C puis Ctrl+V : copie « text_2 »');
      await page.keyboard.press('Delete');
      await t.waitFor(async () => !(await listNames(page)).includes('text_2'), 'Suppr : copie supprimée');
      await page.keyboard.press('Control+z');
      await t.waitFor(async () => (await listNames(page)).includes('text_2'), 'Ctrl+Z : copie rétablie');
      await page.keyboard.press('Control+y');
      await t.waitFor(async () => !(await listNames(page)).includes('text_2'), 'Ctrl+Y : supprimée à nouveau');

      await page.keyboard.press('Control+s');
      await waitStatus(t, '« e2e_asset » enregistré, PNG exporté (64 × 32)', 'Ctrl+S : asset enregistré et exporté', assetStatus(page));
      const file = workspacePath(t, 'textures', 'assets', 'e2e_asset.png');
      let png = readPng(file);
      t.equal([png.width, png.height], [64, 32], 'PNG exporté à l’échelle 1');
      t.equal(pixelAt(png, 12, 18)[3], 255, 'l’intérieur de la boîte est opaque');
      t.equal(pixelAt(png, 0, 31), [0, 0, 0, 0], 'le fond reste transparent');
      const logoPixels = () => {
        let opaque = 0;
        for (let y = 13; y < 28; y++) for (let x = 40; x < 64; x++) if (pixelAt(png, x, y)[3] > 0) opaque++;
        return opaque;
      };
      t.check(logoPixels() > 0, 'l’image est dans le PNG');
      const saved = readJson(workspacePath(t, 'assets', 'e2e_asset.asset.json'));
      t.equal(saved.elements.map((element) => element.id), ['box', 'text', 'logo'], 'éléments enregistrés');
      t.equal(saved.elements.find((element) => element.id === 'text').text, 'Salut', 'texte enregistré');

      // Un élément masqué n’est pas exporté.
      await listRow(page, 'logo').hover();
      await listRow(page, 'logo').getByRole('button', { name: 'Masquer', exact: true }).click();
      await page.keyboard.press('Control+s');
      await t.waitFor(() => {
        png = readPng(file);
        return logoPixels() === 0;
      }, 'élément masqué absent du PNG exporté');
      t.equal(readJson(workspacePath(t, 'assets', 'e2e_asset.asset.json')).elements.find((element) => element.id === 'logo').hidden, true, 'drapeau `hidden` enregistré');
    },
  },
];
