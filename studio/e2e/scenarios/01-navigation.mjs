/**
 * Navigation : rail d’écrans, adresse, raccourcis (Ctrl+1…5, Ctrl+O, « ? »),
 * disposition AZERTY (lettres lues sur la touche produite, chiffres sur la
 * touche physique), taille minimale de la fenêtre (1024 × 600).
 */
import { auditLayout } from '../lib/audit.mjs';
import { dispatchKey, inspectorNumber, inspectorPill, menuCanvas, modal, open, outlineRow, setMenuZoom, textOf } from '../lib/studio.mjs';

export const title = 'Navigation, raccourcis et taille minimale';

const hashOf = (page) => page.evaluate(() => window.location.hash);

const RAIL = [
  ['Éditeur', /^#\/editeur\/menus/],
  ['Bibliothèques', /^#\/bibliotheques$/],
  ['Paramètres', /^#\/parametres$/],
  ['À propos', /^#\/a-propos$/],
  ['Accueil', /^#\/accueil$/],
];

/** Taille minimale de la fenêtre de l’appli (`src-tauri/src/main.rs`). */
const MINIMUM = { width: 1024, height: 600 };

async function expectHash(t, pattern, message) {
  await t.waitFor(async () => pattern.test(await hashOf(t.page)), message);
}

async function expectCleanLayout(t, label) {
  const problems = await auditLayout(t.page);
  t.equal(problems, [], `mise en page à ${MINIMUM.width} × ${MINIMUM.height} (${label})`);
}

export const tests = [
  {
    name: 'rail d’écrans et adresse',
    async run(t) {
      const { page } = t;
      await open(t, '#/accueil');
      t.equal(await page.title(), 'Menu Forge · Accueil', 'titre de l’onglet');
      for (const [label, pattern] of RAIL) {
        await page.locator('.rail').getByRole('button', { name: label, exact: true }).click();
        await expectHash(t, pattern, `rail « ${label} » : adresse`);
        await t.waitEqual(() => page.locator('.rail-button[aria-current="page"]').getAttribute('aria-label'), label, `rail « ${label} » marqué actif`);
      }
      // L’adresse ramène à l’écran, Précédent aussi.
      await page.goBack();
      await expectHash(t, /^#\/a-propos$/, 'Précédent revient à l’écran quitté');
      t.check(await page.getByText('Menu Forge n’est ni affilié à Mojang', { exact: false }).isVisible(), 'mention de non-affiliation dans « À propos »');
    },
  },
  {
    name: 'raccourcis de navigation (QWERTY et AZERTY)',
    async run(t) {
      const { page } = t;
      await open(t, '#/accueil');
      const expected = [/^#\/accueil$/, /^#\/editeur\//, /^#\/bibliotheques$/, /^#\/parametres$/, /^#\/a-propos$/];
      for (const digit of [2, 3, 4, 5, 1]) {
        await page.keyboard.press(`Control+${digit}`);
        await expectHash(t, expected[digit - 1], `Ctrl+${digit}`);
      }
      // AZERTY : Ctrl + la touche du 1 produit « & » ; le chiffre est lu sur la touche physique.
      const azerty = [
        ['é', 2],
        ['"', 3],
        ["'", 4],
        ['(', 5],
        ['&', 1],
      ];
      for (const [key, digit] of azerty) {
        await dispatchKey(page, { key, code: `Digit${digit}`, ctrlKey: true });
        await expectHash(t, expected[digit - 1], `AZERTY Ctrl+${key} (touche du ${digit})`);
      }
      await page.keyboard.press('Control+o');
      await expectHash(t, /^#\/espaces$/, 'Ctrl+O : sélection d’espace de travail');
    },
  },
  {
    name: 'aide-mémoire « ? »',
    async run(t) {
      const { page } = t;
      await open(t, '#/accueil');
      const dialog = modal(page, 'Raccourcis clavier');
      await page.keyboard.press('?');
      await dialog.waitFor();
      t.equal(await dialog.locator('.shortcut-group h3').allTextContents(), [
        'Navigation',
        'Sélection et presse-papiers',
        'Éditeur de menus',
        'Éditeur de formulaires Bedrock',
        'Éditeur d’assets',
        'Éditeur de pixels',
        'Toile',
      ], 'groupes de l’aide-mémoire');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      t.check(true, 'Échap ferme l’aide-mémoire');
      // AZERTY : « ? » est Maj + la touche de la virgule.
      await dispatchKey(page, { key: '?', code: 'Comma', shiftKey: true });
      await dialog.waitFor();
      t.check(true, 'AZERTY Maj+, ouvre l’aide-mémoire');
      await dialog.getByRole('button', { name: 'Fermer', exact: true }).last().click();
      await dialog.waitFor({ state: 'hidden' });
      // Un « ? » tapé dans un champ reste dans le champ.
      await open(t, '#/parametres');
      const field = page.getByLabel('Espace de noms', { exact: true });
      await field.click();
      await page.keyboard.press('?');
      await t.wait(300);
      t.equal(await dialog.count(), 0, '« ? » dans un champ n’ouvre pas l’aide-mémoire');
      t.equal(await field.inputValue(), 'menuforge?', 'le « ? » est saisi dans le champ');
      await field.press('Escape');
      t.equal(await field.inputValue(), 'menuforge', 'Échap rétablit la valeur du champ');
      // Le rail ouvre aussi l’aide-mémoire.
      await page.locator('.rail').getByRole('button', { name: 'Raccourcis clavier', exact: true }).click();
      await dialog.waitFor();
      t.check(true, 'bouton du rail « Raccourcis clavier »');
    },
  },
  {
    name: 'raccourcis de l’éditeur en AZERTY',
    async run(t) {
      const { page } = t;
      await open(t, '#/editeur/menus/shop');
      await outlineRow(page, 0, 'close').click();
      const x = await inspectorNumber(page, 'x');
      await page.keyboard.press('ArrowRight');
      await t.waitEqual(() => inspectorNumber(page, 'x'), x + 1, 'flèche droite : 1 px');
      // AZERTY : Ctrl+Z est sur la touche physique W, Ctrl+A sur la touche Q.
      await dispatchKey(page, { key: 'z', code: 'KeyW', ctrlKey: true });
      await t.waitEqual(() => inspectorNumber(page, 'x'), x, 'AZERTY Ctrl+Z annule');
      await dispatchKey(page, { key: 'y', code: 'KeyY', ctrlKey: true });
      await t.waitEqual(() => inspectorNumber(page, 'x'), x + 1, 'AZERTY Ctrl+Y rétablit');
      await dispatchKey(page, { key: 'a', code: 'KeyQ', ctrlKey: true });
      await t.waitFor(async () => /\d+ éléments sélectionnés/.test(await textOf(page.locator('.statusbar-meta'))), 'AZERTY Ctrl+A sélectionne tout');
      await dispatchKey(page, { key: 'Escape', code: 'Escape' });
      await t.waitEqual(() => inspectorPill(page), 'menu · shop', 'Échap désélectionne');
      // Ctrl+0 (touche du 0, « à » en AZERTY) : zoom « Ajuster ».
      await setMenuZoom(page, 2);
      await dispatchKey(page, { key: 'à', code: 'Digit0', ctrlKey: true });
      await t.waitEqual(() => page.getByLabel('Niveau de zoom').first().inputValue(), 'fit', 'AZERTY Ctrl+0 : zoom ajusté');
      // Outils : V et S (lettres identiques en AZERTY).
      await dispatchKey(page, { key: 's', code: 'KeyS' });
      await t.waitEqual(() => page.getByRole('button', { name: 'Slots', exact: true }).getAttribute('aria-pressed'), 'true', 'S : outil Slots');
      await dispatchKey(page, { key: 'v', code: 'KeyV' });
      await t.waitEqual(() => page.getByRole('button', { name: 'Sélection', exact: true }).getAttribute('aria-pressed'), 'true', 'V : outil Sélection');
      t.check((await menuCanvas(page)).zoom >= 1, 'toile affichée');
    },
  },
  {
    name: 'taille minimale : écrans',
    async run(t) {
      const { page } = t;
      await page.setViewportSize(MINIMUM);
      for (const [hash, label] of [
        ['#/accueil', 'accueil'],
        ['#/bibliotheques', 'bibliothèques'],
        ['#/parametres', 'paramètres'],
        ['#/a-propos', 'à propos'],
        ['#/espaces', 'espaces de travail'],
      ]) {
        await open(t, hash);
        await expectCleanLayout(t, label);
      }
    },
  },
  {
    name: 'taille minimale : éditeurs',
    async run(t) {
      const { page } = t;
      await page.setViewportSize(MINIMUM);
      await open(t, '#/editeur/menus/shop');
      await expectCleanLayout(t, 'éditeur de menus, propriétés du menu');
      await outlineRow(page, 2, 'buy').click();
      await page.locator('.inspector .action-editor').waitFor();
      await expectCleanLayout(t, 'éditeur de menus, slot « buy »');
      await outlineRow(page, 1, 'title').click();
      await expectCleanLayout(t, 'éditeur de menus, texte « title »');
      await page.getByRole('button', { name: 'Essayer', exact: true }).click();
      await page.locator('.try-journal').waitFor();
      await expectCleanLayout(t, 'mode « Essayer »');
      await page.keyboard.press('Escape');
      await page.getByRole('tab', { name: 'Bibliothèque', exact: true }).click();
      await expectCleanLayout(t, 'bibliothèque de l’éditeur');
      await open(t, '#/editeur/assets/help_banner');
      await expectCleanLayout(t, 'éditeur d’assets');
      await page.locator('.asset-editor .outline-list .outline-item').first().click();
      await expectCleanLayout(t, 'éditeur d’assets, élément sélectionné');
      await open(t, '#/editeur/pixels/shop_tab_icon');
      await expectCleanLayout(t, 'éditeur de pixels');
    },
  },
  {
    name: 'taille minimale : dialogues',
    async run(t) {
      const { page } = t;
      await page.setViewportSize(MINIMUM);
      await open(t, '#/editeur/menus/shop');
      await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
      await modal(page, 'Nouveau menu').waitFor();
      await expectCleanLayout(t, 'dialogue « Nouveau menu »');
      // Carte du générateur dans « Nouveau menu » (la barre de l’éditeur a aussi « Générer une interface par IA… »).
      await modal(page, 'Nouveau menu').getByRole('button', { name: /Générer une interface/ }).click();
      await modal(page, 'Générer une interface').waitFor();
      await expectCleanLayout(t, 'dialogue « Générer une interface »');
      await page.keyboard.press('Escape');
      await page.locator('.outline .section-actions').getByRole('button', { name: 'Générer', exact: true }).click();
      await page.locator('.modal').first().waitFor();
      await expectCleanLayout(t, 'générateur de textures');
      await page.keyboard.press('Escape');
      await page.keyboard.press('?');
      await modal(page, 'Raccourcis clavier').waitFor();
      await expectCleanLayout(t, 'aide-mémoire des raccourcis');
    },
  },
];
