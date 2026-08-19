/** Proxy /__/firebase/* → Firebase Hosting (init.json cho auth helper). */
const AUTH_ORIGIN = 'https://su-next.firebaseapp.com'

export async function onRequest(context) {
  const incoming = new URL(context.request.url)
  const dest = new URL(incoming.pathname + incoming.search, AUTH_ORIGIN)
  const headers = new Headers(context.request.headers)
  headers.set('host', 'su-next.firebaseapp.com')
  const res = await fetch(dest.toString(), {
    method: context.request.method,
    headers,
    redirect: 'manual',
  })
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  })
}
