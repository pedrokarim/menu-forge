// `npm run dev` : lance le backend Rust `studio-api` (127.0.0.1:5174) et Vite
// (localhost:5173), qui « proxifie » /api vers lui (voir vite.config.ts).
// Pour Vite seul (c’est ce que fait `tauri dev`, dont l’appli lance l’API
// elle-même), utiliser `npm run dev:vite`.
//
// Sans dépendance : Ctrl+C ou la fin de l’un des deux arrête l’autre.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const studioDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const children = []

function stopAll() {
  for (const child of children) {
    if (child.exitCode === null) child.kill()
  }
}

function run(label, command, args) {
  const child = spawn(command, args, { cwd: studioDir, stdio: 'inherit' })
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

run('api', 'cargo', ['run', '--release', '--manifest-path', 'backend/Cargo.toml', '--bin', 'studio-api'])
run('vite', process.execPath, [path.join(studioDir, 'node_modules/vite/bin/vite.js')])

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopAll()
    process.exit(0)
  })
}
