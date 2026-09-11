import type { MenuDefinition } from '../model/menu';
import type { ElementKind } from '../model/resolve';

/** Élément sélectionné (couche, texte ou zone de slots). */
export interface Selection {
  kind: ElementKind;
  id: string;
}

export interface EditorState {
  menu: MenuDefinition | null;
  /** JSON du menu tel qu’il est sur disque, pour savoir s’il y a des changements. */
  savedJson: string;
  /** Éléments sélectionnés, dans l’ordre de sélection (le dernier est l’élément « actif »). */
  selection: Selection[];
  past: MenuDefinition[];
  future: MenuDefinition[];
}

export type EditorAction =
  /** Ouvre un menu (`null` : aucun, par exemple après une mise à la corbeille). */
  | { type: 'load'; menu: MenuDefinition | null }
  | { type: 'change'; recipe: (draft: MenuDefinition) => void; record?: boolean }
  | { type: 'checkpoint' }
  | { type: 'select'; selection: Selection[] }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'saved'; json: string }
  /** Le document a changé d’identifiant sur disque (renommé) : l’état suit sans perdre l’historique. */
  | { type: 'renamed'; id: string; name?: string };

const HISTORY_LIMIT = 200;

export const INITIAL_EDITOR: EditorState = {
  menu: null,
  savedJson: '',
  selection: [],
  past: [],
  future: [],
};

export function sameSelection(a: Selection | null | undefined, b: Selection | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.id === b.id;
}

export function selectionIncludes(list: readonly Selection[], target: Selection): boolean {
  return list.some((candidate) => sameSelection(candidate, target));
}

/** Ajoute `target` à la sélection, ou l’en retire s’il y est déjà (Maj/Ctrl+clic). */
export function toggleSelection(list: readonly Selection[], target: Selection): Selection[] {
  return selectionIncludes(list, target)
    ? list.filter((candidate) => !sameSelection(candidate, target))
    : [...list, target];
}

/** Réunion de deux sélections, sans doublon (ordre conservé). */
export function mergeSelections(list: readonly Selection[], added: readonly Selection[]): Selection[] {
  return [...list, ...added.filter((target) => !selectionIncludes(list, target))];
}

function pushHistory(past: MenuDefinition[], menu: MenuDefinition): MenuDefinition[] {
  return [...past, menu].slice(-HISTORY_LIMIT);
}

/** Recopie l’identifiant (et le nom) d’un menu renommé. */
function withId(menu: MenuDefinition, id: string, name?: string): MenuDefinition {
  return { ...menu, id, name: name ?? menu.name };
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
        savedJson: action.menu ? JSON.stringify(action.menu) : '',
        selection: [],
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
    case 'renamed': {
      if (!state.menu) return state;
      const saved = JSON.parse(state.savedJson) as MenuDefinition;
      return {
        ...state,
        menu: withId(state.menu, action.id, action.name),
        savedJson: JSON.stringify(withId(saved, action.id, action.name)),
        past: state.past.map((menu) => withId(menu, action.id)),
        future: state.future.map((menu) => withId(menu, action.id)),
      };
    }
  }
}
