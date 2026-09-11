/**
 * Petit moteur de scénarios : chaque fichier de `scenarios/` exporte une liste
 * de tests `{ name, run }` ; `run(t)` reçoit une page neuve et des
 * vérifications comptées. Une vérification qui échoue arrête le test (les
 * suivants continuent) ; toute erreur de page ou de console le fait échouer.
 */
import { isDeepStrictEqual } from 'node:util';

/** Espace insécable (typographie française des messages). */
export const NBSP = String.fromCharCode(160);

const NARROW_NBSP = String.fromCharCode(0x202f);

/**
 * Espaces insécables ramenés à des espaces ordinaires (chaînes, tableaux,
 * objets simples) : les vérifications portent sur le sens, pas sur la typographie.
 */
export function plainSpaces(value) {
  if (typeof value === 'string') return value.replaceAll(NBSP, ' ').replaceAll(NARROW_NBSP, ' ');
  if (Array.isArray(value)) return value.map(plainSpaces);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, plainSpaces(entry)]));
  }
  return value;
}

/**
 * Typographie française d’un texte affiché (noms de tests, messages d’échec) :
 * espace insécable avant « : ; ! ? » et à l’intérieur des guillemets.
 */
export function frenchSpaces(text) {
  return String(text).replace(/ ([:;!?»])/g, `${NBSP}$1`).replace(/« /g, `«${NBSP}`);
}

/** Échec d’une vérification (message lisible, sans pile). */
export class CheckError extends Error {}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function show(value) {
  const text = typeof value === 'string' ? `« ${value} »` : JSON.stringify(value);
  return text && text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

/**
 * Contexte d’un test : vérifications, attente, erreurs de la page.
 * `ignore` : motifs d’erreurs attendues pour ce test (réponse 404 voulue…).
 */
export function createTestContext({ page, env, name }) {
  const errors = [];
  const ignored = [];
  const dialogs = [];
  let checks = 0;

  page.on('pageerror', (error) => errors.push(`erreur de page${NBSP}: ${error.message}`));
  page.on('console', (message) => {
    // Les ressources introuvables sont signalées avec leur adresse par l’écouteur `response`.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      errors.push(`console${NBSP}: ${message.text()}`);
    }
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    // Sans bibliothèque branchée, la police vanilla est introuvable : c’est voulu (aucun asset de Mojang).
    if (response.status() >= 400 && !url.pathname.startsWith('/api/libraries/')) {
      errors.push(`réponse ${response.status()}${NBSP}: ${response.request().method()} ${url.pathname}`);
    }
  });
  // Confirmations acceptées (corbeille, modifications abandonnées) ; chaque question est gardée.
  page.on('dialog', (dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    void dialog.accept().catch(() => undefined);
  });

  const t = {
    page,
    env,
    name,
    dialogs,
    get checks() {
      return checks;
    },
    /** Motif d’erreur attendue pendant ce test (texte ou expression régulière). */
    ignoreErrors(pattern) {
      ignored.push(pattern);
    },
    /** Erreurs de page relevées depuis le début du test, hors motifs ignorés. */
    pageErrors() {
      return errors.filter((error) => !ignored.some((pattern) => (typeof pattern === 'string' ? error.includes(pattern) : pattern.test(error))));
    },
    check(condition, message) {
      checks++;
      if (!condition) throw new CheckError(message);
    },
    equal(actual, expected, message) {
      checks++;
      if (!isDeepStrictEqual(plainSpaces(actual), plainSpaces(expected))) {
        throw new CheckError(`${message}${NBSP}: obtenu ${show(actual)}, attendu ${show(expected)}`);
      }
    },
    /** Attend qu’une fonction (asynchrone) renvoie une valeur vraie ; compte une vérification. */
    async waitFor(probe, message, timeout = 10_000) {
      const deadline = Date.now() + timeout;
      let last;
      for (;;) {
        try {
          last = await probe();
          if (last) {
            checks++;
            return last;
          }
        } catch (error) {
          last = error;
        }
        if (Date.now() > deadline) {
          checks++;
          const detail = last instanceof Error ? ` (${last.message.split('\n')[0]})` : '';
          throw new CheckError(`${message}${detail}`);
        }
        await wait(100);
      }
    },
    /** Attend que `probe()` rende une valeur égale à `expected` ; compte une vérification. */
    async waitEqual(probe, expected, message, timeout = 10_000) {
      let last;
      try {
        await t.waitFor(async () => {
          last = await probe();
          return isDeepStrictEqual(plainSpaces(last), plainSpaces(expected));
        }, message, timeout);
      } catch (error) {
        if (error instanceof CheckError) throw new CheckError(`${message}${NBSP}: obtenu ${show(last)}, attendu ${show(expected)}`);
        throw error;
      }
    },
    /** Vérifie qu’aucune erreur de page n’a été relevée jusqu’ici. */
    noPageErrors(message = 'aucune erreur de page ni de console') {
      const found = t.pageErrors();
      t.check(found.length === 0, `${message}${NBSP}: ${found.slice(0, 5).join(' ; ')}`);
    },
    wait,
  };
  return t;
}
