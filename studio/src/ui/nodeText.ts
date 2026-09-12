import { isValidElement } from 'react';
import type { ReactNode } from 'react';

/**
 * Texte brut d’un contenu React (chaînes, nombres, fragments, éléments), pour
 * l’infobulle d’un libellé que la colonne coupe par des points de suspension.
 */
export function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return '';
}
