import { GRID_COLUMNS, SLOT_SIZE, TITLE_X, TITLE_Y, WINDOW_WIDTH, chestCell, windowHeight } from '../model/geometry';
import { toHexColor } from './constrain';
import type { Rgb } from './constrain';

/**
 * Consignes envoyées aux modèles. Elles contraignent le style (pixel art
 * d’interface Minecraft) et le format (schéma exact du menu, géométrie du
 * coffre, textures disponibles) ; la validation et la chaîne de contrainte
 * vérifient ensuite le résultat, sans faire confiance au modèle.
 *
 * Les consignes d’images sont en anglais : les modèles d’images les suivent
 * nettement mieux. Celles des interfaces sont en français, la langue des
 * textes affichés aux joueurs.
 */

/** Taille la plus grande à laquelle une texture est encore « de l’interface » (au-delà : fond de fenêtre). */
const SMALL_TEXTURE = 48;

/** Ce qu’on ne veut jamais voir dans une texture (fournisseurs qui acceptent un prompt négatif). */
export const TEXTURE_NEGATIVE =
  'blurry, anti-aliasing, smooth gradient, soft shading, photo, realistic, 3d render, perspective, text, letters, numbers, watermark, signature, noise, jpeg artifacts, drop shadow, frame border around the canvas';

export function textureSystemPrompt({ width, height, palette }: { width: number; height: number; palette: readonly Rgb[] }): string {
  const small = Math.max(width, height) <= SMALL_TEXTURE;
  const lines = [
    `Pixel art texture for a Minecraft Java Edition inventory interface (GUI), meant to be displayed at exactly ${width}x${height} pixels.`,
    'Strict pixel art: every art pixel is a crisp, solid square block, aligned on one regular grid; hard edges, no anti-aliasing, no blur, no smooth gradients, no dithering noise.',
    `Draw it as if on a ${width}x${height} grid, then upscaled with nearest-neighbour: few large pixels, readable at 1x.`,
    'Flat orthographic front view, centred, filling the frame; no perspective, no cast shadow, no text, no letters, no watermark.',
    'Vanilla Minecraft GUI look: light grey #c6c6c6 panels, white top-left highlights, dark grey #555555 bottom-right shadows, black #000000 outlines where needed.',
    'Background: fully transparent; if transparency is impossible, one flat solid magenta #ff00ff background with no texture, easy to remove.',
  ];
  if (small) lines.push('Tiny icon: one clear silhouette with a 1-pixel dark outline, at most 3 or 4 shades per colour.');
  if (palette.length > 0 && palette.length <= 32) {
    lines.push(`Use only these colours: ${palette.map(toHexColor).join(', ')}.`);
  }
  return lines.join('\n');
}

export interface InterfaceContext {
  /** `docs/menu.schema.json`, tel quel. */
  schemaText: string;
  menuId: string;
  name: string;
  rows: number;
  /** Textures de l’espace utilisables telles quelles (chemins relatifs à `textures/`). */
  textures: readonly string[];
  /** Menus existants, cibles possibles de l’action `open`. */
  menus: readonly string[];
  /** Textures dessinées par le studio (clé `generator`) permises. */
  allowGenerated: boolean;
}

/** Textures citées dans le prompt au plus (les autres restent utilisables mais ne sont pas listées). */
export const TEXTURES_LISTED = 150;

function example(allowGenerated: boolean): string {
  const background = allowGenerated
    ? {
        id: 'fond',
        texture: 'generated/exemple/fond.png',
        x: 0,
        y: 0,
        generator: { style: 'panel', width: WINDOW_WIDTH, height: windowHeight(3), color: '#c6c6c6', cells: [{ col: 0, row: 0, width: 9, height: 3 }] },
      }
    : { id: 'fond', texture: 'chemin/vers/une_texture_existante.png', x: 0, y: 0 };
  const button = chestCell(8, 2);
  const document = {
    formatVersion: 1,
    id: 'exemple',
    name: 'Exemple',
    container: { type: 'chest', rows: 3 },
    state: { onglet: { type: 'enum', values: ['objets', 'blocs'], default: 'objets' } },
    layers: [
      background,
      ...(allowGenerated
        ? [{ id: 'bouton_ok', texture: 'generated/exemple/bouton_ok.png', x: button.x, y: button.y, generator: { style: 'button', width: 18, height: 18, color: '#52a535' } }]
        : []),
    ],
    texts: [{ id: 'titre', x: 88, y: TITLE_Y, align: 'center', color: '#404040', value: 'Exemple' }],
    slots: [
      { id: 'grille', kind: 'decoration', area: { col: 0, row: 0, width: 8, height: 2 }, item: { material: 'STONE', name: '<gray>Pierre' } },
      {
        id: 'ok',
        kind: 'button',
        area: { col: 8, row: 2 },
        item: { invisible: true, name: '<green>Valider', lore: ['<gray>Ferme le menu'] },
        onClick: [{ type: 'sound', sound: 'ui.button.click' }, { type: 'close' }],
      },
    ],
  };
  return JSON.stringify(document);
}

export function interfaceSystemPrompt(context: InterfaceContext): string {
  const { menuId, name, rows } = context;
  const height = windowHeight(rows);
  const lastCell = chestCell(GRID_COLUMNS - 1, rows - 1);
  const listed = context.textures.slice(0, TEXTURES_LISTED);
  let schema = context.schemaText;
  try {
    schema = JSON.stringify(JSON.parse(context.schemaText));
  } catch {
    // Schéma laissé tel quel.
  }
  return [
    'Tu conçois des interfaces d’inventaire Minecraft (Java) pour Menu Forge, un studio qui dessine des menus de coffre personnalisés : les images sont des glyphes de police affichés dans le titre du coffre, les cases du coffre portent des items et des actions.',
    '',
    'RÉPONSE : uniquement un objet JSON, un document *.menu.json (version 1) qui respecte EXACTEMENT le schéma JSON donné plus bas (toute clé inconnue est refusée). Aucun texte autour, aucun bloc de code.',
    '',
    'IMPOSÉ :',
    `- "formatVersion": 1, "id": "${menuId}", "name": ${JSON.stringify(name)}, "container": { "type": "chest", "rows": ${rows} }.`,
    '- Pas de "extends", "includes", "template" ni "component".',
    '- Identifiants des couches, textes et slots uniques dans leur liste, en minuscules, chiffres et _ (ex. "bouton_retour").',
    '',
    'GÉOMÉTRIE (pixels de la fenêtre, origine en haut à gauche) :',
    `- Fenêtre du coffre : ${WINDOW_WIDTH} px de large, ${height} px de haut (114 + ${SLOT_SIZE} × ${rows} lignes).`,
    `- Case (col, row) du coffre : carré de ${SLOT_SIZE} px dont le coin haut-gauche est x = 7 + ${SLOT_SIZE} × col, y = 17 + ${SLOT_SIZE} × row ; col de 0 à ${GRID_COLUMNS - 1}, row de 0 à ${rows - 1} (dernière case : x = ${lastCell.x}, y = ${lastCell.y}). En dessous vient l’inventaire du joueur, qu’on ne dessine pas.`,
    `- Le titre vanilla commence en x = ${TITLE_X}, y = ${TITLE_Y}. Un texte doit avoir y ≥ 5 (sinon Minecraft refuse la police).`,
    '- "layers" : images du titre, de la plus basse à la plus haute (la dernière est au-dessus). Un fond qui couvre la fenêtre se place en x = 0, y = 0.',
    '- "slots" : zones de cases ("area" : col, row, width, height en cases, jamais hors de la grille). Un bouton dessiné par une couche est un slot "button" posé sur la même zone, avec "item": { "invisible": true, "name": … } et des actions "onClick".',
    '- "texts" : textes dynamiques du titre (variables {state.nom}, {page.number}, {page.count}, {viewer.name}…) ; couleur "#rrggbb".',
    '- Items : "name" et "lore" en MiniMessage (<green>, <gray>, <bold>…), "material" en nom Bukkit (DIAMOND, PLAYER_HEAD…).',
    '- Un état "page" nommé pagine la liste "list" ; "nextPage" / "prevPage" visent cette liste ; "setState" vise un état déclaré avec une valeur permise ; une condition "state" cite un état déclaré.',
    '',
    'TEXTURES :',
    listed.length > 0
      ? `- Existantes (chemins relatifs à textures/, à utiliser telles quelles) : ${listed.join(', ')}${context.textures.length > listed.length ? ` (et ${context.textures.length - listed.length} autres non listées)` : ''}.`
      : '- Aucune texture existante utilisable.',
    context.allowGenerated
      ? `- Ou dessinées par le studio : une couche avec "generator": { "style": "panel" | "button" | "cell" | "veil" | "flat", "width", "height" (1 à 256 px), "color": "#rrggbb" ("#rrggbbaa" pour "veil"), "cells"?: [zones de cases à dessiner en creux], "cellColor"?: "#rrggbb" } et "texture": "generated/${menuId}/<id de la couche>.png". "panel" = panneau biseauté gris façon vanilla (avec "cells", il dessine aussi les cases), "button" = bouton coloré, "cell" = case de slot, "veil" = voile translucide, "flat" = aplat. Préfère-les pour les fonds et les boutons.`
      : '- Aucune texture générée : n’utilise que les textures existantes.',
    '',
    'MENUS EXISTANTS (cibles de l’action "open") : ' + (context.menus.length > 0 ? context.menus.join(', ') : 'aucun') + '. Pour un menu qui n’existe pas encore, utilise "close" ou "back".',
    '',
    'Les textes vus par les joueurs sont en français, sauf demande contraire. Reste sobre et lisible : panneaux, cases alignées sur la grille, boutons clairement repérables.',
    '',
    `EXEMPLE valide (autre identifiant, 3 lignes) : ${example(context.allowGenerated)}`,
    '',
    `SCHÉMA JSON : ${schema}`,
  ].join('\n');
}

export function interfaceRequest(description: string): string {
  return `Interface demandée : ${description.trim()}\n\nRéponds par le document JSON complet.`;
}
