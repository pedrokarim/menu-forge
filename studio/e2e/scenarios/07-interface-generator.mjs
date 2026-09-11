/**
 * Générateur d’interfaces : les cinq types et les trois familles de styles,
 * aperçu interactif, création de menus complets (textures cuites sur le disque).
 */
import { existsSync } from 'node:fs';
import { inspectorField, modal, open, readJson, readPng, textOf, waitStatus, workspacePath } from '../lib/studio.mjs';

export const title = 'Générateur d’interfaces';

const KINDS = ['Boutique', 'Grille simple', 'Modale de confirmation', 'Liste paginée', 'Barre d’onglets'];
const FAMILIES = ['deepslate', 'mcrs', 'dark'];

/** Menus créés : chaque famille au moins une fois. */
const CREATIONS = [
  { kind: 'Boutique', family: 'deepslate', id: 'gen_shop' },
  { kind: 'Grille simple', family: 'mcrs', id: 'gen_grid', rows: 4 },
  { kind: 'Modale de confirmation', family: 'dark', id: 'gen_confirm' },
  { kind: 'Liste paginée', family: 'mcrs', id: 'gen_list' },
  { kind: 'Barre d’onglets', family: 'dark', id: 'gen_tabs', accent: '#ff00aa' },
];

const summary = (dialog) => textOf(dialog.locator('.interface-summary'));

/** Clique chaque case de la première ligne de l’aperçu ; vrai si l’état résumé change. */
async function previewReactsToClicks(page, dialog) {
  const canvas = dialog.getByRole('img', { name: 'Aperçu du menu généré' });
  const box = await canvas.boundingBox();
  const before = await summary(dialog);
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 9; col++) {
      const x = box.x + ((7 + 18 * col + 9) / 176) * box.width;
      const y = box.y + ((17 + 18 * row + 9) * box.width) / 176;
      if (y > box.y + box.height) continue;
      await page.mouse.click(x, y);
      if ((await summary(dialog)) !== before) return true;
    }
  }
  return false;
}

export const tests = [
  {
    name: 'aperçu : cinq types, trois familles',
    async run(t) {
      const { page } = t;
      await open(t, '#/accueil');
      await page.locator('.quick-action', { hasText: 'Générer une interface' }).click();
      const dialog = modal(page, 'Générer une interface');
      await dialog.waitFor();
      t.equal(await dialog.getByRole('button', { name: 'Gabarits' }).count(), 0, 'ouvert depuis l’accueil : pas de retour aux gabarits');
      t.equal(await dialog.getByRole('radio').allTextContents(), KINDS, 'types proposés');
      for (const kind of KINDS) {
        await dialog.getByRole('radio', { name: kind, exact: true }).click();
        for (const family of FAMILIES) {
          await inspectorField(page, 'Famille de styles', '.modal').selectOption(family);
          const text = await summary(dialog);
          const [, layers, slots] = /(\d+) couches?.*?(\d+) slots?/.exec(text) ?? [];
          t.check(Number(layers) > 0 && Number(slots) > 0, `${kind}, ${family}${' '}: couches et slots générés (${text})`);
        }
      }
      await dialog.getByRole('radio', { name: 'Barre d’onglets', exact: true }).click();
      t.check(await previewReactsToClicks(page, dialog), 'barre d’onglets : un clic sur l’aperçu change d’onglet');
      await dialog.getByRole('radio', { name: 'Liste paginée', exact: true }).click();
      t.check(await previewReactsToClicks(page, dialog), 'liste paginée : un clic sur une flèche change de page');
      await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
    },
  },
  {
    name: 'création : un menu par type',
    async run(t) {
      const { page } = t;
      await open(t, '#/editeur/menus/shop');
      for (const [index, creation] of CREATIONS.entries()) {
        await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
        await modal(page, 'Nouveau menu').getByRole('button', { name: /Générer une interface/ }).click();
        const dialog = modal(page, 'Générer une interface');
        if (index === 0) {
          await dialog.getByRole('button', { name: 'Gabarits' }).click();
          await modal(page, 'Nouveau menu').waitFor();
          t.check(true, '« Gabarits » revient au choix du point de départ');
          await modal(page, 'Nouveau menu').getByRole('button', { name: /Générer une interface/ }).click();
        }
        await dialog.getByRole('radio', { name: creation.kind, exact: true }).click();
        await inspectorField(page, 'Famille de styles', '.modal').selectOption(creation.family);
        await inspectorField(page, 'Nom', '.modal').fill(`Généré ${creation.kind}`);
        await inspectorField(page, 'Identifiant', '.modal').fill(creation.id);
        if (creation.rows) await inspectorField(page, 'Lignes du coffre', '.modal').fill(String(creation.rows));
        if (creation.accent) await dialog.locator('.color-input input:not([type="color"])').fill(creation.accent);
        await dialog.getByRole('button', { name: 'Créer le menu', exact: true }).click();
        await waitStatus(t, `Menu « ${creation.id} » créé`);
        const file = workspacePath(t, 'menus', `${creation.id}.menu.json`);
        const menu = readJson(file);
        t.check(menu.layers.length > 0 && menu.layers.every((layer) => layer.generator), `${creation.id}${' '}: couches générées`);
        t.check((menu.slots ?? []).length > 0, `${creation.id}${' '}: zones de slots et actions`);
        const missing = menu.layers.filter((layer) => !existsSync(workspacePath(t, 'textures', ...layer.texture.split('/'))));
        t.equal(missing.map((layer) => layer.texture), [], `${creation.id}${' '}: textures cuites sur le disque`);
        const sample = readPng(workspacePath(t, 'textures', ...menu.layers[0].texture.split('/')));
        t.check(sample.width > 0 && sample.height > 0, `${creation.id}${' '}: PNG lisible`);
        if (creation.rows) t.equal(menu.container.rows, creation.rows, `${creation.id}${' '}: ${creation.rows} lignes`);
        if (creation.accent) t.check(JSON.stringify(menu).includes(creation.accent), `${creation.id}${' '}: couleur d’accent reprise`);
        t.equal(await page.getByLabel('Menu ouvert').inputValue(), creation.id, `${creation.id}${' '}: ouvert dans l’éditeur`);
      }
    },
  },
];
