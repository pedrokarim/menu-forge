import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// L’API locale est servie par le backend Rust (`studio-api` lancé par
// `npm run dev`, ou l’appli Tauri en développement) sur 127.0.0.1:5174 :
// Vite « proxifie » /api vers lui.
const apiBackendUrl = 'http://127.0.0.1:5174'

export default defineConfig({
  plugins: [react()],
  // Tauri affiche ses propres messages : Vite n’efface pas le terminal.
  clearScreen: false,
  server: {
    host: 'localhost',
    // Port fixe : c’est le devUrl de Tauri, et 5174 est réservé au backend Rust.
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: apiBackendUrl } },
  },
})
