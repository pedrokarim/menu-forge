/**
 * Formulaires Bedrock : création depuis « Nouveau menu », disposition, bouton
 * avec icône, aperçu, largeur de l’inspecteur et export pour Bedrock. Le
 * dossier d’export Bedrock est un sous-dossier de l’espace temporaire, créé
 * ici et supprimé avec lui ; un export n’est jamais lancé si ce n’est pas le cas.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CheckError, NBSP } from '../lib/harness.mjs';
import { encodePng, paintImage } from '../lib/png.mjs';
import { api, contextItem, inspectorField, modal, open, waitStatus } from '../lib/studio.mjs';

export const title = 'Formulaires Bedrock';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Icône de test, rangée à dessein sous un chemin long (largeur de l’inspecteur). */
const ICON_TEXTURE = 'e2e_icons/very_long_folder_name_for_overflow_checks/another_deep_folder/e2e_coin_icon.png';
const ICON_PNG = encodePng(paintImage(16, 16, [[0, 0, 16, 16, [210, 160, 40, 255]], [4, 4, 8, 8, [250, 220, 90, 255]]]));

const bedrockDir = (t) => path.join(t.env.root, 'bedrock-export');

/** Ouvre un formulaire dans l’éditeur (pas de toile de coffre : on attend l’aperçu). */
async function openForm(t, id) {
  const { page, env } = t;
  await page.goto('about:blank');
  await page.goto(`${env.uiOrigin}/#/editeur/menus/${id}`, { waitUntil: 'load' });
  await page.locator('.rail').first().waitFor({ timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.form-editor .bf-screen').first().waitFor({ timeout: 30_000 });
  await wait(300);
}

/** Menu de l’espace tel qu’enregistré sur le disque (instantané de l’API). */
async function savedMenu(t, id) {
  return (await api(t, '/workspace')).menus.find((menu) => menu.id === id);
}

async function putIconTexture(t) {
  const response = await fetch(`${t.env.apiOrigin}/api/textures/${ICON_TEXTURE}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png', 'X-Menu-Forge': '1' },
    body: ICON_PNG,
  });
  if (!response.ok) throw new Error(`PUT texture : ${response.status} ${await response.text()}`);
}

/** Formulaire écrit par l’API : un bouton avec icône, condition et actions (inspecteur complet). */
async function putIconForm(t, id) {
  await putIconTexture(t);
  await api(t, `/menus/${id}`, {
    method: 'PUT',
    body: {
      formatVersion: 1,
      id,
      name: id,
      container: { type: 'chest', rows: 6 },
      state: {},
      layers: [],
      form: {
        layout: 'grid',
        title: 'E2E icônes',
        content: 'Contenu du formulaire',
        buttons: [
          {
            id: 'coin',
            text: 'Pièce',
            subtitle: 'Sous-titre',
            icon: { texture: ICON_TEXTURE },
            visibleWhen: { flag: 'viewer.op' },
            onClick: [{ type: 'command', command: 'say {viewer.name}', as: 'player' }, { type: 'close' }],
          },
          { id: 'other', text: 'Autre' },
        ],
      },
    },
  });
}

/** Refuse tout export si le dossier Bedrock réglé n’est pas celui de l’espace temporaire. */
async function guardBedrockDir(t) {
  const target = (await api(t, '/settings')).export.bedrockDirectory;
  if (!target || path.resolve(target) !== path.resolve(bedrockDir(t)) || !path.resolve(target).startsWith(path.resolve(t.env.root))) {
    throw new CheckError(`export refusé${NBSP}: dossier Bedrock réglé hors de l’espace temporaire (${target})`);
  }
  t.check(true, 'dossier d’export Bedrock dans l’espace temporaire');
}

/**
 * Débordements de l’inspecteur du formulaire : colonne et inspecteur sans
 * défilement horizontal, chaque contrôle dans la boîte de l’inspecteur, la
 * zone d’aperçu à gauche de la colonne (jamais par-dessus).
 */
function inspectorOverflow(page) {
  return page.evaluate(() => {
    const problems = [];
    const inspector = document.querySelector('.form-editor .inspector');
    if (!inspector) return ['inspecteur absent'];
    const sidebar = inspector.closest('.sidebar');
    const stage = document.querySelector('.form-editor .stage-area');
    if (sidebar.scrollWidth > sidebar.clientWidth + 1) problems.push(`colonne : ${sidebar.scrollWidth} px pour ${sidebar.clientWidth} px`);
    if (inspector.scrollWidth > inspector.clientWidth + 1) problems.push(`inspecteur : ${inspector.scrollWidth} px pour ${inspector.clientWidth} px`);
    const box = inspector.getBoundingClientRect();
    const column = sidebar.getBoundingClientRect();
    if (stage && stage.getBoundingClientRect().right > column.left + 1) problems.push('l’aperçu empiète sur la colonne de droite');
    const controls = inspector.querySelectorAll('input, select, textarea, button, .icon-grid, .icon-current, .icon-path, .field, .visual-block');
    for (const control of controls) {
      const rect = control.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.left < box.left - 1 || rect.right > box.right + 1) {
        const label = control.getAttribute('aria-label') ?? control.textContent?.trim().slice(0, 30) ?? '';
        problems.push(`${control.tagName.toLowerCase()}.${[...control.classList].join('.')} « ${label} » sort de l’inspecteur (${Math.round(rect.left)}–${Math.round(rect.right)} pour ${Math.round(box.left)}–${Math.round(box.right)})`);
      }
    }
    // Textes à la ligne, jamais coupés : aucun élément de l’inspecteur ne rogne son propre contenu.
    const iconPath = inspector.querySelector('.icon-path');
    if (!iconPath) problems.push('chemin de l’icône absent');
    for (const node of inspector.querySelectorAll('*')) {
      const style = getComputedStyle(node);
      if (style.textOverflow === 'ellipsis' && node.scrollWidth > node.clientWidth + 1) problems.push(`texte coupé : « ${node.textContent.trim().slice(0, 30)} »`);
    }
    return problems;
  });
}

/** Les huit dispositions du pack mcrs_ui. */
const LAYOUTS = ['grid', 'left_button', 'bottom_button', 'image_grid', 'square_image', 'motd', 'store', 'wrapped'];
/** Petite fenêtre, taille minimale de l’appli (hauteur utile d’un écran portable), grande fenêtre. */
const SIZES = [
  { width: 1024, height: 600 },
  { width: 1180, height: 668 },
  { width: 1600, height: 900 },
];
/** 80 caractères avec espaces, et 80 sans aucune (aucun point de coupure). */
const LONG_WORDS = 'Un texte de bouton volontairement long, avec des espaces, pour tester la coupure';
const LONG_TOKEN = 'W'.repeat(80);

/** Formulaire aux données extrêmes : titre et textes longs, 30 boutons, icônes à chemin long. */
function extremeForm(id, layout) {
  const buttons = Array.from({ length: 30 }, (_, index) => {
    const button = {
      id: `button_${index}`,
      text: index % 2 === 0 ? LONG_TOKEN : LONG_WORDS,
      subtitle: index % 2 === 0 ? LONG_WORDS : LONG_TOKEN,
    };
    if (index % 3 === 0) button.icon = { texture: ICON_TEXTURE };
    else if (index % 3 === 1) button.icon = { path: `textures/items/${'deep_folder/'.repeat(6)}diamond` };
    if (index === 1) button.role = 'banner';
    if (index === 2) button.role = 'special';
    if (index % 5 === 0) button.onClick = [{ type: 'command', command: `say ${LONG_TOKEN}`, as: 'player' }, { type: 'close' }];
    return button;
  });
  return {
    formatVersion: 1,
    id,
    name: `${LONG_WORDS} ${layout}`,
    container: { type: 'chest', rows: 6 },
    state: {},
    layers: [],
    form: { layout, title: LONG_WORDS, content: `${LONG_TOKEN} ${LONG_WORDS}`, buttons },
  };
}

/** Capture de contrôle visuel, seulement si MF_E2E_SHOTS désigne un dossier (hors dépôt). */
async function shot(page, name) {
  if (!process.env.MF_E2E_SHOTS) return;
  mkdirSync(process.env.MF_E2E_SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(process.env.MF_E2E_SHOTS, `${name}.png`) });
}

/**
 * Éditeur de formulaire dans les deux sens : colonnes sans défilement
 * horizontal mais qui défilent en interne à la verticale, lignes de boutons
 * et outils de l’aperçu dans leur boîte, page sans défilement vertical, barre
 * d’état visible sous l’éditeur.
 */
function editorOverflow(page) {
  return page.evaluate(() => {
    const problems = [];
    const editor = document.querySelector('.form-editor');
    const statusbar = document.querySelector('.statusbar');
    const doc = document.documentElement;
    if (doc.scrollHeight > doc.clientHeight + 1) problems.push(`page : défilement vertical (${doc.scrollHeight} px pour ${doc.clientHeight} px)`);
    const editorBox = editor.getBoundingClientRect();
    const statusBox = statusbar.getBoundingClientRect();
    if (statusBox.bottom > window.innerHeight + 1) problems.push('barre d’état sous le bas de la fenêtre');
    if (editorBox.bottom > statusBox.top + 1) problems.push('éditeur par-dessus la barre d’état');
    const within = (node, box, what) => {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (rect.left < box.left - 1 || rect.right > box.right + 1) {
        problems.push(`${what} « ${(node.textContent ?? '').trim().slice(0, 30)} » dépasse (${Math.round(rect.left)}–${Math.round(rect.right)} pour ${Math.round(box.left)}–${Math.round(box.right)})`);
      }
    };
    for (const sidebar of editor.querySelectorAll(':scope > .sidebar')) {
      const style = getComputedStyle(sidebar);
      if (sidebar.scrollWidth > sidebar.clientWidth + 1) problems.push(`colonne : défilement horizontal (${sidebar.scrollWidth} px pour ${sidebar.clientWidth} px)`);
      if (!['auto', 'scroll'].includes(style.overflowY)) problems.push(`colonne : pas de défilement vertical interne (${style.overflowY})`);
      const box = sidebar.getBoundingClientRect();
      if (box.bottom > editorBox.bottom + 1) problems.push('colonne plus haute que l’éditeur');
      for (const row of sidebar.querySelectorAll('.form-button-row, .section-header, .field, button')) within(row, box, 'élément de colonne');
    }
    // Onglets de la colonne de gauche : le libellé reste dans son bouton (il passe à la ligne).
    for (const tab of editor.querySelectorAll('.sidebar-tabs button')) {
      const rect = tab.getBoundingClientRect();
      if (rect.width === 0) continue;
      const label = tab.querySelector('.tab-label');
      if (!label) problems.push(`onglet « ${tab.textContent.trim()} » sans .tab-label`);
      else {
        const inner = label.getBoundingClientRect();
        if (inner.left < rect.left - 1 || inner.right > rect.right + 1 || inner.bottom > rect.bottom + 1) problems.push(`onglet « ${label.textContent} » : libellé hors du bouton`);
        // Un mot court comme « Bibliothèque » ne se coupe jamais en deux lignes.
        const line = parseFloat(getComputedStyle(label).lineHeight) || parseFloat(getComputedStyle(label).fontSize) * 1.2;
        if (inner.height > line * 1.5) problems.push(`onglet « ${label.textContent} » : libellé coupé sur plusieurs lignes`);
      }
      if (tab.scrollWidth > tab.clientWidth + 1) problems.push(`onglet « ${tab.textContent.trim()} » : contenu plus large que le bouton`);
    }
    const stageArea = editor.querySelector('.stage-area');
    const stageBox = stageArea.getBoundingClientRect();
    for (const tool of stageArea.querySelectorAll('.stage-toolbar > *')) within(tool, stageBox, 'outil de l’aperçu');
    const stage = stageArea.querySelector('.stage');
    if (!['auto', 'scroll'].includes(getComputedStyle(stage).overflowY)) problems.push('aperçu : pas de défilement interne');
    if (stage.getBoundingClientRect().bottom > editorBox.bottom + 1) problems.push('aperçu plus haut que l’éditeur');
    // Écran simulé plus grand que la zone : défilé tout en haut à gauche, il doit commencer dans la zone.
    const screen = stage.querySelector('.bf-screen');
    if (screen) {
      stage.scrollTo(0, 0);
      const screenBox = screen.getBoundingClientRect();
      const box = stage.getBoundingClientRect();
      if (screenBox.left < box.left - 1 || screenBox.top < box.top - 1) problems.push('aperçu coupé à gauche ou en haut, hors d’atteinte du défilement');
    }
    return problems;
  });
}

/** Contrôles qui sortent de la boîte d’un conteneur (à l’horizontale), et conteneur qui déborde lui-même. */
function boxOverflow(locator, selector) {
  return locator.evaluate((root, selector) => {
    const problems = [];
    if (root.scrollWidth > root.clientWidth + 1) problems.push(`conteneur : ${root.scrollWidth} px pour ${root.clientWidth} px`);
    const box = root.getBoundingClientRect();
    for (const node of root.querySelectorAll(selector)) {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || node.closest('[hidden]')) continue;
      if (rect.left < box.left - 1 || rect.right > box.right + 1) problems.push(`${node.tagName.toLowerCase()} « ${(node.textContent ?? '').trim().slice(0, 30)} » dépasse`);
    }
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) problems.push('page : défilement horizontal');
    return problems;
  }, selector);
}

async function inViewport(page, locator) {
  const box = await locator.boundingBox();
  const size = page.viewportSize();
  return box !== null && box.x >= -1 && box.y >= -1 && box.x + box.width <= size.width + 1 && box.y + box.height <= size.height + 1;
}

export const tests = [
  {
    name: 'créer un formulaire et changer de disposition',
    async run(t) {
      const { page } = t;
      await open(t, '#/editeur/menus/shop');
      await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
      const dialog = modal(page, 'Nouveau menu');
      await dialog.waitFor();
      const layouts = dialog.getByRole('radiogroup', { name: 'Formulaire Bedrock' }).getByRole('radio');
      t.equal(await layouts.count(), 8, 'huit dispositions proposées');
      const grid = layouts.first();
      t.check((await grid.textContent()).startsWith('Grille'), 'première disposition : la grille');
      await grid.click();
      t.equal(await grid.getAttribute('aria-checked'), 'true', 'disposition choisie');
      t.check((await dialog.getByLabel('Lignes du coffre').count()) === 0, 'pas de nombre de lignes pour un formulaire');
      await inspectorField(page, 'Nom', '.modal').fill('E2E formulaire');
      await dialog.getByRole('button', { name: 'Créer', exact: true }).click();
      await page.locator('.form-editor .bf-screen').first().waitFor();
      t.check(await page.locator('.form-editor .bf-press').count() > 0, 'aperçu : boutons de départ');
      await t.waitFor(async () => (await page.locator('.statusbar').first().textContent()).includes('formulaire Bedrock'), 'barre d’état : formulaire Bedrock');
      const created = await savedMenu(t, 'e2e_formulaire');
      t.equal(created?.form?.layout, 'grid', 'formulaire enregistré, disposition « grid »');

      await inspectorField(page, 'Disposition', '.form-editor .sidebar').selectOption('left_button');
      await t.waitFor(async () => (await page.locator('.statusbar').first().textContent()).includes('left_button'), 'barre d’état : left_button');
      await t.waitFor(async () => (await page.locator('.form-editor .bf-list-button').count()) > 0, 'aperçu : boutons en liste');
      await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await t.waitFor(async () => (await savedMenu(t, 'e2e_formulaire'))?.form?.layout === 'left_button', 'disposition enregistrée');
    },
  },
  {
    name: 'ajouter un bouton avec icône, aperçu',
    async run(t) {
      const { page } = t;
      await putIconTexture(t);
      await api(t, '/menus/e2e_icons', {
        method: 'PUT',
        body: {
          formatVersion: 1,
          id: 'e2e_icons',
          name: 'E2E icônes',
          container: { type: 'chest', rows: 6 },
          state: {},
          layers: [],
          form: { layout: 'grid', title: 'E2E icônes', content: '', buttons: [{ id: 'first', text: 'Premier' }] },
        },
      });
      await openForm(t, 'e2e_icons');
      t.equal(await page.locator('.form-editor .form-button-row').count(), 1, 'un bouton au départ');
      await page.locator('.form-editor .sidebar').first().getByRole('button', { name: 'Ajouter', exact: true }).click();
      await contextItem(page, 'Bouton').click();
      await t.waitFor(async () => (await page.locator('.form-editor .form-button-row').count()) === 2, 'bouton ajouté à la liste');
      const selected = page.locator('.form-editor .form-button-row.is-selected');
      t.equal(await selected.count(), 1, 'nouveau bouton sélectionné');

      await inspectorField(page, 'Texte', '.form-editor .inspector').fill('Boutique e2e');
      await page.locator('.form-editor .icon-picker input[type="search"]').fill('e2e_coin');
      await page.locator('.form-editor .icon-grid button').first().click();
      await t.waitFor(async () => (await page.locator('.form-editor .icon-current').textContent()).includes('e2e_coin_icon.png'), 'icône choisie : nom du fichier affiché');
      const preview = page.locator('.form-editor .bf-press[data-selected]');
      await t.waitFor(async () => (await preview.textContent()).includes('Boutique e2e'), 'aperçu : texte du bouton');
      await t.waitFor(async () => ((await preview.locator('img.bf-image').getAttribute('src')) ?? '').includes('e2e_coin_icon'), 'aperçu : icône du bouton');
      t.equal(await page.locator('.form-editor .bf-press').count(), 2, 'aperçu : deux boutons');

      await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await t.waitFor(async () => {
        const saved = await savedMenu(t, 'e2e_icons');
        const button = saved?.form?.buttons.find((candidate) => candidate.text === 'Boutique e2e');
        return button?.icon?.texture === ICON_TEXTURE;
      }, 'bouton et icône enregistrés');
    },
  },
  {
    name: 'inspecteur sans débordement (1024, 1280, 1600 px)',
    async run(t) {
      const { page } = t;
      await putIconForm(t, 'e2e_overflow');
      for (const width of [1024, 1280, 1600]) {
        await page.setViewportSize({ width, height: 900 });
        await openForm(t, 'e2e_overflow');
        await page.locator('.form-editor .inspector .icon-current').first().waitFor();
        t.equal(await inspectorOverflow(page), [], `inspecteur à ${width} px`);
      }
    },
  },
  {
    name: 'données extrêmes : 8 dispositions × 3 tailles',
    async run(t) {
      const { page } = t;
      await putIconTexture(t);
      for (const layout of LAYOUTS) {
        await api(t, `/menus/e2e_extreme_${layout}`, { method: 'PUT', body: extremeForm(`e2e_extreme_${layout}`, layout) });
      }
      for (const size of SIZES) {
        await page.setViewportSize(size);
        for (const layout of LAYOUTS) {
          await openForm(t, `e2e_extreme_${layout}`);
          await page.locator('.form-editor .inspector .icon-current').first().waitFor();
          const label = `${layout} à ${size.width} × ${size.height}`;
          t.equal(await inspectorOverflow(page), [], `inspecteur, ${label}`);
          t.equal(await editorOverflow(page), [], `colonnes, aperçu et barre d’état, ${label}`);
          // Titre de 80 caractères sur une ligne : coupé par l’écran, donc signalé (jamais une coupure muette).
          await t.waitFor(() => page.locator('.form-editor .sidebar .warning', { hasText: 'Titre tronqué en jeu' }).isVisible(), `avertissement du titre tronqué, ${label}`);
          await t.waitFor(() => page.locator('.form-editor .form-fit-count').isVisible(), `compteur des textes tronqués, ${label}`);
          if (layout === 'grid') {
            await t.waitFor(() => page.locator('.form-editor .inspector .warning', { hasText: 'Texte tronqué en jeu' }).isVisible(), `avertissement du texte sans espace, ${label}`);
          }
          // Bas de la colonne de droite atteint par son défilement interne : rien n’est hors d’atteinte.
          await page.locator('.form-editor > .sidebar').last().evaluate((node) => node.scrollTo(0, node.scrollHeight));
          t.equal(await editorOverflow(page), [], `colonne de droite défilée jusqu’en bas, ${label}`);
          await shot(page, `form-${layout}-${size.width}x${size.height}`);
        }
      }
    },
  },
  {
    name: 'aperçu entièrement visible : 3 écrans simulés × 3 tailles',
    async run(t) {
      const { page } = t;
      await putIconForm(t, 'e2e_screens');
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await openForm(t, 'e2e_screens');
        for (const screenId of ['pc', 'large', 'small']) {
          await page.getByLabel('Taille de l’écran simulé').selectOption(screenId);
          await t.wait(250);
          const inside = await page.evaluate(() => {
            const stage = document.querySelector('.form-editor .form-stage').getBoundingClientRect();
            const screen = document.querySelector('.form-editor .bf-screen').getBoundingClientRect();
            return screen.left >= stage.left - 1 && screen.right <= stage.right + 1 && screen.top >= stage.top - 1 && screen.bottom <= stage.bottom + 1;
          });
          t.check(inside, `écran « ${screenId} » entier dans la zone à ${size.width} × ${size.height}`);
          await shot(page, `screen-${screenId}-${size.width}x${size.height}`);
        }
        t.equal(await page.locator('.form-editor .warning', { hasText: 'tronqué' }).count(), 0, `textes courts : aucun avertissement à ${size.width} × ${size.height}`);
      }
    },
  },
  {
    name: 'réglages Bedrock et « Nouveau menu » : 3 tailles',
    async run(t) {
      const { page } = t;
      // Chemin profond : répété en entier sous le champ, à la ligne (créé dans l’espace temporaire).
      const longDir = path.join(t.env.root, 'un_dossier_de_serveur_bedrock_au_nom_particulierement_long', 'sous_dossier_encore_plus_profond_pour_le_test', 'menu_forge', 'export');
      mkdirSync(longDir, { recursive: true });
      await open(t, '#/parametres');
      const input = page.getByLabel('Dossier d’export Bedrock', { exact: true });
      await input.fill(longDir);
      await input.press('Enter');
      await t.waitFor(async () => (await api(t, '/settings')).export.bedrockDirectory === longDir, 'chemin Bedrock profond enregistré');
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await open(t, '#/parametres');
        const section = page.locator('section[aria-labelledby="settings-bedrock"]');
        await section.scrollIntoViewIfNeeded();
        t.equal(await section.locator('.setting-path').textContent(), longDir, `chemin répété en entier à ${size.width} × ${size.height}`);
        t.equal(await boxOverflow(section, 'input, button, code, p, .setting-path'), [], `réglages Bedrock à ${size.width} × ${size.height}`);
        await shot(page, `settings-bedrock-${size.width}x${size.height}`);

        await open(t, '#/editeur/menus/shop');
        await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
        const dialog = modal(page, 'Nouveau menu');
        await dialog.waitFor();
        const create = dialog.getByRole('button', { name: 'Créer', exact: true });
        t.check(await create.isVisible(), `« Créer » visible à ${size.width} × ${size.height}`);
        t.equal(await boxOverflow(dialog, 'button, input, select, p'), [], `« Nouveau menu » à ${size.width} × ${size.height}`);
        t.equal(await inViewport(page, dialog), true, `« Nouveau menu » dans la fenêtre à ${size.width} × ${size.height}`);
        await shot(page, `new-menu-${size.width}x${size.height}`);
        await page.keyboard.press('Escape');
      }
    },
  },
  {
    name: 'export Bedrock vers un dossier temporaire',
    async run(t) {
      const { page } = t;
      mkdirSync(bedrockDir(t), { recursive: true });
      await open(t, '#/parametres');
      const field = page.getByLabel('Dossier d’export Bedrock', { exact: true });
      await field.fill(bedrockDir(t));
      await field.press('Enter');
      await t.waitFor(async () => (await api(t, '/settings')).export.bedrockDirectory === bedrockDir(t), 'dossier Bedrock enregistré dans les réglages');
      await guardBedrockDir(t);

      await openForm(t, 'e2e_icons');
      await page.locator('header.toolbar').getByRole('button', { name: 'Bedrock', exact: true }).click();
      await waitStatus(t, 'Exporté pour Bedrock', 'export Bedrock terminé');
      await waitStatus(t, bedrockDir(t), 'message : dossier d’export Bedrock');

      const runtimeFile = path.join(bedrockDir(t), 'runtime.json');
      t.check(existsSync(runtimeFile), 'runtime.json écrit');
      t.check(existsSync(path.join(bedrockDir(t), 'pack', 'manifest.json')), 'manifeste du pack écrit');
      const runtime = JSON.parse(readFileSync(runtimeFile, 'utf8'));
      const form = (runtime.forms ?? []).find((candidate) => candidate.id === 'e2e_icons');
      t.check(form, 'formulaire « e2e_icons » dans runtime.json');
      t.equal([form.layout, form.flag], ['grid', '§m§a'], 'disposition et drapeau');
      const button = form.buttons.find((candidate) => candidate.text.startsWith('Boutique e2e'));
      const iconPath = `textures/menu_forge/icons/${ICON_TEXTURE.replace(/\.png$/u, '')}`;
      t.equal(button?.image, { type: 'path', data: iconPath }, 'icône citée dans le pack Menu Forge');
      const copied = path.join(bedrockDir(t), 'pack', 'textures', 'menu_forge', 'icons', ...ICON_TEXTURE.split('/'));
      t.check(existsSync(copied), 'icône copiée dans le pack');
      t.check(readFileSync(copied).equals(ICON_PNG), 'icône copiée telle quelle, octet pour octet');
      t.check(!(runtime.menus ?? []).some((menu) => menu.id === 'e2e_icons'), 'le formulaire n’est pas exporté comme menu coffre');
    },
  },
];
