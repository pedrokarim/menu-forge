import type { SlotKind } from '../model/menu';

/** Couleur de chaque type de slot, partagée par la toile et la liste des éléments. */
export const SLOT_COLORS: Record<SlotKind, string> = {
  button: '#5aa0ff',
  list: '#4cd07d',
  input: '#ff9d3c',
  decoration: '#b98aff',
};
