/**
 * Exemples intégrés du visualiseur de shaders : de quoi voir un rendu dès l’ouverture de l’écran, et
 * apprendre pas à pas. Les fichiers sont dans `examples/<id>/` (chemins comme dans un pack, à partir de
 * `shaders/`) ; tous écrits pour Menu Forge, sauf les deux includes repris d’Enderium.
 */
import type { ShaderFile } from './glsl';
import type { SceneId, Vec4 } from './scenes';

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
    summary: 'Un graphe dans un menu : chaque colonne porte deux valeurs dans sa teinte, le shader les relit et trace la ligne, l’aire et le dernier point.',
    tryThis: 'Modifiez les valeurs et le nombre de colonnes, ou la couleur « accent » dans include/enderium_chart.glsl.',
    scene: 'chart',
    program: 'core/item',
    open: 'core/item.fsh',
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
