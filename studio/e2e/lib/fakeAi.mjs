/**
 * Faux fournisseurs d’IA pour les tests de bout en bout : un serveur HTTP
 * local (port libre) qui joue Ollama (texte) et Automatic1111 (images). Le
 * backend du studio les appelle comme de vrais serveurs locaux ; rien ne sort
 * du poste, aucune clé n’est utilisée.
 *
 * Chaque génération reste **en attente** jusqu’à ce que le test la libère
 * (`release`) : un fournisseur aussi lent qu’on veut, et des états
 * observables sans course contre la montre. `delayMs` ajoute un délai réel
 * à chaque réponse libérée.
 *
 * Interface : la première réponse d’une conversation est refusée par le
 * schéma (texte trop haut), la correction est valide (`menu(id, rows, corrected)`,
 * repris des données de démonstration du site).
 */
import http from 'node:http';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startFakeAi({ menu, image, delayMs = 0 }) {
  /** Réponses en attente : `{ path, fire, done }`. */
  const pending = [];
  const seen = { chat: 0, image: 0 };
  const reply = (response, value) => {
    if (response.writableEnded) return;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  const hold = (path, response, answer) => {
    const entry = { path, done: false };
    entry.fire = () => {
      if (entry.done) return;
      entry.done = true;
      setTimeout(() => reply(response, answer()), delayMs);
    };
    // Connexion fermée par le backend : plus rien à libérer.
    response.on('close', () => {
      entry.done = true;
    });
    pending.push(entry);
  };
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (part) => (body += part));
    request.on('end', () => {
      if (request.url === '/api/tags') return reply(response, { models: [{ name: 'llama3.2:latest' }] });
      if (request.url === '/sdapi/v1/sd-models') return reply(response, [{ title: 'e2e.safetensors' }]);
      if (request.url === '/api/chat') {
        seen.chat++;
        const { messages } = JSON.parse(body);
        const system = messages[0]?.content ?? '';
        const id = /"id": "([a-z0-9_]+)"/.exec(system)?.[1] ?? 'menu';
        const rows = Number(/"rows": (\d)/.exec(system)?.[1] ?? 6);
        const corrected = messages.some((message) => String(message.content).includes('ne passe pas la validation'));
        return hold('/api/chat', response, () => ({ message: { role: 'assistant', content: JSON.stringify(menu(id, rows, corrected)) }, done: true }));
      }
      if (request.url === '/sdapi/v1/txt2img') {
        seen.image++;
        return hold('/sdapi/v1/txt2img', response, () => ({ images: [image] }));
      }
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('inconnu');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const waitingOn = (path) => pending.filter((entry) => entry.path === path && !entry.done);
  return {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    seen,
    /** Nombre de générations `path` en attente. */
    waiting: (path) => waitingOn(path).length,
    /** Attend qu’une génération `path` soit en attente, puis y répond. */
    async release(path, timeout = 15_000) {
      const deadline = Date.now() + timeout;
      for (;;) {
        const [entry] = waitingOn(path);
        if (entry) {
          entry.fire();
          return;
        }
        if (Date.now() > deadline) throw new Error(`faux fournisseur${String.fromCharCode(160)}: aucune requête ${path} en attente`);
        await wait(50);
      }
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
