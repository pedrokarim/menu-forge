import type { AssetDefinition } from './model';

/**
 * Historique annuler / rétablir de l’éditeur d’assets.
 *
 * - `change` applique une recette sur une copie de l’asset et crée une entrée
 *   d’historique ;
 * - `record: false` sert aux changements continus (glisser, redimensionner),
 *   précédés d’un `checkpoint` pour ne créer qu’une seule entrée ;
 * - `coalesce` regroupe les changements successifs d’un même champ (frappe
 *   dans un texte, sélecteur de couleur) survenus à moins d’une seconde
 *   d’intervalle.
 */

export interface AssetHistory {
  present: AssetDefinition;
  past: AssetDefinition[];
  future: AssetDefinition[];
  lastCoalesce: { key: string; at: number } | null;
}

export type Recipe = (draft: AssetDefinition) => void;

export type HistoryAction =
  | { type: 'change'; recipe: Recipe; record?: boolean; coalesce?: string; at?: number }
  | { type: 'checkpoint' }
  | { type: 'undo' }
  | { type: 'redo' };

const HISTORY_LIMIT = 200;
const COALESCE_WINDOW_MS = 1000;

export function createHistory(initial: AssetDefinition): AssetHistory {
  return { present: structuredClone(initial), past: [], future: [], lastCoalesce: null };
}

function pushPast(past: AssetDefinition[], asset: AssetDefinition): AssetDefinition[] {
  return [...past, asset].slice(-HISTORY_LIMIT);
}

export function historyReducer(state: AssetHistory, action: HistoryAction): AssetHistory {
  switch (action.type) {
    case 'change': {
      const draft = structuredClone(state.present);
      action.recipe(draft);
      if (JSON.stringify(draft) === JSON.stringify(state.present)) return state;
      if (action.record === false) return { ...state, present: draft };
      const at = action.at ?? 0;
      const last = state.lastCoalesce;
      if (action.coalesce && last && last.key === action.coalesce && at - last.at < COALESCE_WINDOW_MS) {
        return { ...state, present: draft, lastCoalesce: { key: action.coalesce, at } };
      }
      return {
        present: draft,
        past: pushPast(state.past, state.present),
        future: [],
        lastCoalesce: action.coalesce ? { key: action.coalesce, at } : null,
      };
    }
    case 'checkpoint':
      return { ...state, past: pushPast(state.past, state.present), future: [], lastCoalesce: null };
    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        present: previous,
        past: state.past.slice(0, -1),
        future: [state.present, ...state.future],
        lastCoalesce: null,
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        present: next,
        past: pushPast(state.past, state.present),
        future: state.future.slice(1),
        lastCoalesce: null,
      };
    }
  }
}
