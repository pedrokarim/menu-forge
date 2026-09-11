/**
 * Conversions Java → Bedrock de l’export Bedrock : couleurs, noms d’items
 * (MiniMessage → codes `§`), sons et icônes d’items. Les tables sont
 * volontairement courtes : ce qu’elles ne connaissent pas est signalé par un
 * avertissement (voir `docs/bedrock.md` § 7).
 */

/** Les 16 couleurs des codes `§` (valeurs RVB de Minecraft). */
const LEGACY_COLORS: ReadonlyArray<readonly [string, number, number, number]> = [
  ['0', 0, 0, 0],
  ['1', 0, 0, 170],
  ['2', 0, 170, 0],
  ['3', 0, 170, 170],
  ['4', 170, 0, 0],
  ['5', 170, 0, 170],
  ['6', 255, 170, 0],
  ['7', 170, 170, 170],
  ['8', 85, 85, 85],
  ['9', 85, 85, 255],
  ['a', 85, 255, 85],
  ['b', 85, 255, 255],
  ['c', 255, 85, 85],
  ['d', 255, 85, 255],
  ['e', 255, 255, 85],
  ['f', 255, 255, 255],
];

/** Couleurs nommées de MiniMessage → code `§`. */
const NAMED_COLORS: Record<string, string> = {
  black: '0',
  dark_blue: '1',
  dark_green: '2',
  dark_aqua: '3',
  dark_red: '4',
  dark_purple: '5',
  gold: '6',
  gray: '7',
  grey: '7',
  dark_gray: '8',
  dark_grey: '8',
  blue: '9',
  green: 'a',
  aqua: 'b',
  red: 'c',
  light_purple: 'd',
  yellow: 'e',
  white: 'f',
};

/** Décorations de MiniMessage qui ont un code `§` sur Bedrock. */
const DECORATIONS: Record<string, string> = {
  bold: 'l',
  b: 'l',
  italic: 'o',
  i: 'o',
  em: 'o',
  obfuscated: 'k',
  obf: 'k',
  reset: 'r',
};

/** Décorations sans équivalent Bedrock (§n et §m y sont des couleurs) : retirées sans bruit. */
const DROPPED_DECORATIONS = new Set(['underlined', 'u', 'strikethrough', 'st']);

/** `#rgb` ou `#rrggbb` → composantes 0–255, ou `null` si invalide. */
export function parseHexColor(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join('') : match[1];
  return [0, 2, 4].map((start) => Number.parseInt(digits.slice(start, start + 2), 16)) as [number, number, number];
}

/** Couleur JSON UI (`[r, g, b]` entre 0 et 1, trois décimales), ou `null` si invalide. */
export function hexToUiColor(hex: string): [number, number, number] | null {
  const rgb = parseHexColor(hex);
  return rgb ? (rgb.map((value) => Math.round((value / 255) * 1000) / 1000) as [number, number, number]) : null;
}

/** Code `§` dont la couleur est la plus proche (distance euclidienne en RVB). */
export function nearestLegacyCode(red: number, green: number, blue: number): string {
  let best = LEGACY_COLORS[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const color of LEGACY_COLORS) {
    const distance = (color[1] - red) ** 2 + (color[2] - green) ** 2 + (color[3] - blue) ** 2;
    if (distance < bestDistance) {
      best = color;
      bestDistance = distance;
    }
  }
  return best[0];
}

/**
 * Texte MiniMessage → texte à codes `§` (nom d’un item, libellé de bouton).
 * Balise fermante : `§r` (approximation : le style englobant n’est pas
 * restauré). Couleur hexadécimale : code le plus proche, signalé.
 */
export function miniMessageToLegacy(text: string, warn: (message: string) => void = () => {}): string {
  return text.replace(/<(\/?)([^<>]*)>/g, (_match, closing: string, body: string) => {
    if (closing) return '§r';
    const tag = body.trim().toLowerCase();
    const color = tag.startsWith('color:') ? tag.slice('color:'.length) : tag;
    if (color in NAMED_COLORS) return `§${NAMED_COLORS[color]}`;
    const rgb = parseHexColor(color);
    if (rgb) {
      const code = nearestLegacyCode(...rgb);
      warn(`couleur ${color} ramenée au code §${code}`);
      return `§${code}`;
    }
    if (tag in DECORATIONS) return `§${DECORATIONS[tag]}`;
    if (DROPPED_DECORATIONS.has(tag)) return '';
    warn(`balise <${body}> sans équivalent Bedrock, retirée`);
    return '';
  });
}

/** Sons Java (`minecraft:` facultatif) → nom Bedrock. */
const SOUNDS: Record<string, string> = {
  'ui.button.click': 'random.click',
  'entity.experience_orb.pickup': 'random.orb',
  'entity.player.levelup': 'random.levelup',
  'entity.item.pickup': 'random.pop',
  'block.chest.open': 'random.chestopen',
  'block.chest.close': 'random.chestclosed',
  'block.anvil.use': 'random.anvil_use',
  'block.note_block.pling': 'note.pling',
  'block.note_block.harp': 'note.harp',
  'block.note_block.bell': 'note.bell',
  'block.note_block.bass': 'note.bass',
  'block.note_block.hat': 'note.hat',
  'block.note_block.snare': 'note.snare',
  'entity.villager.yes': 'mob.villager.yes',
  'entity.villager.no': 'mob.villager.no',
  'entity.enderman.teleport': 'mob.endermen.portal',
  'item.book.page_turn': 'item.book.page_turn',
};
const BEDROCK_SOUNDS = new Set(Object.values(SOUNDS));

/** Nom Bedrock d’un son ; `known` est faux s’il n’est ni dans la table ni déjà un nom Bedrock connu. */
export function bedrockSound(sound: string): { sound: string; known: boolean } {
  const name = sound.trim().replace(/^minecraft:/, '');
  if (name in SOUNDS) return { sound: SOUNDS[name], known: true };
  return { sound: name, known: BEDROCK_SOUNDS.has(name) };
}

/** Blocs dont la texture Bedrock porte un autre nom (dossier `textures/blocks/`). */
const BLOCK_TEXTURES: Record<string, string> = {
  stone: 'stone',
  dirt: 'dirt',
  cobblestone: 'cobblestone',
  sand: 'sand',
  gravel: 'gravel',
  glass: 'glass',
  bookshelf: 'bookshelf',
  obsidian: 'obsidian',
  glowstone: 'glowstone',
  barrier: 'barrier',
  oak_planks: 'planks_oak',
  oak_log: 'log_oak',
  grass_block: 'grass_side_carried',
  crafting_table: 'crafting_table_front',
  furnace: 'furnace_front_off',
  diamond_block: 'diamond_block',
  gold_block: 'gold_block',
  iron_block: 'iron_block',
  emerald_block: 'emerald_block',
};

/** Items dont la texture Bedrock porte un autre nom (dossier `textures/items/`). */
const RENAMED_ITEMS: Record<string, string> = {
  golden_apple: 'apple_golden',
  redstone: 'redstone_dust',
  bucket: 'bucket_empty',
  totem_of_undying: 'totem',
  compass: 'compass_item',
  clock: 'clock_item',
  book: 'book_normal',
  map: 'map_empty',
  bow: 'bow_standby',
  oak_sign: 'sign',
};

/** Items dont la texture Bedrock porte le même nom qu’en Java. */
const SAME_NAME_ITEMS = new Set([
  'apple',
  'arrow',
  'bone',
  'bread',
  'coal',
  'diamond',
  'diamond_sword',
  'egg',
  'emerald',
  'ender_pearl',
  'experience_bottle',
  'feather',
  'gold_ingot',
  'iron_ingot',
  'iron_sword',
  'name_tag',
  'nether_star',
  'paper',
  'stick',
  'string',
  'sugar',
]);

/**
 * Icône Bedrock d’un matériau (`DIAMOND`, `minecraft:stone`…) ; `approximate`
 * est vrai quand le chemin est deviné (`textures/items/<nom>`).
 */
export function bedrockIcon(material: string): { path: string; approximate: boolean } {
  const name = material.trim().toLowerCase().replace(/^minecraft:/, '');
  if (name in BLOCK_TEXTURES) return { path: `textures/blocks/${BLOCK_TEXTURES[name]}`, approximate: false };
  if (name in RENAMED_ITEMS) return { path: `textures/items/${RENAMED_ITEMS[name]}`, approximate: false };
  return { path: `textures/items/${name}`, approximate: !SAME_NAME_ITEMS.has(name) };
}
