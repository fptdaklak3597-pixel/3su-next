/**
 * VietQR động — ảnh QR chuyển khoản theo số tiền (thu nợ / thanh toán).
 * Dùng API ảnh công khai img.vietqr.io, không cần key.
 */
import type { Settings } from '../types'

export interface VietQrInput {
  bankId: string
  accountNo: string
  accountName?: string
  amount: number
  addInfo?: string
}

export function vietQrImageUrl(input: VietQrInput): string {
  const bank = encodeURIComponent(input.bankId.trim())
  const acc = encodeURIComponent(input.accountNo.replace(/\s+/g, ''))
  const amount = Math.max(0, Math.round(input.amount))
  const info = encodeURIComponent(input.addInfo || '3SU thu no')
  const name = encodeURIComponent(input.accountName || '')
  return `https://img.vietqr.io/image/${bank}-${acc}-compact2.png?amount=${amount}&addInfo=${info}&accountName=${name}`
}

export function vietQrFromSettings(settings: Settings, amount: number, addInfo?: string): string | null {
  if (!settings.bankBin?.trim() || !settings.bankAccount?.trim()) return null
  return vietQrImageUrl({
    bankId: settings.bankBin,
    accountNo: settings.bankAccount,
    accountName: settings.bankAccountName,
    amount,
    addInfo,
  })
}

/** VietQR động nếu có STK; không thì ảnh QR tĩnh trong cài đặt. */
export function payQrSrc(settings: Settings, amount: number, addInfo?: string): string | null {
  return vietQrFromSettings(settings, amount, addInfo) || settings.transferQr || null
}
