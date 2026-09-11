import type { WorkspaceSnapshot } from '../../lib/api';
import { fetchSettings } from '../../lib/appApi';
import { NBSP, plural } from '../../lib/format';
import { withWriteHeader } from '../../lib/http';
import { loadWorkspaceTexture, menusForExport } from '../exportWorkspace';
import { generateBedrockExport, nextPackVersion } from './generate';
import type { PackVersion } from './generate';

/**
 * Export pour Bedrock (voir `docs/bedrock.md`) : le studio lit la version du
 * pack déjà présent dans le dossier cible, génère le pack suivant et le
 * descripteur d’exécution, puis le backend les écrit (`POST /api/export/bedrock`).
 * Chargé à la demande, comme l’export Java.
 */

/** Réponse de `GET /api/export/bedrock`. */
interface BedrockTarget {
  directory: string;
  /** Version du pack déjà exporté, ou `null`. */
  version: number[] | null;
}

export interface BedrockExportResult {
  directory: string;
  menus: number;
  files: number;
  /** Fichiers du précédent export supprimés (chemins relatifs au dossier cible). */
  removed: string[];
  version: PackVersion;
  warnings: string[];
  /** Message d’état à afficher. */
  summary: string;
}

async function failure(response: Response): Promise<Error> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === 'string') return new Error(parsed.error);
  } catch {
    // Texte brut.
  }
  return new Error(text || `Erreur ${response.status}`);
}

/** Base64 d’octets quelconques (par tranches, pour ne pas dépasser la pile d’arguments). */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

/** Exporte tous les menus de l’espace pour Bedrock, dans le dossier réglé dans les paramètres. */
export async function exportForBedrock(snapshot: WorkspaceSnapshot): Promise<BedrockExportResult> {
  const targetResponse = await fetch('/api/export/bedrock');
  if (!targetResponse.ok) throw await failure(targetResponse);
  const target = (await targetResponse.json()) as BedrockTarget;
  const { export: settings } = await fetchSettings();
  const menus = menusForExport(snapshot);
  const version = nextPackVersion(target.version);
  const generated = await generateBedrockExport(menus, loadWorkspaceTexture, { version, namespace: settings.namespace });
  const files = [...generated.files].map(([path, data]) => ({ path, data: toBase64(data) }));
  const response = await fetch(
    '/api/export/bedrock',
    withWriteHeader({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) }),
  );
  if (!response.ok) throw await failure(response);
  const written = (await response.json()) as { directory: string; files: number; removed: string[]; version: PackVersion };
  const result = { ...written, menus: generated.runtime.menus.length, warnings: generated.warnings };
  return { ...result, summary: exportSummary(result) };
}

/** Message d’état affiché après l’export (construit ici pour ne pas alourdir le paquet principal). */
export function exportSummary(result: Omit<BedrockExportResult, 'summary'>): string {
  const removed =
    result.removed.length > 0 ? `, ${plural(result.removed.length, 'ancien fichier retiré', 'anciens fichiers retirés')}` : '';
  const warnings =
    result.warnings.length > 0
      ? `${NBSP}; ${plural(result.warnings.length, 'avertissement')} (${result.warnings[0]}${result.warnings.length > 1 ? '…' : ''})`
      : '';
  return `Exporté pour Bedrock${NBSP}: ${plural(result.menus, 'menu')}, pack ${result.version.join('.')}${removed}, dans ${result.directory}${warnings}`;
}
