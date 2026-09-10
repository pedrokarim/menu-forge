import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { workspacePlugin } from './server/workspace.ts'

const studioDir = path.dirname(fileURLToPath(import.meta.url))

// Espace de travail : dossier contenant menus/ et textures/.
// Par défaut les exemples du dépôt ; sinon la variable MENU_FORGE_WORKSPACE.
const workspaceRoot = path.resolve(
  process.env.MENU_FORGE_WORKSPACE ?? path.join(studioDir, '../examples'),
)
const templatesRoot = path.join(studioDir, '../templates')

export default defineConfig({
  plugins: [react(), workspacePlugin({ workspaceRoot, templatesRoot })],
  server: { host: 'localhost' },
})
