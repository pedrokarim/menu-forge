/**
 * Validateur JSON Schema minimal, sans dépendance : le sous-ensemble de la
 * version 2020-12 employé par `docs/menu.schema.json` et
 * `docs/asset.schema.json` (types, const, enum, propriétés,
 * additionalProperties, propertyNames, items, bornes, motifs, $ref locaux,
 * allOf / anyOf / oneOf / not, if / then / else). Un mot-clé inconnu lève une
 * erreur : un schéma ne peut pas s’appuyer sur une règle que ce validateur
 * ignorerait.
 *
 * Le même code sert aux tests (`tests/jsonSchema.mjs` le réexporte) et au
 * studio, qui valide ainsi les menus produits par l’IA exactement comme ceux
 * des gabarits et des fixtures.
 */

type SchemaObject = Record<string, unknown>;

const ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', 'description', 'examples', 'default', '$defs']);
const KEYWORDS = new Set([
  'type', 'const', 'enum', 'properties', 'required', 'additionalProperties', 'propertyNames', 'minProperties',
  'items', 'minItems', 'uniqueItems', 'minLength', 'pattern', 'minimum', 'maximum', '$ref',
  'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
]);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function resolveRef(root: SchemaObject, ref: string): unknown {
  if (!ref.startsWith('#/')) throw new Error(`$ref non géré : ${ref}`);
  return ref
    .slice(2)
    .split('/')
    .reduce<unknown>((node, key) => (isObject(node) ? node[key.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), root);
}

function check(schema: unknown, value: unknown, path: string, root: SchemaObject, errors: string[]): void {
  if (schema === true) return;
  if (schema === false) {
    errors.push(`${path} : valeur interdite`);
    return;
  }
  if (!isObject(schema)) throw new Error(`schéma invalide en ${path}`);
  for (const key of Object.keys(schema)) {
    if (!KEYWORDS.has(key) && !ANNOTATIONS.has(key)) throw new Error(`mot-clé non géré par le validateur : ${key}`);
  }
  if (typeof schema.$ref === 'string') {
    const target = resolveRef(root, schema.$ref);
    if (target === undefined) throw new Error(`$ref introuvable : ${schema.$ref}`);
    check(target, value, path, root, errors);
  }
  if (schema.type !== undefined) {
    const types = ([] as unknown[]).concat(schema.type).map(String);
    const actual = typeOf(value);
    if (!types.some((type) => type === actual || (type === 'number' && actual === 'integer'))) {
      errors.push(`${path} : ${types.join(' ou ')} attendu, reçu ${actual}`);
      return;
    }
  }
  if ('const' in schema && !deepEqual(schema.const, value)) errors.push(`${path} : ${JSON.stringify(schema.const)} attendu`);
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => deepEqual(option, value))) {
    errors.push(`${path} : une valeur parmi ${schema.enum.map((option) => JSON.stringify(option)).join(', ')} attendue`);
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && [...value].length < schema.minLength) errors.push(`${path} : au moins ${schema.minLength} caractère(s)`);
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
      errors.push(`${path} : « ${value} » ne suit pas ${schema.pattern}`);
    }
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path} : au moins ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path} : au plus ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push(`${path} : au moins ${schema.minItems} élément(s)`);
    if (schema.uniqueItems === true && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) {
      errors.push(`${path} : éléments en double`);
    }
    if (schema.items !== undefined) value.forEach((item, index) => check(schema.items, item, `${path}[${index}]`, root, errors));
  }
  if (isObject(value)) {
    const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
    for (const key of required) if (!(key in value)) errors.push(`${path}.${key} : clé obligatoire absente`);
    if (typeof schema.minProperties === 'number' && Object.keys(value).length < schema.minProperties) errors.push(`${path} : objet trop petit`);
    const properties = isObject(schema.properties) ? schema.properties : undefined;
    for (const [key, child] of Object.entries(value)) {
      if (schema.propertyNames !== undefined) check(schema.propertyNames, key, `${path}.${key} (nom)`, root, errors);
      if (properties && key in properties) check(properties[key], child, `${path}.${key}`, root, errors);
      else if (schema.additionalProperties !== undefined) {
        if (schema.additionalProperties === false) errors.push(`${path}.${key} : clé inconnue`);
        else check(schema.additionalProperties, child, `${path}.${key}`, root, errors);
      }
    }
  }
  if (Array.isArray(schema.allOf)) for (const part of schema.allOf) check(part, value, path, root, errors);
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((part) => validateAt(part, value, path, root).length === 0)) {
    errors.push(`${path} : aucune des formes permises`);
  }
  if (Array.isArray(schema.oneOf)) {
    const outcomes = schema.oneOf.map((part) => validateAt(part, value, path, root));
    const matches = outcomes.filter((outcome) => outcome.length === 0).length;
    if (matches === 0) {
      // La forme la plus proche (le moins d’erreurs) explique le refus.
      const closest = outcomes.reduce((best, outcome) => (outcome.length < best.length ? outcome : best));
      errors.push(...closest);
    } else if (matches > 1) errors.push(`${path} : plusieurs formes correspondent (ambiguïté du schéma)`);
  }
  if (schema.not !== undefined && validateAt(schema.not, value, path, root).length === 0) errors.push(`${path} : forme interdite`);
  if (schema.if !== undefined) {
    const branch = validateAt(schema.if, value, path, root).length === 0 ? schema.then : schema.else;
    if (branch !== undefined) check(branch, value, path, root, errors);
  }
}

function validateAt(schema: unknown, value: unknown, path: string, root: SchemaObject): string[] {
  const errors: string[] = [];
  check(schema, value, path, root, errors);
  return errors;
}

/** Erreurs de `value` au regard de `schema` (liste vide : valide), avec le chemin de la clé fautive (`$.slots[0].area.col : …`). */
export function validate(schema: unknown, value: unknown): string[] {
  if (!isObject(schema)) throw new Error('Le schéma doit être un objet');
  return validateAt(schema, value, '$', schema);
}
