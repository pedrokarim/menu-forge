/**
 * Aides de pilotage du studio : ouvrir une adresse, viser une case de la
 * toile, lire l’inspecteur, attendre un fichier sur le disque.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { NBSP } from './harness.mjs';
import { decodePng } from './png.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Échappe un texte pour une expression régulière. */
export const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Expression régulière qui reconnaît exactement ce texte. */
export const exactly = (text) => new RegExp(`^${escapeRegExp(text)}$`);

/**
 * Ouvre une adresse du studio dans une page fraîche (l’éditeur ne lit
 * l’adresse qu’au chargement) et attend que l’interface soit prête.
 */
export async function open(t, hash) {
  const { page, env } = t;
  await page.goto('about:blank');
  await page.goto(`${env.uiOrigin}/${hash}`, { waitUntil: 'load' });
  await page.locator('.rail').first().waitFor({ timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  // Un menu coffre a sa toile ; un formulaire Bedrock, son écran simulé.
  if (hash.startsWith('#/editeur/menus')) await page.locator('canvas.menu-canvas, .form-editor .bf-screen').first().waitFor({ timeout: 30_000 });
  if (hash.startsWith('#/editeur/assets')) await page.locator('canvas.asset-canvas').first().waitFor({ timeout: 30_000 });
  if (hash.startsWith('#/editeur/pixels')) await page.locator('canvas.pixel-canvas').first().waitFor({ timeout: 30_000 });
  await wait(300);
}

/** Texte d’un élément, espaces insécables ramenés à des espaces. */
export async function textOf(locator) {
  return ((await locator.textContent()) ?? '').replaceAll(NBSP, ' ').trim();
}

/** Message de la barre d’outils de l’éditeur. */
export function toolbarStatus(page) {
  return page.locator('header.toolbar [role="status"]').first();
}

/** Texte du message d’état de la barre d’outils (espaces insécables normalisés). */
export async function statusText(page) {
  return ((await toolbarStatus(page).textContent()) ?? '').replaceAll(NBSP, ' ').trim();
}

/** Attend un message d’état qui contient `text` (ou vérifie l’expression régulière). */
export async function waitStatus(t, pattern, message = `message d’état « ${pattern} »`, locator = toolbarStatus(t.page)) {
  await t.waitFor(async () => {
    const text = ((await locator.textContent()) ?? '').replaceAll(NBSP, ' ');
    return typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
  }, message);
}

/** Ligne de la liste des éléments : section 0 = couches, 1 = textes, 2 = zones de slots. */
export function outlineRow(page, section, name) {
  return page
    .locator('.outline .panel-section')
    .nth(section)
    .locator('.outline-item')
    .filter({ has: page.locator('.outline-name', { hasText: exactly(name) }) })
    .first();
}

/** Noms de la liste des éléments d’une section (dans l’ordre affiché). */
export async function outlineNames(page, section) {
  return page.locator('.outline .panel-section').nth(section).locator('.outline-name').allTextContents();
}

/** Champ de l’inspecteur (entrée ou liste) par son libellé exact. */
export function inspectorField(page, label, scope = '.inspector') {
  return page
    .locator(`${scope} .field`)
    .filter({ has: page.locator('.field-label', { hasText: exactly(label) }) })
    .first()
    .locator('input, select, textarea')
    .first();
}

/** Valeur numérique d’un champ de l’inspecteur. */
export async function inspectorNumber(page, label, scope) {
  return Number(await inspectorField(page, label, scope).inputValue());
}

/** Pastille de l’en-tête de l’inspecteur (« couche », « slot · bouton »…). */
export async function inspectorPill(page) {
  return ((await page.locator('.inspector .section-header .pill').first().textContent()) ?? '').replaceAll(NBSP, ' ').trim();
}

/**
 * Géométrie de la toile des menus : zoom effectif (lu sur la taille du
 * canvas : 176 + 2 × 32 px de marge), point de la page d’un point de la
 * fenêtre du coffre, centre d’une case.
 */
export async function menuCanvas(page) {
  const canvas = page.locator('canvas.menu-canvas').first();
  await canvas.scrollIntoViewIfNeeded();
  await nextFrames(page);
  const box = await canvas.boundingBox();
  const zoom = Math.round(box.width / 240);
  const at = (x, y) => ({ x: box.x + (32 + x) * zoom, y: box.y + (32 + y) * zoom });
  return {
    box,
    zoom,
    at,
    cell: (col, row) => at(7 + 18 * col + 9, 17 + 18 * row + 9),
  };
}

/** Choisit un zoom fixe (`fit` ou un palier) dans la barre de la toile. */
export async function setMenuZoom(page, level) {
  await page.getByLabel('Niveau de zoom').first().selectOption(String(level));
  await wait(250);
  return menuCanvas(page);
}

/** Glisser à la souris, en plusieurs pas (les seuils de glisser sont franchis). */
export async function drag(page, from, to, { steps = 8, before, beforeUp } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (before) await before();
  await page.mouse.move(to.x, to.y, { steps });
  if (beforeUp) await beforeUp();
  await page.mouse.up();
  await wait(120);
}

/** Envoie une touche avec les valeurs `key` et `code` données (disposition AZERTY simulée). */
export async function dispatchKey(page, { key, code, ctrlKey = false, shiftKey = false, altKey = false }) {
  await page.evaluate(
    ({ key, code, ctrlKey, shiftKey, altKey }) => {
      const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
      for (const type of ['keydown', 'keyup']) {
        target.dispatchEvent(new KeyboardEvent(type, { key, code, ctrlKey, shiftKey, altKey, bubbles: true, cancelable: true }));
      }
    },
    { key, code, ctrlKey, shiftKey, altKey },
  );
  await wait(150);
}

/** Attend deux images : les événements `scroll` d’un défilement déjà fait sont émis. */
export function nextFrames(page) {
  return page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/**
 * Clic droit sur un élément. Le défilement qui l’amène à l’écran se termine
 * d’abord : son événement `scroll`, émis à l’image suivante, fermerait sinon le
 * menu contextuel à peine ouvert (un menu se ferme quand la page défile).
 */
export async function rightClick(locator) {
  await locator.scrollIntoViewIfNeeded();
  await nextFrames(locator.page());
  await locator.click({ button: 'right' });
}

/**
 * Élément du menu contextuel ouvert, par son libellé seul (le raccourci
 * affiché à droite fait partie du nom accessible, pas du libellé).
 */
export function contextItem(page, label) {
  const text = typeof label === 'string' ? exactly(label) : label;
  return page.locator('.context-menu .context-item').filter({ has: page.locator('.context-label', { hasText: text }) });
}

/** Dialogue modal ouvert, par son titre. */
export function modal(page, title) {
  return page.getByRole('dialog', { name: typeof title === 'string' ? exactly(title) : title });
}

/** Contenu JSON d’un fichier de l’espace de travail. */
export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Attend l’apparition d’un fichier ; compte une vérification. */
export async function waitForFile(t, file, message = `fichier ${path.basename(file)} écrit`) {
  await t.waitFor(() => existsSync(file), message);
}

/** PNG décodé d’un fichier du disque. */
export function readPng(file) {
  return decodePng(readFileSync(file));
}

/** Chemins de l’espace de travail temporaire. */
export function workspacePath(t, ...parts) {
  return path.join(t.env.workspaceDir, ...parts);
}

/** Appel de l’API locale depuis Node (écritures marquées de l’en-tête du studio). */
export async function api(t, pathname, { method = 'GET', body } = {}) {
  const response = await fetch(`${t.env.apiOrigin}/api${pathname}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Menu-Forge': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${pathname} : ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

/**
 * Le document créé s’ouvre dans son propre onglet : l’onglet d’origine est fermé (clic droit, « Fermer
 * les autres onglets »), pour que la suite du test ne voie qu’un seul éditeur.
 */
export async function closeOtherTabs(page) {
  await page.locator('.shell-editor .editor-tab.active').click({ button: 'right' });
  await page.locator('.context-menu .context-item', { hasText: 'Fermer les autres onglets' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.shell-editor .editor-tab').length === 1);
}
