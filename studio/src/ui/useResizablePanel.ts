import { useCallback, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

/**
 * Colonnes latérales redimensionnables des éditeurs (menus, assets, pixels,
 * formulaires Bedrock) :
 * largeur par défaut, bornes, place minimale laissée à la toile, et largeur
 * choisie mémorisée d’une session à l’autre.
 *
 * Mémoire : `localStorage`, comme toute préférence d’affichage propre au poste
 * (le fichier de réglages garde ce qui décrit le travail). Stockage indisponible
 * (navigation privée, quota) : la largeur vaut pour la session seulement.
 */

/** Réglages d’une colonne, en px CSS. */
export interface ColumnSpec {
  /** Largeur par défaut, fenêtre de 1280 px et plus. */
  size: number;
  /** Largeur par défaut sous 1280 px (colonnes réduites, comme dans les feuilles de style). */
  narrowSize: number;
  /** En dessous, le contenu de la colonne se tasserait ou baverait. */
  min: number;
  max: number;
}

/** Ce qu’il faut à une poignée pour régler une colonne. */
export interface ColumnHandle {
  /** Largeur affichée. */
  value: number;
  min: number;
  /** Borne du moment : la toile garde au moins `STAGE_MIN_WIDTH`. */
  max: number;
  /** Largeur pendant un glisser (pas encore mémorisée). */
  preview: (value: number) => void;
  /** Largeur retenue, mémorisée. */
  commit: (value: number) => void;
  /** Retour à la largeur par défaut (préférence effacée). */
  reset: () => void;
}

/**
 * Colonnes des quatre éditeurs. Largeurs par défaut identiques aux valeurs de
 * repli des feuilles de style (`var(--left-width, 280px)`…) ; minimums choisis
 * pour que rien ne se tasse ni ne bave (vérifié par les tests de bout en bout).
 */
export const EDITOR_COLUMNS = {
  menus: { left: { size: 280, narrowSize: 248, min: 220, max: 460 }, right: { size: 330, narrowSize: 296, min: 280, max: 560 } },
  assets: { left: { size: 280, narrowSize: 248, min: 220, max: 460 }, right: { size: 340, narrowSize: 300, min: 280, max: 560 } },
  pixels: { left: { size: 264, narrowSize: 232, min: 220, max: 420 }, right: { size: 300, narrowSize: 268, min: 240, max: 520 } },
  // Formulaires Bedrock : même grille que l’éditeur de menus (`.workspace`).
  forms: { left: { size: 280, narrowSize: 248, min: 220, max: 460 }, right: { size: 330, narrowSize: 296, min: 280, max: 560 } },
} as const satisfies Record<string, Record<Side, ColumnSpec>>;

export type EditorKind = keyof typeof EDITOR_COLUMNS;

/** Largeur minimale laissée à la toile entre les deux colonnes. */
export const STAGE_MIN_WIDTH = 360;
/** Même seuil que les colonnes réduites des feuilles de style. */
const NARROW_VIEWPORT = 1280;
const STORAGE_PREFIX = 'menu-forge.columns.';

type Side = 'left' | 'right';

function readStored(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: number | null) {
  try {
    if (value === null) window.localStorage.removeItem(STORAGE_PREFIX + key);
    else window.localStorage.setItem(STORAGE_PREFIX + key, String(Math.round(value)));
  } catch {
    // Stockage indisponible : la largeur vaut pour la session.
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Colonnes gauche et droite d’un éditeur. `observe` va (en `ref`) sur la grille à trois
 * colonnes, `style` y pose `--left-width` et `--right-width` ; `left` et
 * `right` se passent aux poignées (`ResizeHandle`).
 */
export function useEditorColumns(editor: EditorKind) {
  const specs: Record<Side, ColumnSpec> = EDITOR_COLUMNS[editor];
  const [stored, setStored] = useState<Record<Side, number | null>>(() => ({
    left: readStored(`${editor}.left`),
    right: readStored(`${editor}.right`),
  }));
  /** Largeur de la grille, suivie en continu (fenêtre redimensionnée…). */
  const [width, setWidth] = useState<number | null>(null);
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const observer = useRef<ResizeObserver | null>(null);

  const observe = useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    observer.current = new ResizeObserver(([entry]) => {
      // Éditeur caché (autre écran) : taille nulle, on garde la dernière vraie largeur.
      if (entry.contentRect.width === 0) return;
      setWidth(entry.contentRect.width);
      setViewport(window.innerWidth);
    });
    observer.current.observe(node);
  }, []);

  const wanted = (side: Side) => {
    const spec = specs[side];
    return clamp(stored[side] ?? (viewport < NARROW_VIEWPORT ? spec.narrowSize : spec.size), spec.min, spec.max);
  };
  // Place des deux colonnes : la toile garde sa largeur minimale ; la colonne de droite (inspecteur) passe d’abord.
  const room = width === null ? Number.POSITIVE_INFINITY : width - STAGE_MIN_WIDTH;
  const rightMax = Math.min(specs.right.max, room - specs.left.min);
  const right = clamp(wanted('right'), specs.right.min, rightMax);
  const leftMax = Math.min(specs.left.max, room - right);
  const left = clamp(wanted('left'), specs.left.min, leftMax);

  // Borne de la colonne de droite selon la gauche telle qu’elle est : glisser l’une ne pousse jamais l’autre.
  const handle = (side: Side, value: number, max: number): ColumnHandle => ({
    value,
    min: specs[side].min,
    max: Math.max(specs[side].min, max),
    preview: (next) => setStored((current) => ({ ...current, [side]: next })),
    commit: (next) => {
      setStored((current) => ({ ...current, [side]: next }));
      writeStored(`${editor}.${side}`, next);
    },
    reset: () => {
      setStored((current) => ({ ...current, [side]: null }));
      writeStored(`${editor}.${side}`, null);
    },
  });

  return {
    observe,
    style: { '--left-width': `${Math.round(left)}px`, '--right-width': `${Math.round(right)}px` } as CSSProperties,
    left: handle('left', left, leftMax),
    right: handle('right', right, Math.min(specs.right.max, room - left)),
  };
}
