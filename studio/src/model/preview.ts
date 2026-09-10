import type { ConditionContext } from './conditions';
import type { MenuDefinition, StateValue } from './menu';

/** Valeurs choisies dans le panneau d’aperçu (état simulé du menu). */
export interface PreviewValues {
  state: Record<string, StateValue>;
  pageCounts: Record<string, number>;
  flags: string[];
  viewerName: string;
}

export const DEFAULT_PREVIEW: PreviewValues = {
  state: {},
  pageCounts: {},
  flags: [],
  viewerName: 'Steve',
};

export const DEFAULT_PAGE_COUNT = 3;

export interface PreviewContext extends ConditionContext {
  variables: Record<string, string>;
}

/**
 * Construit le contexte d’évaluation à partir des valeurs d’aperçu, en
 * retombant sur les valeurs par défaut du menu. Pour un état `page` nommé `p`,
 * dérive les drapeaux `p.hasPrev` / `p.hasNext` comme le fera la lib.
 */
export function buildPreviewContext(menu: MenuDefinition, values: PreviewValues): PreviewContext {
  const state: Record<string, StateValue> = {};
  const flags = new Set(values.flags.map((flag) => flag.trim()).filter(Boolean));
  const variables: Record<string, string> = { 'viewer.name': values.viewerName };

  for (const [name, definition] of Object.entries(menu.state ?? {})) {
    const chosen = values.state[name];
    switch (definition.type) {
      case 'enum':
        state[name] =
          typeof chosen === 'string' && definition.values.includes(chosen) ? chosen : definition.default;
        break;
      case 'bool':
        state[name] = typeof chosen === 'boolean' ? chosen : definition.default;
        break;
      case 'int':
        state[name] = typeof chosen === 'number' ? chosen : definition.default;
        break;
      case 'page': {
        const count = Math.max(1, values.pageCounts[name] ?? DEFAULT_PAGE_COUNT);
        const page = Math.min(count, Math.max(1, typeof chosen === 'number' ? chosen : 1));
        state[name] = page;
        if (page > 1) flags.add(`${name}.hasPrev`);
        if (page < count) flags.add(`${name}.hasNext`);
        variables[`${name}.number`] = String(page);
        variables[`${name}.count`] = String(count);
        break;
      }
    }
    variables[`state.${name}`] = String(state[name]);
  }

  return { state, flags, variables };
}

/** Remplace les variables `{nom}` connues ; les inconnues restent telles quelles. */
export function interpolate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (match, name: string) => variables[name] ?? match);
}
