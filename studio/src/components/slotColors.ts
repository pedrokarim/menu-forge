import type { SlotKind } from '../model/menu';

/** Couleur de chaque type de slot, partagée par la toile et la liste des éléments. */
export const SLOT_COLORS: Record<SlotKind, string> = {
  button: '#4f9dff',
  list: '#3ecf8e',
  input: '#f5a524',
  decoration: '#a78bfa',
};
