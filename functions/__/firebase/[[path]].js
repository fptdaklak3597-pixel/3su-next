/**
 * /__/firebase/init.json — phục vụ tại edge (Firebase Hosting su-next chưa deploy).
 * Path khác vẫn proxy về firebaseapp.com.
 */
import { FIREBASE_BUILD_ENV } from '../../_firebaseEnv.js'
import { firebasePublicFromEnv, isFirebaseInitReady } from '../../firebase-init-core.js'

const AUTH_ORIGIN = 'https://su-next.firebaseapp.com'

function mergeEnv(contextEnv) {
  const fromContext = contextEnv || {}
  const merged = { ...FIREBASE_BUILD_ENV }
  for (const [k, v] of Object.entries(fromContext)) {
    if (typeof v === 'string' && v.trim()) merged[k] = v.trim()
  }
  return merged
}

function initJsonResponse(hostname, env) {
  const cfg = firebasePublicFromEnv(env, hostname)
  if (!isFirebaseInitReady(cfg)) return null
  const body = JSON.stringify(cfg)
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}

async function proxyToFirebase(context) {
  const incoming = new URL(context.request.url)
  const dest = new URL(incoming.pathname + incoming.search, AUTH_ORIGIN)
  const headers = new Headers(context.request.headers)
  headers.set('host', 'su-next.firebaseapp.com')
  const method = context.request.method
  const init = { method, headers, redirect: 'manual' }
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = context.request.body
  }
  const res = await fetch(dest.toString(), init)
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  })
}

export async function onRequest(context) {
  const incoming = new URL(context.request.url)
  if (incoming.pathname.endsWith('/init.json')) {
    const served = initJsonResponse(incoming.hostname, mergeEnv(context.env))
    if (served) return served
  }
  return proxyToFirebase(context)
}
