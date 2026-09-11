import { glyphMetrics } from '../model/compose';
import type { BoundsLookup, Composition, ImageBounds } from '../model/compose';
import { ascentForTop } from '../model/geometry';
import type { MenuDefinition } from '../model/menu';
import { asciiFont, encodeShift, spaceProvider } from './fonts';
import { cropAndPad, measureImage } from './image';
import type { RgbaImage } from './image';
import { compactJson, prettyJson, utf8 } from './json';
import { encodePng } from './png';

/**
 * Génération du resource pack d’un ensemble de menus résolus : **même
 * algorithme et même sortie que `PackGenerator` de la lib** (polices octet
 * pour octet, textures pixel pour pixel), vérifiés par la fixture de parité
 * partagée (`studio/tests/parity.test.ts` et `ParityFixtureTest` côté Java).
 *
 * Pour chaque menu `<id>` : `assets/<ns>/font/menus/<id>.json` (provider
 * `space` puis un provider `bitmap` par couche non vide) et
 * `assets/<ns>/textures/menus/<id>/<couche>.png` (texture recadrée, complétée
 * en bas si besoin) ; pour chaque `ascent` de texte utilisé,
 * `assets/<ns>/font/menus/text_<ascent>.json` (`text_m<abs>` si négatif).
 */

export const DEFAULT_NAMESPACE = 'menuforge';
const NAMESPACE = /^[a-z0-9_.-]+$/;
const FIRST_CODEPOINT = 0xe000;
const LAST_CODEPOINT = 0xf7ff;

/** Charge une texture (chemin relatif à `textures/`) ; `null` si elle n’existe pas. */
export type TextureLoader = (path: string) => Promise<RgbaImage | null>;

/** Fichiers d’un pack : chemin relatif à la racine du pack → contenu, triés par chemin. */
export type PackFiles = Map<string, Uint8Array>;

export function isValidNamespace(namespace: string): boolean {
  return NAMESPACE.test(namespace);
}

export function fontPath(namespace: string, name: string): string {
  return `assets/${namespace}/font/menus/${name}.json`;
}

/** `text_7`, `text_m3`… */
export function textFontName(ascent: number): string {
  return ascent < 0 ? `text_m${Math.abs(ascent)}` : `text_${ascent}`;
}

/**
 * Codepoints de la police d’un menu (`FontLayout`) : chaque couche dont la
 * texture n’est pas vide reçoit, dans l’ordre, un codepoint à partir de U+E000.
 */
export function fontCodepoints(menu: MenuDefinition, boundsOf: BoundsLookup): Map<string, number> {
  const codepoints = new Map<string, number>();
  let next = FIRST_CODEPOINT;
  for (const layer of menu.layers) {
    if (!boundsOf(layer.texture) || codepoints.has(layer.id)) continue;
    if (next > LAST_CODEPOINT) throw new Error(`Menu « ${menu.id} » : trop de couches pour une seule police`);
    codepoints.set(layer.id, next++);
  }
  return codepoints;
}

/** Images et mesures des textures, chargées une fois. */
class TextureCache {
  private readonly images = new Map<string, RgbaImage>();
  private readonly bounds = new Map<string, ImageBounds | null>();
  private readonly load: TextureLoader;

  constructor(load: TextureLoader) {
    this.load = load;
  }

  async preload(paths: Iterable<string>): Promise<void> {
    for (const path of paths) {
      if (this.images.has(path)) continue;
      const image = await this.load(path);
      if (!image) throw new Error(`Texture introuvable : « ${path} »`);
      this.images.set(path, image);
      this.bounds.set(path, measureImage(image));
    }
  }

  image(path: string): RgbaImage {
    const image = this.images.get(path);
    if (!image) throw new Error(`Texture introuvable : « ${path} »`);
    return image;
  }

  readonly boundsOf: BoundsLookup = (path) => this.bounds.get(path) ?? null;
}

/**
 * Génère le pack de plusieurs menus **résolus** (gabarits ignorés).
 *
 * @throws si une texture est introuvable ou illisible, ou l’espace de noms invalide
 */
export async function generatePack(
  menus: readonly MenuDefinition[],
  load: TextureLoader,
  namespace = DEFAULT_NAMESPACE,
): Promise<PackFiles> {
  if (!isValidNamespace(namespace)) {
    throw new Error(`Espace de noms invalide « ${namespace} » (attendu : [a-z0-9_.-]+)`);
  }
  const textures = new TextureCache(load);
  const files = new Map<string, Uint8Array>();
  const textAscents = new Set<number>();

  for (const menu of menus) {
    if (menu.template) continue;
    await textures.preload(menu.layers.map((layer) => layer.texture));
    await generateMenu(menu, textures, namespace, files);
    for (const text of menu.texts ?? []) textAscents.add(ascentForTop(text.y));
  }
  for (const ascent of [...textAscents].sort((a, b) => a - b)) {
    files.set(fontPath(namespace, textFontName(ascent)), utf8(prettyJson(asciiFont(ascent))));
  }
  return new Map([...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

async function generateMenu(
  menu: MenuDefinition,
  textures: TextureCache,
  namespace: string,
  files: Map<string, Uint8Array>,
): Promise<void> {
  const codepoints = fontCodepoints(menu, textures.boundsOf);
  const providers: unknown[] = [spaceProvider()];
  const usedFileNames = new Set<string>();

  for (const layer of menu.layers) {
    const bounds = textures.boundsOf(layer.texture);
    const codepoint = codepoints.get(layer.id);
    if (!bounds || codepoint === undefined) continue;
    const metrics = glyphMetrics(layer, bounds);

    let fileName = layer.id.toLowerCase().replace(/[^a-z0-9_.-]/gu, '_');
    if (usedFileNames.has(fileName)) fileName = `${fileName}_${codepoint.toString(16)}`;
    usedFileNames.add(fileName);
    const textureRelative = `menus/${menu.id}/${fileName}.png`;
    files.set(
      `assets/${namespace}/textures/${textureRelative}`,
      await encodePng(cropAndPad(textures.image(layer.texture), bounds, metrics.height)),
    );
    providers.push({
      type: 'bitmap',
      file: `${namespace}:${textureRelative}`,
      ascent: metrics.ascent,
      height: metrics.height,
      chars: [String.fromCodePoint(codepoint)],
    });
  }
  files.set(fontPath(namespace, menu.id), utf8(prettyJson({ providers })));
}

/** `pack.mcmeta` minimal d’un pack autonome. */
export function packMeta(packFormat: number, description: string): Uint8Array {
  return utf8(prettyJson({ pack: { pack_format: packFormat, description } }));
}

/** Jeton de titre tel que le produit la lib (`TitleToken`). */
export type LibTitleToken =
  | { kind: 'shift'; amount: number }
  | { kind: 'glyph'; layerId: string; ascent: number; height: number; advance: number }
  | { kind: 'text'; value: string; ascent: number; color?: string };

/**
 * Jetons de la composition du studio ramenés à ceux de la lib : un texte sans
 * couleur n’en porte pas (la lib laisse celle du titre ; le studio affiche
 * #404040, la couleur vanilla des titres de coffre).
 */
export function toLibTokens(composition: Composition, menu: MenuDefinition): LibTitleToken[] {
  return composition.tokens.map((token): LibTitleToken => {
    if (token.kind === 'shift') return { kind: 'shift', amount: token.amount };
    if (token.kind === 'glyph') {
      return { kind: 'glyph', layerId: token.layerId, ascent: token.ascent, height: token.height, advance: token.advance };
    }
    const color = (menu.texts ?? []).find((text) => text.id === token.textId)?.color;
    return color === undefined
      ? { kind: 'text', value: token.value, ascent: token.ascent }
      : { kind: 'text', value: token.value, ascent: token.ascent, color };
  });
}

/**
 * Composant JSON du titre (`TitleRenderer`) : décalages et glyphes dans la
 * police du menu, en blanc ; chaque texte dans sa police `text_<ascent>`.
 */
export function renderTitleJson(
  menuId: string,
  tokens: readonly LibTitleToken[],
  codepoints: ReadonlyMap<string, number>,
  namespace = DEFAULT_NAMESPACE,
): string {
  const extra: Record<string, string>[] = [];
  let pending = '';
  const flush = () => {
    if (!pending) return;
    extra.push({ text: pending, font: `${namespace}:menus/${menuId}`, color: 'white' });
    pending = '';
  };
  for (const token of tokens) {
    if (token.kind === 'shift') {
      pending += encodeShift(token.amount);
    } else if (token.kind === 'glyph') {
      const codepoint = codepoints.get(token.layerId);
      if (codepoint === undefined) throw new Error(`La couche « ${token.layerId} » n’a pas de glyphe`);
      pending += String.fromCodePoint(codepoint);
    } else {
      flush();
      const component: Record<string, string> = { text: token.value, font: `${namespace}:menus/${textFontName(token.ascent)}` };
      if (token.color !== undefined) component.color = token.color;
      extra.push(component);
    }
  }
  flush();
  return compactJson(extra.length ? { text: '', extra } : { text: '' });
}

/** Commande `compactJson` exposée pour les composants construits ailleurs. */
export { compactJson };
