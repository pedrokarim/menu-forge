import type { JSX, SVGProps } from 'react';
import { AlignCenterHorizontal } from 'pixelarticons/react/AlignCenterHorizontal';
import { AlignCenterVertical } from 'pixelarticons/react/AlignCenterVertical';
import { AlignEndHorizontal } from 'pixelarticons/react/AlignEndHorizontal';
import { AlignEndVertical } from 'pixelarticons/react/AlignEndVertical';
import { AlignHorizontalDistributeCenter } from 'pixelarticons/react/AlignHorizontalDistributeCenter';
import { AlignStartHorizontal } from 'pixelarticons/react/AlignStartHorizontal';
import { AlignStartVertical } from 'pixelarticons/react/AlignStartVertical';
import { AlignVerticalDistributeCenter } from 'pixelarticons/react/AlignVerticalDistributeCenter';
import { Clipboard } from 'pixelarticons/react/Clipboard';
import { Lock } from 'pixelarticons/react/Lock';
import { MoreHorizontal } from 'pixelarticons/react/MoreHorizontal';
import { Scissors } from 'pixelarticons/react/Scissors';
import { Unlock } from 'pixelarticons/react/Unlock';
import { ArrowDown } from 'pixelarticons/react/ArrowDown';
import { ArrowLeft } from 'pixelarticons/react/ArrowLeft';
import { ArrowRight } from 'pixelarticons/react/ArrowRight';
import { ArrowUp } from 'pixelarticons/react/ArrowUp';
import { Bulletlist } from 'pixelarticons/react/Bulletlist';
import { Check } from 'pixelarticons/react/Check';
import { Clock } from 'pixelarticons/react/Clock';
import { Folder } from 'pixelarticons/react/Folder';
import { FolderPlus } from 'pixelarticons/react/FolderPlus';
import { Home } from 'pixelarticons/react/Home';
import { Open } from 'pixelarticons/react/Open';
import { Pencil } from 'pixelarticons/react/Pencil';
import { Reload } from 'pixelarticons/react/Reload';
import { Sliders } from 'pixelarticons/react/Sliders';
import { ChevronDown } from 'pixelarticons/react/ChevronDown';
import { ChevronUp } from 'pixelarticons/react/ChevronUp';
import { Close } from 'pixelarticons/react/Close';
import { Copy } from 'pixelarticons/react/Copy';
import { CornerDownLeft } from 'pixelarticons/react/CornerDownLeft';
import { Delete } from 'pixelarticons/react/Delete';
import { Mouse } from 'pixelarticons/react/Mouse';
import { Move } from 'pixelarticons/react/Move';
import { Crop } from 'pixelarticons/react/Crop';
import { Download } from 'pixelarticons/react/Download';
import { Expand } from 'pixelarticons/react/Expand';
import { Eye } from 'pixelarticons/react/Eye';
import { EyeOff } from 'pixelarticons/react/EyeOff';
import { Grid3x3 } from 'pixelarticons/react/Grid3x3';
import { Image } from 'pixelarticons/react/Image';
import { InfoBox } from 'pixelarticons/react/InfoBox';
import { Keyboard } from 'pixelarticons/react/Keyboard';
import { LetterT } from 'pixelarticons/react/LetterT';
import { Library } from 'pixelarticons/react/Library';
import { Loader } from 'pixelarticons/react/Loader';
import { Plus } from 'pixelarticons/react/Plus';
import { Redo } from 'pixelarticons/react/Redo';
import { Save } from 'pixelarticons/react/Save';
import { Search } from 'pixelarticons/react/Search';
import { Sparkles } from 'pixelarticons/react/Sparkles';
import { Square } from 'pixelarticons/react/Square';
import { SquareAlert } from 'pixelarticons/react/SquareAlert';
import { TextAlignCenter } from 'pixelarticons/react/TextAlignCenter';
import { TextAlignLeft } from 'pixelarticons/react/TextAlignLeft';
import { TextAlignRight } from 'pixelarticons/react/TextAlignRight';
import { Trash } from 'pixelarticons/react/Trash';
import { Undo } from 'pixelarticons/react/Undo';
import { Upload } from 'pixelarticons/react/Upload';
import { WarningDiamond } from 'pixelarticons/react/WarningDiamond';

type IconComponent = (props: SVGProps<SVGSVGElement>) => JSX.Element;

/** Rectangle `[x, y, largeur, hauteur]` sur la grille 24 × 24 des pixelarticons. */
type PixelRect = readonly [number, number, number, number];

/**
 * Icône dessinée à la main, sur la même grille que pixelarticons (24 × 24,
 * pixels de 2 unités) : un tracé fait uniquement de rectangles reste net.
 */
function pixelIcon(rects: readonly PixelRect[]): IconComponent {
  const d = rects.map(([x, y, width, height]) => `M${x} ${y}h${width}v${height}h${-width}z`).join('');
  return (props) => (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d={d} />
    </svg>
  );
}

/** Pointeur plein, à la manière du curseur du jeu (absent de pixelarticons). */
const Cursor = pixelIcon([
  [5, 2, 2, 2],
  [5, 4, 4, 2],
  [5, 6, 6, 2],
  [5, 8, 8, 2],
  [5, 10, 10, 2],
  [5, 12, 12, 2],
  [5, 14, 8, 2],
  [5, 16, 2, 2],
  [9, 16, 4, 2],
  [11, 18, 4, 2],
  [11, 20, 4, 2],
]);

/** Moins : la barre horizontale de « plus » (zoom arrière ; absent de pixelarticons). */
const Minus = pixelIcon([[4, 11, 16, 2]]);

/** Contour de la souris de pixelarticons (`mouse.svg`), repris pour les variantes ci-dessous. */
const MOUSE_OUTLINE: readonly PixelRect[] = [
  [8, 2, 8, 2],
  [8, 20, 8, 2],
  [6, 4, 2, 2],
  [6, 18, 2, 2],
  [16, 4, 2, 2],
  [16, 18, 2, 2],
  [4, 6, 2, 12],
  [18, 6, 2, 12],
];

/** Clic droit : bouton droit plein, séparé du corps. */
const MouseRight = pixelIcon([
  ...MOUSE_OUTLINE,
  [11, 4, 2, 6],
  [6, 10, 12, 2],
  [13, 4, 3, 2],
  [13, 6, 5, 4],
]);

/** Clic molette : molette épaisse et pleine, séparée du corps. */
const MouseMiddle = pixelIcon([...MOUSE_OUTLINE, [10, 4, 4, 6], [6, 10, 4, 2], [14, 10, 4, 2]]);

/** Touche Maj : flèche creuse vers le haut. */
const KeyShift = pixelIcon([
  [11, 3, 2, 2],
  [9, 5, 2, 2],
  [13, 5, 2, 2],
  [7, 7, 2, 2],
  [15, 7, 2, 2],
  [5, 9, 2, 2],
  [17, 9, 2, 2],
  [5, 11, 5, 2],
  [14, 11, 5, 2],
  [8, 13, 2, 7],
  [14, 13, 2, 7],
  [8, 19, 8, 2],
]);

/** Barre d’espace : le crochet ouvert vers le haut. */
const KeySpace = pixelIcon([
  [3, 11, 2, 6],
  [19, 11, 2, 6],
  [3, 15, 18, 2],
]);

/** Agrandir la fenêtre : un carré vide. */
const WindowMaximize = pixelIcon([
  [5, 5, 14, 2],
  [5, 17, 14, 2],
  [5, 7, 2, 10],
  [17, 7, 2, 10],
]);

/** Restaurer la fenêtre : deux carrés décalés. */
const WindowRestore = pixelIcon([
  [4, 9, 11, 2],
  [4, 18, 11, 2],
  [4, 11, 2, 7],
  [13, 11, 2, 7],
  [8, 5, 11, 2],
  [17, 7, 2, 9],
  [8, 7, 2, 2],
  [15, 14, 2, 2],
]);

/** Coffre : couvercle, corps et loquet (pour le mode Menus). */
const Chest = pixelIcon([
  [4, 4, 16, 2],
  [2, 6, 2, 12],
  [20, 6, 2, 12],
  [2, 18, 20, 2],
  [4, 10, 6, 2],
  [14, 10, 6, 2],
  [10, 8, 4, 6],
]);

/** Grouper : deux pièces dans un cadre pointillé (absent de pixelarticons). */
const Group = pixelIcon([
  [2, 2, 4, 2],
  [2, 4, 2, 2],
  [18, 2, 4, 2],
  [20, 4, 2, 2],
  [2, 20, 4, 2],
  [2, 18, 2, 2],
  [18, 20, 4, 2],
  [20, 18, 2, 2],
  [10, 2, 4, 2],
  [10, 20, 4, 2],
  [2, 10, 2, 4],
  [20, 10, 2, 4],
  [6, 6, 6, 6],
  [12, 12, 6, 6],
]);

/** Dégrouper : deux pièces creuses, séparées, sans cadre. */
const Ungroup = pixelIcon([
  [2, 2, 8, 2],
  [2, 8, 8, 2],
  [2, 4, 2, 4],
  [8, 4, 2, 4],
  [14, 14, 8, 2],
  [14, 20, 8, 2],
  [14, 16, 2, 4],
  [20, 16, 2, 4],
]);

/** Sélection au rectangle : cadre pointillé. */
const Marquee = pixelIcon([
  [2, 2, 4, 2],
  [2, 4, 2, 2],
  [10, 2, 4, 2],
  [18, 2, 4, 2],
  [20, 4, 2, 2],
  [2, 10, 2, 4],
  [20, 10, 2, 4],
  [2, 18, 2, 2],
  [2, 20, 4, 2],
  [10, 20, 4, 2],
  [20, 18, 2, 2],
  [18, 20, 4, 2],
]);

const ICONS = {
  alert: SquareAlert,
  'align-center': TextAlignCenter,
  'align-left': TextAlignLeft,
  'align-right': TextAlignRight,
  'arrow-down': ArrowDown,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'arrow-up': ArrowUp,
  'arrange-bottom': AlignEndHorizontal,
  'arrange-center': AlignCenterVertical,
  'arrange-left': AlignStartVertical,
  'arrange-middle': AlignCenterHorizontal,
  'arrange-right': AlignEndVertical,
  'arrange-top': AlignStartHorizontal,
  box: Square,
  check: Check,
  chest: Chest,
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,
  clipboard: Clipboard,
  clock: Clock,
  close: Close,
  copy: Copy,
  crop: Crop,
  cursor: Cursor,
  cut: Scissors,
  'distribute-horizontal': AlignHorizontalDistributeCenter,
  'distribute-vertical': AlignVerticalDistributeCenter,
  download: Download,
  drag: Move,
  expand: Expand,
  eye: Eye,
  'eye-off': EyeOff,
  folder: Folder,
  'folder-plus': FolderPlus,
  grid: Grid3x3,
  group: Group,
  home: Home,
  image: Image,
  info: InfoBox,
  keyboard: Keyboard,
  'key-delete': Delete,
  'key-enter': CornerDownLeft,
  'key-shift': KeyShift,
  'key-space': KeySpace,
  library: Library,
  list: Bulletlist,
  loader: Loader,
  lock: Lock,
  marquee: Marquee,
  minus: Minus,
  more: MoreHorizontal,
  mouse: Mouse,
  'mouse-middle': MouseMiddle,
  'mouse-right': MouseRight,
  open: Open,
  pencil: Pencil,
  plus: Plus,
  redo: Redo,
  reload: Reload,
  save: Save,
  search: Search,
  sliders: Sliders,
  sparkles: Sparkles,
  text: LetterT,
  trash: Trash,
  undo: Undo,
  ungroup: Ungroup,
  unlock: Unlock,
  upload: Upload,
  warning: WarningDiamond,
  'window-maximize': WindowMaximize,
  'window-restore': WindowRestore,
} satisfies Record<string, IconComponent>;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  /** Multiple de 12 px : chaque pixel de l’icône tombe sur un pixel entier de l’écran. */
  size?: 12 | 24 | 36 | 48;
  /** Texte alternatif ; sans lui, l’icône est décorative (masquée aux lecteurs d’écran). */
  label?: string;
  className?: string;
}

/** Icône pixel (pixelarticons, MIT, ou dessin maison sur la même grille). */
export function Icon({ name, size = 12, label, className }: IconProps) {
  const Component = ICONS[name];
  return (
    <Component
      width={size}
      height={size}
      className={className ? `icon ${className}` : 'icon'}
      shapeRendering="crispEdges"
      focusable="false"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
