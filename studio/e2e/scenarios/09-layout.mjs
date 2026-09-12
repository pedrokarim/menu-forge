/**
 * Mise en page à plusieurs tailles de fenêtre, hauteurs basses comprises :
 * chaque écran (réglages d’export Bedrock compris), les onglets et panneaux des
 * quatre éditeurs (menus, assets, pixels, formulaires Bedrock), tous les
 * dialogues, un menu contextuel, une infobulle, puis les mêmes lieux remplis de
 * données extrêmes (noms très longs, 50 couches, 30 zones, 40 documents,
 * formulaires des huit dispositions à 30 boutons et textes de 80 caractères…)
 * et les états vides. Tout passe l’audit de `lib/audit.mjs` (débordements,
 * textes coupés, chevauchements, dialogue recouvert, alignement des barres
 * d’outils, onglets de même hauteur, titres cassés, cartes creuses, page qui
 * défile en entier). Tous les défauts d’un test sont listés d’un coup, avec la
 * taille et l’état où ils apparaissent.
 *
 * `MF_LAYOUT_SHOTS=<dossier>` : capture de chaque état à chaque taille (hors
 * du dépôt), pour une relecture à l’œil de ce que l’audit ne voit pas.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { auditLayout } from '../lib/audit.mjs';
import { NBSP } from '../lib/harness.mjs';
import { encodePng, paintImage } from '../lib/png.mjs';
import { api, contextItem, modal, nextFrames, open, outlineRow, rightClick } from '../lib/studio.mjs';
import { FORM_LAYOUTS, STRESS, cleanupStress, openEmptyWorkspace, restoreWorkspace, seedStress } from '../lib/stress.mjs';

export const title = 'Mise en page à toutes les tailles';

/**
 * Tailles auditées : quatre largeurs (minimum de l’appli, 1024 × 600, dans
 * `src-tauri/src/main.rs` ; ancien minimum 1180 ; courantes), chacune en hauteur
 * basse (600 et 700 px), plus deux fenêtres hautes.
 */
const SIZES = [
  { width: 1024, height: 600 },
  { width: 1024, height: 700 },
  { width: 1180, height: 600 },
  { width: 1180, height: 700 },
  { width: 1280, height: 600 },
  { width: 1280, height: 800 },
  { width: 1600, height: 600 },
  { width: 1600, height: 900 },
];

const SHOTS = process.env.MF_LAYOUT_SHOTS ? path.resolve(process.env.MF_LAYOUT_SHOTS) : null;

const slug = (text) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Ouvre un écran sans attendre de toile (états vides : aucun document ouvert). */
async function openScreen(t, hash) {
  const { page, env } = t;
  await page.goto('about:blank');
  await page.goto(`${env.uiOrigin}/${hash}`, { waitUntil: 'load' });
  await page.locator('.rail').first().waitFor({ timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await t.wait(400);
}

async function auditHere(t, found, size, state) {
  const { page } = t;
  if (!state.keepPointer) await page.mouse.move(1, 1);
  await nextFrames(page);
  await t.wait(state.settle ?? 150);
  const problems = await auditLayout(page);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${size.width}x${size.height}--${slug(state.name)}.png`) });
  for (const problem of problems) found.push(`${size.width} × ${size.height} · ${state.name} › ${problem}`);
}

/**
 * Parcourt les états : chacun est ouvert et préparé une fois (onglet,
 * sélection, dialogue…), puis audité à chaque taille. Un état fugace (menu
 * contextuel, infobulle : un redimensionnement les ferme) est rouvert à chaque
 * taille. Renvoie les défauts relevés, vérifiés par `expectClean` une fois tout parcouru.
 */
async function sweep(t, states) {
  const { page } = t;
  const found = [];
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  for (const state of states) {
    const reopen = async () => {
      if (state.empty) await openScreen(t, state.hash);
      else await open(t, state.hash);
      if (state.prepare) await state.prepare(page);
    };
    if (state.perSize) {
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await reopen();
        await auditHere(t, found, size, state);
      }
      continue;
    }
    await page.setViewportSize(SIZES[0]);
    await reopen();
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await auditHere(t, found, size, state);
    }
  }
  return found;
}

/** Un seul échec pour tous les défauts d’un test, listés avec leur taille et leur état. */
function expectClean(t, found) {
  t.check(found.length === 0, `${found.length} défaut${found.length > 1 ? 's' : ''} de mise en page${NBSP}:\n      – ${found.join('\n      – ')}`);
}

const MENU = '#/editeur/menus/shop';
const ASSET = '#/editeur/assets/help_banner';
const PIXEL = '#/editeur/pixels/shop_tab_icon';
const STRESS_MENU = `#/editeur/menus/${STRESS.menu}`;
const FORM_ID = 'e2e_layout_form';
const FORM = `#/editeur/menus/${FORM_ID}`;
const STRESS_FORM = `#/editeur/menus/${STRESS.form('grid')}`;

const clickButton = (page, name) => page.getByRole('button', { name, exact: true }).first().click();
const tool = (label) => (page) => clickButton(page, label);
const libraryTab = (page) => page.getByRole('tab', { name: 'Bibliothèque', exact: true }).click();
/** Paramètres défilés jusqu’à la section « Export pour Bedrock ». */
const bedrockSettings = (page) => page.locator('section[aria-labelledby="settings-bedrock"]').evaluate((node) => node.scrollIntoView({ block: 'start' }));
const tryForm = async (page) => {
  await clickButton(page, 'Essayer');
  await page.locator('.form-editor .try-journal').waitFor();
};

/** Formulaire ordinaire : textes courts, une icône du jeu, un bouton spécial, une action. */
function layoutForm() {
  return {
    formatVersion: 1,
    id: FORM_ID,
    name: 'Téléportation',
    container: { type: 'chest', rows: 6 },
    state: {},
    layers: [],
    form: {
      layout: 'grid',
      title: 'Téléportation',
      content: 'Choisis une destination.',
      buttons: [
        { id: 'spawn', text: 'Spawn', icon: { path: 'textures/items/compass' }, onClick: [{ type: 'close' }] },
        { id: 'shop', text: 'Boutique', subtitle: 'Marché' },
        { id: 'arena', text: 'Arène', role: 'special' },
        { id: 'nether', text: 'Nether' },
      ],
    },
  };
}

/** Infobulle d’un bouton de la barre (le pointeur reste dessus jusqu’à l’audit). */
const hoverTooltip = (name) => async (page) => {
  await page.getByRole('button', { name, exact: true }).first().hover();
  await page.locator('[role="tooltip"]').waitFor();
};

export const tests = [
  {
    name: 'écrans',
    async run(t) {
      expectClean(
        t,
        await sweep(t, [
          { name: 'accueil', hash: '#/accueil' },
          { name: 'bibliothèques', hash: '#/bibliotheques' },
          { name: 'paramètres', hash: '#/parametres' },
          { name: 'paramètres · export Bedrock', hash: '#/parametres', prepare: bedrockSettings },
          { name: 'à propos', hash: '#/a-propos' },
          { name: 'espaces de travail', hash: '#/espaces' },
        ]),
      );
    },
  },
  {
    name: 'éditeur de menus',
    async run(t) {
      expectClean(
        t,
        await sweep(t, [
          { name: 'menu, propriétés', hash: MENU },
          { name: 'onglet Bibliothèque', hash: MENU, prepare: (page) => page.getByRole('tab', { name: 'Bibliothèque', exact: true }).click() },
          {
            name: 'slot « buy »',
            hash: MENU,
            prepare: async (page) => {
              await outlineRow(page, 2, 'buy').click();
              await page.locator('.inspector .action-editor').waitFor();
            },
          },
          { name: 'texte « title »', hash: MENU, prepare: (page) => outlineRow(page, 1, 'title').click() },
          { name: 'sélection multiple', hash: MENU, prepare: (page) => page.keyboard.press('Control+a') },
          {
            name: 'mode « Essayer »',
            hash: MENU,
            prepare: async (page) => {
              await clickButton(page, 'Essayer');
              await page.locator('.try-journal').waitFor();
            },
          },
          { name: 'outil Zoom', hash: MENU, prepare: tool('Zoom') },
          {
            name: 'menu contextuel d’une couche',
            hash: MENU,
            perSize: true,
            keepPointer: true,
            prepare: async (page) => {
              await rightClick(outlineRow(page, 0, 'close'));
              await page.locator('.context-menu').waitFor();
            },
          },
          { name: 'infobulle de la barre', hash: MENU, perSize: true, keepPointer: true, settle: 50, prepare: hoverTooltip('Essayer') },
        ]),
      );
    },
  },
  {
    name: 'dialogues de l’éditeur de menus',
    async run(t) {
      // Menu à couche ordinaire (non générée) : seul cas où « Rogner… » ouvre le dialogue.
      const atlas = encodePng(paintImage(32, 16, [[2, 2, 12, 12, [220, 40, 40, 255]]]));
      const upload = await fetch(`${t.env.apiOrigin}/api/textures/layout/atlas.png`, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png', 'X-Menu-Forge': '1' },
        body: atlas,
      });
      t.check(upload.ok, `texture de l’atlas écrite (${upload.status})`);
      await api(t, '/menus/e2e_layout', {
        method: 'PUT',
        body: {
          formatVersion: 1,
          id: 'e2e_layout',
          name: 'e2e_layout',
          container: { type: 'chest', rows: 3 },
          layers: [{ id: 'atlas', texture: 'layout/atlas.png', x: 0, y: 0 }],
          texts: [],
          slots: [],
        },
      });
      expectClean(
        t,
        await sweep(t, [
          {
            name: 'aide-mémoire des raccourcis',
            hash: MENU,
            prepare: async (page) => {
              await page.keyboard.press('?');
              await modal(page, 'Raccourcis clavier').waitFor();
            },
          },
          {
            name: 'nouveau menu',
            hash: MENU,
            prepare: async (page) => {
              await clickButton(page, 'Nouveau');
              await modal(page, 'Nouveau menu').waitFor();
            },
          },
          {
            name: 'générer une interface',
            hash: MENU,
            prepare: async (page) => {
              await clickButton(page, 'Nouveau');
              await modal(page, 'Nouveau menu').getByRole('button', { name: /Générer une interface/ }).first().click();
              await modal(page, 'Générer une interface').waitFor();
            },
          },
          {
            name: 'générateur de textures',
            hash: MENU,
            prepare: async (page) => {
              await page.locator('.outline .section-actions').getByRole('button', { name: 'Générer', exact: true }).click();
              await modal(page, 'Générer une texture').waitFor();
            },
          },
          {
            name: 'interface par IA',
            hash: MENU,
            prepare: async (page) => {
              await clickButton(page, 'Générer une interface par IA…');
              await modal(page, 'Générer une interface par IA').waitFor();
            },
          },
          {
            name: 'rognage d’une couche',
            hash: '#/editeur/menus/e2e_layout',
            prepare: async (page) => {
              await rightClick(outlineRow(page, 0, 'atlas'));
              await contextItem(page, 'Rogner…').click();
              await page.locator('.crop-dialog').waitFor();
            },
          },
          {
            name: 'renommer le menu',
            hash: MENU,
            prepare: async (page) => {
              await page.locator('.stage').first().click({ button: 'right', position: { x: 6, y: 6 } });
              await contextItem(page, 'Renommer le menu…').click();
              await modal(page, /^Renommer le menu/).waitFor();
            },
          },
        ]),
      );
    },
  },
  {
    name: 'éditeur d’assets',
    async run(t) {
      expectClean(
        t,
        await sweep(t, [
          { name: 'asset, éléments', hash: ASSET },
          { name: 'onglet Bibliothèque', hash: ASSET, prepare: (page) => page.getByRole('tab', { name: 'Bibliothèque', exact: true }).click() },
          { name: 'élément sélectionné', hash: ASSET, prepare: (page) => page.locator('.asset-editor .outline-list .outline-item').first().click() },
          {
            name: 'outil Image',
            hash: ASSET,
            prepare: (page) => page.locator('.asset-toolbar').getByRole('button', { name: 'Image', exact: true }).click(),
          },
          {
            name: 'nouvel asset',
            hash: ASSET,
            prepare: async (page) => {
              await clickButton(page, 'Nouvel asset');
              await modal(page, 'Nouvel asset').waitFor();
            },
          },
        ]),
      );
    },
  },
  {
    name: 'éditeur de pixels',
    async run(t) {
      expectClean(
        t,
        await sweep(t, [
          { name: 'crayon', hash: PIXEL },
          { name: 'pot de peinture', hash: PIXEL, prepare: tool('Pot de peinture') },
          { name: 'rectangle', hash: PIXEL, prepare: tool('Rectangle') },
          { name: 'sélection', hash: PIXEL, prepare: tool('Sélection rectangulaire') },
          { name: 'pipette', hash: PIXEL, prepare: tool('Pipette') },
          {
            name: 'nouvelle image',
            hash: PIXEL,
            prepare: async (page) => {
              await clickButton(page, 'Nouvelle image');
              await modal(page, 'Nouvelle image').waitFor();
            },
          },
          {
            name: 'taille de l’image',
            hash: PIXEL,
            prepare: async (page) => {
              await rightClick(page.locator('canvas.pixel-canvas').first());
              await contextItem(page, 'Taille de l’image…').click();
              await modal(page, 'Taille de l’image').waitFor();
            },
          },
          {
            name: 'texture par IA',
            hash: PIXEL,
            prepare: async (page) => {
              await clickButton(page, 'Générer une texture par IA…');
              await modal(page, 'Générer une texture par IA').waitFor();
            },
          },
        ]),
      );
    },
  },
  {
    name: 'éditeur de formulaires',
    async run(t) {
      await api(t, `/menus/${FORM_ID}`, { method: 'PUT', body: layoutForm() });
      expectClean(
        t,
        await sweep(t, [
          { name: 'formulaire, bouton sélectionné', hash: FORM },
          { name: 'formulaire, aucun bouton sélectionné', hash: FORM, prepare: (page) => page.keyboard.press('Escape') },
          { name: 'formulaire, onglet Bibliothèque', hash: FORM, prepare: libraryTab },
          { name: 'formulaire, mode « Essayer »', hash: FORM, prepare: tryForm },
          { name: 'formulaire, grand écran simulé', hash: FORM, prepare: (page) => page.getByLabel('Taille de l’écran simulé').selectOption('large') },
          { name: 'formulaire, zoom ×3', hash: FORM, prepare: (page) => page.getByLabel('Niveau de zoom').first().selectOption('3') },
          {
            name: 'formulaire, menu contextuel d’un bouton',
            hash: FORM,
            perSize: true,
            keepPointer: true,
            prepare: async (page) => {
              await rightClick(page.locator('.form-editor .form-button-row').first());
              await page.locator('.context-menu').waitFor();
            },
          },
          { name: 'formulaire, infobulle de la barre', hash: FORM, perSize: true, keepPointer: true, settle: 50, prepare: hoverTooltip('Essayer') },
        ]),
      );
    },
  },
  {
    name: 'données extrêmes et états vides',
    async run(t) {
      let seeded = null;
      try {
        await open(t, '#/accueil');
        seeded = await seedStress(t);
        const found = await sweep(t, [
          { name: 'extrême · accueil', hash: '#/accueil' },
          { name: 'extrême · espaces de travail', hash: '#/espaces' },
          { name: 'extrême · bibliothèques', hash: '#/bibliotheques' },
          { name: 'extrême · paramètres', hash: '#/parametres' },
          { name: 'extrême · menu', hash: STRESS_MENU },
          { name: 'extrême · couche sélectionnée', hash: STRESS_MENU, prepare: (page) => outlineRow(page, 0, STRESS.layer(49)).click() },
          {
            name: 'extrême · zone sélectionnée',
            hash: STRESS_MENU,
            prepare: async (page) => {
              await outlineRow(page, 2, STRESS.slot(29)).click();
              await page.locator('.inspector .action-editor').waitFor();
            },
          },
          { name: 'extrême · texte sélectionné', hash: STRESS_MENU, prepare: (page) => outlineRow(page, 1, STRESS.text(1)).click() },
          { name: 'extrême · sélection multiple', hash: STRESS_MENU, prepare: (page) => page.keyboard.press('Control+a') },
          { name: 'extrême · onglet Bibliothèque', hash: STRESS_MENU, prepare: (page) => page.getByRole('tab', { name: 'Bibliothèque', exact: true }).click() },
          {
            name: 'extrême · mode « Essayer »',
            hash: STRESS_MENU,
            prepare: async (page) => {
              await clickButton(page, 'Essayer');
              await page.locator('.try-journal').waitFor();
            },
          },
          {
            name: 'extrême · message d’état',
            hash: STRESS_MENU,
            prepare: async (page) => {
              await outlineRow(page, 0, STRESS.layer(49)).click();
              await page.keyboard.press('ArrowRight');
              await page.keyboard.press('Control+s');
              await page.waitForFunction(() => /enregistr/i.test(document.querySelector('header.toolbar [role="status"]')?.textContent ?? ''));
            },
          },
          {
            name: 'extrême · menu contextuel',
            hash: STRESS_MENU,
            perSize: true,
            keepPointer: true,
            prepare: async (page) => {
              await rightClick(outlineRow(page, 0, STRESS.layer(49)));
              await page.locator('.context-menu').waitFor();
            },
          },
          {
            name: 'extrême · renommer',
            hash: STRESS_MENU,
            prepare: async (page) => {
              await page.locator('.stage').first().click({ button: 'right', position: { x: 6, y: 6 } });
              await contextItem(page, 'Renommer le menu…').click();
              await modal(page, /^Renommer le menu/).waitFor();
            },
          },
          // Formulaires Bedrock : huit dispositions, 30 boutons, textes de 80 caractères, chemins d’icône longs.
          ...FORM_LAYOUTS.map((layout) => ({ name: `extrême · formulaire ${layout}`, hash: `#/editeur/menus/${STRESS.form(layout)}` })),
          {
            name: 'extrême · formulaire, icône du jeu au chemin long',
            hash: STRESS_FORM,
            prepare: (page) => page.locator('.form-editor .form-button-row').nth(1).click(),
          },
          { name: 'extrême · formulaire, onglet Bibliothèque', hash: STRESS_FORM, prepare: libraryTab },
          { name: 'extrême · formulaire, mode « Essayer »', hash: STRESS_FORM, prepare: tryForm },
          { name: 'extrême · paramètres, export Bedrock', hash: '#/parametres', prepare: bedrockSettings },
          { name: 'extrême · asset', hash: `#/editeur/assets/${STRESS.asset}` },
          {
            name: 'extrême · élément d’asset',
            hash: `#/editeur/assets/${STRESS.asset}`,
            prepare: (page) => page.locator('.asset-editor .outline-list .outline-item').last().click(),
          },
          { name: 'extrême · image', hash: `#/editeur/pixels/${STRESS.pixel}` },
        ]);
        // États vides : espace de travail sans aucun document.
        await openEmptyWorkspace(t, seeded);
        found.push(
          ...(await sweep(t, [
            { name: 'vide · accueil', hash: '#/accueil', empty: true },
            { name: 'vide · éditeur de menus', hash: '#/editeur/menus', empty: true },
            { name: 'vide · éditeur d’assets', hash: '#/editeur/assets', empty: true },
            { name: 'vide · éditeur de pixels', hash: '#/editeur/pixels', empty: true },
          ])),
        );
        expectClean(t, found);
      } finally {
        await cleanupStress(t, seeded);
        await restoreWorkspace(t).catch(() => undefined);
      }
    },
  },
];
