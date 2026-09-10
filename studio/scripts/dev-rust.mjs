// Mode navigateur avec le backend Rust : lance `studio-api` (127.0.0.1:5174)
// et Vite (localhost:5173), qui « proxifie » /api vers lui
// (MENU_FORGE_BACKEND=rust, voir vite.config.ts).
//
//   node scripts/dev-rust.mjs              API + Vite
//   node scripts/dev-rust.mjs --vite-only  Vite seul (tauri dev lance l’API lui-même)
//
// Sans dépendance : Ctrl+C ou la fin de l’un des deux arrête l’autre.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const studioDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteOnly = process.argv.includes('--vite-only')
const env = { ...process.env, MENU_FORGE_BACKEND: 'rust' }
const children = []

function stopAll() {
  for (const child of children) {
    if (child.exitCode === null) child.kill()
  }
}

function run(label, command, args) {
  const child = spawn(command, args, { cwd: studioDir, env, stdio: 'inherit' })
  child.on('error', (error) => {
    console.error(`[${label}] impossible de lancer ${command} : ${error.message}`)
    stopAll()
    process.exit(1)
  })
  child.on('exit', (code) => {
    stopAll()
    process.exit(code ?? 0)
  })
  children.push(child)
}

if (!viteOnly) {
  run('api', 'cargo', ['run', '--release', '--manifest-path', 'backend/Cargo.toml', '--bin', 'studio-api'])
}
run('vite', process.execPath, [path.join(studioDir, 'node_modules/vite/bin/vite.js')])

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopAll()
    process.exit(0)
  })
}
