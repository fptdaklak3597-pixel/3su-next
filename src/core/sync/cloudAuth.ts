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
    case 'auth/internal-error':
      return 'Lỗi xác thực Firebase. Thử Google, hoặc tải lại trang rồi gửi lại email.'
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
