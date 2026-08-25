/** Cùng logic với src/core/sync/firebaseConfig.ts — dùng cho Pages Function init.json */

const FALLBACK_AUTH_DOMAIN = 'su-next.firebaseapp.com'

const SAME_ORIGIN_AUTH_HOSTS = new Set([
  'su-next-web.pages.dev',
  'su-next-app.pages.dev',
  '3su.shop',
  'www.3su.shop',
  'app.3su.shop',
  'admin.3su.shop',
])

export function resolveAuthDomain(envDomain, host) {
  if (SAME_ORIGIN_AUTH_HOSTS.has(host)) return host
  return envDomain || FALLBACK_AUTH_DOMAIN
}

/** @param {Record<string, string | undefined>} env */
export function firebasePublicFromEnv(env, hostname) {
  const clean = (v) => (typeof v === 'string' ? v.trim() : '')
  const envDomain = clean(env.VITE_FIREBASE_AUTH_DOMAIN)
  return {
    apiKey: clean(env.VITE_FIREBASE_API_KEY),
    authDomain: resolveAuthDomain(envDomain, hostname),
    projectId: clean(env.VITE_FIREBASE_PROJECT_ID),
    storageBucket: clean(env.VITE_FIREBASE_STORAGE_BUCKET) || undefined,
    messagingSenderId: clean(env.VITE_FIREBASE_MESSAGING_SENDER_ID) || undefined,
    appId: clean(env.VITE_FIREBASE_APP_ID),
  }
}

export function isFirebaseInitReady(cfg) {
  return !!(cfg.apiKey && cfg.projectId && cfg.appId)
}
