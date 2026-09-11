/**
 * Éditeurs visuels : actions au clic, conditions, item d’un slot, variables
 * d’état (renommage suivi dans les références), mode « Essayer »,
 * composants (instance, détacher, créer depuis une sélection).
 */
import { existsSync } from 'node:fs';
import {
  api,
  contextItem,
  inspectorField,
  menuCanvas,
  modal,
  open,
  outlineRow,
  readJson,
  rightClick,
  textOf,
  waitStatus,
  workspacePath,
} from '../lib/studio.mjs';

export const title = 'Éditeurs visuels, essai et composants';

async function duplicateMenu(t, from, to, name) {
  if (existsSync(workspacePath(t, 'menus', `${to}.menu.json`))) return;
  await api(t, '/documents/duplicate', { method: 'POST', body: { type: 'menu', from, to, name } });
}

const actionTypes = (page) => page.locator('.inspector .action-editor .action-type').evaluateAll((nodes) => nodes.map((node) => node.value));
const slotOf = (menu, id) => menu.slots.find((slot) => slot.id === id);

export const tests = [
  {
    name: 'actions, conditions et item d’un slot',
    async run(t) {
      const { page } = t;
      await duplicateMenu(t, 'shop', 'shop_visual', 'Boutique visuelle');
      await open(t, '#/editeur/menus/shop_visual');
      await outlineRow(page, 2, 'buy').click();
      const actions = page.locator('.inspector .action-editor');
      await actions.waitFor();
      t.equal(await actionTypes(page), ['sound', 'open'], 'actions du bouton « buy »');
      await actions.getByRole('button', { name: 'Ajouter', exact: true }).click();
      await contextItem(page, 'Changer l’état').click();
      await t.waitEqual(() => actionTypes(page), ['sound', 'open', 'setState'], 'action « Changer l’état » ajoutée');
      const added = actions.locator('.action-card').nth(2);
      await added.locator('select[aria-label="Nouvelle valeur"]').selectOption('food');
      await added.focus();
      await page.keyboard.press('Alt+ArrowUp');
      await t.waitEqual(() => actionTypes(page), ['sound', 'setState', 'open'], 'Alt+↑ : l’action monte');
      await actions.locator('.action-card').first().getByRole('button', { name: 'Supprimer l’action', exact: true }).click();
      await t.waitEqual(() => actionTypes(page), ['setState', 'open'], 'action supprimée');
      await actions.locator('select[aria-label="Menu à ouvrir"]').selectOption('profile');
      t.check((await textOf(actions.locator('.action-card').nth(1).locator('.action-summary'))).length > 0, 'résumé de l’action');

      const visible = page.locator('.inspector .condition-editor').filter({ has: page.locator('.field-label', { hasText: /^Visible si$/ }) });
      await visible.locator('select[aria-label^="Visible si"]').selectOption({ label: 'tab = tools' });
      await t.waitFor(async () => !(await textOf(visible.locator('.condition-summary'))).startsWith('Toujours'), 'condition rapide appliquée');
      const enabled = page.locator('.inspector .condition-editor').filter({ has: page.locator('.field-label', { hasText: /^Actif si$/ }) });
      t.check(await enabled.locator('.condition-node.kind-any').isVisible(), 'arbre « au moins une » de « Actif si »');

      await page.locator('.inspector .item-editor').getByRole('radio', { name: 'Matériau', exact: true }).click();
      await inspectorField(page, 'Matériau').fill('diamond');
      await t.waitEqual(() => inspectorField(page, 'Matériau').inputValue(), 'DIAMOND', 'matériau en majuscules');
      await inspectorField(page, 'Nom (MiniMessage)').fill('<gold>Acheter vite');
      const tooltip = page.locator('.inspector .mc-tooltip');
      await t.waitFor(async () => (await textOf(tooltip)).includes('Acheter vite'), 'aperçu de l’infobulle');
      t.equal(await tooltip.locator('span', { hasText: 'Acheter vite' }).first().evaluate((node) => getComputedStyle(node).color), 'rgb(255, 170, 0)', 'couleur <gold> dans l’aperçu');

      await page.keyboard.press('Control+s');
      await waitStatus(t, '« shop_visual » enregistré');
      const buy = slotOf(readJson(workspacePath(t, 'menus', 'shop_visual.menu.json')), 'buy');
      t.equal(buy.onClick, [{ type: 'setState', state: 'tab', value: 'food' }, { type: 'open', menu: 'profile' }], 'actions enregistrées');
      t.equal(buy.visibleWhen, { state: 'tab', is: 'tools' }, 'condition enregistrée');
      t.equal([buy.item.material, buy.item.name, buy.item.invisible], ['DIAMOND', '<gold>Acheter vite', undefined], 'item enregistré');
    },
  },
  {
    name: 'variables d’état : renommer, ajouter',
    async run(t) {
      const { page } = t;
      await duplicateMenu(t, 'shop', 'shop_state', 'Boutique à états');
      await open(t, '#/editeur/menus/shop_state');
      const editor = page.locator('.inspector .state-editor');
      await editor.waitFor();
      const names = () => editor.locator('input[aria-label="Nom de la variable"]').evaluateAll((nodes) => nodes.map((node) => node.value));
      t.equal(await names(), ['tab', 'page'], 'variables du menu');
      const first = editor.locator('input[aria-label="Nom de la variable"]').first();
      await first.fill('onglet');
      await first.press('Enter');
      await t.waitEqual(names, ['onglet', 'page'], 'variable renommée');
      await editor.getByRole('button', { name: 'Ajouter', exact: true }).click();
      await contextItem(page, 'Booléen').click();
      await t.waitEqual(names, ['onglet', 'page', 'enabled'], 'variable booléenne ajoutée');
      await page.keyboard.press('Control+s');
      await waitStatus(t, '« shop_state » enregistré');
      const menu = readJson(workspacePath(t, 'menus', 'shop_state.menu.json'));
      t.equal(Object.keys(menu.state).sort(), ['enabled', 'onglet', 'page'], 'états enregistrés');
      t.equal(slotOf(menu, 'tab_tools').onClick, [{ type: 'setState', state: 'onglet', value: 'tools' }], 'actions `setState` suivent le renommage');
      t.equal(menu.layers.find((layer) => layer.id === 'tab_food_active').visibleWhen, { state: 'onglet', is: 'food' }, 'conditions des couches suivent le renommage');
      t.equal(slotOf(menu, 'buy').enabledWhen.any[0].state, 'onglet', 'conditions des slots suivent le renommage');
    },
  },
  {
    name: 'mode « Essayer »',
    async run(t) {
      const { page } = t;
      await open(t, '#/editeur/menus/shop');
      const canvas = await menuCanvas(page);
      await page.keyboard.press('e');
      await page.locator('.try-journal').waitFor();
      t.check(await page.locator('.try-panel').isVisible(), 'E : panneau d’essai');
      const stack = page.locator('.try-stack li');
      const entries = page.locator('.try-log-entry');
      const clickCell = async (col, row) => {
        const point = canvas.cell(col, row);
        await page.mouse.click(point.x, point.y);
        await t.wait(150);
      };
      await clickCell(1, 0);
      await t.waitFor(async () => (await entries.count()) > 0, 'onglet cliqué : action au journal');
      await clickCell(4, 4);
      await t.waitEqual(() => stack.count(), 2, '« Acheter » ouvre la confirmation (pile de deux menus)');
      t.check((await textOf(stack.last())).includes('Confirmation d’achat'), 'le menu ouvert est en haut de la pile');
      await clickCell(5, 4);
      await t.waitEqual(() => stack.count(), 1, '« Non » revient au menu précédent');
      await clickCell(4, 4);
      await t.waitEqual(() => stack.count(), 2, 'confirmation rouverte');
      await page.keyboard.press('Backspace');
      await t.waitEqual(() => stack.count(), 1, 'Retour arrière : « back »');
      await clickCell(8, 0);
      await t.waitFor(() => page.locator('.try-panel .warning').isVisible(), '« Fermer » : inventaire fermé');
      await page.locator('.try-panel').getByRole('button', { name: 'Rouvrir', exact: true }).click();
      await t.waitFor(async () => (await page.locator('.try-panel .warning').count()) === 0, '« Rouvrir »');
      await page.keyboard.press('Escape');
      await t.waitFor(async () => (await page.locator('.try-journal').count()) === 0, 'Échap : retour à l’édition');
      t.check(await page.getByRole('button', { name: 'Enregistré', exact: true }).isVisible(), 'l’essai ne modifie pas le menu');
    },
  },
  {
    name: 'composants : instance, détacher, créer depuis une sélection',
    async run(t) {
      const { page } = t;
      await open(t, '#/editeur/menus/profile');
      const back = outlineRow(page, 2, 'nav_back');
      t.equal(await textOf(back.locator('.badge')), 'composant', 'élément d’instance marqué « composant »');
      const cards = page.locator('.inspector .includes-editor .include-card');
      await t.waitEqual(() => cards.count(), 1, 'une instance incluse');
      t.equal(await cards.first().locator('select[aria-label="Composant"]').inputValue(), 'back_bar', 'composant « back_bar »');
      await cards.first().getByRole('button', { name: 'Plus d’actions', exact: true }).click();
      await contextItem(page, 'Détacher (copier ses éléments ici)').click();
      await waitStatus(t, 'détachée');
      await t.waitEqual(() => cards.count(), 0, 'instance détachée');
      t.equal(await back.locator('.badge').count(), 0, 'ses éléments appartiennent au menu');
      await page.keyboard.press('Control+z');
      await t.waitEqual(() => cards.count(), 1, 'Ctrl+Z : l’instance revient');

      await duplicateMenu(t, 'shop', 'shop_component', 'Boutique à composant');
      await open(t, '#/editeur/menus/shop_component');
      await outlineRow(page, 0, 'previous').click();
      await outlineRow(page, 0, 'next').click({ modifiers: ['Control'] });
      await rightClick(outlineRow(page, 0, 'next'));
      await contextItem(page, 'Créer un composant…').click();
      const dialog = modal(page, 'Nouveau composant');
      await inspectorField(page, 'Nom', '.modal').fill('Pagination');
      t.equal(await inspectorField(page, 'Identifiant', '.modal').inputValue(), 'pagination', 'identifiant du composant déduit du nom');
      await dialog.getByRole('button', { name: 'Créer le composant', exact: true }).click();
      await waitStatus(t, 'Composant « pagination » créé avec 2 éléments');
      const component = readJson(workspacePath(t, 'menus', 'pagination.menu.json'));
      t.equal([component.component, component.layers.map((layer) => layer.id)], [true, ['previous', 'next']], 'fichier du composant');
      await t.waitEqual(() => textOf(outlineRow(page, 0, 'next').locator('.badge')), 'composant', 'le menu en garde une instance');
      await page.keyboard.press('Control+s');
      await waitStatus(t, '« shop_component » enregistré');
      const menu = readJson(workspacePath(t, 'menus', 'shop_component.menu.json'));
      t.equal(menu.includes, [{ component: 'pagination' }], 'instance enregistrée');
      t.check(!menu.layers.some((layer) => layer.id === 'previous' || layer.id === 'next'), 'les éléments ont quitté le menu');
    },
  },
];
