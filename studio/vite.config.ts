import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { loadLibrarySources } from './server/libraries.ts'
import { workspacePlugin } from './server/workspace.ts'

const studioDir = path.dirname(fileURLToPath(import.meta.url))

// Backend de l’API locale :
// - par défaut, le serveur TypeScript intégré à Vite (studio/server/) ;
// - MENU_FORGE_BACKEND=rust : le backend Rust (`studio-api`, ou l’appli Tauri
//   en développement), vers lequel Vite « proxifie » /api.
const useRustBackend = process.env.MENU_FORGE_BACKEND === 'rust'
const rustBackendUrl = 'http://127.0.0.1:5174'

// Espace de travail : dossier contenant menus/ et textures/.
// Par défaut les exemples du dépôt ; sinon la variable MENU_FORGE_WORKSPACE.
const workspaceRoot = path.resolve(
  process.env.MENU_FORGE_WORKSPACE ?? path.join(studioDir, '../examples'),
)
const templatesRoot = path.join(studioDir, '../templates')

// Bibliothèques d'assets : fichier local non versionné (voir libraries.example.json).
const librariesFile = path.resolve(
  process.env.MENU_FORGE_LIBRARIES ?? path.join(studioDir, '../libraries.local.json'),
)

export default defineConfig(async () => ({
  plugins: useRustBackend
    ? [react()]
    : [
        react(),
        workspacePlugin({
          workspaceRoot,
          templatesRoot,
          libraries: await loadLibrarySources(librariesFile),
          cacheDir: path.join(studioDir, '.cache'),
        }),
      ],
  // Tauri affiche ses propres messages : Vite n’efface pas le terminal.
  clearScreen: false,
  server: {
    host: 'localhost',
    // Port fixe : c’est le devUrl de Tauri, et 5174 est réservé au backend Rust.
    port: 5173,
    strictPort: true,
    proxy: useRustBackend ? { '/api': { target: rustBackendUrl } } : undefined,
  },
}))
