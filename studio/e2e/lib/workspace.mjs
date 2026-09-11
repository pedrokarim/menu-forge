/**
 * Espace de travail temporaire des tests : gabarits du dépôt copiés, menus,
 * assets et image de pixels de démonstration (`site/scripts/demo-workspace.mjs`,
 * textures générées ou dessinées par le studio lui-même), réglages sans
 * bibliothèque. Aucun asset tiers ne peut y entrer.
 */
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Crée le dossier de travail (sous le dossier temporaire du système) et renvoie ses chemins. */
export function createWorkDir(repoDir) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'menu-forge-e2e-'));
  const workspaceDir = path.join(root, 'workspace');
  const paths = {
    root,
    workspaceDir,
    templatesDir: path.join(root, 'templates'),
    cacheDir: path.join(root, 'cache'),
    viteCacheDir: path.join(root, 'vite'),
    settingsFile: path.join(root, 'settings.json'),
    librariesFile: path.join(root, 'libraries.json'),
    /** Dossier « Export vers le plugin » : réglé par le scénario d’export, jamais un vrai projet. */
    exportDir: path.join(root, 'plugin-resources'),
  };
  for (const folder of ['menus', 'assets', 'textures', 'pixels']) mkdirSync(path.join(workspaceDir, folder), { recursive: true });
  mkdirSync(paths.cacheDir, { recursive: true });
  mkdirSync(paths.exportDir, { recursive: true });
  cpSync(path.join(repoDir, 'templates'), paths.templatesDir, { recursive: true });
  writeFileSync(paths.librariesFile, '[]\n');
  const settings = {
    version: 1,
    activeWorkspace: workspaceDir,
    workspaces: [{ path: workspaceDir, name: 'e2e', lastOpened: new Date().toISOString() }],
    libraries: [],
    ui: { defaultZoom: 0, showGrid: true, confirmations: { delete: true, discardChanges: true } },
    // Dossier d’export vide au départ : seul le scénario d’export le règle, sur `exportDir`.
    export: { enderiumResources: null, namespace: 'menuforge', packFormat: 46 },
  };
  writeFileSync(paths.settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  return paths;
}

/** Données de démonstration du site (menus, assets, image de pixels). */
export async function loadDemoData(repoDir) {
  return import(pathToFileURL(path.join(repoDir, 'site', 'scripts', 'demo-workspace.mjs')).href);
}

/**
 * Écrit menus, assets, images de pixels et textures par l’API, depuis la page :
 * les PNG sont produits par le code du studio (`renderGenerator`, `renderAsset`,
 * encodeur PNG de l’éditeur de pixels).
 */
export async function seedWorkspace(page, { menus, assets, pixels }) {
  await page.evaluate(
    async ({ menus, assets, pixels }) => {
      const generator = await import('/src/model/generator.ts');
      const textureRender = await import('/src/model/textureRender.ts');
      const assetRender = await import('/src/asset/render.ts');
      const pixelDocument = await import('/src/pixel/document.ts');
      const pixelIo = await import('/src/pixel/io.ts');
      const pixelApi = await import('/src/lib/pixelApi.ts');
      const put = async (url, body, type) => {
        const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': type, 'X-Menu-Forge': '1' }, body });
        if (!response.ok) throw new Error(`${url} : ${response.status} ${await response.text()}`);
      };
      const putTexture = async (texture, canvas) =>
        put(`/api/textures/${texture.split('/').map(encodeURIComponent).join('/')}`, await generator.canvasToBlob(canvas), 'image/png');

      // Logo du projet (24 × 24, dessiné au pixel) comme texture de l’espace.
      const logo = new Image();
      logo.src = '/brand/logo.svg';
      await logo.decode();
      const logoCanvas = document.createElement('canvas');
      logoCanvas.width = 24;
      logoCanvas.height = 24;
      logoCanvas.getContext('2d').drawImage(logo, 0, 0, 24, 24);
      await putTexture('brand/logo.png', logoCanvas);

      for (const asset of assets) {
        await put(`/api/assets/${asset.id}`, JSON.stringify(asset, null, 2), 'application/json');
        await putTexture(`assets/${asset.id}.png`, await assetRender.renderAsset(asset));
      }
      for (const menu of menus) {
        for (const layer of menu.layers) {
          if (!layer.generator) continue;
          const blob = await textureRender.renderGeneratorBlob(layer.generator, layer);
          await put(`/api/textures/${layer.texture.split('/').map(encodeURIComponent).join('/')}`, blob, 'image/png');
        }
        await put(`/api/menus/${menu.id}`, JSON.stringify(menu, null, 2), 'application/json');
      }
      for (const image of pixels) {
        const { width, height } = image.size;
        let state = pixelDocument.createState(width, height);
        state = { ...state, layers: [] };
        for (const spec of image.layers) {
          const layer = pixelDocument.createLayer(width, height, state.layers);
          layer.name = spec.name;
          layer.opacity = spec.opacity ?? 100;
          if (spec.generator) layer.data.set(textureRender.renderGeneratorImage(spec.generator, { x: 0, y: 0 }).data);
          for (const [x, y, w, h, color] of spec.rects) {
            const rgb = [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));
            for (let row = y; row < y + h; row++) {
              for (let col = x; col < x + w; col++) layer.data.set([...rgb, 255], (row * width + col) * 4);
            }
          }
          state.layers.push(layer);
        }
        state.activeLayerId = state.layers.at(-1).id;
        const texture = pixelDocument.defaultTexture(image.id);
        await pixelApi.savePixel(await pixelIo.encodeDocument({ id: image.id, name: image.name, texture }, state));
        await put(`/api/textures/${texture}`, await pixelIo.flattenToBlob(state), 'image/png');
      }
    },
    { menus, assets, pixels },
  );
}
