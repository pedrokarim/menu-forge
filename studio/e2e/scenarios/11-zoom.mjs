/**
 * Raccourcis de zoom, les mêmes dans les trois éditeurs : « + » et « - »,
 * Maj+0 (taille réelle), Maj+1 (ajuster), Maj+2 (cadrer la sélection), outil
 * Zoom (Z : appui bref, il reste ; maintenu, il revient à l’outil précédent ;
 * clic, Alt+clic, rectangle), disposition AZERTY, touche tapée dans un champ.
 */
import { dispatchKey, drag, menuCanvas, modal, nextFrames, open, outlineRow, setMenuZoom, statusText } from '../lib/studio.mjs';

export const title = 'Raccourcis de zoom';

const zoomValue = (page) => page.getByLabel('Niveau de zoom').first().inputValue();
const numericLevels = (page) =>
  page
    .getByLabel('Niveau de zoom')
    .first()
    .locator('option')
    .evaluateAll((options) => options.map((option) => option.value).filter((value) => value !== 'fit').map(Number));
const pressed = (page, name) => page.getByRole('button', { name, exact: true }).first().getAttribute('aria-pressed');

/** Pas de zoom attendu après une touche : palier suivant (1) ou précédent (−1) dans la liste. */
async function expectStep(t, key, direction, message) {
  const { page } = t;
  const levels = await numericLevels(page);
  const before = Number(await zoomValue(page));
  const expected = direction > 0 ? levels.find((level) => level > before) : levels.findLast((level) => level < before);
  await key();
  await t.waitEqual(async () => Number(await zoomValue(page)), expected, message);
}

/** Outil Zoom : Z bref le garde, Z maintenu revient à l’outil précédent. */
async function checkZoomTool(t, previous) {
  const { page } = t;
  await page.keyboard.press('z');
  await t.waitEqual(() => pressed(page, 'Zoom'), 'true', 'Z (appui bref) : outil Zoom');
  await page.getByRole('button', { name: previous, exact: true }).first().click();
  await page.mouse.move(1, 1);
  await page.keyboard.down('z');
  await t.waitEqual(() => pressed(page, 'Zoom'), 'true', 'Z maintenu : outil Zoom le temps de l’appui');
  await t.wait(400);
  await page.keyboard.up('z');
  await t.waitEqual(() => pressed(page, previous), 'true', `Z relâché : retour à l’outil « ${previous} »`);
}

export const tests = [
  {
    name: 'éditeur de menus',
    async run(t) {
      const { page } = t;
      await page.setViewportSize({ width: 1440, height: 900 });
      await open(t, '#/editeur/menus/shop');
      await setMenuZoom(page, 3);
      await expectStep(t, () => page.keyboard.press('+'), 1, '« + » : palier suivant');
      await expectStep(t, () => page.keyboard.press('-'), -1, '« - » : palier précédent');
      // AZERTY : « + » est Maj + la touche « = », « - » la touche du 6.
      await expectStep(t, () => dispatchKey(page, { key: '+', code: 'Equal', shiftKey: true }), 1, 'AZERTY « + »');
      await expectStep(t, () => dispatchKey(page, { key: '-', code: 'Digit6' }), -1, 'AZERTY « - »');
      await page.keyboard.press('Shift+Digit1');
      await t.waitEqual(() => zoomValue(page), 'fit', 'Maj+1 : ajuster');
      await dispatchKey(page, { key: '0', code: 'Digit0', shiftKey: true });
      // Taille réelle : ×1, ou le plus petit palier proposé.
      const smallest = Math.min(...(await numericLevels(page)));
      await t.waitEqual(async () => Number(await zoomValue(page)), smallest, 'AZERTY Maj+0 : taille réelle');
      // Maj+2 : la sélection cadrée, visible dans la zone de travail.
      await page.keyboard.press('Shift+Digit2');
      await t.waitFor(async () => /Rien de sélectionné/.test(await statusText(page)), 'Maj+2 sans sélection : message');
      await outlineRow(page, 0, 'close').click();
      await page.mouse.move(1, 1);
      await page.keyboard.press('Shift+Digit2');
      const levels = await numericLevels(page);
      await t.waitEqual(async () => Number(await zoomValue(page)), Math.max(...levels), 'Maj+2 : couche de 18 px cadrée au plus grand palier');
      await nextFrames(page);
      const inView = await page.evaluate(() => {
        const stage = document.querySelector('.stage').getBoundingClientRect();
        const canvas = document.querySelector('canvas.menu-canvas').getBoundingClientRect();
        return canvas.right > stage.left && canvas.left < stage.right && canvas.bottom > stage.top && canvas.top < stage.bottom;
      });
      t.check(inView, 'Maj+2 : la toile reste visible');
      // Une touche tapée dans un champ reste dans le champ.
      await page.keyboard.press('Escape');
      await setMenuZoom(page, 3);
      const name = page.locator('.inspector .field').filter({ has: page.locator('.field-label', { hasText: /^Nom$/ }) }).locator('input, textarea').first();
      await name.click();
      await page.keyboard.press('+');
      await t.wait(200);
      t.equal(await zoomValue(page), '3', '« + » dans un champ ne zoome pas');
      await name.press('Escape');
      await page.keyboard.press('Control+z').catch(() => undefined);
      // Outil Zoom : touche, clic (avant), Alt+clic (arrière), rectangle.
      await page.locator('canvas.menu-canvas').first().click({ position: { x: 4, y: 4 } });
      await checkZoomTool(t, 'Sélection');
      await setMenuZoom(page, 3);
      await page.getByRole('button', { name: 'Zoom', exact: true }).first().click();
      let canvas = await menuCanvas(page);
      await page.mouse.click(canvas.cell(4, 2).x, canvas.cell(4, 2).y);
      await t.waitEqual(async () => Number(await zoomValue(page)), levels.find((level) => level > 3), 'outil Zoom : clic = palier suivant');
      canvas = await menuCanvas(page);
      await page.keyboard.down('Alt');
      await page.mouse.click(canvas.cell(4, 2).x, canvas.cell(4, 2).y);
      await page.keyboard.up('Alt');
      await t.waitEqual(async () => Number(await zoomValue(page)), 3, 'outil Zoom : Alt+clic = palier précédent');
      canvas = await menuCanvas(page);
      await drag(page, canvas.cell(0, 0), canvas.cell(1, 1));
      await t.waitEqual(async () => Number(await zoomValue(page)), Math.max(...levels), 'outil Zoom : rectangle de deux cases cadré');
      await page.keyboard.press('v');
    },
  },
  {
    name: 'éditeur d’assets',
    async run(t) {
      const { page } = t;
      await page.setViewportSize({ width: 1440, height: 900 });
      await open(t, '#/editeur/assets/help_banner');
      await page.getByLabel('Niveau de zoom').first().selectOption('2');
      await expectStep(t, () => page.keyboard.press('+'), 1, '« + » : palier suivant');
      await expectStep(t, () => page.keyboard.press('-'), -1, '« - » : palier précédent');
      await page.keyboard.press('Shift+Digit0');
      await t.waitEqual(() => zoomValue(page), '1', 'Maj+0 : taille réelle (×1)');
      await page.keyboard.press('Shift+Digit1');
      await t.waitEqual(() => zoomValue(page), 'fit', 'Maj+1 : ajuster');
      await page.locator('.asset-editor .outline-list .outline-item').first().click();
      await page.mouse.move(1, 1);
      const fitted = Number((/×(\d+)/.exec((await page.getByLabel('Niveau de zoom').first().locator('option[value="fit"]').textContent()) ?? '') ?? [])[1]);
      await page.keyboard.press('Shift+Digit2');
      await t.waitFor(async () => Number(await zoomValue(page)) > fitted, 'Maj+2 : l’élément sélectionné est cadré plus grand');
      await checkZoomTool(t, 'Sélection');
      // Outil Zoom : clic sur l’asset.
      await page.getByLabel('Niveau de zoom').first().selectOption('2');
      await page.locator('.asset-toolbar').getByRole('button', { name: 'Zoom', exact: true }).click();
      const box = await page.locator('canvas.asset-canvas').first().boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await t.waitEqual(() => zoomValue(page), '3', 'outil Zoom : clic = palier suivant');
      // Ctrl + molette : zoom sur le pointeur, comme les autres toiles.
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -120);
      await page.keyboard.up('Control');
      await t.waitEqual(() => zoomValue(page), '4', 'Ctrl+molette : palier suivant');
    },
  },
  {
    name: 'éditeur de pixels',
    async run(t) {
      const { page } = t;
      await page.setViewportSize({ width: 1440, height: 900 });
      await open(t, '#/editeur/pixels/shop_tab_icon');
      await page.getByLabel('Niveau de zoom').first().selectOption('4');
      await expectStep(t, () => page.keyboard.press('+'), 1, '« + » : palier suivant');
      await expectStep(t, () => page.keyboard.press('-'), -1, '« - » : palier précédent');
      await page.keyboard.press('Shift+Digit0');
      await t.waitEqual(() => zoomValue(page), '1', 'Maj+0 : taille réelle (×1)');
      await page.keyboard.press('Shift+Digit1');
      await t.waitFor(async () => Number(await zoomValue(page)) > 4, 'Maj+1 : image ajustée à la zone');
      const fitted = Number(await zoomValue(page));
      // Maj+2 : sans sélection, un message ; avec une petite sélection, un zoom plus fort.
      await page.keyboard.press('Shift+Digit2');
      await t.waitFor(async () => /Rien de sélectionné/.test(((await page.locator('.pixel-main .asset-status').textContent()) ?? '').replaceAll(String.fromCharCode(160), ' ')), 'Maj+2 sans sélection : message');
      await page.keyboard.press('m');
      const canvas = await page.locator('canvas.pixel-canvas').first().boundingBox();
      const center = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
      await drag(page, { x: center.x - 20, y: center.y - 20 }, { x: center.x + 10, y: center.y + 10 });
      await page.keyboard.press('Shift+Digit2');
      await t.waitFor(async () => Number(await zoomValue(page)) > fitted, 'Maj+2 : la sélection est cadrée plus grand');
      await page.keyboard.press('Control+d');
      await checkZoomTool(t, 'Sélection rectangulaire');
      // Outil Zoom : clic et Alt+clic.
      await page.getByLabel('Niveau de zoom').first().selectOption('4');
      await page.getByRole('button', { name: 'Zoom', exact: true }).first().click();
      await page.mouse.click(center.x, center.y);
      await t.waitEqual(() => zoomValue(page), '5', 'outil Zoom : clic = palier suivant');
      await page.keyboard.down('Alt');
      await page.mouse.click(center.x, center.y);
      await page.keyboard.up('Alt');
      await t.waitEqual(() => zoomValue(page), '4', 'outil Zoom : Alt+clic = palier précédent');
      await page.keyboard.press('b');
      // Aide-mémoire : les raccourcis de zoom y figurent.
      await page.keyboard.press('?');
      const dialog = modal(page, 'Raccourcis clavier');
      await dialog.waitFor();
      t.check(await dialog.getByText('Outil Zoom (maintenu', { exact: false }).isVisible(), 'aide-mémoire : outil Zoom');
      t.check(await dialog.getByText('Zoomer sur la sélection', { exact: true }).isVisible(), 'aide-mémoire : Maj+2');
    },
  },
];
