/**
 * Palette par défaut de Menu Forge : tons de l’interface de Minecraft, du
 * thème Deepslate et les 16 couleurs du chat. Partagée par l’éditeur de
 * pixels et la génération de textures par IA (palette imposée).
 */
export const DEFAULT_PALETTE: ReadonlyArray<{ hex: string; name: string }> = [
  { hex: '#ffffff', name: 'Blanc (lumière des cadres)' },
  { hex: '#c6c6c6', name: 'Fond d’inventaire' },
  { hex: '#8b8b8b', name: 'Case (slot)' },
  { hex: '#555555', name: 'Ombre des cadres' },
  { hex: '#373737', name: 'Ombre de case' },
  { hex: '#404040', name: 'Texte des titres' },
  { hex: '#000000', name: 'Noir (contour)' },
  { hex: '#100010', name: 'Fond d’infobulle' },
  { hex: '#5000ff', name: 'Liseré d’infobulle (haut)' },
  { hex: '#28007f', name: 'Liseré d’infobulle (bas)' },
  { hex: '#1b1c21', name: 'Deepslate · fond' },
  { hex: '#26272e', name: 'Deepslate · panneau' },
  { hex: '#3c3d46', name: 'Deepslate · bouton' },
  { hex: '#5c5d68', name: 'Deepslate · lumière' },
  { hex: '#f2c94c', name: 'Deepslate · or' },
  { hex: '#8f6c14', name: 'Deepslate · or sombre' },
  { hex: '#000000', name: '§0 noir' },
  { hex: '#0000aa', name: '§1 bleu foncé' },
  { hex: '#00aa00', name: '§2 vert foncé' },
  { hex: '#00aaaa', name: '§3 cyan foncé' },
  { hex: '#aa0000', name: '§4 rouge foncé' },
  { hex: '#aa00aa', name: '§5 violet' },
  { hex: '#ffaa00', name: '§6 or' },
  { hex: '#aaaaaa', name: '§7 gris' },
  { hex: '#555555', name: '§8 gris foncé' },
  { hex: '#5555ff', name: '§9 bleu' },
  { hex: '#55ff55', name: '§a vert' },
  { hex: '#55ffff', name: '§b cyan' },
  { hex: '#ff5555', name: '§c rouge' },
  { hex: '#ff55ff', name: '§d rose' },
  { hex: '#ffff55', name: '§e jaune' },
  { hex: '#ffffff', name: '§f blanc' },
];
