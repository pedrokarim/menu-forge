/**
 * Validateur JSON Schema des tests : c’est celui du studio
 * (`src/lib/jsonSchema.ts`), qui valide aussi les menus produits par l’IA.
 * Un mot-clé inconnu fait échouer le test : le schéma ne peut pas s’appuyer
 * sur une règle que ce validateur ignorerait.
 */
export { validate } from '../src/lib/jsonSchema.ts';
