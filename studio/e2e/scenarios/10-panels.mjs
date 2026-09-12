/**
 * Colonnes redimensionnables des quatre éditeurs (menus, assets, pixels,
 * formulaires Bedrock) : glisser la poignée change la largeur (la toile ou
 * l’aperçu suit), la largeur survit à un rechargement, double-clic la
 * rétablit ; au clavier, flèches, Maj, Début et Fin. Aux bornes, rien ne bave
 * (audit de mise en page).
 */
import { auditLayout } from '../lib/audit.mjs';
import { api, menuCanvas, nextFrames, open } from '../lib/studio.mjs';

export const title = 'Colonnes redimensionnables';

/** Préférences de largeur écrites par ces tests (et elles seules). */
const clearWidths = (page) =>
  page.evaluate(() => {
    for (const key of Object.keys(window.localStorage)) if (key.startsWith('menu-forge.columns.')) window.localStorage.removeItem(key);
  });

const EDITORS = [
  { name: 'menus', hash: '#/editeur/menus/shop', root: '.workspace', left: 280, right: 330, leftMin: 220, rightMin: 280 },
  { name: 'assets', hash: '#/editeur/assets/help_banner', root: '.asset-editor', left: 280, right: 340, leftMin: 220, rightMin: 280 },
  { name: 'pixels', hash: '#/editeur/pixels/shop_tab_icon', root: '.pixel-editor', left: 264, right: 300, leftMin: 220, rightMin: 240 },
  { name: 'formulaires', hash: '#/editeur/menus/e2e_panels_form', root: '.form-editor', left: 280, right: 330, leftMin: 220, rightMin: 280, form: 'e2e_panels_form' },
];

/** Formulaire Bedrock écrit dans l’espace temporaire, pour l’éditeur de formulaires. */
const putForm = (t, id) =>
  api(t, `/menus/${id}`, {
    method: 'PUT',
    body: {
      formatVersion: 1,
      id,
      name: id,
      container: { type: 'chest', rows: 6 },
      state: {},
      layers: [],
      form: { layout: 'grid', title: 'Colonnes', content: 'Formulaire des tests de colonnes.', buttons: [{ id: 'first', text: 'Premier' }, { id: 'second', text: 'Second' }] },
    },
  });

const sidebarWidth = (page, root, side) =>
  page.evaluate(
    ({ root, side }) => {
      const asides = document.querySelectorAll(`${root} > aside.sidebar`);
      const aside = side === 'left' ? asides[0] : asides[asides.length - 1];
      return Math.round(aside.getBoundingClientRect().width);
    },
    { root, side },
  );

const handleOf = (page, side) => page.getByRole('separator', { name: `Largeur de la colonne de ${side === 'left' ? 'gauche' : 'droite'}`, exact: true });

/** Glisse une poignée de `dx` px (souris, en plusieurs pas). */
async function dragHandle(page, side, dx) {
  const box = await handleOf(page, side).boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 6 });
  await page.mouse.up();
  await nextFrames(page);
}

export const tests = EDITORS.map((editor) => ({
  name: `éditeur de ${editor.name} : glisser, mémoire, rétablir, clavier`,
  async run(t) {
    const { page } = t;
    await page.setViewportSize({ width: 1440, height: 900 });
    if (editor.form) await putForm(t, editor.form);
    await open(t, editor.hash);
    await clearWidths(page);
    await open(t, editor.hash);
    t.equal(await sidebarWidth(page, editor.root, 'left'), editor.left, 'colonne de gauche : largeur par défaut');
    t.equal(await sidebarWidth(page, editor.root, 'right'), editor.right, 'colonne de droite : largeur par défaut');

    // Glisser : la colonne suit la souris ; la valeur accessible aussi.
    await dragHandle(page, 'left', 80);
    await t.waitEqual(() => sidebarWidth(page, editor.root, 'left'), editor.left + 80, 'glisser la poignée de gauche élargit la colonne');
    t.equal(await handleOf(page, 'left').getAttribute('aria-valuenow'), String(editor.left + 80), 'aria-valuenow suit la largeur');
    await dragHandle(page, 'right', -60);
    await t.waitEqual(() => sidebarWidth(page, editor.root, 'right'), editor.right + 60, 'glisser la poignée de droite vers la gauche élargit la colonne');

    // Mémoire : un rechargement garde les deux largeurs.
    await open(t, editor.hash);
    t.equal(await sidebarWidth(page, editor.root, 'left'), editor.left + 80, 'largeur de gauche retrouvée après rechargement');
    t.equal(await sidebarWidth(page, editor.root, 'right'), editor.right + 60, 'largeur de droite retrouvée après rechargement');

    // Double-clic : largeur par défaut, et préférence effacée.
    await handleOf(page, 'left').dblclick();
    await t.waitEqual(() => sidebarWidth(page, editor.root, 'left'), editor.left, 'double-clic : largeur par défaut');
    await open(t, editor.hash);
    t.equal(await sidebarWidth(page, editor.root, 'left'), editor.left, 'largeur par défaut après rechargement');

    // Clavier : flèche (8 px), Maj+flèche (32 px), Début (minimum), Fin (maximum), Entrée (rétablir).
    await handleOf(page, 'left').focus();
    await page.keyboard.press('ArrowRight');
    await t.waitEqual(() => sidebarWidth(page, editor.root, 'left'), editor.left + 8, 'flèche droite : 8 px de plus');
    await page.keyboard.press('Shift+ArrowLeft');
    await t.waitEqual(() => sidebarWidth(page, editor.root, 'left'), editor.left - 24, 'Maj+flèche gauche : 32 px de moins');
    await page.keyboard.press('Home');
    await t.waitEqual(() => sidebarWidth(page, editor.root, 'left'), editor.leftMin, 'Début : largeur minimale');
    await handleOf(page, 'right').focus();
    await page.keyboard.press('Home');
    await t.waitEqual(() => sidebarWidth(page, editor.root, 'right'), editor.rightMin, 'Début : largeur minimale à droite');

    // Aux bornes : rien ne bave (colonnes au minimum, puis au maximum dans une petite fenêtre).
    await page.mouse.move(1, 1);
    t.equal(await auditLayout(page), [], 'mise en page, colonnes au minimum');
    await page.setViewportSize({ width: 1180, height: 700 });
    await handleOf(page, 'left').focus();
    await page.keyboard.press('End');
    await handleOf(page, 'right').focus();
    await page.keyboard.press('End');
    await nextFrames(page);
    const stage = await page.evaluate((root) => {
      const main = document.querySelector(`${root} > section`);
      return Math.round(main.getBoundingClientRect().width);
    }, editor.root);
    t.check(stage >= 360, `colonnes au maximum : la toile garde au moins 360 px (${stage} px)`);
    await page.mouse.move(1, 1);
    await t.wait(150);
    t.equal(await auditLayout(page), [], 'mise en page, colonnes au maximum à 1180 × 700');
    if (editor.name === 'menus') {
      // Zoom « Ajuster » recalculé pour la place qui reste : la toile tient dans sa zone.
      await t.waitFor(async () => {
        const label = await page.getByLabel('Niveau de zoom').first().locator('option[value="fit"]').textContent();
        const fitted = Number(/×(\d+)/.exec(label ?? '')?.[1]);
        return fitted > 0 && (await menuCanvas(page)).zoom === fitted;
      }, 'zoom « Ajuster » recalculé après redimensionnement');
    }
    await handleOf(page, 'left').focus();
    await page.keyboard.press('Enter');
    await handleOf(page, 'right').dblclick();
    await clearWidths(page);
  },
}));
