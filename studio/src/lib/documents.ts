import type { MenuDefinition } from '../model/menu';
import { uniqueId } from '../model/menu';
import { rewriteMenuReferences } from '../model/references';
import { saveMenu } from './api';
import { duplicateDocument, renameDocument, trashDocument } from './appApi';
import type { DocumentSummary, DocumentType, TrashedDocument } from './appApi';
import { NBSP } from './format';

/**
 * Gestion des documents (menus et assets) partagée par l’accueil et
 * l’éditeur : renommer (avec mise à jour des références), dupliquer, mettre à
 * la corbeille.
 */

/** Opération faite sur un document, transmise à l’éditeur pour qu’il suive. */
export interface DocumentEvent {
  kind: 'renamed' | 'duplicated' | 'trashed';
  type: DocumentType;
  from: string;
  /** Nouvel identifiant (renommé, dupliqué). */
  to?: string;
  name?: string;
  /** Menus réécrits parce qu’ils faisaient référence au menu renommé. */
  updated?: string[];
  nonce: number;
}

export const DOCUMENT_NOUNS: Record<DocumentType, string> = { menu: 'menu', asset: 'asset' };

/**
 * Renomme un document ; pour un menu, les autres menus qui y font référence
 * (`extends`, action `open`) sont réécrits si `updateReferences`.
 */
export async function renameWithReferences(options: {
  type: DocumentType;
  from: string;
  to: string;
  name?: string;
  menus: readonly MenuDefinition[];
  updateReferences: boolean;
}): Promise<{ summary: DocumentSummary; updated: string[] }> {
  const { type, from, to, name, menus, updateReferences } = options;
  const summary = await renameDocument(type, from, to, name);
  const updated: string[] = [];
  if (type === 'menu' && updateReferences) {
    for (const menu of menus) {
      if (menu.id === from) continue;
      const copy = structuredClone(menu);
      if (!rewriteMenuReferences(copy, from, to)) continue;
      await saveMenu(copy);
      updated.push(menu.id);
    }
  }
  return { summary, updated };
}

/** Duplique un document sous le premier identifiant libre (`shop_2`…), nommé « … (copie) ». */
export function duplicateWithFreeId(
  type: DocumentType,
  from: string,
  name: string,
  existingIds: readonly string[],
): Promise<DocumentSummary> {
  return duplicateDocument(type, from, uniqueId(from, existingIds), `${name} (copie)`);
}

/** Demande confirmation (si le réglage le veut) puis déplace le document dans la corbeille. */
export async function trashWithConfirmation(
  type: DocumentType,
  id: string,
  name: string,
  ask: boolean,
): Promise<TrashedDocument | null> {
  const question =
    `Mettre le ${DOCUMENT_NOUNS[type]} « ${name} » à la corbeille${NBSP}? ` +
    `Il est déplacé dans le dossier .trash de l’espace de travail${NBSP}: rien n’est supprimé.`;
  if (ask && !window.confirm(question)) return null;
  return trashDocument(type, id);
}
