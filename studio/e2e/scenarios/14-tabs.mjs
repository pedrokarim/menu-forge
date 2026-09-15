/**
 * Onglets et sessions : chaque document ouvert a son onglet et garde ses
 * modifications ; fermer un onglet modifié ouvre le dialogue « Enregistrer,
 * Ne pas enregistrer, Annuler » ; la session d’un espace est rouverte au
 * rechargement. Le visualiseur de shaders a ses propres onglets et brouillons.
 */
import { inspectorField, inspectorNumber, modal, open, readJson, workspacePath } from '../lib/studio.mjs';

export const title = 'Onglets et sessions';

const tabs = (page) => page.locator('.shell-editor .editor-tab');
const dirtyTabs = (page) => page.locator('.shell-editor .editor-tab.dirty');
/** Liste « Menu ouvert » de l’onglet affiché (son éditeur vient en premier dans la page). */
const openedMenu = (page) => page.getByLabel('Menu ouvert').first();

/** Sélectionne la première couche du menu affiché et la décale d’un pixel (document modifié). */
async function nudgeFirstLayer(t, key = 'ArrowRight') {
  const { page } = t;
  await page.locator('.outline .panel-section').first().locator('.outline-item').first().click();
  const before = await inspectorNumber(page, key === 'ArrowRight' ? 'x' : 'y');
  await page.keyboard.press(key);
  await t.waitEqual(() => inspectorNumber(page, key === 'ArrowRight' ? 'x' : 'y'), before + 1, `couche décalée (${key})`);
  return { before, id: await inspectorField(page, 'Identifiant').inputValue() };
}

export const tests = [
  {
    name: 'onglets : un par document, modifications gardées, fermeture avec confirmation',
    async run(t) {
      const { page } = t;
      const original = readJson(workspacePath(t, 'menus', 'shop.menu.json'));
      await open(t, '#/editeur/menus/shop');
      await t.waitEqual(() => tabs(page).count(), 1, 'un onglet pour le document ouvert');

      await nudgeFirstLayer(t);
      await t.waitEqual(() => dirtyTabs(page).count(), 1, 'onglet marqué modifié');

      // Choisir un autre menu l’ouvre dans son onglet ; le premier garde ses modifications.
      await openedMenu(page).selectOption('confirmation');
      await t.waitEqual(() => tabs(page).count(), 2, 'second onglet');
      await t.waitEqual(() => openedMenu(page).inputValue(), 'confirmation', 'le menu choisi est affiché');
      await t.waitFor(async () => /\/confirmation$/.test(await page.evaluate(() => window.location.hash)), 'adresse de l’onglet affiché');
      await page.locator('.shell-editor .editor-tab.dirty .editor-tab-button').click();
      await t.waitEqual(() => openedMenu(page).inputValue(), 'shop', 'retour au premier onglet');
      t.equal(await dirtyTabs(page).count(), 1, 'modifications toujours là');

      // Les onglets restent ouverts quand on change d’écran.
      await page.locator('.rail').getByRole('button', { name: 'Accueil', exact: true }).click();
      await page.locator('.rail').getByRole('button', { name: 'Éditeur', exact: true }).click();
      await t.waitEqual(() => tabs(page).count(), 2, 'onglets conservés après un changement d’écran');
      t.equal(await dirtyTabs(page).count(), 1, 'modifications conservées après un changement d’écran');

      // Fermer l’onglet modifié : Annuler garde tout.
      await page.locator('.shell-editor .editor-tab.dirty .editor-tab-close').click();
      const dialog = modal(page, /^Fermer/);
      await dialog.waitFor();
      t.check(await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).isVisible(), 'dialogue : Enregistrer');
      t.check(await dialog.getByRole('button', { name: 'Ne pas enregistrer' }).isVisible(), 'dialogue : Ne pas enregistrer');
      await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      t.equal(await tabs(page).count(), 2, 'Annuler : l’onglet reste ouvert');

      // Ctrl+W puis « Ne pas enregistrer » : l’onglet se ferme, le fichier n’a pas changé.
      await page.locator('.stage').first().click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('Control+w');
      await dialog.waitFor();
      await dialog.getByRole('button', { name: 'Ne pas enregistrer' }).click();
      await t.waitEqual(() => tabs(page).count(), 1, 'onglet fermé sans enregistrer');
      t.equal(await dirtyTabs(page).count(), 0, 'plus aucune modification en cours');
      t.equal(readJson(workspacePath(t, 'menus', 'shop.menu.json')), original, 'fichier du menu inchangé');
      await t.waitEqual(() => openedMenu(page).inputValue(), 'confirmation', 'l’onglet restant est affiché');
    },
  },
  {
    name: 'enregistrer en fermant, session rouverte au rechargement',
    async run(t) {
      const { page } = t;
      const file = workspacePath(t, 'menus', 'back_bar.menu.json');
      await open(t, '#/editeur/menus/back_bar');
      const { before, id } = await nudgeFirstLayer(t, 'ArrowDown');
      await page.locator('.shell-editor .editor-tab.dirty .editor-tab-close').click();
      const dialog = modal(page, /^Fermer/);
      await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await t.waitEqual(() => tabs(page).count(), 0, 'onglet fermé après enregistrement');
      await t.waitEqual(() => readJson(file).layers.find((layer) => layer.id === id)?.y, before + 1, 'modification enregistrée dans le fichier');
      t.check(await page.getByRole('heading', { name: 'Aucun document ouvert' }).isVisible(), 'éditeur sans onglet');

      // Deux documents ouverts, puis rechargement : les mêmes onglets reviennent, le même affiché.
      await page.getByRole('button', { name: 'Documents récents' }).click();
      await page.evaluate(() => (window.location.hash = '#/editeur/menus/shop'));
      await t.waitEqual(() => tabs(page).count(), 1, 'menu rouvert');
      await page.evaluate(() => (window.location.hash = '#/editeur/menus/confirmation'));
      await t.waitEqual(() => tabs(page).count(), 2, 'second menu rouvert');
      // Noms des documents chargés (un onglet montre l’identifiant le temps de lire son document).
      const labels = ['Boutique', 'Confirmation d’achat'];
      await t.waitEqual(() => page.locator('.shell-editor .editor-tab-label').allTextContents(), labels, 'onglets nommés d’après leur document');
      await page.reload({ waitUntil: 'load' });
      await page.locator('canvas.menu-canvas').first().waitFor({ timeout: 30_000 });
      await t.waitEqual(() => page.locator('.shell-editor .editor-tab-label').allTextContents(), labels, 'session rouverte : mêmes onglets');
      await t.waitEqual(() => openedMenu(page).inputValue(), 'confirmation', 'session rouverte : même onglet affiché');
    },
  },
  {
    name: 'shaders : un onglet par exemple, brouillons gardés, abandon confirmé',
    async run(t) {
      const { page } = t;
      await open(t, '#/shaders');
      const shaderTabs = page.locator('.shaderlab-tabs .editor-tab');
      await t.waitEqual(() => shaderTabs.count(), 1, 'premier exemple ouvert');
      const code = page.locator('.shaderlab-code');
      await code.fill(`${await code.inputValue()}\n// essai e2e`);
      await t.waitEqual(() => page.locator('.shaderlab-tabs .editor-tab.dirty').count(), 1, 'brouillon marqué');
      await page.locator('.shaderlab-examples li button', { hasText: 'Noir et blanc' }).click();
      await t.waitEqual(() => shaderTabs.count(), 2, 'l’exemple s’ouvre dans un second onglet');

      await page.locator('.rail').getByRole('button', { name: 'Accueil', exact: true }).click();
      await page.locator('.rail').getByRole('button', { name: 'Shaders', exact: true }).click();
      await t.waitEqual(() => shaderTabs.count(), 2, 'onglets gardés après un changement d’écran');
      t.equal(await page.locator('.shaderlab-tabs .editor-tab.dirty').count(), 1, 'brouillon gardé après un changement d’écran');

      await page.locator('.shaderlab-tabs .editor-tab.dirty .editor-tab-close').click();
      const dialog = modal(page, /^Fermer/);
      t.check(!(await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).isVisible()), 'rien à enregistrer : pas de bouton Enregistrer');
      await dialog.getByRole('button', { name: 'Abandonner les modifications' }).click();
      await t.waitEqual(() => shaderTabs.count(), 1, 'onglet du brouillon fermé');
    },
  },
];
