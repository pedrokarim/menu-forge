// Formulaires Bedrock (docs/format.md § Formulaire Bedrock) : texte envoyé, émulation des liaisons
// du pack mcrs_ui, forme sur disque, résolution, références, renommage d’état et mode « Essayer ».
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLegacyText, stripLegacy } from '../src/lib/legacyText.ts';
import {
  FORM_LAYOUTS,
  createEmptyForm,
  formButtonText,
  formLayout,
  formWireTitle,
  hasFlag,
  motdBannerHeight,
  splitAtCut,
  storeCategoryCount,
  visibleFormButtons,
} from '../src/model/bedrockForm.ts';
import { menuForDisk, normalizeMenu } from '../src/model/menu.ts';
import type { MenuDefinition } from '../src/model/menu.ts';
import { buildPreviewContext, DEFAULT_PREVIEW } from '../src/model/preview.ts';
import { menuReferences, rewriteMenuReferences } from '../src/model/references.ts';
import { resolveMenu } from '../src/model/resolve.ts';
import { clickFormButton, startSession } from '../src/model/simulate.ts';
import { renameState, stateUsageCount } from '../src/model/stateEdit.ts';

function hub(): MenuDefinition {
  return normalizeMenu({
    formatVersion: 1,
    id: 'hub',
    name: 'Hub',
    state: { tab: { type: 'enum', values: ['a', 'b'], default: 'a' } },
    form: {
      layout: 'grid',
      title: 'Hub {state.tab}',
      buttons: [
        { id: 'spawn', text: 'Spawn', onClick: [{ type: 'command', command: 'tp {viewer.name}' }, { type: 'close' }] },
        { id: 'op', text: 'Op', visibleWhen: { flag: 'viewer.op' }, onClick: [{ type: 'setState', state: 'tab', value: 'b' }] },
        { id: 'next', text: 'Suivant', visibleWhen: { state: 'tab', is: 'a' }, onClick: [{ type: 'open', menu: 'shop' }] },
      ],
    },
  } as unknown as MenuDefinition);
}

test('huit dispositions, drapeaux de mcrs_ui distincts', () => {
  assert.equal(FORM_LAYOUTS.length, 8);
  assert.equal(new Set(FORM_LAYOUTS.map((info) => info.flag)).size, 8);
  assert.deepEqual(
    Object.fromEntries(FORM_LAYOUTS.map((info) => [info.layout, info.flag])),
    {
      grid: '§m§a',
      image_grid: '§m§d',
      square_image: '§m§e',
      store: '§m§0',
      left_button: '§m§b',
      bottom_button: '§m§c',
      motd: '§m§f',
      wrapped: '§m§1',
    },
  );
  assert.equal(formLayout('store').namespace, 'mcrs_store_modal');
  assert.throws(() => formLayout('carousel' as never), /inconnue/u);
});

test('texte et titre envoyés, comme les anciens formulaires de mc-rs', () => {
  assert.equal(formButtonText({ text: 'Mode Bedwars', role: 'banner' }), '§m§a Mode Bedwars');
  assert.equal(formButtonText({ text: 'Premium', role: 'special' }), '§m§b Premium');
  assert.equal(formButtonText({ text: 'Forêt', subtitle: '§aDifficulté facile' }), 'Forêt\t§aDifficulté facile');
  assert.equal(formButtonText({ text: 'A', subtitle: '' }), 'A');
  assert.equal(formWireTitle('grid', '§l§6mc-rs§r §eHUB'), '§m§a §l§6mc-rs§r §eHUB');
  assert.equal(formWireTitle('store', '§6Store'), '§m§0 §6Store');
});

test('boutons envoyés : visibleWhen évaluée dans l’état', () => {
  const menu = hub();
  const ids = (flags: string[], state = {}) =>
    visibleFormButtons(menu.form!, buildPreviewContext(menu, { ...DEFAULT_PREVIEW, flags, state })).map((button) => button.id);
  assert.deepEqual(ids([]), ['spawn', 'next']);
  assert.deepEqual(ids(['viewer.op']), ['spawn', 'op', 'next']);
  assert.deepEqual(ids(['viewer.op'], { tab: 'b' }), ['spawn', 'op']);
});

test('émulation des liaisons du pack : coupe au 100ᵉ caractère, drapeaux, boutique, bannière du motd', () => {
  assert.deepEqual(splitAtCut('Forêt\t§aFacile'), { head: 'Forêt§aFacile', rest: '' }, 'sous-titre collé au titre');
  const padded = `${'Forêt'.padEnd(99)}\t§aFacile`;
  assert.deepEqual(splitAtCut(padded), { head: 'Forêt'.padEnd(99), rest: '§aFacile' });
  assert.equal(hasFlag('§m§a Populaire', '§m§a'), true);
  assert.equal(hasFlag('Populaire', '§m§a'), false);
  assert.equal(storeCategoryCount('a3populaire'), 3);
  assert.equal(storeCategoryCount('§m§aPopulaire'), 0, 'deux premiers caractères : « §m »');
  assert.equal(storeCategoryCount(''), 0);
  assert.equal(motdBannerHeight('§m§a 80'), 80);
  assert.equal(motdBannerHeight('§m§a Banner'), 0, 'texte non numérique : bannière de hauteur nulle');
});

test('codes § de Bedrock : couleurs de matériaux, gras, remise à zéro', () => {
  assert.deepEqual(parseLegacyText('§l§6mc-rs§r §eHUB'), [
    { text: 'mc-rs', color: '#ffaa00', bold: true, italic: false },
    { text: ' ', color: null, bold: false, italic: false },
    { text: 'HUB', color: '#ffff55', bold: false, italic: false },
  ]);
  assert.deepEqual(parseLegacyText('§m§a x'), [{ text: ' x', color: '#55ff55', bold: false, italic: false }], '§m est une couleur sur Bedrock');
  assert.equal(stripLegacy('§c↩ Retour§'), '↩ Retour');
});

test('sur disque, un formulaire n’a ni coffre ni couches ; en mémoire, des valeurs neutres', () => {
  const created = createEmptyForm('motd', 'Message', 'motd');
  assert.equal(created.container.rows, 6);
  const disk = menuForDisk(created);
  assert.equal('container' in disk, false);
  assert.equal('layers' in disk, false);
  assert.equal('state' in disk, false, 'état vide retiré');
  assert.deepEqual(disk.form?.buttons.map((button) => button.role ?? 'button'), ['banner', 'button', 'button']);
  assert.deepEqual(normalizeMenu(disk), { ...disk, container: { type: 'chest', rows: 6 }, layers: [] });
  const chest = { formatVersion: 1, id: 'c', name: 'C', container: { type: 'chest', rows: 1 }, layers: [] } as MenuDefinition;
  assert.equal(menuForDisk(chest), chest, 'un coffre est inchangé');
  assert.deepEqual(createEmptyForm('s', 'S', 'store').form?.content, 'a2', 'boutique : deux onglets annoncés');
});

test('résolution : un formulaire est déjà résolu et ne sert ni de gabarit ni de composant', () => {
  const form = hub();
  const resolved = resolveMenu(form, () => undefined);
  assert.equal(resolved.menu, form);
  assert.deepEqual(resolved.errors, []);
  assert.equal(resolveMenu({ ...form, extends: ['frame'] }, () => undefined).errors.length, 1);
  const chest = { formatVersion: 1, id: 'c', name: 'C', container: { type: 'chest', rows: 1 }, layers: [], extends: ['hub'], includes: [{ component: 'hub' }] } as MenuDefinition;
  const errors = resolveMenu(chest, (id) => (id === 'hub' ? form : undefined)).errors.join('\n');
  assert.match(errors, /gabarit/u);
  assert.match(errors, /composant/u);
});

test('références et renommages suivent les boutons de formulaire', () => {
  const form = hub();
  assert.deepEqual(menuReferences([form], 'shop').map((reference) => [reference.id, reference.opens]), [['hub', 1]]);
  assert.equal(rewriteMenuReferences(form, 'shop', 'boutique'), true);
  assert.deepEqual(form.form?.buttons[2].onClick, [{ type: 'open', menu: 'boutique' }]);

  assert.equal(stateUsageCount(form, 'tab'), 3, 'titre, setState, visibleWhen');
  renameState(form, 'tab', 'onglet');
  assert.equal(form.form?.title, 'Hub {state.onglet}');
  assert.deepEqual(form.form?.buttons[1].onClick, [{ type: 'setState', state: 'onglet', value: 'b' }]);
  assert.deepEqual(form.form?.buttons[2].visibleWhen, { state: 'onglet', is: 'a' });
});

test('mode « Essayer » : clic sur un bouton de formulaire', () => {
  const form = hub();
  const shop = { formatVersion: 1, id: 'shop', name: 'Boutique', container: { type: 'chest', rows: 1 }, layers: [] } as MenuDefinition;
  const lookup = (id: string) => ({ hub: form, shop })[id as 'hub' | 'shop'];
  let session = startSession('hub', DEFAULT_PREVIEW);
  session = clickFormButton(session, lookup, 'spawn');
  assert.equal(session.closed, true);
  assert.match(session.log.map((entry) => entry.text).join('\n'), /tp Steve/u);

  session = clickFormButton(startSession('hub', DEFAULT_PREVIEW), lookup, 'op');
  assert.match(session.log.at(-1)?.text ?? '', /condition d’affichage est fausse/u);
  session = clickFormButton(startSession('hub', DEFAULT_PREVIEW), lookup, 'next');
  assert.deepEqual(session.stack.map((frame) => frame.menuId), ['hub', 'shop']);
  assert.equal(clickFormButton(session, lookup, 'absent'), session);
});
