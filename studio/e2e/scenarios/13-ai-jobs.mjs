/**
 * Générations par IA en tâches de fond, avec un fournisseur simulé lent
 * (`lib/fakeAi.mjs`, réponses libérées par le test) : phases en clair lues au
 * backend, chronomètre, dialogue fermé sans arrêter la tâche, indicateur du
 * rail, notifications d’essai refusé puis de succès, « Ouvrir » qui ramène le
 * résultat, « Annuler » qui arrête vraiment, deux tâches à la fois.
 *
 * Chaque état est audité (`lib/audit.mjs`) à 1024 × 600, 1280 × 800 et
 * 1600 × 900. `MF_AI_SHOTS=<dossier>` : une capture de chaque état à chaque
 * taille, pour la relecture à l’œil.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { auditLayout } from '../lib/audit.mjs';
import { startFakeAi } from '../lib/fakeAi.mjs';
import { NBSP } from '../lib/harness.mjs';
import { encodePng, paintImage } from '../lib/png.mjs';
import { api, inspectorField, modal, nextFrames, open, textOf, waitStatus } from '../lib/studio.mjs';
import { loadDemoData } from '../lib/workspace.mjs';

export const title = 'Générations par IA en tâches de fond';

const SIZES = [
  { width: 1024, height: 600 },
  { width: 1280, height: 800 },
  { width: 1600, height: 900 },
];
const SHOTS = process.env.MF_AI_SHOTS ? path.resolve(process.env.MF_AI_SHOTS) : null;
const MENU = '#/editeur/menus/shop';
const PIXEL = '#/editeur/pixels/shop_tab_icon';
const CHAT = '/api/chat';
const TXT2IMG = '/sdapi/v1/txt2img';
const PROMPT = 'Boutique paginée : une grille d’offres, flèches page précédente et suivante';

const slug = (text) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Audite l’état affiché aux trois tailles (et le capture si demandé), puis rend la taille d’origine. */
async function capture(t, found, name) {
  const { page } = t;
  const original = page.viewportSize();
  await page.mouse.move(1, 1);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await nextFrames(page);
    await t.wait(250);
    for (const problem of await auditLayout(page)) found.push(`${size.width} × ${size.height} · ${name} › ${problem}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${slug(name)}--${size.width}x${size.height}.png`) });
  }
  await page.setViewportSize(original);
}

function expectClean(t, found) {
  t.check(found.length === 0, `${found.length} défaut${found.length > 1 ? 's' : ''} de mise en page${NBSP}:\n      – ${found.join('\n      – ')}`);
}

/** Faux fournisseurs branchés sur Ollama et Automatic1111 le temps de `run`, puis débranchés. */
async function withFakeAi(t, run) {
  const demo = await loadDemoData(t.env.repoDir);
  const image = Buffer.from(encodePng(paintImage(64, 64, [[16, 16, 32, 32, [76, 208, 125, 255]]]))).toString('base64');
  const fake = await startFakeAi({ menu: demo.DEMO_AI.menu, image, delayMs: 400 });
  try {
    for (const provider of ['ollama', 'automatic1111']) {
      await api(t, `/ai/providers/${provider}`, { method: 'PUT', body: { enabled: true, endpoint: fake.endpoint } });
    }
    await run(fake);
  } finally {
    await fake.close();
    for (const provider of ['ollama', 'automatic1111']) {
      await api(t, `/ai/providers/${provider}`, { method: 'PUT', body: { enabled: false, endpoint: null } }).catch(() => undefined);
    }
  }
}

/** Remplit et lance le dialogue « Générer une interface par IA » ; renvoie l’identifiant du menu demandé. */
async function launchInterface(page, dialog, name) {
  await inspectorField(page, 'Fournisseur', '.modal').selectOption('ollama');
  await dialog.locator('textarea.ai-prompt').fill(PROMPT);
  await inspectorField(page, 'Nom', '.modal').fill(name);
  const id = await inspectorField(page, 'Identifiant', '.modal').inputValue();
  await dialog.getByRole('button', { name: 'Générer', exact: true }).click();
  return id;
}

const jobTitle = (dialog) => textOf(dialog.locator('.ai-job-title'));
const toastTexts = async (page) => (await page.locator('.toast').allTextContents()).map((text) => text.replaceAll(NBSP, ' '));
const rail = (page) => page.locator('.rail');

export const tests = [
  {
    name: 'interface : phases, arrière-plan, essai refusé, succès, « Ouvrir »',
    async run(t) {
      const { page } = t;
      const found = [];
      await withFakeAi(t, async (fake) => {
        await open(t, MENU);
        await page.getByRole('button', { name: 'Générer une interface par IA…', exact: true }).first().click();
        const dialog = modal(page, 'Générer une interface par IA');
        await dialog.waitFor();
        const id = await launchInterface(page, dialog, 'Marché de nuit');

        // Phase réelle, lue au backend : la requête est partie, le fournisseur « réfléchit ».
        await t.waitEqual(() => jobTitle(dialog), 'Ollama réfléchit…', 'phase lue au backend');
        t.equal(await textOf(dialog.locator('.ai-job-detail')), 'Essai 1 sur 3', 'numéro de l’essai');
        t.check(await dialog.locator('.ai-job-bar-run').isVisible(), 'barre : l’étape en cours défile');
        t.check(await dialog.locator('fieldset.ai-form').evaluate((node) => node.disabled), 'formulaire figé pendant la génération');
        t.check(await dialog.locator('.ai-attempts .is-live').isVisible(), 'journal : l’essai en cours en direct');
        const before = await textOf(dialog.locator('.ai-job-clock'));
        await t.waitFor(async () => (await textOf(dialog.locator('.ai-job-clock'))) !== before, 'le chronomètre tourne', 3000);
        await capture(t, found, 'dialogue interface · essai 1 en cours');

        // Fermer le dialogue n’arrête pas la tâche.
        await dialog.getByRole('button', { name: 'Continuer en arrière-plan', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
        const indicator = rail(page).getByRole('button', { name: '1 génération en cours', exact: true });
        await indicator.waitFor();
        const progress = page.locator('.toast-progress');
        await progress.waitFor();
        t.check((await textOf(progress)).includes('Génération lancée avec Ollama…'), 'notification de progression');
        t.check((await textOf(progress)).includes('Ollama réfléchit…'), 'la notification suit la phase');
        await capture(t, found, 'indicateur et notification de progression');

        // Changer d’écran (sans recharger) ne tue pas la tâche ; l’essai 1 est refusé par le schéma.
        await rail(page).getByRole('button', { name: 'Paramètres', exact: true }).click();
        await page.waitForFunction(() => window.location.hash.startsWith('#/parametres'));
        await fake.release(CHAT);
        await t.waitFor(async () => (await toastTexts(page)).some((text) => text.includes('Essai 1 sur 3 refusé : 1 erreur, correction en cours…')), 'notification « Essai 1 sur 3 refusé »');
        t.check(await indicator.isVisible(), 'indicateur toujours là sur un autre écran');
        await capture(t, found, 'notification d’essai refusé');

        // L’indicateur rouvre le dialogue sur la tâche, en direct.
        await indicator.click();
        await dialog.waitFor();
        await t.waitEqual(() => jobTitle(dialog), 'Essai 2 sur 3 : correction de 1 erreur…', 'phase de correction');
        t.equal(await dialog.locator('.ai-attempts li.is-error').count(), 1, 'journal : essai 1 refusé');
        t.check((await textOf(dialog.locator('.ai-attempts li.is-error'))).includes('Essai 1 : 1 erreur, renvoyée au modèle'), 'journal : erreurs de l’essai 1');
        t.check(await dialog.locator('.ai-attempt-errors li').first().isVisible(), 'erreurs du dernier essai dépliées');
        await capture(t, found, 'dialogue interface · correction en cours');

        // Échap ferme, la tâche continue ; la correction est valide.
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        t.check(await indicator.isVisible(), 'Échap : la tâche continue');
        await fake.release(CHAT);
        const success = page.locator('.toast-success');
        await success.waitFor({ timeout: 15_000 });
        t.check((await textOf(success)).includes('Interface prête'), 'notification « Interface prête »');
        await indicator.waitFor({ state: 'detached' });
        t.equal(await page.locator('.toast-progress').count(), 0, 'progression retirée');
        await capture(t, found, 'notification de succès');

        // « Ouvrir » ramène le résultat, qui s’ouvre ensuite dans l’éditeur.
        await success.getByRole('button', { name: 'Ouvrir', exact: true }).click();
        await dialog.waitFor();
        await dialog.getByRole('img', { name: 'Aperçu du menu généré' }).waitFor();
        t.equal(await jobTitle(dialog), 'Interface prête', 'dialogue sur le résultat');
        t.equal(await dialog.locator('.ai-attempts li.is-ok').count(), 1, 'journal : essai 2 valide');
        await capture(t, found, 'dialogue interface · résultat');
        await dialog.getByRole('button', { name: 'Ouvrir dans l’éditeur', exact: true }).click();
        await waitStatus(t, `Menu « ${id} » généré`);
        t.equal(await page.getByLabel('Menu ouvert').inputValue(), id, 'menu généré ouvert dans l’éditeur');

        // Consommé : le dialogue rouvert repart d’un formulaire neuf.
        await page.getByRole('button', { name: 'Générer une interface par IA…', exact: true }).first().click();
        await dialog.waitFor();
        t.equal(await dialog.locator('.ai-job').count(), 0, 'résultat ouvert : plus remontré');
        await page.keyboard.press('Escape');
      });
      expectClean(t, found);
    },
  },
  {
    name: '« Annuler la génération » arrête vraiment la tâche',
    async run(t) {
      const { page } = t;
      const found = [];
      await withFakeAi(t, async (fake) => {
        await open(t, MENU);
        await page.getByRole('button', { name: 'Générer une interface par IA…', exact: true }).first().click();
        const dialog = modal(page, 'Générer une interface par IA');
        await dialog.waitFor();
        await launchInterface(page, dialog, 'Menu annulé');
        await t.waitEqual(() => jobTitle(dialog), 'Ollama réfléchit…', 'génération en cours');
        await dialog.getByRole('button', { name: 'Annuler la génération', exact: true }).click();
        await t.waitEqual(() => jobTitle(dialog), 'Génération annulée', 'tâche annulée');
        t.check(await dialog.getByRole('button', { name: 'Générer', exact: true }).isEnabled(), 'le formulaire est rendu');
        t.equal(await rail(page).locator('.rail-jobs').count(), 0, 'plus d’indicateur');
        await capture(t, found, 'dialogue interface · génération annulée');
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        await t.waitFor(async () => (await toastTexts(page)).some((text) => text.includes('Génération annulée')), 'notification d’annulation');
        await capture(t, found, 'notification d’annulation');
        // La réponse qui arrive après coup ne produit rien.
        await fake.release(CHAT);
        await t.wait(1500);
        t.equal(await page.locator('.toast-success, .toast-error').count(), 0, 'rien après l’annulation');
      });
      expectClean(t, found);
    },
  },
  {
    name: 'deux tâches à la fois : une texture et une interface',
    async run(t) {
      const { page } = t;
      const found = [];
      await withFakeAi(t, async (fake) => {
        // Texture, depuis l’éditeur de pixels.
        await open(t, PIXEL);
        await page.getByRole('button', { name: 'Générer une texture par IA…', exact: true }).first().click();
        const textureDialog = modal(page, 'Générer une texture par IA');
        await textureDialog.waitFor();
        await inspectorField(page, 'Fournisseur', '.modal').selectOption('automatic1111');
        await textureDialog.locator('textarea.ai-prompt').fill('Émeraude taillée, facettes vert vif');
        await textureDialog.getByRole('button', { name: 'Générer', exact: true }).click();
        await t.waitEqual(() => jobTitle(textureDialog), 'Automatic1111 réfléchit…', 'texture : phase lue au backend');
        await capture(t, found, 'dialogue texture · génération en cours');
        await textureDialog.getByRole('button', { name: 'Continuer en arrière-plan', exact: true }).click();
        await textureDialog.waitFor({ state: 'detached' });

        // Interface, depuis l’accueil, pendant que la texture tourne.
        await rail(page).getByRole('button', { name: 'Accueil', exact: true }).click();
        await page.getByRole('button', { name: 'Générer une interface par IA…', exact: true }).first().click();
        const dialog = modal(page, 'Générer une interface par IA');
        await dialog.waitFor();
        await launchInterface(page, dialog, 'Menu parallèle');
        await t.waitEqual(() => jobTitle(dialog), 'Ollama réfléchit…', 'interface : phase lue au backend');
        await dialog.getByRole('button', { name: 'Continuer en arrière-plan', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });

        const indicator = rail(page).getByRole('button', { name: '2 générations en cours', exact: true });
        await indicator.waitFor();
        t.equal(await page.locator('.toast-progress').count(), 2, 'une progression par tâche');
        await indicator.click();
        await page.locator('.context-menu').waitFor();
        t.equal(await page.locator('.context-menu .context-item').count(), 2, 'l’indicateur propose les deux tâches');
        await capture(t, found, 'indicateur · deux générations');
        await page.keyboard.press('Escape');

        // Les deux aboutissent ; la pile garde les notifications de fin.
        await fake.release(TXT2IMG);
        await fake.release(CHAT);
        await fake.release(CHAT);
        await t.waitFor(async () => {
          const texts = await toastTexts(page);
          return texts.some((text) => text.includes('Texture prête')) && texts.some((text) => text.includes('Interface prête'));
        }, 'notifications « Texture prête » et « Interface prête »', 15_000);
        await capture(t, found, 'pile de notifications');

        // « Ouvrir » sur la texture : son dialogue, sur le résultat ; « Rejeter » le retire.
        await page.locator('.toast', { hasText: 'Texture prête' }).getByRole('button', { name: 'Ouvrir', exact: true }).click();
        await textureDialog.waitFor();
        await textureDialog.getByRole('img', { name: 'Texture contrainte' }).waitFor();
        await capture(t, found, 'dialogue texture · résultat');
        await textureDialog.getByRole('button', { name: 'Rejeter', exact: true }).click();
        t.equal(await textureDialog.locator('.ai-job').count(), 0, 'rejeté : retour au formulaire');
        await page.keyboard.press('Escape');
        t.equal(fake.seen.image, 1, 'une seule image demandée');
      });
      expectClean(t, found);
    },
  },
];
