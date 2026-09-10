import type { MenuDefinition } from '../model/menu';
import type { ElementKind } from '../model/resolve';

export interface Selection {
  kind: ElementKind;
  id: string;
}

export interface EditorState {
  menu: MenuDefinition | null;
  /** JSON du menu tel qu’il est sur disque, pour savoir s’il y a des changements. */
  savedJson: string;
  selection: Selection | null;
  past: MenuDefinition[];
  future: MenuDefinition[];
}

export type EditorAction =
  | { type: 'load'; menu: MenuDefinition }
  | { type: 'change'; recipe: (draft: MenuDefinition) => void; record?: boolean }
  | { type: 'checkpoint' }
  | { type: 'select'; selection: Selection | null }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'saved'; json: string };

const HISTORY_LIMIT = 200;

export const INITIAL_EDITOR: EditorState = {
  menu: null,
  savedJson: '',
  selection: null,
  past: [],
  future: [],
};

function pushHistory(past: MenuDefinition[], menu: MenuDefinition): MenuDefinition[] {
  return [...past, menu].slice(-HISTORY_LIMIT);
}

/**
 * Réducteur de l’éditeur. `change` applique une recette sur une copie du menu ;
 * `record: false` sert aux changements continus (glisser-déposer), précédés
 * d’un `checkpoint` pour qu’une seule entrée d’historique soit créée.
 */
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'load':
      return {
        menu: action.menu,
        savedJson: JSON.stringify(action.menu),
        selection: null,
        past: [],
        future: [],
      };
    case 'change': {
      if (!state.menu) return state;
      const draft = structuredClone(state.menu);
      action.recipe(draft);
      if (action.record === false) return { ...state, menu: draft };
      return { ...state, menu: draft, past: pushHistory(state.past, state.menu), future: [] };
    }
    case 'checkpoint':
      if (!state.menu) return state;
      return { ...state, past: pushHistory(state.past, state.menu), future: [] };
    case 'select':
      return { ...state, selection: action.selection };
    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous || !state.menu) return state;
      return {
        ...state,
        menu: previous,
        past: state.past.slice(0, -1),
        future: [state.menu, ...state.future],
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next || !state.menu) return state;
      return {
        ...state,
        menu: next,
        past: pushHistory(state.past, state.menu),
        future: state.future.slice(1),
      };
    }
    case 'saved':
      return { ...state, savedJson: action.json };
  }
}
