import { validate } from '../lib/jsonSchema';
import { validateAction } from '../model/actions';
import type { ActionContext } from '../model/actions';
import { conditionProblems } from '../model/conditionText';
import { GRID_COLUMNS, TITLE_Y } from '../model/geometry';
import type { Condition, MenuDefinition, SlotArea } from '../model/menu';
import { generatedTexturePath } from '../model/menuEdit';
import { stateDefinitionProblems } from '../model/stateEdit';

/**
 * Validation d’un menu produit par l’IA, en trois couches :
 * 1. le schéma `docs/menu.schema.json`, par le validateur partagé avec les
 *    tests (`src/lib/jsonSchema.ts`) ;
 * 2. les règles de la lib (`MenuValidator`) : identifiants uniques, texte
 *    en y ≥ 5, zones dans le coffre, états cités par les conditions et les
 *    actions, par les validateurs de l’éditeur (`validateAction`,
 *    `conditionProblems`, `stateDefinitionProblems`) ;
 * 3. les règles propres à la génération : identifiant et taille imposés,
 *    textures existantes ou générées par le studio, menu autonome.
 * Chaque erreur commence par le chemin JSON de la clé fautive : c’est ce que
 * la boucle de correction renvoie au modèle.
 */

export interface MenuCheckContext {
  /** `docs/menu.schema.json`, analysé. */
  schema: unknown;
  menuId: string;
  rows: number;
  /** Textures de l’espace (chemins relatifs à `textures/`). */
  textures: ReadonlySet<string>;
  /** Menus de l’espace (cibles d’`open`). */
  menus: ActionContext['menus'];
  /** Couches `generator` (dessinées par le studio) permises. */
  allowGenerated: boolean;
}

/** Côté maximal d’une texture dessinée par le studio. */
export const MAX_GENERATED_SIDE = 256;
/** y minimal d’un texte : au-delà d’un ascent de 8, Minecraft refuse la police (`MenuValidator`). */
export const MIN_TEXT_Y = TITLE_Y + 7 - 8;

const GENERATED_ID = /^[a-z0-9_]+$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Corrections sans ambiguïté, faites avant la validation : version du format
 * par défaut, type de conteneur, chemin des textures générées (le studio les
 * range sous `generated/<menu>/<couche>.png`).
 */
export function normalizeMenu(value: unknown, menuId: string): unknown {
  if (!isObject(value)) return value;
  const menu = structuredClone(value);
  if (menu.formatVersion === undefined) menu.formatVersion = 1;
  if (isObject(menu.container) && menu.container.type === undefined) menu.container.type = 'chest';
  if (Array.isArray(menu.layers)) {
    for (const layer of menu.layers) {
      if (isObject(layer) && isObject(layer.generator) && typeof layer.id === 'string' && GENERATED_ID.test(layer.id)) {
        layer.texture = generatedTexturePath(menuId, layer.id);
      }
    }
  }
  return menu;
}

function areaProblem(area: SlotArea, rows: number): string | null {
  const width = area.width ?? 1;
  const height = area.height ?? 1;
  if (area.col + width > GRID_COLUMNS || area.row + height > rows) {
    return `la zone (${area.col}, ${area.row}, ${width} × ${height} cases) sort du coffre de ${GRID_COLUMNS} × ${rows} cases`;
  }
  return null;
}

function duplicates(list: ReadonlyArray<{ id: string }>, path: string, errors: string[]) {
  const seen = new Set<string>();
  list.forEach((element, index) => {
    if (seen.has(element.id)) errors.push(`${path}[${index}].id : « ${element.id} » en double`);
    seen.add(element.id);
  });
}

/** Menu validé (normalisé), ou les erreurs avec leur chemin. */
export function checkMenu(value: unknown, context: MenuCheckContext): { value?: MenuDefinition; errors: string[] } {
  const normalized = normalizeMenu(value, context.menuId);
  const schemaErrors = validate(context.schema, normalized);
  if (schemaErrors.length > 0) return { errors: schemaErrors };
  const menu = normalized as MenuDefinition;
  const errors: string[] = [];

  if (menu.id !== context.menuId) errors.push(`$.id : « ${context.menuId} » attendu, reçu « ${menu.id} »`);
  if (menu.container.rows !== context.rows) errors.push(`$.container.rows : ${context.rows} attendu (taille choisie)`);
  for (const key of ['extends', 'includes', 'template', 'component'] as const) {
    if (menu[key] !== undefined) errors.push(`$.${key} : non pris en charge dans une génération (menu autonome attendu)`);
  }

  const states = menu.state ?? {};
  for (const [name, definition] of Object.entries(states)) {
    for (const problem of stateDefinitionProblems(definition)) errors.push(`$.state.${name} : ${problem}`);
  }
  const conditions = (condition: Condition | undefined, path: string) => {
    if (condition) for (const problem of conditionProblems(condition, states)) errors.push(`${path} : ${problem}`);
  };
  const actionContext: ActionContext = {
    states,
    menus: [...context.menus.filter((candidate) => candidate.id !== menu.id), { id: menu.id, name: menu.name, state: menu.state }],
  };

  const layers = menu.layers;
  duplicates(layers, '$.layers', errors);
  layers.forEach((layer, index) => {
    const at = `$.layers[${index}]`;
    const generator = layer.generator;
    if (generator) {
      if (!context.allowGenerated) errors.push(`${at}.generator : textures générées non permises, utilise une texture existante`);
      if (!GENERATED_ID.test(layer.id)) errors.push(`${at}.id : lettres minuscules, chiffres et _ pour une couche générée`);
      if (generator.width > MAX_GENERATED_SIDE || generator.height > MAX_GENERATED_SIDE) {
        errors.push(`${at}.generator : ${generator.width} × ${generator.height} px, ${MAX_GENERATED_SIDE} px au plus par côté`);
      }
      if (!HEX_COLOR.test(generator.color)) errors.push(`${at}.generator.color : couleur #rrggbb (ou #rrggbbaa) attendue`);
      if (generator.cellColor !== undefined && !HEX_COLOR.test(generator.cellColor)) {
        errors.push(`${at}.generator.cellColor : couleur #rrggbb attendue`);
      }
      generator.cells?.forEach((cell, cellIndex) => {
        const problem = areaProblem(cell, context.rows);
        if (problem) errors.push(`${at}.generator.cells[${cellIndex}] : ${problem}`);
      });
    } else if (!context.textures.has(layer.texture)) {
      errors.push(
        `${at}.texture : « ${layer.texture} » n’existe pas dans l’espace de travail (utilise une texture de la liste${
          context.allowGenerated ? ' ou une couche « generator »' : ''
        })`,
      );
    }
    conditions(layer.visibleWhen, `${at}.visibleWhen`);
  });

  const texts = menu.texts ?? [];
  duplicates(texts, '$.texts', errors);
  texts.forEach((text, index) => {
    const at = `$.texts[${index}]`;
    if (text.y < MIN_TEXT_Y) errors.push(`${at}.y : ${text.y}, au moins ${MIN_TEXT_Y} (sinon Minecraft refuse la police)`);
    conditions(text.visibleWhen, `${at}.visibleWhen`);
  });

  const slots = menu.slots ?? [];
  duplicates(slots, '$.slots', errors);
  slots.forEach((slot, index) => {
    const at = `$.slots[${index}]`;
    const problem = areaProblem(slot.area, context.rows);
    if (problem) errors.push(`${at}.area : ${problem}`);
    conditions(slot.visibleWhen, `${at}.visibleWhen`);
    conditions(slot.enabledWhen, `${at}.enabledWhen`);
    (slot.onClick ?? []).forEach((action, actionIndex) => {
      for (const actionProblem of validateAction(action, actionContext)) errors.push(`${at}.onClick[${actionIndex}] : ${actionProblem}`);
    });
  });

  return errors.length > 0 ? { errors } : { value: menu, errors };
}
