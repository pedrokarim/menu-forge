/**
 * Validateur JSON Schema minimal, sans dépendance : le sous-ensemble de la
 * version 2020-12 employé par `docs/menu.schema.json` (types, const, enum,
 * propriétés, additionalProperties, propertyNames, items, bornes, motifs,
 * $ref locaux, allOf / anyOf / oneOf / not, if / then / else). Un mot-clé
 * inconnu fait échouer le test : le schéma ne peut pas s’appuyer sur une
 * règle que ce validateur ignorerait.
 */

const ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', 'description', 'examples', 'default', '$defs']);
const KEYWORDS = new Set([
  'type', 'const', 'enum', 'properties', 'required', 'additionalProperties', 'propertyNames', 'minProperties',
  'items', 'minItems', 'uniqueItems', 'minLength', 'pattern', 'minimum', 'maximum', '$ref',
  'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
]);

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`$ref non géré : ${ref}`);
  return ref
    .slice(2)
    .split('/')
    .reduce((node, key) => node?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], root);
}

function check(schema, value, path, root, errors) {
  if (schema === true) return;
  if (schema === false) {
    errors.push(`${path} : valeur interdite`);
    return;
  }
  for (const key of Object.keys(schema)) {
    if (!KEYWORDS.has(key) && !ANNOTATIONS.has(key)) throw new Error(`mot-clé non géré par le validateur : ${key}`);
  }
  if (schema.$ref) {
    const target = resolveRef(root, schema.$ref);
    if (!target) throw new Error(`$ref introuvable : ${schema.$ref}`);
    check(target, value, path, root, errors);
  }
  if (schema.type) {
    const types = [].concat(schema.type);
    const actual = typeOf(value);
    if (!types.some((type) => type === actual || (type === 'number' && actual === 'integer'))) {
      errors.push(`${path} : ${types.join(' ou ')} attendu, reçu ${actual}`);
      return;
    }
  }
  if ('const' in schema && !deepEqual(schema.const, value)) errors.push(`${path} : ${JSON.stringify(schema.const)} attendu`);
  if (schema.enum && !schema.enum.some((option) => deepEqual(option, value))) {
    errors.push(`${path} : une valeur parmi ${schema.enum.map((option) => JSON.stringify(option)).join(', ')} attendue`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) errors.push(`${path} : au moins ${schema.minLength} caractère(s)`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${path} : « ${value} » ne suit pas ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} : au moins ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} : au plus ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} : au moins ${schema.minItems} élément(s)`);
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push(`${path} : éléments en double`);
    if (schema.items !== undefined) value.forEach((item, index) => check(schema.items, item, `${path}[${index}]`, root, errors));
  }
  if (isObject(value)) {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}.${key} : clé obligatoire absente`);
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) errors.push(`${path} : objet trop petit`);
    for (const [key, child] of Object.entries(value)) {
      if (schema.propertyNames) check(schema.propertyNames, key, `${path}.${key} (nom)`, root, errors);
      if (schema.properties && key in schema.properties) check(schema.properties[key], child, `${path}.${key}`, root, errors);
      else if (schema.additionalProperties !== undefined) {
        if (schema.additionalProperties === false) errors.push(`${path}.${key} : clé inconnue`);
        else check(schema.additionalProperties, child, `${path}.${key}`, root, errors);
      }
    }
  }
  for (const part of schema.allOf ?? []) check(part, value, path, root, errors);
  if (schema.anyOf && !schema.anyOf.some((part) => validateAt(part, value, path, root).length === 0)) {
    errors.push(`${path} : aucune des formes permises`);
  }
  if (schema.oneOf) {
    const outcomes = schema.oneOf.map((part) => validateAt(part, value, path, root));
    const matches = outcomes.filter((outcome) => outcome.length === 0).length;
    if (matches === 0) {
      // La forme la plus proche (le moins d’erreurs) explique le refus.
      const closest = outcomes.reduce((best, outcome) => (outcome.length < best.length ? outcome : best));
      errors.push(...closest);
    } else if (matches > 1) errors.push(`${path} : plusieurs formes correspondent (ambiguïté du schéma)`);
  }
  if (schema.not && validateAt(schema.not, value, path, root).length === 0) errors.push(`${path} : forme interdite`);
  if (schema.if) {
    const branch = validateAt(schema.if, value, path, root).length === 0 ? schema.then : schema.else;
    if (branch) check(branch, value, path, root, errors);
  }
}

function validateAt(schema, value, path, root) {
  const errors = [];
  check(schema, value, path, root, errors);
  return errors;
}

/** Erreurs de `value` au regard de `schema` (liste vide : valide). */
export function validate(schema, value) {
  return validateAt(schema, value, '$', schema);
}
