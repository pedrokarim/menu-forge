#!/usr/bin/env node
/**
 * Captures d’écran du studio pour le site et le README.
 *
 * 1. Monte un espace de travail de démonstration (`demo-workspace.mjs`) :
 *    uniquement des textures générées ou dessinées par le code du studio et
 *    le logo du projet,
 *    réglages avec `"libraries": []` – aucun asset tiers ne peut apparaître.
 * 2. Lance le backend Rust (`studio-api`, sans Discord) et Vite sur des ports
 *    dédiés, cuit les textures avec le code du studio, puis pilote l’interface
 *    avec Playwright. Les captures de la génération par IA passent par des
 *    fournisseurs **simulés** sur ce poste (un faux Automatic1111 et un faux
 *    Ollama, sur un port libre de 127.0.0.1) : aucun service réel, aucune clé ;
 *    la capture est refusée si une clé est déjà rangée dans le trousseau.
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
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { DEMO_AI, DEMO_ASSETS, DEMO_MENUS, DEMO_PIXELS, DEMO_WORKSPACE_NAME } from './demo-workspace.mjs';

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
/** Dossier « Export vers le plugin » de la démonstration (affiché comme les ressources d’enderium-core). */
const EXPORT_DIR = path.join(WORK_DIR, 'enderium-core', 'resources');
const ONLY = new Set((process.env.MF_ONLY ?? '').split(',').map((name) => name.trim()).filter(Boolean));
const VIEWPORT = { width: 1440, height: 900 };

/** Chemins de la machine remplacés dans les captures par des chemins neutres. */
const PATH_MASKS = [
  [SETTINGS_FILE, 'C:\\Users\\vous\\AppData\\Roaming\\menu-forge\\settings.json'],
  [EXPORT_DIR, 'C:\\Users\\vous\\enderium-core\\core\\src\\main\\resources'],
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

/* ---------- Fournisseurs d’IA simulés ---------- */

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 'ascii');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

/** PNG RGBA minimal : `pixel(x, y)` renvoie `[r, g, b, a]`. */
function encodePng(width, height, pixel) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * stride + 1 + x * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

/** Image « renvoyée par le modèle » : l’émeraude de la démonstration, agrandie, fond clair bruité. */
function fakeModelImage() {
  const { art, colors, background, scale } = DEMO_AI.image;
  if (art.some((row) => row.length !== art.length)) throw new Error('Dessin de l’émeraude : lignes de longueur inégale');
  const rgb = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const size = art.length * scale;
  return encodePng(size, size, (x, y) => {
    const key = art[Math.floor(y / scale)][Math.floor(x / scale)];
    const noise = ((x * 7 + y * 13) % 7) - 3;
    const base = rgb(key === '.' ? background : colors[key]);
    return [...base.map((value) => Math.max(0, Math.min(255, value + noise))), 255];
  }).toString('base64');
}

/**
 * Faux Automatic1111 (images) et faux Ollama (texte) sur 127.0.0.1, port libre.
 * Rien ne sort du poste : le backend du studio les appelle comme de vrais
 * serveurs locaux, et reçoit les réponses de `DEMO_AI`.
 */
async function startFakeProviders() {
  const image = fakeModelImage();
  const reply = (response, value) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (part) => (body += part));
    request.on('end', () => {
      if (request.url === '/sdapi/v1/sd-models') return reply(response, [{ title: 'demo.safetensors' }]);
      if (request.url === '/sdapi/v1/txt2img') return reply(response, { images: [image] });
      if (request.url === '/api/tags') return reply(response, { models: [{ name: 'llama3.2:latest' }] });
      if (request.url === '/api/chat') {
        const { messages } = JSON.parse(body);
        const system = messages[0]?.content ?? '';
        const id = /"id": "([a-z0-9_]+)"/.exec(system)?.[1] ?? 'menu';
        const rows = Number(/"rows": (\d)/.exec(system)?.[1] ?? 6);
        const corrected = messages.some((message) => String(message.content).includes('ne passe pas la validation'));
        const content = JSON.stringify(DEMO_AI.menu(id, rows, corrected));
        return reply(response, { message: { role: 'assistant', content }, done: true });
      }
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('inconnu');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, endpoint: `http://127.0.0.1:${server.address().port}` };
}

/* ---------- Espace de démonstration ---------- */

function prepareWorkDir() {
  rmSync(WORK_DIR, { recursive: true, force: true });
  for (const folder of ['menus', 'assets', 'textures', 'pixels']) mkdirSync(path.join(WORKSPACE_DIR, folder), { recursive: true });
  mkdirSync(path.join(WORK_DIR, 'cache'), { recursive: true });
  mkdirSync(EXPORT_DIR, { recursive: true });
  writeFileSync(path.join(WORK_DIR, 'libraries.json'), '[]\n');
  const settings = {
    version: 1,
    activeWorkspace: WORKSPACE_DIR,
    workspaces: [{ path: WORKSPACE_DIR, name: DEMO_WORKSPACE_NAME, lastOpened: new Date().toISOString() }],
    libraries: [],
    ui: { defaultZoom: 0, showGrid: true, confirmations: { delete: true, discardChanges: true } },
    export: { enderiumResources: EXPORT_DIR, namespace: 'menuforge', packFormat: 46 },
  };
  writeFileSync(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`);
}

/**
 * Écrit menus, assets, images de pixels et textures par l’API, depuis la page :
 * les PNG sont produits par le code du studio (`renderGeneratorBlob`, `renderAsset`,
 * encodeur PNG de l’éditeur de pixels).
 */
async function seedWorkspace(page) {
  await page.evaluate(
    async ({ menus, assets, pixels }) => {
      const generator = await import('/src/model/generator.ts');
      const textureRender = await import('/src/model/textureRender.ts');
      const assetRender = await import('/src/asset/render.ts');
      const pixelDocument = await import('/src/pixel/document.ts');
      const pixelIo = await import('/src/pixel/io.ts');
      const pixelApi = await import('/src/lib/pixelApi.ts');
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
          if (layer.generator) {
            const png = await textureRender.renderGeneratorBlob(layer.generator, layer);
            await put(`/api/textures/${layer.texture.split('/').map(encodeURIComponent).join('/')}`, png, 'image/png');
          }
        }
        await put(`/api/menus/${menu.id}`, JSON.stringify(menu, null, 2), 'application/json');
        await pause();
      }

      // Images de pixels : calques peints au rectangle (ou par le générateur), encodés par le studio.
      for (const image of pixels) {
        const { width, height } = image.size;
        let state = pixelDocument.createState(width, height);
        state = { ...state, layers: [] };
        for (const spec of image.layers) {
          const layer = pixelDocument.createLayer(width, height, state.layers);
          layer.name = spec.name;
          layer.opacity = spec.opacity ?? 100;
          if (spec.generator) {
            const canvas = textureRender.imageToCanvas(textureRender.renderGeneratorImage(spec.generator, { x: 0, y: 0 }));
            layer.data.set(canvas.getContext('2d').getImageData(0, 0, width, height).data);
          }
          for (const [x, y, w, h, color] of spec.rects) {
            const rgb = [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));
            for (let row = y; row < y + h; row++) {
              for (let col = x; col < x + w; col++) layer.data.set([...rgb, 255], (row * width + col) * 4);
            }
          }
          state.layers.push(layer);
        }
        state.activeLayerId = state.layers.at(-1).id;
        const texture = pixelDocument.defaultTexture(image.id);
        await pixelApi.savePixel(await pixelIo.encodeDocument({ id: image.id, name: image.name, texture }, state));
        await put(`/api/textures/${texture}`, await pixelIo.flattenToBlob(state), 'image/png');
        await pause();
      }
    },
    { menus: DEMO_MENUS, assets: DEMO_ASSETS, pixels: DEMO_PIXELS },
  );
}

/* ---------- Pilotage ---------- */

/** Ouvre une adresse du studio dans une page fraîche (l’éditeur ne lit l’adresse qu’au chargement). */
async function open(page, hash) {
  await page.goto('about:blank');
  // Premier chargement : Vite peut encore précompiler ses dépendances.
  await page.goto(`${UI_ORIGIN}/${hash}`, { waitUntil: 'load', timeout: 180_000 });
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
  // Clic dans la barre de titre, vide : le bas de l’accueil porte des cartes de documents.
  await page.locator('body').click({ position: { x: 700, y: 22 } });
  await page.keyboard.press('?');
  await page.locator('.modal').first().waitFor();
  await wait(400);
});

/* ---------- Éditeur de menus : gestes, éditeurs visuels, essai, composants, export ---------- */

/** Ligne de la liste des éléments : section 0 = couches, 1 = textes, 2 = zones de slots. */
const outlineRow = (page, section, name) =>
  page
    .locator('.outline .panel-section')
    .nth(section)
    .locator('.outline-item')
    .filter({ has: page.locator('.outline-name', { hasText: new RegExp(`^${name}$`) }) })
    .first();

/** Zoom fixe de la toile, et point de la page qui correspond au centre d’une case du coffre. */
async function fixedZoom(page, zoom) {
  await page.getByLabel('Niveau de zoom').first().selectOption(String(zoom));
  await wait(400);
  const box = await page.locator('canvas.menu-canvas').boundingBox();
  const at = (x, y) => ({ x: box.x + (32 + x) * zoom, y: box.y + (32 + y) * zoom });
  return { at, cell: (col, row) => at(7 + 18 * col + 9, 17 + 18 * row + 9) };
}

/** Fait défiler la colonne de droite jusqu’à un élément. */
async function scrollSidebarTo(locator, offset = 8) {
  await locator.evaluate((node, shift) => {
    const sidebar = node.closest('.sidebar');
    sidebar.scrollTo({ top: node.getBoundingClientRect().top - sidebar.getBoundingClientRect().top + sidebar.scrollTop - shift });
  }, offset);
  await wait(250);
}

shot('multi-select', 'Sélection multiple et barre d’alignement', async (page) => {
  await open(page, '#/editeur/menus/shop');
  await zoomIn(page);
  const tabs = ['tab_blocks', 'tab_tools', 'tab_food', 'tab_misc'];
  for (const [index, name] of tabs.entries()) {
    await outlineRow(page, 0, name).locator('.outline-name').click(index === 0 ? {} : { modifiers: ['Control'] });
  }
  await page.locator('.inspector .align-bar').first().waitFor();
  await page.mouse.move(700, 880);
  await wait(400);
});

shot('visual-editors', 'Éditeurs visuels des actions et des conditions d’un slot', async (page) => {
  await page.setViewportSize(TALL_VIEWPORT);
  await open(page, '#/editeur/menus/shop');
  await fixedZoom(page, 3);
  await outlineRow(page, 2, 'buy').locator('.outline-name').click();
  await page.locator('.inspector .action-editor').first().waitFor();
  await page.locator('.inspector .condition-editor').first().waitFor();
  await wait(400);
  // Colonne de droite : les actions au clic en haut, puis « Visible si » et « Actif si ».
  await scrollSidebarTo(page.locator('.inspector .action-editor').first(), 12);
  await page.mouse.move(700, 1150);
  await wait(300);
});

shot('try-mode', 'Mode « Essayer » : clics simulés et journal', async (page) => {
  await open(page, '#/editeur/menus/shop');
  const { cell } = await fixedZoom(page, 3);
  await page.getByRole('button', { name: 'Essayer', exact: true }).click();
  await page.locator('.try-journal').waitFor();
  for (const [col, row] of [[1, 0], [8, 5], [8, 5], [4, 4]]) {
    const point = cell(col, row);
    await page.mouse.click(point.x, point.y);
    await wait(250);
  }
  // La confirmation est ouverte (pile de deux menus) : « Oui » lance la commande puis revient.
  const yes = cell(2, 4);
  await page.mouse.click(yes.x, yes.y);
  await wait(250);
  const buy = cell(4, 4);
  await page.mouse.click(buy.x, buy.y);
  await wait(400);
  await page.mouse.move(10, 400);
  await wait(200);
});

shot('components', 'Un composant réutilisable et son instance', async (page) => {
  await open(page, '#/editeur/menus/profile');
  await fixedZoom(page, 3);
  const includes = page.locator('.includes-editor').first();
  await includes.waitFor();
  await scrollSidebarTo(includes, 12);
  await outlineRow(page, 2, 'nav_back').hover();
  await wait(300);
});

shot('export', 'Export vers le plugin et pack ZIP de test', async (page) => {
  // Fenêtre plus large : le message d’export (dossier compris) tient dans la barre d’outils.
  await page.setViewportSize({ width: 1920, height: 1000 });
  await open(page, '#/editeur/menus/shop');
  await zoomIn(page);
  await page.getByRole('button', { name: 'Pack ZIP', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Pack de test écrit' }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Exporter', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Exporté vers le plugin' }).waitFor({ timeout: 30000 });
  // Menu contextuel d’une zone vide de la toile : les deux exports et leurs raccourcis.
  const stage = await page.locator('.stage').first().boundingBox();
  await page.mouse.click(stage.x + stage.width - 60, stage.y + stage.height - 330, { button: 'right' });
  await page.locator('.context-menu').waitFor();
  await page.locator('.context-menu').getByRole('menuitem', { name: /Exporter vers le plugin/ }).hover();
  await wait(400);
});

/* ---------- Éditeur de pixels ---------- */

shot('pixel-editor', 'Éditeur de pixels : une texture d’onglet dessinée en calques', async (page) => {
  await open(page, '#/editeur/pixels/shop_tab_icon');
  const canvas = page.locator('canvas.pixel-canvas');
  await canvas.waitFor({ timeout: 30000 });
  await wait(500);
  await page.keyboard.press('Control+0');
  await wait(300);
  const box = await canvas.boundingBox();
  const zoom = Number(await page.locator('select.pixel-zoom').inputValue());
  const size = 32;
  const ox = Math.round((Math.floor(box.width) - size * zoom) / 2);
  const oy = Math.round((Math.floor(box.height) - size * zoom) / 2);
  const at = (x, y) => ({ x: box.x + ox + (x + 0.5) * zoom, y: box.y + oy + (y + 0.5) * zoom });
  const stroke = async (points) => {
    await page.mouse.move(at(...points[0]).x, at(...points[0]).y);
    await page.mouse.down();
    for (const point of points.slice(1)) await page.mouse.move(at(...point).x, at(...point).y, { steps: 4 });
    await page.mouse.up();
    await wait(80);
  };
  // Petits éclats dorés dessinés au crayon sur le calque « Reflets », en symétrie horizontale.
  const hex = page.getByLabel('Code hexadécimal (#rrggbb ou #rrggbbaa)');
  await hex.fill('#fff6c8');
  await hex.press('Tab');
  await page.keyboard.press('b');
  await page.getByRole('button', { name: 'Symétrie horizontale' }).click();
  await stroke([[4, 4], [4, 6]]);
  await stroke([[3, 5], [5, 5]]);
  await stroke([[6, 26], [6, 27]]);
  await page.mouse.move(at(20, 14).x, at(20, 14).y);
  await wait(300);
});

shot('settings', 'Paramètres', async (page) => {
  await open(page, '#/parametres');
});

/* ---------- Formulaires Bedrock ---------- */

/**
 * Formulaire Bedrock de la démonstration, écrit par l’API au moment de la
 * capture (hors de `DEMO_MENUS` : les tests de bout en bout n’en dépendent
 * pas). Ses icônes sont des textures de l’espace, cuites par le studio.
 */
const DEMO_FORM = {
  formatVersion: 1,
  id: 'hub',
  name: 'Hub du serveur',
  container: { type: 'chest', rows: 6 },
  state: {},
  layers: [],
  form: {
    layout: 'grid',
    title: '§l§6Serveur démo',
    content: '§7Bienvenue, {viewer.name}. Choisis une destination.',
    buttons: [
      { id: 'shop', text: 'Boutique', icon: { texture: 'generated/shop/buy.png' }, onClick: [{ type: 'open', menu: 'shop' }] },
      { id: 'profile', text: 'Profil', icon: { texture: 'brand/logo.png' }, onClick: [{ type: 'open', menu: 'profile' }] },
      {
        id: 'vote',
        text: 'Voter',
        icon: { texture: 'generated/confirmation/yes.png' },
        onClick: [{ type: 'command', command: 'vote', as: 'player' }, { type: 'close' }],
      },
      {
        id: 'admin',
        text: 'Administration',
        icon: { texture: 'generated/shop/tab_blocks_active.png' },
        visibleWhen: { flag: 'viewer.op' },
        onClick: [{ type: 'open', menu: 'confirmation' }],
      },
      { id: 'close', text: 'Fermer', icon: { texture: 'generated/shop/close.png' }, onClick: [{ type: 'close' }] },
    ],
  },
};

/** Écrit le formulaire de démonstration par l’API (sans effet s’il existe déjà tel quel). */
async function putDemoForm(page) {
  await page.evaluate(async (form) => {
    const response = await fetch(`/api/menus/${form.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Menu-Forge': '1' },
      body: JSON.stringify(form, null, 2),
    });
    if (!response.ok) throw new Error(`${form.id} : ${response.status} ${await response.text()}`);
  }, DEMO_FORM);
}

shot('bedrock-form', 'Éditeur de formulaires Bedrock, un bouton sélectionné', async (page) => {
  await open(page, '#/accueil');
  await putDemoForm(page);
  await open(page, `#/editeur/menus/${DEMO_FORM.id}`);
  await page.locator('.form-editor .bf-screen').first().waitFor({ timeout: 30000 });
  await page.locator('.form-editor .form-button-row', { hasText: 'Boutique' }).first().click();
  await page.locator('.form-editor .inspector .icon-current').waitFor();
  await page.mouse.move(5, 600);
  await wait(400);
});

shot('bedrock-layouts', 'Nouveau menu, les huit dispositions des formulaires Bedrock', async (page) => {
  await open(page, '#/editeur/menus/shop');
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
  const modal = page.locator('.modal').first();
  await modal.waitFor();
  const layouts = modal.getByRole('radiogroup', { name: 'Formulaire Bedrock' });
  await layouts.getByRole('radio').first().click();
  await field(modal, 'Nom').fill('Hub du serveur');
  await layouts.evaluate((group) => group.scrollIntoView({ block: 'center' }));
  await page.mouse.move(5, 5);
  await wait(400);
  return modal;
});

/* ---------- Générateur d’interfaces ---------- */

/** Champ d’un dialogue par le texte exact de son libellé (`label.field`). */
const field = (scope, label) =>
  scope
    .locator('label.field')
    .filter({ has: scope.page().locator('.field-label', { hasText: new RegExp(`^${label}$`) }) })
    .locator('input, select, textarea')
    .first();

/** Ouvre le générateur d’interfaces par l’action rapide de l’accueil. */
async function openInterfaceGenerator(page) {
  await open(page, '#/accueil');
  await page.locator('.quick-action', { hasText: 'Générer une interface' }).click();
  const modal = page.locator('.modal').filter({ has: page.locator('.interface-generator') }).first();
  await modal.waitFor({ timeout: 30000 });
  await wait(300);
  return modal;
}

shot('interface-generator', 'Générateur d’interfaces : barre d’onglets en style « sombre à accent »', async (page) => {
  const modal = await openInterfaceGenerator(page);
  await modal.getByRole('radio', { name: 'Barre d’onglets' }).click();
  await field(modal, 'Famille de styles').selectOption('dark');
  await field(modal, 'Nom').fill('Quêtes');
  await wait(500);
  await page.mouse.move(5, 5);
  await wait(200);
  return modal;
});

shot('interface-examples', 'Générateur d’interfaces : galerie d’exemples, vignettes rendues en direct', async (page) => {
  await open(page, '#/accueil');
  await page.getByRole('button', { name: 'Voir les exemples', exact: true }).click();
  const modal = page.locator('.modal').filter({ has: page.locator('.interface-examples') }).first();
  await modal.waitFor({ timeout: 30000 });
  await modal.getByRole('radio', { name: /^Marché,/ }).click();
  // Vignettes dessinées à la demande : on attend toutes celles de la partie visible de la grille.
  await page.waitForFunction(
    () => {
      const grid = document.querySelector('.example-grid')?.getBoundingClientRect();
      if (!grid) return false;
      const visible = [...document.querySelectorAll('.example-card canvas')].filter((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return rect.top < grid.bottom && rect.bottom > grid.top;
      });
      return visible.length > 0 && visible.every((canvas) => canvas.dataset.drawn === 'true');
    },
    null,
    { timeout: 30000 },
  );
  await page.mouse.move(5, 5);
  await wait(300);
  return modal;
});

shot('generated-menu', 'Une boutique générée (style mc-rs), ouverte dans l’éditeur', async (page) => {
  const modal = await openInterfaceGenerator(page);
  await field(modal, 'Nom').fill('Marché');
  await wait(300);
  await modal.getByRole('button', { name: 'Créer le menu' }).click();
  await page.getByRole('status').filter({ hasText: 'créé' }).waitFor({ timeout: 30000 });
  await zoomIn(page);
  await page.mouse.move(700, 880);
  await wait(500);
});

/* ---------- Génération par IA (fournisseurs simulés) ---------- */

/** Adresse du faux serveur local (fixée au lancement). */
let fakeEndpoint = '';

/** Règle un fournisseur par l’API du studio (`enabled`, `endpoint`), depuis la page. */
async function configureAi(page, provider, patch) {
  await page.evaluate(
    async ({ provider: id, patch: value }) => {
      const api = await import('/src/ai/api.ts');
      await api.configureProvider(id, value);
    },
    { provider, patch },
  );
}

/** Refuse la capture si une vraie clé est rangée dans le trousseau (elle n’a rien à faire à l’écran). */
async function assertNoRealKeys(page) {
  const configured = await page.evaluate(async () => {
    const api = await import('/src/ai/api.ts');
    const list = await api.fetchProviders();
    return list.providers.filter((provider) => provider.keyConfigured).map((provider) => provider.id);
  });
  if (configured.length > 0) throw new Error(`clé d’API déjà rangée pour ${configured.join(', ')} : capture refusée`);
}

shot('ai-settings', 'Paramètres, section IA : onze fournisseurs, aucun activé', async (page) => {
  await page.setViewportSize(TALL_VIEWPORT);
  for (const provider of ['automatic1111', 'ollama']) await configureAi(page, provider, { enabled: false, endpoint: null });
  await open(page, '#/parametres');
  await page.locator('.ai-provider').nth(10).waitFor({ timeout: 30000 });
  await assertNoRealKeys(page);
  await page.locator('.ai-provider[data-provider="openai"] summary').click();
  await page.locator('#settings-ai').evaluate((heading) => heading.closest('section').scrollIntoView({ block: 'start' }));
  await page.mouse.move(5, 600);
  await wait(400);
});

shot('ai-texture', '« Générer une texture par IA » : sortie du modèle et texture contrainte', async (page) => {
  await configureAi(page, 'automatic1111', { enabled: true, endpoint: fakeEndpoint });
  await open(page, '#/editeur/pixels/shop_tab_icon');
  await page.locator('canvas.pixel-canvas').waitFor({ timeout: 30000 });
  await assertNoRealKeys(page);
  await page.getByRole('button', { name: 'Générer une texture par IA…' }).first().click();
  const modal = page.locator('.modal').first();
  await modal.waitFor();
  await field(modal, 'Fournisseur').selectOption('automatic1111');
  await field(modal, 'Taille type').selectOption('0');
  await field(modal, 'Palette imposée').selectOption('menu-forge');
  await modal.locator('textarea').fill(DEMO_AI.texturePrompt);
  await modal.getByRole('button', { name: 'Générer', exact: true }).click();
  await page.getByRole('img', { name: 'Texture contrainte' }).waitFor({ timeout: 30000 });
  await page.mouse.move(5, 5);
  await wait(400);
  return modal;
});

shot('ai-interface', '« Générer une interface par IA » : essai refusé, corrigé, validé', async (page) => {
  await configureAi(page, 'ollama', { enabled: true, endpoint: fakeEndpoint });
  await open(page, '#/accueil');
  await assertNoRealKeys(page);
  await page.getByRole('button', { name: 'Générer une interface par IA…', exact: true }).click();
  const modal = page.locator('.modal').first();
  await modal.waitFor({ timeout: 30000 });
  await field(modal, 'Fournisseur').selectOption('ollama');
  await modal.locator('textarea').fill(DEMO_AI.interfacePrompt);
  await field(modal, 'Nom').fill('Marché de nuit');
  await modal.getByRole('button', { name: 'Générer', exact: true }).click();
  await modal.locator('.ai-log li.is-ok').waitFor({ timeout: 30000 });
  await page.mouse.move(5, 5);
  await wait(400);
  return modal;
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
let fakeProviders = null;
const errors = [];

try {
  prepareWorkDir();
  mkdirSync(OUT_DIR, { recursive: true });
  fakeProviders = await startFakeProviders();
  fakeEndpoint = fakeProviders.endpoint;
  log(`fournisseurs d’IA simulés sur ${fakeEndpoint}`);

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
    // Cache des dépendances gardé d'un lancement à l'autre (WORK_DIR est effacé à chaque fois) :
    // sans lui, Vite repart à froid et la première page dépasse les délais.
    cacheDir: path.join(STUDIO_DIR, 'node_modules', '.vite-capture'),
    server: {
      // `studio/node_modules` peut être une jonction (worktree) : on autorise aussi sa cible.
      // `docs/` : le dialogue « Générer une interface » importe `docs/menu.schema.json`.
      fs: { allow: [STUDIO_DIR, path.join(REPO_DIR, 'docs'), realpathSync(path.join(STUDIO_DIR, 'node_modules'))] },
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
  // « Quitter la page ? » (dessin non enregistré) : on quitte ; toute autre question est refusée.
  page.on('dialog', (dialog) => (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()));
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
  fakeProviders?.server.closeAllConnections();
  fakeProviders?.server.close();
  for (const child of children) child.kill();
}

if (errors.length > 0) {
  console.error(`\n${errors.length} erreur(s) :\n  ${errors.join('\n  ')}`);
  process.exitCode = 1;
} else {
  log('terminé, aucune erreur de page');
}
