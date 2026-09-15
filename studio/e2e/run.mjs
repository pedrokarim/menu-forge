#!/usr/bin/env node
/**
 * Tests de bout en bout du studio Menu Forge (`npm run e2e`).
 *
 * 1. Compile (ou retrouve) `studio-api` en release.
 * 2. Crée un espace de travail temporaire : gabarits du dépôt, menus, assets et
 *    image de démonstration générés par le studio, réglages sans bibliothèque.
 * 3. Démarre l’API (`--no-discord`, port dédié) et un Vite de test (config
 *    générée dans `studio/.cache/`), puis joue les scénarios de `scenarios/`
 *    avec Playwright.
 * 4. Arrête ce qu’il a lancé (par PID) et supprime ce qu’il a créé, même en
 *    cas d’échec. Code de sortie non nul si un test échoue.
 *
 * Arguments : filtres sur le nom des scénarios ou des tests
 * (`npm run e2e -- pixels exports`).
 *
 * Variables d’environnement :
 *   MF_E2E_UI_PORT, MF_E2E_API_PORT   ports de Vite et de l’API (5390 et 5391)
 *   PLAYWRIGHT_DIR                    dossier node_modules où trouver playwright
 *                                     ou playwright-core
 *   MF_BROWSER_CHANNEL                navigateur installé à utiliser (msedge, chrome…)
 *   MF_STUDIO_API                     binaire studio-api à utiliser (sinon compilé)
 *   MF_E2E_HEADED=1                   navigateur visible
 *   MF_E2E_KEEP=1                     garder l’espace temporaire (chemin affiché)
 *   MF_VERBOSE=1                      journaux de l’API et de Vite
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CheckError, NBSP, createTestContext, frenchSpaces } from './lib/harness.mjs';
import { createWorkDir, loadDemoData, seedWorkspace } from './lib/workspace.mjs';

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const STUDIO_DIR = path.resolve(E2E_DIR, '..');
const REPO_DIR = path.resolve(STUDIO_DIR, '..');
const RESULTS_DIR = path.join(E2E_DIR, 'results');
const SCENARIOS_DIR = path.join(E2E_DIR, 'scenarios');
const UI_PORT = Number(process.env.MF_E2E_UI_PORT ?? 5390);
const API_PORT = Number(process.env.MF_E2E_API_PORT ?? 5391);
const VERBOSE = Boolean(process.env.MF_VERBOSE);
const FILTERS = process.argv.slice(2).map((filter) => filter.toLowerCase());

const log = (...parts) => console.log('•', ...parts);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (ms) => `${(ms / 1000).toFixed(1).replace('.', ',')}${NBSP}s`;

/* ---------- Ressources lancées ou créées, libérées à la fin ---------- */

const children = [];
const createdPaths = [];
let browser = null;
let cleaning = null;

/** Arrête un processus lancé par la suite, avec ses enfants, par son PID. */
async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
  await Promise.race([exited, wait(5000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

/** Libère tout ce que la suite a lancé ou créé (une seule fois). */
function cleanup() {
  cleaning ??= (async () => {
    await browser?.close().catch(() => undefined);
    for (const child of children.reverse()) await stopProcess(child).catch(() => undefined);
    for (const target of createdPaths.reverse()) {
      if (process.env.MF_E2E_KEEP && target.keep) {
        log(`espace temporaire gardé${NBSP}: ${target.path}`);
        continue;
      }
      rmSync(target.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  })();
  return cleaning;
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(signal, () => {
    console.error(`\nInterruption (${signal})${NBSP}: arrêt des processus lancés et nettoyage…`);
    void cleanup().finally(() => process.exit(130));
  });
}

/* ---------- Préparation ---------- */

/** Vrai si quelque chose écoute déjà sur ce port (on ne l’arrête jamais : on s’arrête). */
function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function studioApiBinary() {
  if (process.env.MF_STUDIO_API) {
    if (!existsSync(process.env.MF_STUDIO_API)) throw new Error(`MF_STUDIO_API introuvable${NBSP}: ${process.env.MF_STUDIO_API}`);
    return process.env.MF_STUDIO_API;
  }
  const binary = path.join(STUDIO_DIR, 'backend', 'target', 'release', process.platform === 'win32' ? 'studio-api.exe' : 'studio-api');
  const cargo = spawnSync('cargo', ['--version'], { stdio: 'ignore' });
  if (cargo.status !== 0) {
    if (existsSync(binary)) return binary;
    throw new Error('studio-api absent et cargo introuvable : installer Rust ou définir MF_STUDIO_API.');
  }
  log('studio-api : cargo build --release (rapide s’il est à jour)…');
  const result = spawnSync(
    'cargo',
    ['build', '--release', '--quiet', '--manifest-path', path.join(STUDIO_DIR, 'backend', 'Cargo.toml'), '--bin', 'studio-api'],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error('Échec de la compilation de studio-api');
  return binary;
}

/** Playwright (ou playwright-core) : PLAYWRIGHT_DIR, puis les dépendances du studio et du site. */
async function loadChromium() {
  const bases = [];
  if (process.env.PLAYWRIGHT_DIR) bases.push(path.join(path.resolve(process.env.PLAYWRIGHT_DIR), 'noop.js'));
  bases.push(path.join(STUDIO_DIR, 'package.json'), path.join(REPO_DIR, 'site', 'package.json'));
  for (const base of bases) {
    const resolver = createRequire(base);
    for (const name of ['playwright', 'playwright-core']) {
      try {
        const module = await import(pathToFileURL(resolver.resolve(name)).href);
        const chromium = module.chromium ?? module.default?.chromium;
        if (chromium) return chromium;
      } catch {
        // Paquet absent de ce dossier : on essaie le suivant.
      }
    }
  }
  throw new Error(
    'Playwright introuvable. Définir PLAYWRIGHT_DIR sur un dossier node_modules qui contient playwright ou playwright-core ' +
      '(par exemple après `npm install playwright-core` dans un dossier hors du dépôt).',
  );
}

async function launchBrowser(chromium) {
  const options = { headless: !process.env.MF_E2E_HEADED };
  if (process.env.MF_BROWSER_CHANNEL) return chromium.launch({ ...options, channel: process.env.MF_BROWSER_CHANNEL });
  try {
    return await chromium.launch(options);
  } catch (error) {
    // Navigateurs de Playwright non téléchargés : repli sur Edge, présent sous Windows.
    log(`Chromium de Playwright indisponible, essai avec Edge${NBSP}:`, error.message.split('\n')[0]);
    return chromium.launch({ ...options, channel: 'msedge' });
  }
}

function pipeLogs(child, name) {
  const forward = (chunk) => {
    if (VERBOSE) process.stderr.write(`[${name}] ${chunk}`);
  };
  child.stdout?.on('data', forward);
  child.stderr?.on('data', forward);
}

async function waitForUrl(url, name, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Pas encore prêt.
    }
    await wait(150);
  }
  throw new Error(`${name} ne répond pas sur ${url}`);
}

/** Config Vite de test, écrite dans `studio/.cache/` (supprimée à la fin). */
function writeViteConfig() {
  const cache = path.join(STUDIO_DIR, '.cache');
  const hadCache = existsSync(cache);
  mkdirSync(cache, { recursive: true });
  if (!hadCache) createdPaths.push({ path: cache });
  const file = path.join(cache, `e2e-vite-${process.pid}.config.mjs`);
  createdPaths.push({ path: file });
  // `studio/node_modules` peut être une jonction (worktree) : on autorise aussi sa cible.
  const allow = [STUDIO_DIR, realpathSync(path.join(STUDIO_DIR, 'node_modules'))];
  const config = {
    root: STUDIO_DIR,
    // Cache des dépendances gardé d'une passe à l'autre (dans node_modules, jamais effacé par la suite) :
    // sans lui, Vite repart à froid à chaque lancement et la première page dépasse les délais.
    cacheDir: path.join(STUDIO_DIR, 'node_modules', '.vite-e2e'),
    logLevel: VERBOSE ? 'info' : 'warn',
    clearScreen: false,
    server: {
      host: 'localhost',
      port: UI_PORT,
      strictPort: true,
      fs: { allow },
      proxy: { '/api': { target: `http://127.0.0.1:${API_PORT}` } },
    },
  };
  writeFileSync(
    file,
    [
      '// Généré par studio/e2e/run.mjs pour les tests de bout en bout ; supprimé à la fin.',
      "import react from '@vitejs/plugin-react';",
      `export default { ...${JSON.stringify(config, null, 2)}, plugins: [react()] };`,
      '',
    ].join('\n'),
  );
  return file;
}

/* ---------- Scénarios ---------- */

async function loadScenarios() {
  const files = readdirSync(SCENARIOS_DIR).filter((name) => name.endsWith('.mjs')).sort();
  const scenarios = [];
  for (const file of files) {
    const module = await import(pathToFileURL(path.join(SCENARIOS_DIR, file)).href);
    const title = module.title ?? file.replace(/\.mjs$/, '');
    const tests = module.tests.filter(
      (test) =>
        FILTERS.length === 0 ||
        FILTERS.some((filter) => file.toLowerCase().includes(filter) || title.toLowerCase().includes(filter) || test.name.toLowerCase().includes(filter)),
    );
    if (tests.length > 0) scenarios.push({ file, title, tests });
  }
  return scenarios;
}

function slug(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

async function runTest(context, env, scenario, test) {
  const page = await context.newPage();
  // Chaque test part sans onglets rouverts : la session de l’espace (stockage local, partagé par le
  // contexte) est effacée au premier chargement de la page, pas lors d’un rechargement pendant le test.
  await page.addInitScript(() => {
    try {
      if (window.sessionStorage.getItem('menu-forge.e2e-started')) return;
      window.sessionStorage.setItem('menu-forge.e2e-started', '1');
      for (const key of Object.keys(window.localStorage)) if (key.startsWith('menu-forge.session:')) window.localStorage.removeItem(key);
    } catch {
      // about:blank : pas de stockage, rien à effacer.
    }
  });
  const t = createTestContext({ page, env, name: test.name });
  const started = Date.now();
  let failure = null;
  try {
    await test.run(t);
    t.noPageErrors();
  } catch (error) {
    failure = error instanceof CheckError ? error.message : (error?.stack ?? String(error)).split('\n').slice(0, 4).join('\n    ');
    const extra = t.pageErrors();
    if (extra.length > 0 && !(error instanceof CheckError && error.message.startsWith('aucune erreur'))) {
      failure += `\n    erreurs de page${NBSP}: ${extra.slice(0, 5).join(' ; ')}`;
    }
    mkdirSync(RESULTS_DIR, { recursive: true });
    const shot = path.join(RESULTS_DIR, `${slug(scenario.title)}--${slug(test.name)}.png`);
    await page.screenshot({ path: shot }).catch(() => undefined);
    failure += `\n    capture${NBSP}: ${path.relative(STUDIO_DIR, shot)}`;
  } finally {
    await page.close().catch(() => undefined);
  }
  return { name: test.name, checks: t.checks, ms: Date.now() - started, failure };
}

/* ---------- Programme ---------- */

const results = [];
const startedAt = Date.now();
let fatal = null;

try {
  const scenarios = await loadScenarios();
  if (scenarios.length === 0) throw new Error(`aucun test ne correspond aux filtres${NBSP}: ${FILTERS.join(', ')}`);
  for (const port of [UI_PORT, API_PORT]) {
    if (await portInUse(port)) throw new Error(`le port ${port} est déjà occupé : arrêter ce qui l’utilise ou choisir MF_E2E_UI_PORT / MF_E2E_API_PORT`);
  }
  rmSync(RESULTS_DIR, { recursive: true, force: true });

  const binary = studioApiBinary();
  const chromium = await loadChromium();
  const paths = createWorkDir(REPO_DIR);
  createdPaths.push({ path: paths.root, keep: true });
  log(`espace temporaire${NBSP}: ${paths.root}`);

  const api = spawn(
    binary,
    [
      '--port', String(API_PORT),
      '--settings', paths.settingsFile,
      '--workspace', paths.workspaceDir,
      '--libraries', paths.librariesFile,
      '--templates', paths.templatesDir,
      '--cache', paths.cacheDir,
      '--studio-dir', STUDIO_DIR,
      '--no-discord',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  children.push(api);
  pipeLogs(api, 'api');
  log(`studio-api lancé (PID ${api.pid}) sur ${API_PORT}`);

  const viteConfig = writeViteConfig();
  const vite = spawn(process.execPath, [path.join(STUDIO_DIR, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', viteConfig], {
    cwd: STUDIO_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.push(vite);
  pipeLogs(vite, 'vite');
  log(`Vite lancé (PID ${vite.pid}) sur ${UI_PORT}`);

  await waitForUrl(`http://127.0.0.1:${API_PORT}/api/app`, 'studio-api');
  await waitForUrl(`http://localhost:${UI_PORT}/`, 'Vite');

  browser = await launchBrowser(chromium);
  const env = {
    uiOrigin: `http://localhost:${UI_PORT}`,
    apiOrigin: `http://127.0.0.1:${API_PORT}`,
    ...paths,
    studioDir: STUDIO_DIR,
    repoDir: REPO_DIR,
  };
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    locale: 'fr-FR',
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: env.uiOrigin });
  context.setDefaultTimeout(15_000);

  // Espace de démonstration écrit par le code du studio, depuis une page (textures cuites par lui).
  const seedPage = await context.newPage();
  // Premier chargement : Vite peut encore précompiler ses dépendances (poste chargé, premier lancement).
  await seedPage.goto(`${env.uiOrigin}/#/accueil`, { waitUntil: 'load', timeout: 180_000 });
  await seedPage.locator('.rail').first().waitFor({ timeout: 90_000 });
  const demo = await loadDemoData(REPO_DIR);
  await seedWorkspace(seedPage, { menus: demo.DEMO_MENUS, assets: demo.DEMO_ASSETS, pixels: demo.DEMO_PIXELS });
  await seedPage.close();
  log(`espace de démonstration prêt${NBSP}: ${demo.DEMO_MENUS.length} menus, ${demo.DEMO_ASSETS.length} assets, ${demo.DEMO_PIXELS.length} image`);

  for (const scenario of scenarios) {
    console.log(`\n${frenchSpaces(scenario.title)}`);
    for (const test of scenario.tests) {
      const result = await runTest(context, env, scenario, test);
      results.push({ scenario: scenario.title, ...result });
      const mark = result.failure ? '✗' : '✓';
      console.log(`  ${mark} ${frenchSpaces(result.name)} (${result.checks} vérification${result.checks > 1 ? 's' : ''}, ${seconds(result.ms)})`);
      if (result.failure) console.log(`    ${frenchSpaces(result.failure)}`);
    }
  }
} catch (error) {
  fatal = error;
} finally {
  await cleanup();
}

const failed = results.filter((result) => result.failure);
const checks = results.reduce((sum, result) => sum + result.checks, 0);
console.log('');
if (fatal) console.error(`Arrêt de la suite${NBSP}: ${fatal.message}`);
console.log(
  `${results.length - failed.length}/${results.length} test${results.length > 1 ? 's' : ''} réussi${results.length - failed.length > 1 ? 's' : ''}, ` +
    `${checks} vérifications, ${seconds(Date.now() - startedAt)}`,
);
if (failed.length > 0) {
  console.log(`Échecs${NBSP}:`);
  for (const result of failed) console.log(frenchSpaces(`  – ${result.scenario} › ${result.name}`));
}
process.exitCode = fatal || failed.length > 0 ? 1 : 0;
