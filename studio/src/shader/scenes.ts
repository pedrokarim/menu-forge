/**
 * Scènes d’essai du visualiseur : ce que le jeu envoie au shader pour un cas précis (quads, couleurs de
 * sommet, coordonnées de texture, texture), reproduit sans Minecraft. Chaque scène correspond à une
 * technique d’Enderium : la courbe des interfaces (shader `core/item`), le portrait du profil (shader
 * `core/entity`), et une scène libre (un quad texturé).
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

export interface SceneVertex {
  position: Vec3;
  color: Vec4;
  uv: Vec2;
  normal: Vec3;
}

export interface SceneBitmap {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Ce que le rendu dessine : une zone de `width` × `height` pixels d’interface, des quads, une texture. */
export interface SceneGeometry {
  width: number;
  height: number;
  quads: SceneVertex[][];
  texture: SceneBitmap;
}

export type SceneId = 'chart' | 'portrait' | 'free';

export interface SceneInputs {
  /** Courbe : valeurs séparées par des espaces, virgules ou retours à la ligne. */
  values: string;
  columns: number;
  /** Portrait et scène libre : image fournie (sinon une image par défaut). */
  image: SceneBitmap | null;
  /** Scène libre : couleur de sommet. */
  color: Vec4;
}

export interface SceneDefinition {
  id: SceneId;
  label: string;
  hint: string;
  /** Programme à essayer en premier (`core/item`…). */
  program: string;
  build(inputs: SceneInputs): SceneGeometry;
}

export const DEFAULT_INPUTS: SceneInputs = {
  values: '12 12.4 12.1 13 13.8 13.2 12.6 11.9 12.2 12.9 13.5 14.1 14.6 14.2 13.9 14.8 15.4 15.1 15.9 16.3',
  columns: 24,
  image: null,
  color: [1, 1, 1, 1],
};

function bitmap(width: number, height: number): SceneBitmap {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function setPixel(target: SceneBitmap, x: number, y: number, rgba: Vec4) {
  const offset = (y * target.width + x) * 4;
  target.data.set(rgba, offset);
}

function quad(x0: number, y0: number, x1: number, y1: number, z: number, u0: number, v0: number, u1: number, v1: number,
              color: Vec4, normal: Vec3 = [0, 0, 1]): SceneVertex[] {
  return [
    { position: [x0, y0, z], color, uv: [u0, v0], normal },
    { position: [x1, y0, z], color, uv: [u1, v0], normal },
    { position: [x1, y1, z], color, uv: [u1, v1], normal },
    { position: [x0, y1, z], color, uv: [u0, v1], normal },
  ];
}

// --- Courbe --------------------------------------------------------------------------------------

/** Valeurs lues dans le texte (nombres séparés par des espaces, virgules, points-virgules). */
export function parseValues(text: string): number[] {
  return text
    .split(/[\s;,]+/)
    .map((part) => Number(part))
    .filter((value) => Number.isFinite(value));
}

/** Même codage que `ChartSeries.encode` d’Enderium : valeurs 11 bits, tendance, dernière colonne. */
export function encodeChart(values: number[], columns: number): number[] {
  const series = values.length === 0 ? [0] : values;
  const points: number[] = [];
  for (let i = 0; i <= columns; i++) {
    const position = series.length === 1 ? 0 : (i * (series.length - 1)) / columns;
    const index = Math.min(series.length - 2, Math.floor(position));
    points.push(series.length === 1 ? series[0] : series[index] + (series[index + 1] - series[index]) * (position - index));
  }
  const low = Math.min(...series);
  const high = Math.max(...series);
  const level = (value: number) => {
    if (high - low < 1e-9) return 1023;
    const normalized = 0.1 + ((value - low) / (high - low)) * 0.8;
    return Math.round(Math.max(0, Math.min(1, normalized)) * 2047);
  };
  const rising = series[series.length - 1] >= series[0];
  const colors: number[] = [];
  for (let i = 0; i < columns; i++) {
    colors.push((level(points[i]) << 13) | (level(points[i + 1]) << 2) | (rising ? 2 : 0) | (i === columns - 1 ? 1 : 0));
  }
  return colors;
}

const CHART: SceneDefinition = {
  id: 'chart',
  label: 'Courbe (core/item)',
  hint: 'Une colonne par segment ; chaque colonne porte ses deux valeurs dans sa couleur de sommet. La texture « champ » donne la position (rouge = x, vert = y, bleu 167, alpha 251).',
  program: 'core/item',
  build(inputs) {
    const width = 158;
    const height = 82;
    const columns = Math.max(1, Math.min(64, Math.round(inputs.columns)));
    // Atlas 512 : le champ en (128, 64), comme une texture parmi d’autres
    const atlas = bitmap(512, 512);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) setPixel(atlas, 128 + x, 64 + y, [x, y, 167, 251]);
    const [u0, v0, u1, v1] = [128 / 512, 64 / 512, 384 / 512, 320 / 512];
    const colors = encodeChart(parseValues(inputs.values), columns);
    const quads = colors.map((packed, i) => {
      const color: Vec4 = [((packed >> 16) & 255) / 255, ((packed >> 8) & 255) / 255, (packed & 255) / 255, 1];
      return quad((i * width) / columns, 0, ((i + 1) * width) / columns, height, 0, u0, v0, u1, v1, color);
    });
    return { width, height, quads, texture: atlas };
  },
};

// --- Portrait ------------------------------------------------------------------------------------

/** Skin 64 × 64 par défaut, dessinée pour le studio (cheveux, visage, yeux, chemise, pantalon). */
export function defaultSkin(): SceneBitmap {
  const skin = bitmap(64, 64);
  const fill = (x0: number, y0: number, w: number, h: number, rgba: Vec4) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setPixel(skin, x, y, rgba);
  };
  const hair: Vec4 = [92, 60, 34, 255];
  const face: Vec4 = [214, 160, 118, 255];
  const shirt: Vec4 = [58, 120, 196, 255];
  const pants: Vec4 = [52, 56, 86, 255];
  fill(0, 8, 32, 8, face); // côtés, visage, arrière de la tête
  fill(8, 0, 16, 8, hair); // dessus et dessous
  fill(0, 8, 32, 2, hair); // frange
  fill(24, 8, 8, 8, hair); // arrière
  fill(10, 12, 1, 1, [255, 255, 255, 255]);
  fill(11, 12, 1, 1, [40, 60, 110, 255]);
  fill(13, 12, 1, 1, [40, 60, 110, 255]);
  fill(14, 12, 1, 1, [255, 255, 255, 255]);
  fill(11, 14, 3, 1, [150, 90, 70, 255]);
  fill(16, 16, 24, 16, shirt); // torse
  fill(40, 16, 16, 16, shirt); // bras droit
  fill(32, 48, 16, 16, shirt); // bras gauche
  fill(0, 16, 16, 16, pants);
  fill(16, 48, 16, 16, pants);
  fill(40, 16, 16, 4, face); // mains en haut de la bande
  return skin;
}

const PORTRAIT: SceneDefinition = {
  id: 'portrait',
  label: 'Portrait (core/entity)',
  hint: 'Face avant d’une tête de joueur de 68 × 70 px (le rapport qui déclenche le buste), chapeau devant ; skin 64 × 64.',
  program: 'core/entity',
  build(inputs) {
    const skin = inputs.image && inputs.image.width === 64 && inputs.image.height === 64 ? inputs.image : defaultSkin();
    const [w, h] = [68, 70];
    const margin = 6;
    const white: Vec4 = [1, 1, 1, 1];
    const base = quad(margin, margin, margin + w, margin + h, 0, 8 / 64, 8 / 64, 16 / 64, 16 / 64, white);
    const grow = w / 16;
    const hat = quad(margin - grow, margin - (h / 16), margin + w + grow, margin + h + h / 16, 10,
      40 / 64, 8 / 64, 48 / 64, 16 / 64, white);
    return { width: w + margin * 2, height: h + margin * 2, quads: [base, hat], texture: skin };
  },
};

// --- Scène libre ---------------------------------------------------------------------------------

function checker(): SceneBitmap {
  const image = bitmap(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const on = ((x >> 2) + (y >> 2)) % 2 === 0;
    setPixel(image, x, y, on ? [230, 180, 60, 255] : [60, 70, 90, 255]);
  }
  return image;
}

const FREE: SceneDefinition = {
  id: 'free',
  label: 'Libre (un quad)',
  hint: 'Un quad de 128 × 128 px, coordonnées de texture de 0 à 1 sur l’image fournie, couleur de sommet réglable.',
  program: 'core/item',
  build(inputs) {
    const texture = inputs.image ?? checker();
    return { width: 128, height: 128, quads: [quad(0, 0, 128, 128, 0, 0, 0, 1, 1, inputs.color)], texture };
  },
};

export const SCENES: SceneDefinition[] = [CHART, PORTRAIT, FREE];
