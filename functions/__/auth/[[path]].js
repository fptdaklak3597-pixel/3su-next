/** Proxy /__/auth/* → Firebase Hosting — cùng origin với app (tránh mất sessionStorage). */
const AUTH_ORIGIN = 'https://su-next.firebaseapp.com'

export async function onRequest(context) {
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
