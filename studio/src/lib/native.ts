/**
 * Fonctions natives de l’appli Tauri (sélecteur de dossier, explorateur).
 * Absentes en mode navigateur : l’interface propose alors une saisie de chemin.
 * Les modules Tauri ne sont chargés qu’à l’usage.
 */

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Sélecteur de dossier natif ; `null` si l’utilisateur annule. */
export async function pickFolder(title: string, defaultPath?: string): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({ directory: true, multiple: false, title, defaultPath });
  return typeof result === 'string' ? result : null;
}

/** Montre le dossier (ou le fichier) dans l’explorateur du système. */
export async function revealInExplorer(path: string): Promise<void> {
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(path);
}
