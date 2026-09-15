/**
 * Exemples intégrés du visualiseur de shaders : de quoi voir un rendu dès l’ouverture de l’écran, et
 * apprendre pas à pas. Les fichiers sont dans `examples/<id>/` (chemins comme dans un pack, à partir de
 * `shaders/`) ; tous écrits pour Menu Forge, sauf les deux includes repris d’Enderium.
 */
import type { ShaderFile } from './glsl';
import type { SceneId, SceneInputs, Vec4 } from './scenes';

export interface ShaderExample {
  id: string;
  title: string;
  /** Ce que fait l’exemple, en une ou deux phrases. */
  summary: string;
  /** Ce qu’il est intéressant de modifier. */
  tryThis: string;
  scene: SceneId;
  program: string;
  /** Fichier ouvert dans l’éditeur au chargement. */
  open: string;
  animate?: boolean;
  color?: Vec4;
  /** Fichiers d’un autre exemple (plusieurs exemples partagent les shaders de la courbe). */
  folder?: string;
  /** Réglages de la scène au chargement (style et taille de courbe, valeurs…). */
  inputs?: Partial<SceneInputs>;
}

export const SHADER_EXAMPLES: readonly ShaderExample[] = [
  {
    id: 'basics',
    title: 'Les bases',
    summary: 'Le plus petit shader utile : le vertex shader place les coins, le fragment shader colore chaque pixel avec la texture et la teinte.',
    tryThis: 'Changez la couleur de sommet, ou remplacez la dernière ligne par fragColor = vec4(1.0, 0.0, 0.0, 1.0);',
    scene: 'free',
    program: 'core/item',
    open: 'core/item.fsh',
  },
  {
    id: 'grayscale',
    title: 'Noir et blanc',
    summary: 'Chaque pixel est remplacé par sa luminosité : un calcul de couleur, pixel par pixel.',
    tryThis: 'Passez STRENGTH à 0.5 pour un gris partiel.',
    scene: 'free',
    program: 'core/item',
    open: 'core/item.fsh',
  },
  {
    id: 'wave',
    title: 'Vague animée',
    summary: 'La texture ondule : on lit la texture un peu à côté, d’un décalage qui suit le temps du jeu (GameTime).',
    tryThis: 'Jouez sur AMPLITUDE, WAVES et SPEED.',
    scene: 'free',
    program: 'core/item',
    open: 'core/item.fsh',
    animate: true,
  },
  {
    id: 'color_trigger',
    title: 'Déclencheur par couleur',
    summary: 'La technique des serveurs : une teinte précise (#FFFD01) envoyée par le serveur active un effet arc-en-ciel ; toute autre teinte garde le rendu normal.',
    tryThis: 'Changez la couleur de sommet : l’effet s’arrête. Remettez #fffd01 : il revient.',
    scene: 'free',
    program: 'core/item',
    open: 'core/item.vsh',
    animate: true,
    color: [1, 253 / 255, 1 / 255, 1],
  },
  {
    id: 'chart',
    title: 'Courbe de prix (Enderium)',
    summary: 'Un graphe dans un menu : chaque colonne porte deux valeurs dans sa teinte, le shader les relit et trace la ligne, l’aire et le dernier point. Six styles : choisissez-les dans la scène.',
    tryThis: 'Modifiez les valeurs et le nombre de colonnes, ou la couleur « accent » dans include/enderium_chart.glsl.',
    scene: 'chart',
    program: 'core/item',
    open: 'core/item.fsh',
  },
  {
    id: 'chart_bars',
    folder: 'chart',
    title: 'Histogramme (Enderium)',
    summary: 'Même technique, style « barres » : une barre par colonne, verte si elle monte par rapport à la précédente, la dernière plus claire.',
    tryThis: 'Passez de 8 à 32 colonnes ; changez la taille pour « Moyen ».',
    scene: 'chart',
    program: 'core/item',
    open: 'include/enderium_chart.glsl',
    inputs: { chartStyle: 'bars', columns: 16 },
  },
  {
    id: 'chart_candles',
    folder: 'chart',
    title: 'Chandeliers (Enderium)',
    summary: 'Pour la bourse : chaque colonne porte ouverture, fermeture, plus haut et plus bas (6 bits chacun) ; corps vert ou rouge, mèche fine.',
    tryThis: 'Ajoutez des valeurs très écartées pour allonger les mèches.',
    scene: 'chart',
    program: 'core/item',
    open: 'include/enderium_chart.glsl',
    inputs: { chartStyle: 'candles', columns: 12 },
  },
  {
    id: 'chart_volume',
    folder: 'chart',
    title: 'Prix et volume (Enderium)',
    summary: 'Le prix en haut (ligne et aire), le volume échangé en barres discrètes en bas, dans la même colonne.',
    tryThis: 'Essayez la taille « Large », celle de la page 2 de la galerie.',
    scene: 'chart',
    program: 'core/item',
    open: 'include/enderium_chart.glsl',
    inputs: { chartStyle: 'volume', chartSize: 'wide', columns: 28 },
  },
  {
    id: 'chart_spark',
    folder: 'chart',
    title: 'Mini-courbe (Enderium)',
    summary: 'Pour une ligne de liste : 50 × 12 px, trait fin, aire légère, ni grille ni point.',
    tryThis: 'Montez l’échelle d’interface pour voir le trait rester fin.',
    scene: 'chart',
    program: 'core/item',
    open: 'include/enderium_chart.glsl',
    inputs: { chartStyle: 'spark', chartSize: 'mini', columns: 12 },
  },
  {
    id: 'portrait',
    title: 'Portrait du profil (Enderium)',
    summary: 'Une tête de joueur de 68 × 70 px devient un buste en 3D, calculé par lancer de rayons dans la skin.',
    tryThis: 'Chargez votre skin (PNG 64 × 64), puis cherchez portraitRender dans l’include.',
    scene: 'portrait',
    program: 'core/entity',
    open: 'core/entity.fsh',
  },
];

const SOURCES = import.meta.glob('./examples/**/*.{vsh,fsh,glsl}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Fichiers d’un exemple, chemins à partir de `shaders/`. */
export function exampleFiles(id: string): ShaderFile[] {
  const prefix = `./examples/${id}/`;
  return Object.entries(SOURCES)
    .filter(([path]) => path.startsWith(prefix))
    .map(([path, source]) => ({ path: path.slice(prefix.length), source }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
