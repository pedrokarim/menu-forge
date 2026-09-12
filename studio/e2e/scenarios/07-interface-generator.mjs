/**
 * Générateur d’interfaces : les cinq types et les trois familles de styles,
 * aperçu interactif, création de menus complets (textures cuites sur le disque),
 * galerie d’exemples (filtres, réglages chargés, création directe, mise en page).
 *
 * `MF_LAYOUT_SHOTS=<dossier>` : capture de chaque état de la galerie à chaque
 * taille (hors du dépôt), pour une relecture à l’œil.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { auditLayout } from '../lib/audit.mjs';
import { NBSP } from '../lib/harness.mjs';
import { inspectorField, modal, nextFrames, open, readJson, readPng, textOf, waitStatus, workspacePath } from '../lib/studio.mjs';

export const title = 'Générateur d’interfaces';

const SHOTS = process.env.MF_LAYOUT_SHOTS ? path.resolve(process.env.MF_LAYOUT_SHOTS) : null;
/** Tailles de l’audit de la galerie : minimum de l’appli, courante, grand écran. */
const GALLERY_SIZES = [
  { width: 1024, height: 600 },
  { width: 1280, height: 800 },
  { width: 1600, height: 900 },
];

/** Audite l’état affiché à chaque taille ; renvoie les défauts avec la taille et l’état. */
async function auditGallery(t, state) {
  const { page } = t;
  const found = [];
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  for (const size of GALLERY_SIZES) {
    await page.setViewportSize(size);
    await page.mouse.move(1, 1);
    await nextFrames(page);
    await t.wait(300);
    for (const problem of await auditLayout(page)) found.push(`${size.width} × ${size.height} · ${state} › ${problem}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${size.width}x${size.height}--galerie-${state.replace(/[^a-z0-9]+/gi, '-')}.png`) });
  }
  return found;
}

/** Vignettes dessinées : chacune tient dans sa case et reste pixelisée. */
async function thumbnailsFit(gallery) {
  return gallery.locator('.example-card').evaluateAll((cards) =>
    cards
      .filter((card) => card.querySelector('canvas[data-drawn]'))
      .map((card) => {
        const box = card.querySelector('.example-thumb').getBoundingClientRect();
        const canvas = card.querySelector('canvas');
        const rect = canvas.getBoundingClientRect();
        const inside = rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5 && rect.top >= box.top - 0.5 && rect.bottom <= box.bottom + 0.5;
        return { name: card.querySelector('.example-name').textContent, ok: inside && getComputedStyle(canvas).imageRendering === 'pixelated' };
      }),
  );
}

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
  {
    name: 'galerie d’exemples : filtrer, charger, créer',
    async run(t) {
      const { page } = t;
      const layout = [];
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(t, '#/accueil');
      await page.getByRole('button', { name: 'Voir les exemples', exact: true }).click();
      const dialog = modal(page, 'Générer une interface');
      await dialog.waitFor();
      t.equal(await dialog.getByRole('tab', { name: /Exemples/ }).getAttribute('aria-selected'), 'true', '« Voir les exemples » ouvre la galerie');
      const gallery = dialog.getByRole('radiogroup', { name: 'Exemples d’interfaces' });
      const cards = gallery.getByRole('radio');
      t.equal(await cards.count(), 22, 'vingt-deux exemples');
      await t.waitFor(async () => (await gallery.locator('canvas[data-drawn]').count()) > 0, 'premières vignettes dessinées');
      await t.wait(400);
      const drawnAtOpen = await gallery.locator('canvas[data-drawn]').count();
      t.check(drawnAtOpen < 22, `rendu paresseux${NBSP}: ${drawnAtOpen} vignettes dessinées à l’ouverture`);
      t.equal((await thumbnailsFit(gallery)).filter((entry) => !entry.ok).map((entry) => entry.name), [], 'vignettes tenues dans leur case, pixelisées');
      layout.push(...(await auditGallery(t, 'ouverture')));

      // Filtres par type et par famille.
      const typeFilter = dialog.getByRole('group', { name: 'Type' });
      const familyFilter = dialog.getByRole('group', { name: 'Famille' });
      const names = () => cards.evaluateAll((items) => items.map((item) => item.querySelector('.example-name').textContent));
      await typeFilter.getByRole('button', { name: 'Barre d’onglets', exact: true }).click();
      t.equal(await cards.count(), 5, 'filtre « Barre d’onglets »');
      await familyFilter.getByRole('button', { name: 'mc-rs', exact: true }).click();
      t.equal(await names(), ['Atelier', 'Garde-robe'], 'onglets en mc-rs');
      layout.push(...(await auditGallery(t, 'filtrée')));
      await typeFilter.getByRole('button', { name: 'Tous', exact: true }).click();
      t.equal(await cards.count(), 8, 'mc-rs, tous les types');
      await familyFilter.getByRole('button', { name: 'Toutes', exact: true }).click();
      t.equal(await cards.count(), 22, 'filtres levés');

      // Un clic charge les réglages de l’exemple dans le formulaire.
      const hotel = gallery.getByRole('radio', { name: /^Hôtel des ventes du royaume,/ });
      await hotel.click();
      t.equal(await hotel.getAttribute('aria-checked'), 'true', 'exemple sélectionné');
      layout.push(...(await auditGallery(t, 'exemple sélectionné')));
      await gallery.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      await t.wait(400);
      layout.push(...(await auditGallery(t, 'bas de la grille')));
      t.equal(await gallery.locator('canvas[data-drawn]').count(), 22, 'toutes les vignettes dessinées une fois atteintes');
      t.equal((await thumbnailsFit(gallery)).filter((entry) => !entry.ok).map((entry) => entry.name), [], 'bas de la grille : vignettes tenues');
      await dialog.getByRole('button', { name: 'Personnaliser', exact: true }).click();
      layout.push(...(await auditGallery(t, 'réglages chargés')));
      await page.setViewportSize({ width: 1280, height: 800 });
      const value = (label) => inspectorField(page, label, '.modal').inputValue();
      t.equal(await value('Nom'), 'Hôtel des ventes du royaume', 'nom repris');
      t.equal(await value('Titre affiché'), 'Hôtel des ventes du royaume', 'titre repris');
      t.equal(await value('Identifiant'), 'hotel_des_ventes_du_royaume', 'identifiant tiré du nom');
      t.equal(await value('Famille de styles'), 'deepslate', 'famille');
      t.equal(await dialog.locator('.color-input input:not([type="color"])').inputValue(), '#d04545', 'accent');
      t.equal(await value('Lignes du coffre'), '3', 'lignes');
      t.equal(await value('Boutons de la barre'), '5', 'boutons');
      t.equal(await value('Disposition des boutons'), 'end', 'disposition');
      t.equal(await dialog.getByRole('radio', { name: 'Boutique', exact: true }).getAttribute('aria-checked'), 'true', 'type');

      // Réglages retouchés, puis « Créer le menu » : le menu s’ouvre dans l’éditeur.
      await inspectorField(page, 'Identifiant', '.modal').fill('e2e_hotel');
      await inspectorField(page, 'Lignes du coffre', '.modal').fill('4');
      await dialog.getByRole('button', { name: 'Créer le menu', exact: true }).click();
      await waitStatus(t, 'Menu « e2e_hotel » créé');
      const menu = readJson(workspacePath(t, 'menus', 'e2e_hotel.menu.json'));
      t.equal([menu.name, menu.container.rows], ['Hôtel des ventes du royaume', 4], 'e2e_hotel : nom de l’exemple, lignes retouchées');
      t.check(JSON.stringify(menu).includes('#d04545'), 'e2e_hotel : accent de l’exemple');
      const opened = page.getByLabel('Menu ouvert');
      t.equal(await opened.inputValue(), 'e2e_hotel', 'e2e_hotel : ouvert dans l’éditeur');

      // Double-clic, puis « Utiliser cet exemple » : création directe, identifiants uniques.
      const created = [];
      for (const gesture of ['double-clic', 'bouton']) {
        const previous = await opened.inputValue();
        await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
        await modal(page, 'Nouveau menu').getByRole('button', { name: /Générer une interface/ }).click();
        await dialog.getByRole('tab', { name: /Exemples/ }).click();
        const market = gallery.getByRole('radio', { name: /^Marché,/ });
        if (gesture === 'double-clic') await market.dblclick();
        else {
          await market.click();
          await dialog.getByRole('button', { name: 'Utiliser cet exemple', exact: true }).click();
        }
        await dialog.waitFor({ state: 'detached' });
        await t.waitFor(async () => (await opened.inputValue()) !== previous, `${gesture} : menu créé et ouvert`);
        const id = await opened.inputValue();
        created.push(id);
        const marketMenu = readJson(workspacePath(t, 'menus', `${id}.menu.json`));
        t.equal([marketMenu.name, marketMenu.container.rows], ['Marché', 6], `${gesture} : réglages de l’exemple`);
      }
      t.check(created.every((id) => /^marche(_\d+)?$/.test(id)) && created[0] !== created[1], `identifiants uniques (${created.join(', ')})`);

      t.check(layout.length === 0, `${layout.length} défaut${layout.length > 1 ? 's' : ''} de mise en page${NBSP}:\n      – ${layout.join('\n      – ')}`);
    },
  },
];
