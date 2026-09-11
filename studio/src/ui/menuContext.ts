import { createContext, useContext } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { IconName } from './Icon';

/** Action d’un menu contextuel. */
export interface MenuAction {
  label: string;
  icon?: IconName;
  /** Raccourci affiché à droite (« Ctrl+D »), à titre indicatif. */
  shortcut?: string;
  disabled?: boolean;
  /** Action destructrice (supprimer, retirer) : en rouge. */
  danger?: boolean;
  onSelect: () => void;
}

/** Entrée d’un menu contextuel : action, séparateur ou titre (nom de l’élément visé). */
export type MenuEntry = MenuAction | { separator: true } | { heading: string };

/** Ouvre le menu au pointeur (ou sous l’élément si le menu est ouvert au clavier). */
export type OpenContextMenu = (event: ReactMouseEvent | MouseEvent, entries: MenuEntry[]) => void;

/** Sans fournisseur (tests isolés), le clic droit garde son comportement habituel. */
export const ContextMenuContext = createContext<OpenContextMenu>(() => undefined);

/** Ouvre un menu contextuel, par exemple dans un gestionnaire `onContextMenu`. */
export function useContextMenu(): OpenContextMenu {
  return useContext(ContextMenuContext);
}

export function isMenuAction(entry: MenuEntry): entry is MenuAction {
  return 'onSelect' in entry;
}
