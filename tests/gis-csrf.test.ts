import { describe, expect, it } from 'vitest'
import { onRequest } from '../functions/__/gis.js'
import {
  cookieValue,
  gisCallbackPage,
  gisResponseHeaders,
  isGisCredential,
  MAX_GIS_POST_BYTES,
  safeEqual,
  validateGisSubmission,
} from '../functions/__/gis-core.js'

const CREDENTIAL = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMiLCJhdWQiOiIzU1UifQ.signature_123'

function gisRequest(over: {
  credential?: string
  bodyCsrf?: string
  cookieCsrf?: string
  method?: string
  contentType?: string
} = {}): Request {
  const form = new URLSearchParams({
    credential: over.credential ?? CREDENTIAL,
    g_csrf_token: over.bodyCsrf ?? 'csrf-token-123',
  })
  const headers = new Headers({
    'content-type': over.contentType ?? 'application/x-www-form-urlencoded;charset=UTF-8',
    cookie: `other=x; g_csrf_token=${encodeURIComponent(over.cookieCsrf ?? 'csrf-token-123')}; tail=y`,
  })
  return new Request('https://app.example/__/gis', {
    method: over.method ?? 'POST',
    headers,
    body: (over.method ?? 'POST') === 'POST' ? form.toString() : undefined,
  })
}

describe('GIS CSRF primitives', () => {
  it('đọc cookie theo tên và giữ dấu = trong giá trị', () => {
    expect(cookieValue('a=1; g_csrf_token=abc%3Ddef; z=9', 'g_csrf_token')).toBe('abc=def')
  })

  it('so sánh token không thoát sớm theo độ dài', () => {
    expect(safeEqual('same', 'same')).toBe(true)
    expect(safeEqual('same', 'diff')).toBe(false)
    expect(safeEqual('short', 'longer')).toBe(false)
  })

  it('chỉ chấp nhận JWT compact base64url trong giới hạn', () => {
    expect(isGisCredential(CREDENTIAL)).toBe(true)
    expect(isGisCredential('not-a-jwt')).toBe(false)
    expect(isGisCredential('a.b.</script><script>alert(1)</script>')).toBe(false)
  })

  it('bắt buộc cookie và form g_csrf_token khớp', () => {
    expect(validateGisSubmission({
      credential: CREDENTIAL,
      bodyCsrf: 'token',
      cookieHeader: 'g_csrf_token=token',
    })).toMatchObject({ ok: true, status: 200 })

    expect(validateGisSubmission({
      credential: CREDENTIAL,
      bodyCsrf: 'attacker',
      cookieHeader: 'g_csrf_token=victim',
    })).toMatchObject({ ok: false, status: 403 })

    expect(validateGisSubmission({
      credential: CREDENTIAL,
      bodyCsrf: 'token',
      cookieHeader: '',
    })).toMatchObject({ ok: false, status: 403 })
  })

  it('callback page chỉ chạy script có nonce và lưu đúng một credential đã kiểm tra', () => {
    const nonce = 'abcdefghijklmnop_123456'
    const html = gisCallbackPage(CREDENTIAL, nonce)
    const headers = gisResponseHeaders(nonce)
    expect(html).toContain(`nonce="${nonce}"`)
    expect(html).toContain('sessionStorage.setItem("3su:gisId"')
    expect(html).toContain('</script>')
    expect(html).toContain(CREDENTIAL)
    expect(headers['content-security-policy']).toContain(`script-src 'nonce-${nonce}'`)
    expect(headers['cache-control']).toContain('no-store')
  })
})

describe('Cloudflare GIS callback', () => {
  it('nhận redirect POST hợp lệ và trả trang no-store có CSP nonce', async () => {
    const response = await onRequest({ request: gisRequest() })
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('content-security-policy')).toMatch(/script-src 'nonce-[A-Za-z0-9_-]+'/)
    expect(html).toContain('sessionStorage.setItem')
    expect(html).toContain(CREDENTIAL)
  })

  it('từ chối token CSRF sai và không phát trang lưu credential', async () => {
    const response = await onRequest({ request: gisRequest({ cookieCsrf: 'victim', bodyCsrf: 'attacker' }) })
    const html = await response.text()

    expect(response.status).toBe(403)
    expect(html).not.toContain('sessionStorage.setItem')
    expect(html).not.toContain(CREDENTIAL)
  })

  it('từ chối method và content-type không hợp lệ', async () => {
    expect((await onRequest({ request: gisRequest({ method: 'GET' }) })).status).toBe(405)
    expect((await onRequest({ request: gisRequest({ contentType: 'application/json' }) })).status).toBe(415)
  })

  it('từ chối body thực tế vượt giới hạn trước khi parse', async () => {
    const response = await onRequest({
      request: gisRequest({ bodyCsrf: 'x'.repeat(MAX_GIS_POST_BYTES + 1) }),
    })
    expect(response.status).toBe(413)
  })

  it('từ chối credential sai cấu trúc dù CSRF hợp lệ', async () => {
    const response = await onRequest({ request: gisRequest({ credential: '<script>alert(1)</script>' }) })
    const html = await response.text()
    expect(response.status).toBe(400)
    expect(html).not.toContain('<script>alert(1)</script>')
  })
})
