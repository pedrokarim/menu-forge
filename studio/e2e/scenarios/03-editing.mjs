/**
 * Gestes d’édition : sélection multiple (liste, toile, rectangle, Ctrl+A),
 * copier / couper / coller / dupliquer, aligner / répartir, verrou et
 * masquage, renommer / dupliquer / corbeille (accueil et éditeur),
 * glisser-déposer d’un PNG depuis l’explorateur.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
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
  rightClick,
  textOf,
  waitForFile,
  waitStatus,
  workspacePath,
} from '../lib/studio.mjs';
import { encodePng, paintImage } from '../lib/png.mjs';
import { createBlankMenu } from './02-menu-editor.mjs';

export const title = 'Gestes d’édition';

const selectedCount = async (page) => {
  const match = /(\d+) éléments sélectionnés/.exec(await textOf(page.locator('.statusbar-meta').first()));
  return match ? Number(match[1]) : 1;
};

/** Clic sur la toile, touche de modification maintenue (`mouse.click` n’en accepte pas). */
async function clickWith(page, point, key) {
  await page.keyboard.down(key);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up(key);
}

/** Sélectionne des lignes de la liste (Ctrl + clic après la première). */
async function selectRows(page, section, names) {
  for (const [index, name] of names.entries()) {
    await outlineRow(page, section, name).click(index === 0 ? {} : { modifiers: ['Control'] });
  }
}

/**
 * Dépose des fichiers sur un élément comme depuis l’explorateur : `dragover`
 * (repère de dépôt), puis `drop` si `drop` est vrai.
 */
async function dropFiles(page, selector, files, point, drop = true) {
  await page.evaluate(
    ({ selector, files, point, drop }) => {
      const transfer = new DataTransfer();
      for (const file of files) transfer.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
      const target = document.querySelector(selector);
      const init = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: point.x, clientY: point.y };
      target.dispatchEvent(new DragEvent('dragenter', init));
      target.dispatchEvent(new DragEvent('dragover', init));
      if (drop) target.dispatchEvent(new DragEvent('drop', init));
    },
    { selector, files: files.map((file) => ({ ...file, bytes: [...file.bytes] })), point, drop },
  );
}

/** Fichiers d’un dossier, récursivement (chemins relatifs). */
function listFiles(dir) {
  return existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String) : [];
}

/** Bouton « … » d’une carte de l’accueil. */
function cardActions(page, name) {
  return page.getByRole('button', { name: new RegExp(`^Actions de «\\s*${name.replace(/[()]/g, '\\$&')}\\s*»$`) });
}

/** Réécrit un document tel quel : il remonte en tête des documents récents. */
async function touchMenu(t, id) {
  await api(t, `/menus/${id}`, { method: 'PUT', body: readJson(workspacePath(t, 'menus', `${id}.menu.json`)) });
}

export const tests = [
  {
    name: 'sélection multiple : liste, plage, toile, rectangle, Ctrl+A',
    async run(t) {
      const { page } = t;
      await open(t, '#/editeur/menus/shop');
      await selectRows(page, 0, ['tab_blocks', 'tab_tools', 'tab_food', 'tab_misc']);
      await t.waitEqual(() => inspectorPill(page), 'sélection · 4 éléments', 'Ctrl + clic dans la liste : quatre couches');
      t.equal(await selectedCount(page), 4, 'barre d’état : 4 éléments sélectionnés');
      t.check(await page.locator('.inspector .align-bar').isVisible(), 'barre « Aligner et répartir » de la sélection');
      await outlineRow(page, 0, 'tab_misc').click();
      await outlineRow(page, 0, 'tab_blocks').click({ modifiers: ['Shift'] });
      await t.waitEqual(() => selectedCount(page), 4, 'Maj + clic : plage de la liste');
      const canvas = await menuCanvas(page);
      const close = canvas.cell(8, 0);
      await clickWith(page, close, 'Shift');
      await t.waitEqual(() => selectedCount(page), 5, 'Maj + clic sur la toile : ajoute la zone visée');
      await clickWith(page, close, 'Control');
      await t.waitEqual(() => selectedCount(page), 4, 'Ctrl + clic sur la toile : la retire');

      await page.keyboard.press('Escape');
      await page.getByRole('checkbox', { name: 'Zones', exact: true }).uncheck();
      await drag(page, canvas.at(-24, -24), canvas.at(30, 30));
      await t.waitFor(async () => (await selectedCount(page)) >= 3, 'rectangle tracé sur une zone vide : ce qu’il touche');
      t.check((await inspectorPill(page)).startsWith('sélection ·'), 'inspecteur de la sélection');
      await page.keyboard.press('Control+a');
      // Zones masquées : 11 couches visibles dans l’état d’aperçu et 7 textes.
      await t.waitEqual(() => selectedCount(page), 18, 'Ctrl+A : tout ce qui est visible et déverrouillé');
    },
  },
  {
    name: 'aligner et répartir',
    async run(t) {
      const { page } = t;
      await open(t, '#/editeur/menus/shop');
      await selectRows(page, 0, ['close', 'balance', 'buy']);
      await page.locator('.inspector .align-bar').getByRole('button', { name: 'Aligner en haut', exact: true }).click();
      await outlineRow(page, 0, 'buy').click();
      await t.waitEqual(() => inspectorNumber(page, 'y'), 17, '« Aligner en haut » (sélection) : y = 17');
      await page.keyboard.press('Control+z');
      await t.waitEqual(() => inspectorNumber(page, 'y'), 89, 'Ctrl+Z : position d’origine');

      await selectRows(page, 0, ['tab_blocks', 'tab_tools', 'tab_misc']);
      await page.locator('.inspector .align-bar').getByRole('button', { name: 'Répartir horizontalement', exact: true }).click();
      await outlineRow(page, 0, 'tab_tools').click();
      await t.waitEqual(() => inspectorNumber(page, 'x'), 34, '« Répartir horizontalement » : écarts égaux');

      await outlineRow(page, 0, 'close').click();
      await page.locator('.inspector .align-bar').getByRole('button', { name: 'Aligner à gauche', exact: true }).click();
      await t.waitEqual(() => inspectorNumber(page, 'x'), 0, 'un élément seul s’aligne sur la toile');
      await outlineRow(page, 0, 'buy').click();
      await page.locator('.inspector .align-bar').getByRole('button', { name: 'Centrer horizontalement', exact: true }).click();
      await waitStatus(t, 'Déjà aligné');
      // Menu contextuel d’une sélection multiple : les mêmes commandes.
      await selectRows(page, 0, ['close', 'balance']);
      await rightClick(outlineRow(page, 0, 'balance'));
      t.equal(await page.locator('.context-menu').getAttribute('aria-label'), '2 éléments sélectionnés', 'menu contextuel de la sélection');
      await contextItem(page, 'Aligner en bas').click();
      await outlineRow(page, 0, 'balance').click();
      t.equal(await inspectorNumber(page, 'y'), 17, '« Aligner en bas » : même bas pour deux éléments de même hauteur');
    },
  },
  {
    name: 'copier, coller, dupliquer, couper, supprimer',
    async run(t) {
      const { page } = t;
      await open(t, '#/editeur/menus/shop');
      await outlineRow(page, 0, 'close').click();
      await page.keyboard.press('Control+c');
      await waitStatus(t, '1 élément copié');
      const clipboard = await page.evaluate(() => navigator.clipboard.readText());
      t.check(JSON.parse(clipboard).marker === 'menu-forge/clipboard', 'presse-papiers du système : JSON marqué du studio');
      await page.keyboard.press('Control+v');
      await waitStatus(t, 'collé(s)');
      await t.waitFor(async () => (await outlineNames(page, 0)).includes('close_2'), 'Ctrl+V : copie « close_2 »');
      t.equal(await inspectorField(page, 'Identifiant').inputValue(), 'close_2', 'la copie est sélectionnée');
      await page.keyboard.press('Control+d');
      await t.waitFor(async () => (await outlineNames(page, 0)).includes('close_2_2'), 'Ctrl+D : copie « close_2_2 »');
      await page.keyboard.press('Control+x');
      await t.waitFor(async () => !(await outlineNames(page, 0)).includes('close_2_2'), 'Ctrl+X : la copie est retirée');
      await page.keyboard.press('Control+v');
      await t.waitFor(async () => (await outlineNames(page, 0)).includes('close_2_2'), 'Ctrl+V après Ctrl+X : elle revient');
      await page.keyboard.press('Delete');
      await t.waitFor(async () => !(await outlineNames(page, 0)).includes('close_2_2'), 'Suppr : supprimée');
      // Texte et zone de slots, par le menu contextuel de la liste.
      await rightClick(outlineRow(page, 1, 'title'));
      await contextItem(page, 'Dupliquer').click();
      await t.waitFor(async () => (await outlineNames(page, 1)).includes('title_2'), 'texte dupliqué par le menu contextuel');
      await rightClick(outlineRow(page, 2, 'close'));
      await contextItem(page, 'Dupliquer').click();
      await t.waitFor(async () => (await outlineNames(page, 2)).includes('close_2'), 'zone de slots dupliquée');
    },
  },
  {
    name: 'verrouiller et masquer',
    async run(t) {
      const { page } = t;
      await open(t, '#/editeur/menus/shop');
      await page.getByRole('checkbox', { name: 'Zones', exact: true }).uncheck();
      const canvas = await menuCanvas(page);
      const close = canvas.at(153, 19);
      const row = outlineRow(page, 0, 'close');
      // Les boutons d’une ligne n’apparaissent qu’au survol (ou sur la ligne sélectionnée).
      await row.hover();
      await row.getByRole('button', { name: 'Verrouiller', exact: true }).click();
      await t.waitFor(async () => (await row.locator('.outline-flags').count()) === 1, 'cadenas affiché dans la liste');
      await page.mouse.click(close.x, close.y);
      await t.waitFor(async () => (await inspectorField(page, 'Identifiant').inputValue()) === 'background', 'une couche verrouillée ne se sélectionne plus sur la toile');
      await page.keyboard.press('Control+a');
      await t.waitEqual(() => selectedCount(page), 17, 'Ctrl+A ignore la couche verrouillée');
      await row.hover();
      await row.getByRole('button', { name: 'Déverrouiller', exact: true }).click();
      // Sans sélection (Ctrl+A l’a remplie) : le clic prend l’élément du dessus.
      await page.keyboard.press('Escape');
      await page.mouse.click(close.x, close.y);
      await t.waitFor(async () => (await inspectorField(page, 'Identifiant').inputValue()) === 'close', 'déverrouillée, elle se sélectionne à nouveau');

      await rightClick(row);
      await contextItem(page, 'Masquer sur la toile').click();
      await t.waitFor(async () => (await row.getAttribute('class')).includes('hidden-by-state'), 'masquée : estompée dans la liste');
      await page.keyboard.press('Escape');
      await page.mouse.click(close.x, close.y);
      await t.waitFor(async () => (await inspectorField(page, 'Identifiant').inputValue()) !== 'close', 'une couche masquée ne se sélectionne plus');
      await row.click();
      await page.getByRole('checkbox', { name: 'Masqué sur la toile', exact: true }).uncheck();
      await t.waitFor(async () => !(await row.getAttribute('class')).includes('hidden-by-state'), 'case « Masqué sur la toile » de l’inspecteur');
      await page.getByRole('checkbox', { name: 'Verrouillé', exact: true }).check();
      await t.waitFor(async () => (await row.locator('.outline-flags').count()) === 1, 'case « Verrouillé » de l’inspecteur');
    },
  },
  {
    name: 'renommer, dupliquer, corbeille depuis l’accueil',
    async run(t) {
      const { page } = t;
      await touchMenu(t, 'confirmation');
      await open(t, '#/accueil');
      await cardActions(page, 'Confirmation d’achat').click();
      await contextItem(page, 'Dupliquer').click();
      await waitForFile(t, workspacePath(t, 'menus', 'confirmation_2.menu.json'), 'copie « confirmation_2 » écrite');
      t.equal(readJson(workspacePath(t, 'menus', 'confirmation_2.menu.json')).name, 'Confirmation d’achat (copie)', 'nom de la copie');
      await cardActions(page, 'Confirmation d’achat (copie)').click();
      await contextItem(page, 'Renommer…').click();
      const dialog = modal(page, /^Renommer le menu/);
      await dialog.waitFor();
      await inspectorField(page, 'Identifiant', '.modal').fill('confirmation_e2e');
      await inspectorField(page, 'Nom', '.modal').fill('Confirmation E2E');
      await dialog.getByRole('button', { name: 'Renommer', exact: true }).click();
      await waitForFile(t, workspacePath(t, 'menus', 'confirmation_e2e.menu.json'), 'menu renommé écrit');
      await t.waitFor(() => !existsSync(workspacePath(t, 'menus', 'confirmation_2.menu.json')), 'l’ancien fichier n’existe plus');
      t.equal(readJson(workspacePath(t, 'menus', 'confirmation_e2e.menu.json')).id, 'confirmation_e2e', 'champ `id` réécrit');
      await cardActions(page, 'Confirmation E2E').click();
      await contextItem(page, 'Mettre à la corbeille').click();
      await t.waitFor(() => !existsSync(workspacePath(t, 'menus', 'confirmation_e2e.menu.json')), 'le menu quitte menus/');
      t.check(t.dialogs.some((dialog) => dialog.type === 'confirm' && dialog.message.includes('corbeille')), 'confirmation demandée');
      t.check(listFiles(workspacePath(t, '.trash')).some((file) => path.basename(file) === 'confirmation_e2e.menu.json'), 'le menu est dans .trash/');
      t.check(existsSync(workspacePath(t, 'menus', 'confirmation.menu.json')), 'l’original est intact');

      await api(t, '/assets/key_hint', { method: 'PUT', body: readJson(workspacePath(t, 'assets', 'key_hint.asset.json')) });
      await open(t, '#/accueil');
      await cardActions(page, 'Bulle de touche').click();
      await contextItem(page, 'Dupliquer').click();
      await waitForFile(t, workspacePath(t, 'assets', 'key_hint_2.asset.json'), 'asset dupliqué depuis l’accueil');
    },
  },
  {
    name: 'renommer, dupliquer, corbeille depuis l’éditeur',
    async run(t) {
      const { page } = t;
      await createBlankMenu(t, 'e2e_doc');
      await open(t, '#/editeur/menus/e2e_doc');
      await page.getByRole('button', { name: 'Actions du menu', exact: true }).click();
      await contextItem(page, 'Dupliquer').click();
      await waitStatus(t, '« e2e_doc_2 » créé, copie de « e2e_doc »');
      await t.waitEqual(() => page.getByLabel('Menu ouvert').first().inputValue(), 'e2e_doc_2', 'la copie est ouverte');
      await page.getByRole('button', { name: 'Actions du menu', exact: true }).click();
      await contextItem(page, 'Renommer…').click();
      const dialog = modal(page, /^Renommer le menu/);
      await inspectorField(page, 'Identifiant', '.modal').fill('e2e_doc_renamed');
      await dialog.getByRole('button', { name: 'Renommer', exact: true }).click();
      await waitStatus(t, '« e2e_doc_2 » renommé en « e2e_doc_renamed »');
      t.check(existsSync(workspacePath(t, 'menus', 'e2e_doc_renamed.menu.json')), 'fichier renommé');
      await page.getByRole('button', { name: 'Actions du menu', exact: true }).click();
      await contextItem(page, 'Mettre à la corbeille').click();
      // L’onglet du menu se ferme : la confirmation est une notification.
      await waitStatus(t, '« e2e_doc_renamed » mis à la corbeille', 'notification de mise à la corbeille', page.locator('.toast-title').first());
      t.check(!existsSync(workspacePath(t, 'menus', 'e2e_doc_renamed.menu.json')), 'le menu quitte menus/');
      t.check((await page.getByLabel('Menu ouvert').first().inputValue()) !== 'e2e_doc_renamed', 'un autre menu est ouvert');

      await page.getByRole('tab', { name: 'Pixels', exact: true }).click();
      await page.locator('canvas.pixel-canvas').first().waitFor();
      await page.getByRole('button', { name: 'Actions de l’image', exact: true }).click();
      await contextItem(page, 'Dupliquer').click();
      await waitStatus(t, '« shop_tab_icon_2 » créé, copie de « shop_tab_icon »');
      t.check(existsSync(workspacePath(t, 'pixels', 'shop_tab_icon_2.pixel.json')), 'image dupliquée');
      await page.getByRole('button', { name: 'Actions de l’image', exact: true }).click();
      await contextItem(page, 'Mettre à la corbeille').click();
      await t.waitFor(() => !existsSync(workspacePath(t, 'pixels', 'shop_tab_icon_2.pixel.json')), 'image mise à la corbeille');
    },
  },
  {
    name: 'glisser-déposer d’un PNG sur la toile',
    async run(t) {
      const { page } = t;
      await createBlankMenu(t, 'e2e_drop');
      await open(t, '#/editeur/menus/e2e_drop');
      const canvas = await menuCanvas(page);
      const icon = encodePng(paintImage(16, 16, [[0, 0, 16, 16, [30, 30, 36, 255]], [3, 3, 10, 10, [242, 201, 76, 255]]]));
      const point = canvas.at(88, 40);
      await dropFiles(page, '.stage', [{ name: 'drop_icon.png', type: 'image/png', bytes: icon }], point, false);
      await t.waitFor(() => page.locator('.drop-hint').isVisible(), 'repère de dépôt au survol');
      await dropFiles(page, '.stage', [{ name: 'drop_icon.png', type: 'image/png', bytes: icon }], point);
      await waitStatus(t, 'couche « drop_icon »');
      t.check(readFileSync(workspacePath(t, 'textures', 'imported', 'drop_icon.png')).equals(icon), 'PNG déposé écrit tel quel dans textures/imported/');
      t.equal(
        [await inspectorField(page, 'Identifiant').inputValue(), await inspectorNumber(page, 'x'), await inspectorNumber(page, 'y')],
        ['drop_icon', 80, 32],
        'couche centrée sur le point de dépôt',
      );
      await dropFiles(page, '.stage', [{ name: 'notes.txt', type: 'text/plain', bytes: Buffer.from('bonjour') }], point);
      await waitStatus(t, 'Seuls les fichiers PNG peuvent être déposés sur la toile.');
      t.check(!(await page.locator('.drop-hint').isVisible()), 'le repère disparaît après le dépôt');
    },
  },
];
