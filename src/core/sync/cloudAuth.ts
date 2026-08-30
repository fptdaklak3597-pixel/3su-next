/**
 * Phân loại phiên cloud + copy mail — không import Firebase SDK.
 * Người gửi thật: cấu hình SMTP Firebase = 3su.shop@gmail.com.
 */
export const CLOUD_MAIL_FROM = '3su.shop@gmail.com'

export type CloudAuthUser = {
  email?: string | null
  emailVerified: boolean
  providerData: Array<{ providerId: string }>
} | null

export type CloudGate = 'in' | 'out' | 'verify'

export function isPasswordProvider(u: CloudAuthUser): boolean {
  return !!u?.providerData.some((p) => p.providerId === 'password')
}

/** Email/mật khẩu chưa bấm liên kết xác nhận — Google bỏ qua. */
export function isCloudEmailPending(u: CloudAuthUser): boolean {
  return isPasswordProvider(u) && !u!.emailVerified
}

export function classifyCloudUser(u: CloudAuthUser): CloudGate {
  if (!u) return 'out'
  if (isCloudEmailPending(u)) return 'verify'
  return 'in'
}

export function cloudMailHint(kind: 'verify' | 'reset'): string {
  if (kind === 'verify') {
    return `Mở thư từ ${CLOUD_MAIL_FROM} (cả hộp spam), bấm liên kết, rồi quay lại đây.`
  }
  return `Thư vào cửa hàng gửi từ ${CLOUD_MAIL_FROM}. Kiểm tra cả hộp spam.`
}

const IDENTITY_SEND_OOB = 'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode'

const IDENTITY_AUTH_CODES: Record<string, string> = {
  INVALID_EMAIL: 'auth/invalid-email',
  MISSING_EMAIL: 'auth/missing-email',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'auth/too-many-requests',
  OPERATION_NOT_ALLOWED: 'auth/operation-not-allowed',
  UNAUTHORIZED_DOMAIN: 'auth/unauthorized-domain',
  INVALID_CONTINUE_URI: 'auth/unauthorized-domain',
  UNAUTHORIZED_CONTINUE_URI: 'auth/unauthorized-domain',
  CAPTCHA_CHECK_FAILED: 'auth/internal-error',
  INTERNAL_ERROR: 'auth/internal-error',
}

function identityErrorMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return 'INTERNAL_ERROR'
  const error = (body as { error?: { message?: unknown } }).error
  return typeof error?.message === 'string' && error.message.trim() ? error.message : 'INTERNAL_ERROR'
}

/** Map thông điệp Identity Toolkit → mã Firebase Auth. */
export function identityAuthCode(message: string): string {
  const raw = message.split(':')[0].trim().toUpperCase().replace(/[^A-Z0-9_]/g, '')
  return IDENTITY_AUTH_CODES[raw] || 'auth/internal-error'
}

export function identityToolkitError(body: unknown, network = false): Error & { code: string } {
  if (network) {
    const err = new Error('Không kết nối được. Kiểm tra mạng rồi thử lại.') as Error & { code: string }
    err.code = 'auth/network-request-failed'
    return err
  }
  const message = identityErrorMessage(body)
  const err = new Error(message) as Error & { code: string }
  err.code = identityAuthCode(message)
  return err
}

/** @3su.shop không có MX — thư đăng nhập không tới được. */
export function emailLinkUndeliverableReason(email: string): string | null {
  const host = email.trim().split('@')[1]?.toLowerCase()
  if (host === '3su.shop') {
    return 'Email @3su.shop không nhận được thư đăng nhập. Bấm Tiếp tục với Google, hoặc dùng Gmail.'
  }
  return null
}

/**
 * Gửi liên kết đăng nhập bằng REST — không qua SDK (SDK kéo reCAPTCHA iframe,
 * hay trả auth/internal-error trên Cursor/Electron dù email hợp lệ).
 */
export async function sendEmailSignInLinkRequest(opts: {
  apiKey: string
  email: string
  continueUrl: string
  fetchImpl?: typeof fetch
}): Promise<void> {
  const email = opts.email.trim()
  if (!email) throw identityToolkitError({ error: { message: 'MISSING_EMAIL' } })
  const blocked = emailLinkUndeliverableReason(email)
  if (blocked) {
    const err = new Error(blocked) as Error & { code: string }
    err.code = 'auth/email-undeliverable'
    throw err
  }
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
  let res: Response
  try {
    res = await fetchImpl(`${IDENTITY_SEND_OOB}?key=${encodeURIComponent(opts.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestType: 'EMAIL_SIGNIN',
        email,
        continueUrl: opts.continueUrl,
        canHandleCodeInApp: true,
      }),
    })
  } catch {
    throw identityToolkitError(null, true)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) throw identityToolkitError(body)
}

export function cloudAuthMessage(e: unknown): string {
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : ''
  switch (code) {
    case 'auth/invalid-email':
      return 'Email không hợp lệ.'
    case 'auth/missing-email':
      return 'Nhập lại email để hoàn tất.'
    case 'auth/invalid-action-code':
    case 'auth/expired-action-code':
      return 'Liên kết hết hạn. Gửi lại mail.'
    case 'auth/operation-not-allowed':
      return 'Đăng nhập email tạm không dùng được. Thử Google, hoặc gửi lại sau.'
    case 'auth/too-many-requests':
      return 'Thử lại sau — gửi mail quá nhiều lần.'
    case 'auth/network-request-failed':
      return 'Không kết nối được. Kiểm tra mạng rồi thử lại.'
    case 'auth/popup-closed-by-user':
      return 'Đã đóng cửa sổ đăng nhập Google.'
    case 'auth/popup-blocked':
      return 'Trình duyệt chặn cửa sổ Google. Cho phép popup rồi thử lại.'
    case 'auth/unauthorized-domain':
      return 'Tên miền này chưa được phép đăng nhập. Liên hệ người cài app.'
    case 'auth/email-undeliverable':
      return e instanceof Error ? e.message : 'Email này không nhận được thư đăng nhập. Dùng Google.'
    case 'auth/internal-error':
      return 'Không gửi được mail xác nhận. Nếu email này đã vào bằng Google, bấm Tiếp tục với Google. Không thì tải lại trang rồi gửi lại mail.'
    case 'auth/redirect-cancelled-by-user':
      return 'Đã hủy đăng nhập Google.'
    case 'auth/no-auth-event':
    case 'auth/invalid-credential':
      return 'Đăng nhập Google chưa xong. Bấm lại Tiếp tục với Google.'
    default: {
      const msg = e instanceof Error ? e.message : 'Lỗi tài khoản'
      if (/missing initial state/i.test(msg)) {
        return 'Đăng nhập Google bị trình duyệt chặn. Bấm lại Tiếp tục với Google.'
      }
      if (/origin_mismatch/i.test(msg)) {
        return 'Google chưa cho phép origin này. Thử Chrome, hoặc thêm cổng localhost vào OAuth.'
      }
      if (/gis-timeout/i.test(msg)) {
        return 'Trình duyệt Cursor không giữ được cửa sổ Google. Mở Chrome để vào, hoặc bấm lại.'
      }
      return msg
    }
  }
}
