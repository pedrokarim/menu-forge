// Nom d’image tiré de la description (« Générer une texture par IA ») : coupé au dernier mot
// entier, sans ponctuation pendante ni « … », et l’identifiant qui en dérive.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROMPT_NAME_LIMIT, nameFromPrompt } from '../src/ai/naming.ts';
import { sanitizeId } from '../src/model/menu.ts';

test('coupé au dernier mot entier, virgule pendante retirée', () => {
  const name = nameFromPrompt('Émeraude taillée, facettes vert vif, contour sombre et reflet blanc');
  assert.equal(name, 'Émeraude taillée, facettes vert vif');
  assert.equal(sanitizeId(name), 'emeraude_taillee_facettes_vert_vif');
});

test('deux-points pendant retiré', () => {
  const name = nameFromPrompt('Icône de quête principale du serveur : parchemin roulé');
  assert.equal(name, 'Icône de quête principale du serveur');
});

test('description courte gardée telle quelle', () => {
  assert.equal(nameFromPrompt('Épée en diamant'), 'Épée en diamant');
  assert.equal(nameFromPrompt('  Épée   en\ndiamant  '), 'Épée en diamant');
});

test('mot qui finit pile à la limite : gardé entier', () => {
  const head = 'a'.repeat(PROMPT_NAME_LIMIT - 5);
  assert.equal(nameFromPrompt(`${head} bcde fin`), `${head} bcde`);
  assert.equal(nameFromPrompt(`${head} bcdef`), head);
});

test('jamais plus long que la limite, jamais de points de suspension', () => {
  const prompts = [
    'Bouton de boutique vert, fond sombre, bordure dorée et coins arrondis',
    'Cadre de coffre en bois clair; ferrures noires; charnières visibles',
    'Onglet « armes » de la boutique – épée croisée avec une hache',
    'Fond de menu : pierre taillée, mousse, lierre…',
  ];
  for (const prompt of prompts) {
    const name = nameFromPrompt(prompt);
    assert.ok(name.length > 0 && name.length <= PROMPT_NAME_LIMIT, `« ${name} » (${name.length} caractères)`);
    assert.ok(!name.includes('…'), `« ${name} » sans points de suspension`);
    assert.doesNotMatch(name, /[\s,;:.\-–—«]$/u, `« ${name} » sans ponctuation pendante`);
    assert.ok(prompt.startsWith(name), `« ${name} » est le début de la description`);
  }
});

test('premier mot plus long que la limite : coupé net', () => {
  const word = 'x'.repeat(PROMPT_NAME_LIMIT + 10);
  assert.equal(nameFromPrompt(word), 'x'.repeat(PROMPT_NAME_LIMIT));
});

test('ponctuation finale d’une description courte retirée, vide si aucun mot', () => {
  assert.equal(nameFromPrompt('Épée en diamant.'), 'Épée en diamant');
  assert.equal(nameFromPrompt('Bouclier :'), 'Bouclier');
  assert.equal(nameFromPrompt(' , : '), '');
});

test('limite réglable', () => {
  assert.equal(nameFromPrompt('Épée en diamant, lame cyan', 12), 'Épée en');
});
