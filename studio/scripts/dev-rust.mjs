// `npm run dev` : lance le backend Rust `studio-api` (127.0.0.1:5174) et Vite
// (localhost:5173), qui « proxifie » /api vers lui (voir vite.config.ts).
// Pour Vite seul (c’est ce que fait `tauri dev`, dont l’appli lance l’API
// elle-même), utiliser `npm run dev:vite`.
//
// Sans dépendance : Ctrl+C ou la fin de l’un des deux arrête l’autre. Sous
// Windows, l’arbre entier de chaque enfant est arrêté (`taskkill /T /F`) :
// `cargo run` lance `studio-api`, qu’un simple `kill` laisserait orphelin
// (port 5174 occupé au lancement suivant). Le script attend la fin de tous
// les enfants avant de quitter ; son code de sortie est non nul si un enfant
// a échoué ou a été tué par un signal.
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const studioDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWindows = process.platform === 'win32'
/** Au-delà, on quitte même si un enfant ne s’est pas arrêté. */
const STOP_TIMEOUT_MS = 10_000

/** Enfants encore en vie. */
const running = new Set()
let stopping = false
let exitCode = 0

function killTree(child) {
  if (child.pid === undefined) return
  if (isWindows) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

function exitWhenDone() {
  if (running.size === 0) process.exit(exitCode)
}

/** Arrête tous les enfants ; `code` : code de sortie retenu (le premier l’emporte). */
function stopAll(code) {
  if (stopping) {
    exitWhenDone()
    return
  }
  stopping = true
  exitCode = code
  for (const child of running) killTree(child)
  setTimeout(() => {
    console.error('[dev] des processus ne se sont pas arrêtés à temps')
    process.exit(exitCode || 1)
  }, STOP_TIMEOUT_MS).unref()
  exitWhenDone()
}

function run(label, command, args) {
  const child = spawn(command, args, { cwd: studioDir, stdio: 'inherit' })
  running.add(child)
  child.on('error', (error) => {
    console.error(`[${label}] impossible de lancer ${command} : ${error.message}`)
    running.delete(child)
    stopAll(1)
  })
  child.on('exit', (code, signal) => {
    running.delete(child)
    if (!stopping) {
      // Tué par un signal : jamais un succès.
      const failed = signal !== null ? 1 : (code ?? 1)
      if (signal !== null) console.error(`[${label}] arrêté par le signal ${signal}`)
      stopAll(failed)
      return
    }
    exitWhenDone()
  })
}

run('api', 'cargo', ['run', '--release', '--manifest-path', 'backend/Cargo.toml', '--bin', 'studio-api'])
run('vite', process.execPath, [path.join(studioDir, 'node_modules/vite/bin/vite.js')])

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stopAll(0))
}
