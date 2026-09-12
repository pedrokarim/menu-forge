/**
 * Données extrêmes pour l’audit de mise en page : noms très longs (avec et sans
 * espaces), longs chemins de texture, longs textes d’interface en français,
 * 50 couches, 30 zones de slots, 40 documents récents, palette pleine,
 * bibliothèques et espace de travail aux noms longs, espace vide, formulaires
 * Bedrock dans les huit dispositions (30 boutons, textes de 80 caractères avec
 * et sans espaces, longs chemins d’icône), dossier d’export Bedrock profond.
 *
 * Tout est créé par l’API et par le code du studio dans le dossier temporaire
 * de la suite ; `cleanupStress` retire les bibliothèques et l’espace ajoutés,
 * rétablit le dossier d’export Bedrock et rend l’espace de départ actif (les
 * documents partent avec le dossier temporaire).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { api } from './studio.mjs';
import { seedWorkspace } from './workspace.mjs';

/** Chaîne sans espace (identifiant, chemin) : elle ne peut passer à la ligne que n’importe où. */
export const LONG_WORD = 'Nom_extremement_long_sans_la_moindre_espace_pour_verifier_que_rien_ne_deborde_jamais';
/** Texte d’interface long, avec des espaces. */
export const LONG_TEXT =
  'Un nom vraiment très long, avec des espaces, pour vérifier que chaque libellé passe à la ligne au lieu de déborder';

export const STRESS = {
  menu: 'stress_menu',
  asset: 'stress_asset',
  pixel: 'stress_pixel',
  /** Identifiant d’une couche du menu (la dernière, en haut de la liste). */
  layer: (index) => `couche_${index}_au_nom_particulierement_long_pour_la_liste_des_elements`,
  slot: (index) => `zone_${index}_identifiant_de_slot_vraiment_tres_long`,
  text: (index) => `texte_${index}_identifiant_de_texte_tres_long`,
  /** Formulaire Bedrock de données extrêmes, un par disposition. */
  form: (layout) => `stress_form_${layout}`,
};

/** Les huit dispositions des formulaires Bedrock (pack mcrs_ui). */
export const FORM_LAYOUTS = ['grid', 'left_button', 'bottom_button', 'image_grid', 'square_image', 'motd', 'store', 'wrapped'];
/** Textes de bouton de 80 caractères : avec des espaces, et sans aucune (aucun point de coupure). */
export const FORM_WORDS = 'Un texte de bouton volontairement long, avec des espaces, pour tester la coupure';
export const FORM_TOKEN = 'W'.repeat(80);
const FORM_BUTTONS = 30;

const LAYERS = 50;
const SLOTS = 30;
const DOCUMENTS = 40;
const LIBRARIES = 6;
const TEXTURE_DIR = `generated/${STRESS.menu}/dossier_au_nom_tres_long_pour_les_textures/sous_dossier_encore_plus_long_et_profond`;

function stressMenu() {
  const colors = ['#7d7d86', '#52a535', '#d04545', '#e0892b', '#3fb8b0', '#6a3cf2'];
  return {
    formatVersion: 1,
    id: STRESS.menu,
    name: LONG_WORD,
    container: { type: 'chest', rows: 6 },
    state: {
      onglet: { type: 'enum', values: ['premier_onglet_au_nom_long', 'second_onglet_au_nom_encore_plus_long'], default: 'premier_onglet_au_nom_long' },
    },
    layers: Array.from({ length: LAYERS }, (_, index) => ({
      id: STRESS.layer(index),
      texture: `${TEXTURE_DIR}/${STRESS.layer(index)}.png`,
      x: 7 + 18 * (index % 9),
      y: 17 + 18 * (Math.floor(index / 9) % 6),
      generator: { style: 'button', width: 18, height: 18, color: colors[index % colors.length] },
    })),
    texts: Array.from({ length: 8 }, (_, index) => ({
      id: STRESS.text(index),
      x: 8,
      y: 6 + 14 * index,
      color: '#404040',
      value: index % 2 === 0 ? LONG_TEXT : LONG_WORD,
    })),
    slots: Array.from({ length: SLOTS }, (_, index) => ({
      id: STRESS.slot(index),
      kind: 'button',
      area: { col: index % 9, row: Math.floor(index / 9) },
      item: { invisible: true, name: `<gold>${LONG_TEXT}`, lore: [`<gray>${LONG_WORD}`] },
      onClick: [{ type: 'close' }],
    })),
  };
}

function stressAsset() {
  return {
    formatVersion: 1,
    id: STRESS.asset,
    name: LONG_TEXT,
    size: { width: 176, height: 88 },
    background: null,
    elements: [
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `boite_${index}_au_nom_particulierement_long_pour_la_liste`,
        type: 'box',
        x: (index % 6) * 29,
        y: Math.floor(index / 6) * 44,
        width: 28,
        height: 40,
        style: { kind: 'procedural', preset: 'flat', color: '#2a2233', border: '#6a3cf2' },
      })),
      { id: 'image_au_chemin_de_texture_tres_long', type: 'image', x: 4, y: 4, texture: `${TEXTURE_DIR}/${STRESS.layer(0)}.png`, scale: 1 },
      {
        id: 'texte_au_nom_tres_long',
        type: 'text',
        x: 6,
        y: 60,
        text: LONG_TEXT,
        color: '#ffffff',
        shadow: false,
        lineHeight: 10,
        align: 'left',
      },
    ],
    export: { ascent: 7 },
  };
}

/** 64 × 64 : 256 couleurs différentes (palette « du document » pleine), 12 calques aux noms longs. */
function stressPixel() {
  const squares = [];
  for (let index = 0; index < 256; index++) {
    const [r, g, b] = [(index * 37) % 256, (index * 91) % 256, (index * 53) % 256];
    const hex = `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
    squares.push([(index % 16) * 4, Math.floor(index / 16) * 4, 4, 4, hex]);
  }
  return {
    id: STRESS.pixel,
    name: LONG_WORD,
    size: { width: 64, height: 64 },
    layers: [
      { name: `Fond ${LONG_TEXT}`, rects: squares },
      ...Array.from({ length: 11 }, (_, index) => ({
        name: `Calque ${index + 1} au nom particulièrement long pour la liste des calques`,
        rects: [[index * 5, index * 5, 4, 4, '#f2c94c']],
      })),
    ],
  };
}

/** 30 boutons : textes longs avec et sans espaces, icônes de l’espace et du jeu à chemins longs, rôles, actions. */
function stressForm(layout) {
  const buttons = Array.from({ length: FORM_BUTTONS }, (_, index) => {
    const button = {
      id: index % 2 ? `bouton_${index}_au_nom_particulierement_long_pour_la_liste` : `bouton_${index}`,
      text: index % 2 === 0 ? FORM_TOKEN : FORM_WORDS,
      subtitle: index % 2 === 0 ? FORM_WORDS : FORM_TOKEN,
    };
    if (index % 3 === 0) button.icon = { texture: `${TEXTURE_DIR}/${STRESS.layer(index % LAYERS)}.png` };
    else if (index % 3 === 1) button.icon = { path: `textures/items/${'dossier_de_textures_tres_profond/'.repeat(4)}diamant` };
    if (index === 1) button.role = 'banner';
    if (index === 2) button.role = 'special';
    if (index % 5 === 0) button.onClick = [{ type: 'command', command: `say ${FORM_TOKEN}`, as: 'player' }, { type: 'close' }];
    return button;
  });
  return {
    formatVersion: 1,
    id: STRESS.form(layout),
    name: `${FORM_WORDS} (${layout})`,
    container: { type: 'chest', rows: 6 },
    state: {},
    layers: [],
    form: { layout, title: FORM_WORDS, content: `${FORM_TOKEN} ${FORM_WORDS}`, buttons },
  };
}

/** Écrit les données extrêmes ; renvoie ce qu’il faut pour les états vides et le nettoyage. */
export async function seedStress(t) {
  const { page, env } = t;
  // Le menu d’abord : ses textures (longs chemins) doivent exister quand l’asset, qui en utilise une, est rendu.
  await seedWorkspace(page, { menus: [stressMenu()], assets: [], pixels: [] });
  await seedWorkspace(page, { menus: [], assets: [stressAsset()], pixels: [stressPixel()] });
  for (let index = 0; index < DOCUMENTS; index++) {
    const id = `stress_doc_${String(index).padStart(2, '0')}`;
    await api(t, `/menus/${id}`, {
      method: 'PUT',
      body: {
        formatVersion: 1,
        id,
        name: index % 2 === 0 ? `${LONG_TEXT} (${index})` : `${LONG_WORD}_${index}`,
        container: { type: 'chest', rows: 3 },
        layers: [],
        texts: [],
        slots: [],
      },
    });
  }
  const libraries = [];
  for (let index = 0; index < LIBRARIES; index++) {
    const root = path.join(env.root, 'bibliotheques', `bibliotheque_${index}_${LONG_WORD}`);
    mkdirSync(path.join(root, 'assets'), { recursive: true });
    const id = `stress_lib_${index}`;
    await api(t, '/libraries', {
      method: 'POST',
      body: { id, name: index % 2 === 0 ? `${LONG_TEXT} ${index}` : `${LONG_WORD}_${index}`, root, ownership: index % 2 === 0 ? 'own' : 'third-party' },
    });
    libraries.push(id);
  }
  // Formulaires Bedrock après le menu : leurs icônes reprennent ses textures aux chemins longs.
  for (const layout of FORM_LAYOUTS) await api(t, `/menus/${STRESS.form(layout)}`, { method: 'PUT', body: stressForm(layout) });
  // Dossier d’export Bedrock profond (dans le dossier temporaire) ; l’ancien réglage est rétabli par `cleanupStress`.
  const bedrockBefore = (await api(t, '/settings')).export.bedrockDirectory ?? null;
  const bedrockDir = path.join(env.root, 'dossier_de_serveur_bedrock_au_nom_particulierement_long', 'sous_dossier_encore_plus_profond_pour_le_test', 'menu_forge', 'export');
  mkdirSync(bedrockDir, { recursive: true });
  await api(t, '/settings', { method: 'PUT', body: { export: { bedrockDirectory: bedrockDir } } });
  // Espace vide au nom long : connu (espaces récents), et ouvert le temps des états vides.
  const emptyWorkspace = path.join(env.root, `espace_${LONG_WORD}`);
  mkdirSync(emptyWorkspace, { recursive: true });
  await api(t, '/workspaces/open', { method: 'POST', body: { path: emptyWorkspace, name: LONG_TEXT } });
  await api(t, '/workspaces/open', { method: 'POST', body: { path: env.workspaceDir, name: 'e2e' } });
  return { libraries, emptyWorkspace, bedrockBefore };
}

/** Ouvre l’espace vide (états vides) ; `restore` rend l’espace de départ actif. */
export const openEmptyWorkspace = (t, seeded) => api(t, '/workspaces/open', { method: 'POST', body: { path: seeded.emptyWorkspace } });
export const restoreWorkspace = (t) => api(t, '/workspaces/open', { method: 'POST', body: { path: t.env.workspaceDir, name: 'e2e' } });

/** Retire ce que `seedStress` a ajouté aux réglages (bibliothèques, espace vide, dossier Bedrock) et rend l’espace de départ actif. */
export async function cleanupStress(t, seeded) {
  await restoreWorkspace(t).catch(() => undefined);
  if (!seeded) return;
  await api(t, '/settings', { method: 'PUT', body: { export: { bedrockDirectory: seeded.bedrockBefore } } }).catch(() => undefined);
  for (const id of seeded.libraries) await api(t, `/libraries/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
  await api(t, '/workspaces', { method: 'DELETE', body: { path: seeded.emptyWorkspace } }).catch(() => undefined);
}
