/**
 * Exports : « Exporter vers le plugin » et « Pack ZIP ». Le dossier d’export
 * est réglé, par l’écran Paramètres, sur un sous-dossier de l’espace
 * temporaire ; un export n’est jamais lancé si ce n’est pas le cas.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CheckError } from '../lib/harness.mjs';
import { api, contextItem, menuCanvas, open, readJson, waitStatus, workspacePath } from '../lib/studio.mjs';
import { listZip, readZipEntry } from '../lib/png.mjs';
import { createBlankMenu } from './02-menu-editor.mjs';

export const title = 'Exports';

/** Refuse tout export si le dossier réglé n’est pas celui de l’espace temporaire. */
async function guardExportDir(t) {
  const settings = await api(t, '/settings');
  const target = settings.export.enderiumResources;
  if (!target || path.resolve(target) !== path.resolve(t.env.exportDir) || !path.resolve(target).startsWith(path.resolve(t.env.root))) {
    throw new CheckError(`export refusé${' '}: dossier réglé hors de l’espace temporaire (${target})`);
  }
  t.check(true, 'dossier d’export dans l’espace temporaire');
}

const exportRoot = (t) => path.join(t.env.exportDir, 'menuforge');
const exportedFiles = (t) => (existsSync(exportRoot(t)) ? readdirSync(exportRoot(t), { recursive: true }).map((file) => String(file).replaceAll('\\', '/')) : []);

export const tests = [
  {
    name: 'dossier d’export réglé dans l’espace temporaire',
    async run(t) {
      const { page } = t;
      await open(t, '#/parametres');
      const field = page.getByLabel('Dossier du serveur Java (ressources du plugin)', { exact: true });
      await field.fill(t.env.exportDir);
      await field.press('Enter');
      await t.waitFor(async () => (await api(t, '/settings')).export.enderiumResources === t.env.exportDir, 'dossier enregistré dans les réglages');
      await guardExportDir(t);
    },
  },
  {
    name: 'exporter vers le plugin',
    async run(t) {
      const { page } = t;
      await guardExportDir(t);
      await open(t, '#/editeur/menus/shop');
      await page.getByRole('button', { name: 'Exporter', exact: true }).click();
      await waitStatus(t, 'Exporté vers le plugin', 'export terminé');
      await waitStatus(t, exportRoot(t), 'message : dossier d’export');
      const snapshot = await api(t, '/workspace');
      const menus = snapshot.menus.filter((menu) => !menu.template);
      const files = exportedFiles(t);
      t.check(files.includes('.menu-forge-export.json'), 'manifeste de l’export');
      for (const menu of menus) {
        const file = files.find((candidate) => candidate.startsWith('menus/') && path.basename(candidate).startsWith(`${menu.id}.`));
        t.check(file, `menu « ${menu.id} » exporté`);
        const exported = JSON.parse(readFileSync(path.join(exportRoot(t), file), 'utf8'));
        t.check(!('extends' in exported) && !('template' in exported), `« ${menu.id} »${' '}: gabarits appliqués`);
        t.check(exported.layers.every((layer) => !('generator' in layer)), `« ${menu.id} »${' '}: sans métadonnées du générateur`);
        for (const layer of exported.layers) {
          t.check(files.includes(`textures/${layer.texture}`), `« ${menu.id} »${' '}: texture ${layer.texture} exportée`);
        }
      }
      const templates = snapshot.menus.filter((menu) => menu.template).map((menu) => menu.id);
      t.check(!files.some((file) => templates.some((id) => path.basename(file).startsWith(`${id}.`))), 'les gabarits eux-mêmes ne sont pas exportés');
    },
  },
  {
    name: 'pack ZIP de test',
    async run(t) {
      const { page } = t;
      await open(t, '#/editeur/menus/shop');
      await page.getByRole('button', { name: 'Pack ZIP', exact: true }).click();
      await waitStatus(t, 'Pack de test écrit', 'pack écrit');
      const zip = workspacePath(t, 'exports', 'menuforge-pack.zip');
      t.check(existsSync(zip), 'archive dans exports/ de l’espace');
      const bytes = readFileSync(zip);
      t.equal(bytes.subarray(0, 2).toString('latin1'), 'PK', 'signature zip');
      const entries = listZip(bytes);
      const names = entries.map((entry) => entry.name);
      const meta = JSON.parse(readZipEntry(bytes, entries.find((entry) => entry.name === 'pack.mcmeta')).toString('utf8'));
      t.equal(meta.pack.pack_format, 46, '`pack_format` des paramètres');
      t.check(names.some((name) => /^assets\/menuforge\/font\/.+\.json$/.test(name)), 'polices générées');
      t.check(names.some((name) => /^assets\/menuforge\/textures\/.+\.png$/.test(name)), 'textures du pack');
    },
  },
  {
    name: 'raccourcis, menu contextuel et fichiers retirés',
    async run(t) {
      const { page } = t;
      await guardExportDir(t);
      await createBlankMenu(t, 'e2e_export_tmp');
      await open(t, '#/editeur/menus/shop');
      await page.keyboard.press('Control+e');
      await waitStatus(t, 'Exporté vers le plugin', 'Ctrl+E : export vers le plugin');
      t.check(exportedFiles(t).some((file) => path.basename(file).startsWith('e2e_export_tmp.')), 'menu temporaire exporté');
      await page.keyboard.press('Control+Shift+E');
      await waitStatus(t, 'Pack de test écrit', 'Ctrl+Maj+E : pack ZIP');
      await api(t, '/documents/trash', { method: 'POST', body: { type: 'menu', id: 'e2e_export_tmp' } });
      await open(t, '#/editeur/menus/shop');
      const canvas = await menuCanvas(page);
      const empty = canvas.at(-16, 100);
      await page.mouse.click(empty.x, empty.y, { button: 'right' });
      // Le nom accessible d’une entrée comprend son raccourci (« Ctrl E »).
      await contextItem(page, /^Exporter vers le plugin/).click();
      await waitStatus(t, /ancien fichier retiré|anciens fichiers retirés/, 'le fichier d’un menu disparu est retiré');
      t.check(!exportedFiles(t).some((file) => path.basename(file).startsWith('e2e_export_tmp.')), 'plus de fichier pour le menu mis à la corbeille');
      const manifest = readJson(path.join(exportRoot(t), '.menu-forge-export.json'));
      t.check(!JSON.stringify(manifest).includes('e2e_export_tmp'), 'manifeste à jour');
    },
  },
];
