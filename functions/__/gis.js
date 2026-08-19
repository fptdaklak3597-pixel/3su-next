import {
  gisCallbackPage,
  gisErrorPage,
  gisResponseHeaders,
  MAX_GIS_POST_BYTES,
  randomNonce,
  validateGisSubmission,
} from './gis-core.js'

function htmlResponse(body, status, nonce = '') {
  const headers = new Headers(gisResponseHeaders(nonce))
  headers.set('allow', 'POST')
  return new Response(body, { status, headers })
}

/**
 * Google GIS redirect — Google POST credential + g_csrf_token.
 * Bắt buộc double-submit cookie trước khi đưa credential vào sessionStorage.
 */
export async function onRequest(context) {
  const request = context.request
  if (request.method !== 'POST') {
    return htmlResponse(gisErrorPage('Phương thức không được hỗ trợ'), 405)
  }

  const contentType = request.headers.get('content-type') || ''
  if (!contentType.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    return htmlResponse(gisErrorPage('Định dạng yêu cầu không hợp lệ'), 415)
  }

  const contentLength = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_GIS_POST_BYTES) {
    return htmlResponse(gisErrorPage('Yêu cầu đăng nhập quá lớn'), 413)
  }

  let body = ''
  try {
    body = await request.text()
  } catch {
    return htmlResponse(gisErrorPage('Không đọc được yêu cầu đăng nhập'), 400)
  }
  if (new TextEncoder().encode(body).byteLength > MAX_GIS_POST_BYTES) {
    return htmlResponse(gisErrorPage('Yêu cầu đăng nhập quá lớn'), 413)
  }

  const form = new URLSearchParams(body)
  const result = validateGisSubmission({
    credential: form.get('credential'),
    bodyCsrf: form.get('g_csrf_token'),
    cookieHeader: request.headers.get('cookie'),
  })
  if (!result.ok) return htmlResponse(gisErrorPage(result.message), result.status)

  const nonce = randomNonce()
  return htmlResponse(gisCallbackPage(result.credential, nonce), 200, nonce)
}
