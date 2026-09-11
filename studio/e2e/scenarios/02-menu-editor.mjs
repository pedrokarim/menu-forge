/**
 * Éditeur de menus : création depuis un gabarit, zones de slots (tracer,
 * glisser, redimensionner, Échap, annuler / rétablir), aimantation et Alt,
 * zoom et défilement, clic répété, menus contextuels, rognage d’atlas.
 */
import { existsSync, readFileSync } from 'node:fs';
import {
  api,
  contextItem,
  drag,
  inspectorField,
  inspectorNumber,
  inspectorPill,
  menuCanvas,
  modal,
  open,
  outlineNames,
  outlineRow,
  readJson,
  readPng,
  rightClick,
  setMenuZoom,
  textOf,
  waitForFile,
  waitStatus,
  workspacePath,
} from '../lib/studio.mjs';
import { cropImage, encodePng, paintImage } from '../lib/png.mjs';

export const title = 'Éditeur de menus';

/** Menu vierge écrit par l’API (indépendant des autres tests). */
export async function createBlankMenu(t, id, rows = 3) {
  await api(t, `/menus/${id}`, {
    method: 'PUT',
    body: { formatVersion: 1, id, name: id, container: { type: 'chest', rows }, layers: [], texts: [], slots: [] },
  });
}

/** Atlas de démonstration 32 × 16 : un sprite rouge à gauche, un bleu à droite. */
export const ATLAS = paintImage(32, 16, [
  [2, 2, 12, 12, [220, 40, 40, 255]],
  [19, 4, 10, 8, [40, 90, 220, 255]],
]);

const zoomValue = (page) => page.getByLabel('Niveau de zoom').first().inputValue();

export const tests = [
  {
    name: 'nouveau menu depuis un gabarit, et vierge',
    async run(t) {
      const { page } = t;
      await open(t, '#/editeur/menus/shop');
      await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
      const dialog = modal(page, 'Nouveau menu');
      await dialog.getByRole('radio', { name: /^Liste paginée/ }).click();
      t.equal(await dialog.getByRole('radio', { name: /^Liste paginée/ }).getAttribute('aria-checked'), 'true', 'gabarit choisi');
      await inspectorField(page, 'Nom', '.modal').fill('E2E liste');
      t.equal(await inspectorField(page, 'Identifiant', '.modal').inputValue(), 'e2e_liste', 'identifiant déduit du nom');
      await dialog.getByRole('button', { name: 'Créer', exact: true }).click();
      await waitStatus(t, 'Menu « e2e_liste » créé');
      const template = readJson(`${t.env.templatesDir}/paginated_list.menu.json`);
      const file = workspacePath(t, 'menus', 'e2e_liste.menu.json');
      await waitForFile(t, file);
      const created = readJson(file);
      t.equal(created.id, 'e2e_liste', 'identifiant du menu écrit');
      t.equal(created.layers.map((layer) => layer.id), template.layers.map((layer) => layer.id), 'couches du gabarit reprises');
      t.equal((created.slots ?? []).map((slot) => slot.id), (template.slots ?? []).map((slot) => slot.id), 'zones de slots du gabarit reprises');
      for (const layer of created.layers.filter((candidate) => candidate.generator)) {
        t.check(layer.texture.startsWith('generated/e2e_liste/'), `texture générée rattachée au menu (${layer.id})`);
        t.check(existsSync(workspacePath(t, 'textures', ...layer.texture.split('/'))), `texture générée cuite sur le disque (${layer.texture})`);
      }
      t.equal(await page.getByLabel('Menu ouvert').inputValue(), 'e2e_liste', 'le menu créé est ouvert');

      await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
      await dialog.getByRole('radio', { name: /^Vierge/ }).click();
      await inspectorField(page, 'Nom', '.modal').fill('E2E vierge');
      await inspectorField(page, 'Lignes du coffre', '.modal').fill('3');
      await dialog.getByRole('button', { name: 'Créer', exact: true }).click();
      await waitStatus(t, 'Menu « e2e_vierge » créé');
      const blank = readJson(workspacePath(t, 'menus', 'e2e_vierge.menu.json'));
      t.equal(blank.container, { type: 'chest', rows: 3 }, 'coffre de trois lignes');
      t.equal(blank.layers, [], 'aucune couche');
      t.check(((await page.locator('.statusbar-meta').textContent()) ?? '').includes('176 × 168 px'), 'barre d’état : 176 × 168 px');
    },
  },
  {
    name: 'zones de slots : tracer, glisser, redimensionner, Échap, annuler',
    async run(t) {
      const { page } = t;
      await createBlankMenu(t, 'e2e_slots');
      await open(t, '#/editeur/menus/e2e_slots');
      let canvas = await menuCanvas(page);
      await page.keyboard.press('s');
      await drag(page, canvas.cell(1, 0), canvas.cell(3, 1));
      await t.waitEqual(() => inspectorPill(page), 'slot · bouton', 'zone tracée et sélectionnée');
      const area = async () => [
        await inspectorNumber(page, 'Colonne'),
        await inspectorNumber(page, 'Ligne'),
        await inspectorNumber(page, 'Largeur'),
        await inspectorNumber(page, 'Hauteur'),
      ];
      t.equal(await area(), [1, 0, 3, 2], 'zone de 3 × 2 cases en (1, 0)');
      t.equal(await outlineNames(page, 2), ['slot'], 'zone listée');

      await page.keyboard.press('v');
      canvas = await menuCanvas(page);
      await drag(page, canvas.cell(2, 0), canvas.cell(4, 1));
      await t.waitEqual(area, [3, 1, 3, 2], 'glisser : la zone avance de deux colonnes et d’une ligne');

      // Poignée sud-est : 3 px écran au-delà du coin de la zone.
      const corner = canvas.at(7 + 18 * 6, 17 + 18 * 3);
      await drag(page, { x: Math.round(corner.x) + 3, y: Math.round(corner.y) + 3 }, canvas.cell(7, 2));
      await t.waitEqual(area, [3, 1, 5, 2], 'redimensionner par la poignée sud-est');

      // Échap pendant un glisser : rien ne bouge, la sélection reste.
      await drag(page, canvas.cell(4, 1), canvas.cell(5, 2), { beforeUp: () => page.keyboard.press('Escape') });
      t.equal(await area(), [3, 1, 5, 2], 'Échap annule le glisser en cours');
      t.equal(await inspectorPill(page), 'slot · bouton', 'Échap pendant un glisser garde la sélection');

      await page.keyboard.press('Control+z');
      await t.waitEqual(area, [3, 1, 3, 2], 'Ctrl+Z annule le redimensionnement');
      await page.keyboard.press('Control+z');
      await t.waitEqual(area, [1, 0, 3, 2], 'Ctrl+Z annule le déplacement');
      await page.keyboard.press('Control+y');
      await t.waitEqual(area, [3, 1, 3, 2], 'Ctrl+Y rétablit le déplacement');
      await page.getByRole('button', { name: 'Rétablir', exact: true }).first().click();
      await t.waitEqual(area, [3, 1, 5, 2], 'bouton « Rétablir »');
      t.check(await page.getByRole('button', { name: 'Rétablir', exact: true }).first().isDisabled(), 'plus rien à rétablir');

      await page.keyboard.press('Control+s');
      await waitStatus(t, '« e2e_slots » enregistré');
      t.equal(readJson(workspacePath(t, 'menus', 'e2e_slots.menu.json')).slots[0].area, { col: 3, row: 1, width: 5, height: 2 }, 'zone enregistrée');
    },
  },
  {
    name: 'aimantation, Alt, zoom à la molette et défilement',
    async run(t) {
      const { page } = t;
      await open(t, '#/editeur/menus/shop');
      await page.getByRole('checkbox', { name: 'Zones', exact: true }).uncheck();
      await outlineRow(page, 0, 'balance').click();
      t.equal(await inspectorNumber(page, 'x'), 97, 'couche « balance » en x = 97');
      let canvas = await menuCanvas(page);
      const start = canvas.at(100, 20);
      // Deux pixels vers la droite : le bord gauche (99) s’accroche au coin de l’item (98).
      await drag(page, start, { x: start.x + 2 * canvas.zoom, y: start.y });
      await t.waitEqual(() => inspectorNumber(page, 'x'), 98, 'aimantation sur le coin de l’item');
      await page.keyboard.press('Control+z');
      await t.waitEqual(() => inspectorNumber(page, 'x'), 97, 'annuler le glisser aimanté');
      await page.keyboard.down('Alt');
      await drag(page, start, { x: start.x + 2 * canvas.zoom, y: start.y });
      await page.keyboard.up('Alt');
      await t.waitEqual(() => inspectorNumber(page, 'x'), 99, 'Alt : glisser sans aimantation');

      const fitted = canvas.zoom;
      await page.mouse.move(canvas.box.x + canvas.box.width / 2, canvas.box.y + canvas.box.height / 2);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -120);
      await page.keyboard.up('Control');
      await t.waitFor(async () => (await zoomValue(page)) !== 'fit' && Number(await zoomValue(page)) > fitted, 'Ctrl+molette : zoom avant');

      canvas = await setMenuZoom(page, 8);
      const stage = page.locator('.stage').first();
      const stageBox = await stage.boundingBox();
      await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
      await page.mouse.wheel(0, 400);
      await t.waitFor(async () => (await stage.evaluate((node) => node.scrollTop)) > 0, 'molette : la toile défile');
      const before = await stage.evaluate((node) => node.scrollLeft);
      await page.mouse.move(stageBox.x + stageBox.width / 2 + 5, stageBox.y + stageBox.height / 2);
      await page.keyboard.down('Space');
      await drag(page, { x: stageBox.x + stageBox.width / 2, y: stageBox.y + stageBox.height / 2 }, { x: stageBox.x + stageBox.width / 2 - 200, y: stageBox.y + stageBox.height / 2 });
      await page.keyboard.up('Space');
      await t.waitFor(async () => (await stage.evaluate((node) => node.scrollLeft)) > before + 100, 'Espace + glisser : la toile défile');
      t.equal(await inspectorNumber(page, 'x'), 99, 'le défilement ne déplace pas la couche');
      await page.keyboard.press('Control+0');
      await t.waitEqual(() => zoomValue(page), 'fit', 'Ctrl+0 : zoom « Ajuster »');
    },
  },
  {
    name: 'clic répété : l’élément du dessous',
    async run(t) {
      const { page } = t;
      await open(t, '#/editeur/menus/shop');
      const canvas = await menuCanvas(page);
      const point = canvas.cell(0, 0);
      const expected = [
        ['slot · bouton', 'tab_blocks'],
        ['couche · générée', 'tab_blocks_active'],
        ['couche · générée', 'tab_blocks'],
        ['couche · générée', 'background'],
        ['slot · bouton', 'tab_blocks'],
      ];
      for (const [index, [pill, id]] of expected.entries()) {
        await page.mouse.click(point.x, point.y);
        await t.waitEqual(
          async () => [await inspectorPill(page), await inspectorField(page, 'Identifiant').inputValue()],
          [pill, id],
          `clic ${index + 1} sur la case (0, 0)`,
        );
      }
    },
  },
  {
    name: 'menus contextuels de la toile et de la liste',
    async run(t) {
      const { page } = t;
      await open(t, '#/editeur/menus/shop');
      await page.getByRole('checkbox', { name: 'Zones', exact: true }).uncheck();
      const canvas = await menuCanvas(page);
      const close = canvas.at(153, 19);
      await page.mouse.click(close.x, close.y, { button: 'right' });
      const menu = page.locator('.context-menu');
      await menu.waitFor();
      t.equal(await menu.getAttribute('aria-label'), 'Couche « close »', 'menu de la couche visée');
      t.check(await contextItem(page, 'Rogner…').isDisabled(), '« Rogner… » indisponible pour une texture générée');
      t.check(await contextItem(page, 'Modifier la texture générée…').isVisible(), '« Modifier la texture générée… » proposé');
      await page.keyboard.press('ArrowDown');
      t.equal(await menu.evaluate((node) => node.contains(document.activeElement)), true, 'les flèches parcourent le menu');
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached' });
      t.equal(await inspectorField(page, 'Identifiant').inputValue(), 'close', 'Échap ferme le menu sans désélectionner');

      const order = await outlineNames(page, 0);
      await page.mouse.click(close.x, close.y, { button: 'right' });
      await contextItem(page, 'Descendre').click();
      await t.waitEqual(async () => (await outlineNames(page, 0)).indexOf('close'), order.indexOf('close') + 1, '« Descendre » : la couche passe sous la suivante');
      await page.keyboard.press('Control+z');
      await t.waitEqual(() => outlineNames(page, 0), order, 'Ctrl+Z rétablit l’ordre des couches');

      const empty = canvas.at(-16, 100);
      await page.mouse.click(empty.x, empty.y, { button: 'right' });
      await menu.waitFor();
      t.equal(await menu.getAttribute('aria-label'), 'Menu « Boutique »', 'menu d’une zone vide de la toile');
      t.check(await contextItem(page, /^Exporter vers le plugin/).isVisible(), 'exports proposés dans le menu de la toile');
      await contextItem(page, 'Ajouter un texte').click();
      await t.waitEqual(() => inspectorPill(page), 'texte', '« Ajouter un texte » : texte créé et sélectionné');
      t.check((await outlineNames(page, 1)).includes('text'), 'texte listé');

      await rightClick(outlineRow(page, 2, 'buy'));
      await menu.waitFor();
      t.equal(await menu.getAttribute('aria-label'), 'Slot « buy »', 'menu d’une ligne de la liste');
      await contextItem(page, 'Supprimer').click();
      await t.waitFor(async () => !(await outlineNames(page, 2)).includes('buy'), '« Supprimer » retire la zone');
      await page.keyboard.press('Control+z');
      await t.waitFor(async () => (await outlineNames(page, 2)).includes('buy'), 'Ctrl+Z la rétablit');
    },
  },
  {
    name: 'rognage d’atlas : grille, sprite, extraction',
    async run(t) {
      const { page } = t;
      await createBlankMenu(t, 'e2e_crop');
      await open(t, '#/editeur/menus/e2e_crop');
      const bytes = encodePng(ATLAS);
      await page.locator('.outline input[type="file"]').setInputFiles({ name: 'atlas.png', mimeType: 'image/png', buffer: bytes });
      await waitStatus(t, 'Texture importée : imported/atlas.png');
      t.check(readFileSync(workspacePath(t, 'textures', 'imported', 'atlas.png')).equals(bytes), 'PNG importé écrit tel quel');
      t.equal(await inspectorField(page, 'Identifiant').inputValue(), 'atlas', 'couche « atlas » créée et sélectionnée');

      await page.locator('.inspector').getByRole('button', { name: 'Rogner…', exact: true }).click();
      let dialog = modal(page, 'Rogner la couche « atlas »');
      await dialog.waitFor();
      await dialog.getByRole('button', { name: 'Grille', exact: true }).click();
      let picker = dialog.locator('.asset-region-scroll canvas');
      let box = await picker.boundingBox();
      let zoom = box.width / 32;
      await page.mouse.click(box.x + 24 * zoom, box.y + 8 * zoom);
      await t.waitEqual(async () => (await dialog.locator('.crop-side .mono').textContent())?.trim(), '16 × 16 px · depuis 16, 0', 'grille de 16 : case de droite');
      await dialog.getByRole('button', { name: 'Rogner la couche', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      await waitStatus(t, 'Couche « atlas » rognée à 16 × 16 px');
      t.equal([await inspectorNumber(page, 'x'), await inspectorNumber(page, 'y')], [16, 0], 'la couche se décale : la partie gardée reste en place');
      const cropped = await inspectorField(page, 'Texture').inputValue();
      t.check(cropped.startsWith('cropped/'), `texture rognée sous textures/cropped/ (${cropped})`);
      const written = readPng(workspacePath(t, 'textures', ...cropped.split('/')));
      t.equal(Buffer.from(written.data).equals(Buffer.from(cropImage(ATLAS, 16, 0, 16, 16).data)), true, 'découpe identique, octet pour octet');

      await rightClick(outlineRow(page, 0, 'atlas'));
      await contextItem(page, 'Rogner…').click();
      dialog = modal(page, 'Rogner la couche « atlas »');
      await dialog.waitFor();
      await dialog.getByRole('button', { name: 'Sprite', exact: true }).click();
      picker = dialog.locator('.asset-region-scroll canvas');
      box = await picker.boundingBox();
      zoom = box.width / 16;
      await page.mouse.click(box.x + 8.5 * zoom, box.y + 8.5 * zoom);
      await t.waitEqual(async () => (await dialog.locator('.crop-side .mono').textContent())?.trim(), '10 × 8 px · depuis 3, 4', 'sprite détecté sur ses pixels opaques');
      await dialog.getByRole('button', { name: 'Extraire en nouvelle couche', exact: true }).click();
      await t.waitFor(async () => (await textOf(dialog.locator('.notice'))).includes('1 zone ajoutée'), '« Ajouter et continuer » : le dialogue reste ouvert');
      await dialog.locator('.modal-footer').getByRole('button', { name: 'Fermer', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      await outlineRow(page, 0, 'atlas_part').click();
      t.equal([await inspectorNumber(page, 'x'), await inspectorNumber(page, 'y')], [19, 4], 'couche extraite à la place du sprite');
      t.equal(await inspectorField(page, 'Texture').inputValue() !== cropped, true, 'la couche extraite a sa propre texture');
    },
  },
];
