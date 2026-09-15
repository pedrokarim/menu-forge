import { useSyncExternalStore } from 'react';

/**
 * Questions posées dans un dialogue du studio (à la place de `window.confirm`) : modifications non
 * enregistrées, confirmation d’une action. Ce module ne tient que la file des questions ; `DialogHost`
 * les affiche une à une. N’importe quel code peut en poser une et attendre la réponse.
 */

/** Réponse à « Enregistrer les modifications ? ». */
export type UnsavedChoice = 'save' | 'discard' | 'cancel';

export interface UnsavedQuestion {
  kind: 'unsaved';
  /** Documents concernés (noms affichés). */
  documents: string[];
  /** Ce qui arrive ensuite, pour le titre (« Fermer l’onglet », « Changer d’espace de travail »). */
  action: string;
  /** Pas d’enregistrement possible (brouillon du visualiseur de shaders) : seulement abandonner ou annuler. */
  discardOnly?: boolean;
  resolve: (choice: UnsavedChoice) => void;
}

export interface ConfirmQuestion {
  kind: 'confirm';
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  resolve: (confirmed: boolean) => void;
}

export type Question = UnsavedQuestion | ConfirmQuestion;

let queue: readonly Question[] = [];
const listeners = new Set<() => void>();

function commit(next: readonly Question[]): void {
  queue = next;
  for (const listener of listeners) listener();
}

function enqueue(question: Question): void {
  commit([...queue, question]);
}

/** Retire la question affichée (après sa réponse). */
export function answered(question: Question): void {
  commit(queue.filter((candidate) => candidate !== question));
}

/** « Enregistrer les modifications de … avant de … ? » : Enregistrer, Ne pas enregistrer, Annuler. */
export function askUnsaved(documents: string[], action: string, options: { discardOnly?: boolean } = {}): Promise<UnsavedChoice> {
  return new Promise((resolve) => enqueue({ kind: 'unsaved', documents, action, discardOnly: options.discardOnly, resolve }));
}

/** Confirmation d’une action : vrai si l’utilisateur la valide. */
export function askConfirm(input: Omit<ConfirmQuestion, 'kind' | 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => enqueue({ kind: 'confirm', ...input, resolve }));
}

export function getQuestions(): readonly Question[] {
  return queue;
}

export function subscribeQuestions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Question à afficher (la plus ancienne), ou `null`. */
export function useQuestion(): Question | null {
  return useSyncExternalStore(subscribeQuestions, getQuestions, getQuestions)[0] ?? null;
}
