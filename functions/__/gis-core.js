export const GIS_CSRF_COOKIE = 'g_csrf_token'
export const GIS_STORAGE_KEY = '3su:gisId'
export const MAX_GIS_POST_BYTES = 32 * 1024
export const MAX_GIS_CREDENTIAL_LENGTH = 16 * 1024
export const MAX_GIS_CSRF_LENGTH = 512

function decodeCookieValue(value) {
  try { return decodeURIComponent(value) } catch { return value }
}

export function cookieValue(cookieHeader, name) {
  const target = String(name || '').trim()
  if (!target) return ''
  for (const part of String(cookieHeader || '').split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const key = part.slice(0, index).trim()
    if (key !== target) continue
    return decodeCookieValue(part.slice(index + 1).trim())
  }
  return ''
}

/** So sánh không thoát sớm, kể cả khi độ dài khác nhau. */
export function safeEqual(a, b) {
  const left = String(a || '')
  const right = String(b || '')
  const length = Math.max(left.length, right.length)
  let diff = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return diff === 0
}

/** Chỉ nhận JWT compact base64url, không cho ký tự HTML/script lọt vào callback page. */
export function isGisCredential(value) {
  const credential = String(value || '')
  return credential.length > 0
    && credential.length <= MAX_GIS_CREDENTIAL_LENGTH
    && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(credential)
}

export function validateGisSubmission({ credential, bodyCsrf, cookieHeader }) {
  const formToken = String(bodyCsrf || '')
  const cookieToken = cookieValue(cookieHeader, GIS_CSRF_COOKIE)
  if (!formToken || !cookieToken
    || formToken.length > MAX_GIS_CSRF_LENGTH
    || cookieToken.length > MAX_GIS_CSRF_LENGTH
    || !safeEqual(formToken, cookieToken)) {
    return { ok: false, status: 403, message: 'Yêu cầu đăng nhập Google không hợp lệ' }
  }
  const cleanCredential = String(credential || '')
  if (!isGisCredential(cleanCredential)) {
    return { ok: false, status: 400, message: 'Phản hồi Google không hợp lệ' }
  }
  return { ok: true, status: 200, credential: cleanCredential }
}

export function randomNonce() {
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(18)
    cryptoApi.getRandomValues(bytes)
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID().replace(/-/g, '')
  throw new Error('Secure random unavailable')
}

export function gisCallbackPage(credential, nonce) {
  if (!isGisCredential(credential)) throw new Error('Invalid GIS credential')
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(String(nonce || ''))) throw new Error('Invalid CSP nonce')
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>3SU</title></head><body><p>Đang hoàn tất đăng nhập…</p><script nonce="${nonce}">try{sessionStorage.setItem(${JSON.stringify(GIS_STORAGE_KEY)},${JSON.stringify(credential)})}catch(e){}location.replace('/')</script></body></html>`
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function gisErrorPage(message) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>3SU</title></head><body><h1>Không thể đăng nhập</h1><p>${escapeHtml(message)}</p><p><a href="/">Quay lại ứng dụng</a></p></body></html>`
}

export function gisResponseHeaders(nonce = '') {
  const scriptPolicy = nonce ? `script-src 'nonce-${nonce}'` : "script-src 'none'"
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
    pragma: 'no-cache',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'content-security-policy': `default-src 'none'; ${scriptPolicy}; style-src 'none'; img-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
  }
}
