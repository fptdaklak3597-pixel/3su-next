/**
 * Ghi config Firebase public vào functions/_firebaseEnv.js lúc build.
 * Cloudflare Pages Functions không có VITE_* runtime — file này embed từ build env.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'functions', '_firebaseEnv.js')

function loadDotEnv() {
  for (const name of ['.env', '.env.local', '.env.production']) {
    const path = join(root, name)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const i = trimmed.indexOf('=')
      if (i < 1) continue
      const key = trimmed.slice(0, i).trim()
      let val = trimmed.slice(i + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (val) process.env[key] = val
    }
  }
}

loadDotEnv()

const keys = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

const env = Object.fromEntries(keys.map((k) => [k, process.env[k]?.trim() || '']))

mkdirSync(dirname(out), { recursive: true })
writeFileSync(
  out,
  `/** Auto-generated — npm run build */\nexport const FIREBASE_BUILD_ENV = ${JSON.stringify(env, null, 2)}\n`,
  'utf8',
)

const missing = keys.filter((k) => !env[k] && k !== 'VITE_FIREBASE_STORAGE_BUCKET' && k !== 'VITE_FIREBASE_MESSAGING_SENDER_ID')
if (missing.length) {
  console.warn(`gen-firebase-fn-config: thiếu ${missing.join(', ')} — init.json proxy fallback`)
}
