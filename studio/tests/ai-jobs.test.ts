// Générations en tâches de fond (src/ai/jobs.ts) et notifications (src/ui/toasts.ts) : phases en
// clair, essais refusés, fin, annulation, échec, dialogue ouvert. Le travail est une promesse
// pilotée pas à pas : aucun appel réseau, aucun fournisseur.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cancelJob, consumeJob, describeJob, friendlyError, getJob, jobSteps, latestJob, onOpenJob, startJob, watchJob } from '../src/ai/jobs.ts';
import type { JobControl, JobOutcome, JobSpec } from '../src/ai/jobs.ts';
import { formatClock, formatSpan } from '../src/lib/clock.ts';
import { TOAST_DURATION, dismissToast, getToasts, showToast } from '../src/ui/toasts.ts';

const NBSP = String.fromCharCode(160);
const plain = (text: string | undefined) => (text ?? '').replaceAll(NBSP, ' ');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const spec = (prompt = 'Boutique paginée', kind: JobSpec['kind'] = 'interface'): JobSpec => ({
  kind,
  providerId: 'codex',
  providerName: 'Codex CLI',
  providerKind: 'cli',
  prompt,
  maxAttempts: 3,
  params: { prompt },
});

/** Travail factice : le test signale les phases et décide de la fin. */
function controlled() {
  const handle: {
    control: JobControl | null;
    resolve: (outcome: JobOutcome) => void;
    reject: (error: unknown) => void;
  } = { control: null, resolve: () => undefined, reject: () => undefined };
  const run = (control: JobControl) => {
    handle.control = control;
    return new Promise<JobOutcome>((resolve, reject) => {
      handle.resolve = resolve;
      handle.reject = reject;
    });
  };
  return { run, handle, control: () => handle.control as JobControl };
}

const titles = (group: string) => getToasts().filter((toast) => toast.group === group).map((toast) => plain(toast.title));
const title = (id: string) => plain(describeJob(getJob(id)!).title);

test('interface : phases en clair, essai refusé notifié, puis « Interface prête » avec « Ouvrir »', async () => {
  const work = controlled();
  const id = startJob(spec(), work.run);
  assert.equal(getJob(id)?.phase, 'preparing');
  assert.deepEqual(titles(id), ['Génération lancée avec Codex CLI…']);
  assert.equal(title(id), 'Préparation de la demande…');

  work.control().attemptStarted(1);
  assert.equal(title(id), 'Envoi à Codex…');
  work.control().remote({ phase: 'waiting', events: 1 });
  assert.equal(getJob(id)?.phase, 'waiting', 'une réponse du backend fait passer de l’envoi à l’attente');
  assert.equal(title(id), 'Codex lit la demande…');
  work.control().remote({ phase: 'thinking', events: 5 });
  assert.equal(title(id), 'Codex réfléchit…');
  assert.equal(plain(describeJob(getJob(id)!).detail ?? ''), 'Essai 1 sur 3');
  assert.deepEqual(jobSteps(getJob(id)!), { steps: ['Demande', 'Envoi', 'Réponse', 'Schéma', 'Rendu'], current: 2 });

  work.control().phase('checking');
  assert.equal(title(id), 'Vérification du menu par le schéma…');
  work.control().attemptFinished(['$.texts[0].y : 2 < 5', '$.slots : absent', '$.id : attendu', '$.name : vide']);
  assert.ok(titles(id).includes('Essai 1 sur 3 refusé : 4 erreurs, correction en cours…'), titles(id).join(' | '));

  work.control().attemptStarted(2);
  assert.equal(getJob(id)?.phase, 'correcting');
  assert.equal(title(id), 'Essai 2 sur 3 : correction de 4 erreurs…');
  // La notification de progression suit la phase.
  assert.equal(plain(getToasts().find((toast) => toast.id === `job-${id}`)?.message), 'Essai 2 sur 3 : correction de 4 erreurs…');

  work.control().attemptFinished([]);
  work.control().phase('rendering');
  work.handle.resolve({ value: { menu: { id: 'boutique' } } });
  await settle();
  const job = getJob(id)!;
  assert.equal(job.phase, 'done');
  assert.ok(job.endedAt !== null);
  assert.deepEqual(job.attempts.map((attempt) => [attempt.index, attempt.errors.length]), [[1, 4], [2, 0]]);
  // Progression et essai refusé retirés ; reste le succès, qui disparaît seul et propose « Ouvrir ».
  assert.deepEqual(titles(id), ['Interface prête']);
  const success = getToasts().find((toast) => toast.group === id)!;
  assert.equal(success.variant, 'success');
  assert.equal(success.duration, TOAST_DURATION);
  assert.equal(success.action?.label, 'Ouvrir');
  assert.equal(latestJob('interface')?.id, id, 'le résultat reste consultable');

  let opened: string | null = null;
  const stop = onOpenJob((target) => {
    opened = target.id;
  });
  success.action?.run();
  stop();
  assert.equal(opened, id, '« Ouvrir » demande le dialogue de la tâche');

  consumeJob(id);
  assert.equal(latestJob('interface'), null, 'ouvert dans l’éditeur ou rejeté : plus remontré');
  assert.deepEqual(titles(id), []);
});

test('« Annuler » arrête vraiment la tâche : signal abandonné, fin « annulée », notification', async () => {
  const work = controlled();
  const id = startJob(spec('Menu à annuler'), work.run);
  work.control().attemptStarted(1);
  cancelJob(id);
  assert.equal(work.control().signal.aborted, true);
  // Phases signalées après l’annulation : ignorées.
  work.control().phase('checking');
  assert.equal(getJob(id)?.phase, 'sending');
  work.handle.reject(Object.assign(new Error('Génération annulée'), { name: 'AbortError' }));
  await settle();
  assert.equal(getJob(id)?.phase, 'cancelled');
  assert.deepEqual(titles(id), ['Génération annulée']);
  assert.equal(latestJob('interface'), null, 'une tâche annulée ne se remontre pas');
});

test('échec : message clair sans jargon, qui reste, avec « Voir le détail »', async () => {
  const work = controlled();
  const id = startJob(spec(), work.run);
  work.handle.reject(new Error(`Délai dépassé${NBSP}: pas de réponse en 600${NBSP}s, la génération est abandonnée`));
  await settle();
  assert.equal(getJob(id)?.phase, 'failed');
  const error = getToasts().find((toast) => toast.group === id)!;
  assert.equal(error.variant, 'error');
  assert.equal(error.duration, null, 'une erreur ne disparaît pas seule');
  assert.equal(error.action?.label, 'Voir le détail');
  assert.equal(error.message, 'Le fournisseur n’a pas répondu à temps.');
  assert.match(getJob(id)?.error ?? '', /600/, 'le détail complet reste dans la tâche');
  consumeJob(id);
});

test('aucun document valide : échec, mais la génération reste consultable', async () => {
  const work = controlled();
  const id = startJob(spec(), work.run);
  const failure = `Aucun document valide après 3${NBSP}essais${NBSP}: reformule la demande ou augmente le nombre d’essais`;
  work.handle.resolve({ value: { menu: null, errors: ['$.id : attendu'] }, failure });
  await settle();
  const job = getJob(id)!;
  assert.equal(job.phase, 'failed');
  assert.deepEqual(job.result, { menu: null, errors: ['$.id : attendu'] });
  assert.equal(plain(getToasts().find((toast) => toast.group === id)?.message), 'Aucun document valide après 3 essais');
  assert.equal(latestJob('interface')?.id, id);
  consumeJob(id);
});

test('dialogue ouvert sur la tâche : ni essai refusé ni succès notifiés (il les montre déjà)', async () => {
  const work = controlled();
  const id = startJob(spec(), work.run);
  const unwatch = watchJob(id);
  work.control().attemptStarted(1);
  work.control().attemptFinished(['$.id : attendu']);
  work.handle.resolve({ value: { menu: {} } });
  await settle();
  assert.deepEqual(titles(id), []);
  unwatch();
  consumeJob(id);
});

test('texture : étapes et phases propres aux images', () => {
  const work = controlled();
  const id = startJob({ ...spec('Épée en diamant', 'texture'), providerName: 'OpenAI', providerKind: 'cloud', maxAttempts: 1 }, work.run);
  work.control().attemptStarted(1);
  work.control().remote({ phase: 'waiting', events: 0 });
  assert.equal(title(id), 'OpenAI réfléchit…');
  work.control().phase('rendering');
  assert.equal(title(id), 'Mise aux contraintes : grille, palette, transparence…');
  assert.deepEqual(jobSteps(getJob(id)!), { steps: ['Demande', 'Envoi', 'Image', 'Contraintes'], current: 3 });
  cancelJob(id);
});

test('messages d’erreur des notifications', () => {
  assert.equal(friendlyError(`Codex CLI s’est arrêté en erreur (exit code: 1)${NBSP}: You've hit your usage limit.`), 'Crédit ou quota épuisé chez le fournisseur.');
  assert.equal(friendlyError(`Codex CLI s’est arrêté en erreur (exit code: 1)${NBSP}: boom`), 'Codex CLI s’est arrêté en erreur');
  assert.equal(friendlyError(`Connexion impossible à http://127.0.0.1:11434${NBSP}: le service est-il lancé${NBSP}?`), 'Le fournisseur est injoignable.');
  assert.equal(friendlyError('Mistral : limite de débit atteinte (429)'), 'Trop de demandes : le fournisseur demande d’attendre un peu.');
});

test('notifications : durées par défaut, remplacement en place, fermeture', () => {
  const first = showToast({ variant: 'info', title: 'Premier' });
  const second = showToast({ variant: 'progress', title: 'Deuxième' });
  assert.equal(getToasts().find((toast) => toast.id === first)?.duration, TOAST_DURATION);
  assert.equal(getToasts().find((toast) => toast.id === second)?.duration, null, 'une progression reste');
  showToast({ id: first, variant: 'error', title: 'Premier, en erreur' });
  const ids = getToasts().map((toast) => toast.id);
  assert.ok(ids.indexOf(first) < ids.indexOf(second), 'remplacée, elle garde sa place');
  const replaced = getToasts().find((toast) => toast.id === first)!;
  assert.equal(replaced.duration, null);
  assert.equal(replaced.version, 2);
  dismissToast(first);
  dismissToast(second);
  assert.ok(!getToasts().some((toast) => toast.id === first || toast.id === second));
});

test('chronomètre et durées', () => {
  assert.equal(formatClock(7_400), '0:07');
  assert.equal(formatClock(72_000), '1:12');
  assert.equal(formatClock(3_723_000), '1:02:03');
  assert.equal(plain(formatSpan(42_000)), '42 s');
  assert.equal(plain(formatSpan(72_000)), '1 min 12 s');
  assert.equal(plain(formatSpan(120_000)), '2 min');
});
