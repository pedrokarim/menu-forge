#!/usr/bin/env node
/**
 * Captures d’écran du studio pour le site et le README.
 *
 * 1. Monte un espace de travail de démonstration (`demo-workspace.mjs`) :
 *    uniquement des textures générées par le studio et le logo du projet,
 *    réglages avec `"libraries": []` – aucun asset tiers ne peut apparaître.
 * 2. Lance le backend Rust (`studio-api`, sans Discord) et Vite sur des ports
 *    dédiés, cuit les textures avec le code du studio, puis pilote l’interface
 *    avec Playwright.
 * 3. Écrit les PNG dans `site/assets/screens/` en masquant les chemins de la
 *    machine, puis les optimise (Pillow, si Python est disponible).
 *
 * Depuis `site/` : `npm install`, puis `npm run capture`. Prérequis : les
 * dépendances du studio installées (`studio/node_modules`) et Rust (le backend
 * est compilé s’il manque).
 *
 * Variables d’environnement :
 *   MF_UI_PORT, MF_API_PORT  ports de Vite et de l’API (5221 et 5222)
 *   MF_CAPTURE_DIR           dossier de travail, vidé à chaque lancement
 *                            (défaut : <temp>/menu-forge-capture)
 *   MF_ONLY                  captures à produire, séparées par des virgules
 *   MF_BROWSER_CHANNEL       navigateur installé à utiliser (msedge, chrome…)
 *   PLAYWRIGHT_DIR           dossier node_modules où trouver playwright ou
 *                            playwright-core (sinon, résolution normale)
 *   MF_KEEP_RAW=1            ne pas optimiser les PNG
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEMO_ASSETS, DEMO_MENUS, DEMO_WORKSPACE_NAME } from './demo-workspace.mjs';

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DIR = path.resolve(SITE_DIR, '..');
const STUDIO_DIR = path.join(REPO_DIR, 'studio');
const OUT_DIR = path.join(SITE_DIR, 'assets', 'screens');

const UI_PORT = Number(process.env.MF_UI_PORT ?? 5221);
const API_PORT = Number(process.env.MF_API_PORT ?? 5222);
const UI_ORIGIN = `http://localhost:${UI_PORT}`;
const WORK_DIR = path.resolve(process.env.MF_CAPTURE_DIR ?? path.join(os.tmpdir(), 'menu-forge-capture'));
const WORKSPACE_DIR = path.join(WORK_DIR, DEMO_WORKSPACE_NAME);
const SETTINGS_FILE = path.join(WORK_DIR, 'settings.json');
const ONLY = new Set((process.env.MF_ONLY ?? '').split(',').map((name) => name.trim()).filter(Boolean));
const VIEWPORT = { width: 1440, height: 900 };

/** Chemins de la machine remplacés dans les captures par des chemins neutres. */
const PATH_MASKS = [
  [SETTINGS_FILE, 'C:\\Users\\vous\\AppData\\Roaming\\menu-forge\\settings.json'],
  [WORKSPACE_DIR, 'C:\\Users\\vous\\Documents\\serveur-demo'],
  [WORK_DIR, 'C:\\Users\\vous\\Documents'],
].flatMap(([real, shown]) => [
  [real, shown],
  [real.replaceAll('\\', '/'), shown.replaceAll('\\', '/')],
]);

const log = (...parts) => console.log('•', ...parts);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- Outils ---------- */

/** Importe le point d’entrée ESM d’un paquet installé dans `studio/node_modules`. */
async function importStudioPackage(name) {
  const packageDir = path.join(STUDIO_DIR, 'node_modules', ...name.split('/'));
  const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  let entry = manifest.exports?.['.'] ?? manifest.module ?? manifest.main;
  while (entry && typeof entry === 'object') entry = entry.import ?? entry.default ?? entry.node;
  if (typeof entry !== 'string') throw new Error(`Point d’entrée introuvable pour ${name}`);
  return import(pathToFileURL(path.join(packageDir, entry)).href);
}

/** Playwright (ou playwright-core), depuis PLAYWRIGHT_DIR ou les dépendances du site. */
async function loadChromium() {
  const candidates = ['playwright', 'playwright-core'];
  const resolvers = [];
  if (process.env.PLAYWRIGHT_DIR) resolvers.push(createRequire(path.join(path.resolve(process.env.PLAYWRIGHT_DIR), 'noop.js')));
  resolvers.push(createRequire(path.join(SITE_DIR, 'package.json')));
  for (const resolver of resolvers) {
    for (const name of candidates) {
      try {
        const module = await import(pathToFileURL(resolver.resolve(name)).href);
        const chromium = module.chromium ?? module.default?.chromium;
        if (chromium) return chromium;
      } catch {
        // Paquet absent de ce dossier : on essaie le suivant.
      }
    }
  }
  throw new Error('Playwright introuvable : lancer `npm install` dans site/ ou définir PLAYWRIGHT_DIR.');
}

async function launchBrowser(chromium) {
  const channel = process.env.MF_BROWSER_CHANNEL;
  if (channel) return chromium.launch({ channel });
  try {
    return await chromium.launch();
  } catch (error) {
    // Navigateurs de Playwright non téléchargés : repli sur Edge, présent sous Windows.
    log('Chromium de Playwright indisponible, essai avec Edge :', error.message.split('\n')[0]);
    return chromium.launch({ channel: 'msedge' });
  }
}

function studioApiBinary() {
  const binary = path.join(STUDIO_DIR, 'backend', 'target', 'release', process.platform === 'win32' ? 'studio-api.exe' : 'studio-api');
  if (!existsSync(binary)) {
    log('compilation de studio-api (cargo build --release)…');
    const result = spawnSync(
      'cargo',
      ['build', '--release', '--manifest-path', path.join(STUDIO_DIR, 'backend', 'Cargo.toml'), '--bin', 'studio-api'],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) throw new Error('Échec de la compilation de studio-api');
  }
  return binary;
}

async function waitForApi() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${API_PORT}/api/app`);
      if (response.ok) return;
    } catch {
      // Pas encore prêt.
    }
    await wait(150);
  }
  throw new Error(`studio-api ne répond pas sur le port ${API_PORT}`);
}

/* ---------- Espace de démonstration ---------- */

function prepareWorkDir() {
  rmSync(WORK_DIR, { recursive: true, force: true });
  for (const folder of ['menus', 'assets', 'textures']) mkdirSync(path.join(WORKSPACE_DIR, folder), { recursive: true });
  mkdirSync(path.join(WORK_DIR, 'cache'), { recursive: true });
  writeFileSync(path.join(WORK_DIR, 'libraries.json'), '[]\n');
  const settings = {
    version: 1,
    activeWorkspace: WORKSPACE_DIR,
    workspaces: [{ path: WORKSPACE_DIR, name: DEMO_WORKSPACE_NAME, lastOpened: new Date().toISOString() }],
    libraries: [],
    ui: { defaultZoom: 0, showGrid: true, confirmations: { delete: true, discardChanges: true } },
    export: { enderiumResources: null, namespace: 'menuforge', packFormat: 46 },
  };
  writeFileSync(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`);
}

/**
 * Écrit menus, assets et textures par l’API, depuis la page : les PNG sont
 * produits par le code du studio (`renderGenerator`, `renderAsset`).
 */
async function seedWorkspace(page) {
  await page.evaluate(
    async ({ menus, assets }) => {
      const generator = await import('/src/model/generator.ts');
      const assetRender = await import('/src/asset/render.ts');
      const pause = () => new Promise((resolve) => setTimeout(resolve, 40));
      const put = async (url, body, type) => {
        const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': type, 'X-Menu-Forge': '1' }, body });
        if (!response.ok) throw new Error(`${url} : ${response.status} ${await response.text()}`);
      };
      const putTexture = async (texture, canvas) =>
        put(`/api/textures/${texture.split('/').map(encodeURIComponent).join('/')}`, await generator.canvasToBlob(canvas), 'image/png');

      // Logo du projet (24 × 24, dessiné au pixel) comme texture de l’espace.
      const logo = new Image();
      logo.src = '/brand/logo.svg';
      await logo.decode();
      const logoCanvas = document.createElement('canvas');
      logoCanvas.width = 24;
      logoCanvas.height = 24;
      logoCanvas.getContext('2d').drawImage(logo, 0, 0, 24, 24);
      await putTexture('brand/logo.png', logoCanvas);

      for (const asset of assets) {
        await put(`/api/assets/${asset.id}`, JSON.stringify(asset, null, 2), 'application/json');
        await putTexture(`assets/${asset.id}.png`, await assetRender.renderAsset(asset));
        await pause();
      }
      for (const menu of menus) {
        for (const layer of menu.layers) {
          if (layer.generator) await putTexture(layer.texture, generator.renderGenerator(layer.generator, layer));
        }
        await put(`/api/menus/${menu.id}`, JSON.stringify(menu, null, 2), 'application/json');
        await pause();
      }
    },
    { menus: DEMO_MENUS, assets: DEMO_ASSETS },
  );
}

/* ---------- Pilotage ---------- */

/** Ouvre une adresse du studio dans une page fraîche (l’éditeur ne lit l’adresse qu’au chargement). */
async function open(page, hash) {
  await page.goto('about:blank');
  await page.goto(`${UI_ORIGIN}/${hash}`, { waitUntil: 'load' });
  await page.locator('.rail').first().waitFor({ timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await wait(700);
}

/** Remplace les chemins de la machine par des chemins neutres, partout dans la page. */
async function maskPaths(page) {
  await page.evaluate((masks) => {
    const apply = (value) => masks.reduce((text, [real, shown]) => text.split(real).join(shown), value);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const next = apply(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    }
    for (const element of document.querySelectorAll('input, textarea')) {
      const next = apply(element.value);
      if (next !== element.value) element.value = next;
    }
    for (const element of document.querySelectorAll('[title], [aria-label], [placeholder]')) {
      for (const name of ['title', 'aria-label', 'placeholder']) {
        const value = element.getAttribute(name);
        if (value && apply(value) !== value) element.setAttribute(name, apply(value));
      }
    }
  }, PATH_MASKS);
}

const shots = [];
/** Déclare une capture : `run` prépare la page et renvoie l’élément à capturer (ou rien pour la fenêtre). */
function shot(name, description, run) {
  shots.push({ name, description, run });
}

shot('home', 'Accueil : actions rapides et documents récents', async (page) => {
  await open(page, '#/accueil');
});

/** Bouton « + » du zoom de la toile. */
const zoomInButton = (page) => page.locator('.stage-toolbar-end button').last();

async function zoomIn(page) {
  await zoomInButton(page).click();
  await wait(300);
}

/** Masque les zones de slots : la toile montre alors le menu tel qu’il sera en jeu. */
async function hideZones(page) {
  await page.getByRole('checkbox', { name: 'Zones', exact: true }).uncheck();
  await wait(200);
}

shot('menu-editor', 'Éditeur de menus : la boutique, un slot sélectionné', async (page) => {
  await open(page, '#/editeur/menus/shop');
  await zoomIn(page);
  await page.locator('.outline-list li', { hasText: 'buy' }).last().click();
  await wait(300);
  // Infobulle Deepslate sur le zoom de la toile.
  await zoomInButton(page).hover();
  await wait(1200);
});

shot('modal-editor', 'Éditeur de menus : une modale de confirmation', async (page) => {
  await open(page, '#/editeur/menus/confirmation');
  await zoomIn(page);
  await page.locator('.outline-list li', { hasText: 'yes' }).last().click();
  await wait(300);
});

/** Hauteur de fenêtre des gros plans : le zoom « Ajuster » passe à ×3 et centre le coffre. */
const TALL_VIEWPORT = { width: 1440, height: 1180 };
const CLOSE_UP_ZOOM = 3;

/**
 * Rectangle de la fenêtre du coffre (176 × (114 + 18 × lignes) px) sur la page,
 * en zoom « Ajuster » : centrée dans la toile.
 */
async function chestWindow(page, rows) {
  const stage = await page.locator('.stage').first().boundingBox();
  const width = 176 * CLOSE_UP_ZOOM;
  const height = (114 + 18 * rows) * CLOSE_UP_ZOOM;
  return { x: stage.x + (stage.width - width) / 2, y: stage.y + (stage.height - height) / 2, width, height };
}

async function openCloseUp(page, hash) {
  await page.setViewportSize(TALL_VIEWPORT);
  await open(page, hash);
  const zoom = await page.locator('.stage-toolbar-end select').first().inputValue().catch(() => 'fit');
  if (zoom !== 'fit') throw new Error(`zoom inattendu : ${zoom}`);
  await hideZones(page);
}

shot('menu-canvas', 'Gros plan : le menu tel qu’il sera en jeu', async (page) => {
  await openCloseUp(page, '#/editeur/menus/shop');
  const chest = await chestWindow(page, 6);
  const margin = 24;
  return {
    clip: {
      x: Math.round(chest.x - margin),
      y: Math.round(chest.y - margin),
      width: Math.round(chest.width + 2 * margin),
      height: Math.round(chest.height + 2 * margin),
    },
  };
});

shot('title-composition', 'Gros plan : la toile et le titre composé, jeton par jeton', async (page) => {
  await openCloseUp(page, '#/editeur/menus/shop');
  const section = page.locator('.panel-section', { has: page.locator('h3', { hasText: 'Titre composé' }) }).first();
  await section.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await wait(300);
  const chest = await chestWindow(page, 6);
  const sidebar = await page.locator('aside.sidebar').last().boundingBox();
  const header = await section.locator('.section-header').boundingBox();
  const left = chest.x - 32;
  const top = Math.max(sidebar.y, Math.min(chest.y - 24, header.y - 8));
  const bottom = Math.min(sidebar.y + sidebar.height, chest.y + chest.height + 24);
  return {
    clip: {
      x: Math.round(left),
      y: Math.round(top),
      width: Math.round(sidebar.x + sidebar.width - left),
      height: Math.round(bottom - top),
    },
  };
});

shot('texture-generator', 'Gros plan : le générateur de textures', async (page) => {
  await open(page, '#/editeur/menus/shop');
  await page.locator('.outline .section-actions button').first().click();
  const modal = page.locator('.modal').first();
  await modal.waitFor();
  await modal.getByRole('checkbox', { name: 'Dessiner des cellules de slots' }).check();
  await wait(500);
  return modal;
});

shot('asset-editor', 'Éditeur d’assets (mode libre) : un encart d’aide', async (page) => {
  await open(page, '#/editeur/assets/help_banner');
});

shot('shortcuts', 'Aide-mémoire des raccourcis', async (page) => {
  await open(page, '#/accueil');
  await page.locator('body').click({ position: { x: 700, y: 880 } });
  await page.keyboard.press('?');
  await page.locator('.modal').first().waitFor();
  await wait(400);
});

shot('settings', 'Paramètres', async (page) => {
  await open(page, '#/parametres');
});

/* ---------- Optimisation ---------- */

/** Réduit les PNG à une palette de 256 couleurs (Pillow), s’ils y gagnent. */
function optimize(files) {
  if (process.env.MF_KEEP_RAW) return;
  const script = [
    'import os, sys',
    'from PIL import Image',
    'for path in sys.argv[1:]:',
    '    before = os.path.getsize(path)',
    '    image = Image.open(path).convert("RGB")',
    '    quantized = image.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)',
    '    temporary = path + ".tmp.png"',
    '    quantized.save(temporary, optimize=True)',
    '    if os.path.getsize(temporary) < before:',
    '        os.replace(temporary, path)',
    '    else:',
    '        os.remove(temporary)',
  ].join('\n');
  for (const python of ['python', 'python3', 'py']) {
    const result = spawnSync(python, ['-c', script, ...files], { stdio: 'inherit' });
    if (result.status === 0) return;
  }
  log('optimisation ignorée : Python ou Pillow introuvable');
}

/* ---------- Programme ---------- */

const children = [];
let vite = null;
let browser = null;
const errors = [];

try {
  prepareWorkDir();
  mkdirSync(OUT_DIR, { recursive: true });

  const api = spawn(
    studioApiBinary(),
    [
      '--port', String(API_PORT),
      '--settings', SETTINGS_FILE,
      '--workspace', WORKSPACE_DIR,
      '--libraries', path.join(WORK_DIR, 'libraries.json'),
      '--cache', path.join(WORK_DIR, 'cache'),
      '--studio-dir', STUDIO_DIR,
      '--no-discord',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  children.push(api);
  api.stderr.on('data', (chunk) => process.env.MF_VERBOSE && process.stderr.write(chunk));
  log(`studio-api lancé (PID ${api.pid}) sur ${API_PORT}`);

  const { createServer } = await importStudioPackage('vite');
  const { default: react } = await importStudioPackage('@vitejs/plugin-react');
  vite = await createServer({
    configFile: false,
    root: STUDIO_DIR,
    plugins: [react()],
    logLevel: 'warn',
    clearScreen: false,
    cacheDir: path.join(WORK_DIR, 'vite'),
    server: {
      // `studio/node_modules` peut être une jonction (worktree) : on autorise aussi sa cible.
      fs: { allow: [STUDIO_DIR, realpathSync(path.join(STUDIO_DIR, 'node_modules'))] },
      host: 'localhost',
      port: UI_PORT,
      strictPort: true,
      proxy: { '/api': { target: `http://127.0.0.1:${API_PORT}` } },
    },
  });
  await vite.listen();
  log(`Vite prêt sur ${UI_ORIGIN}`);
  await waitForApi();

  browser = await launchBrowser(await loadChromium());
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: 'dark', locale: 'fr-FR' });
  const page = await context.newPage();
  page.on('dialog', (dialog) => dialog.dismiss());
  page.on('pageerror', (error) => errors.push(`pageerror : ${error.message}`));
  page.on('console', (message) => {
    // Les ressources introuvables sont signalées avec leur adresse ci-dessous.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(`console : ${message.text()}`);
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    // Sans bibliothèque branchée, la police vanilla est introuvable : c’est voulu (aucun asset de Mojang).
    if (response.status() >= 400 && !url.pathname.startsWith('/api/libraries/')) {
      errors.push(`${response.status()} : ${url.pathname}`);
    }
  });

  await open(page, '#/accueil');
  await seedWorkspace(page);
  log(`espace de démonstration prêt : ${DEMO_MENUS.length} menus, ${DEMO_ASSETS.length} assets`);

  const written = [];
  for (const { name, description, run } of shots) {
    if (ONLY.size > 0 && !ONLY.has(name)) continue;
    const file = path.join(OUT_DIR, `${name}.png`);
    try {
      const target = await run(page);
      await maskPaths(page);
      await wait(150);
      if (target?.clip) await page.screenshot({ path: file, clip: target.clip });
      else if (target) await target.screenshot({ path: file });
      else await page.screenshot({ path: file });
      written.push(file);
      log(`${name}.png – ${description}`);
    } catch (error) {
      errors.push(`${name} : ${error.message.split('\n')[0]}`);
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.setViewportSize(VIEWPORT);
  }

  optimize(written);
  for (const file of written) log(`${path.relative(REPO_DIR, file)} : ${Math.round(statSync(file).size / 1024)} Ko`);
} catch (error) {
  errors.push(error.message);
} finally {
  await browser?.close().catch(() => {});
  await vite?.close().catch(() => {});
  for (const child of children) child.kill();
}

if (errors.length > 0) {
  console.error(`\n${errors.length} erreur(s) :\n  ${errors.join('\n  ')}`);
  process.exitCode = 1;
} else {
  log('terminé, aucune erreur de page');
}
