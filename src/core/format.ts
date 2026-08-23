/**
 * 3SU Next — Định dạng số liệu tiếng Việt
 */

/** Định dạng tiền tệ đầy đủ: 1234567 → "1.234.567đ" */
export function fmt(n: number): string {
  return Math.round(n).toLocaleString('vi-VN') + 'đ'
}

/** Định dạng tiền ngắn gọn: 1234567 → "1,2tr", 45000 → "45k" */
export function fmtShort(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return sign + trimZero((abs / 1_000_000_000).toFixed(1)) + 'tỷ'
  if (abs >= 1_000_000) return sign + trimZero((abs / 1_000_000).toFixed(1)) + 'tr'
  if (abs >= 1_000) return sign + trimZero((abs / 1_000).toFixed(0)) + 'k'
  return sign + String(Math.round(abs))
}

function trimZero(s: string): string {
  return s.replace(/\.0$/, '').replace('.', ',')
}

/** Định dạng số thường: 1234 → "1.234" */
export function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('vi-VN')
}

/* ─── Ngày tháng ─── */

/** YYYY-MM-DD (local) */
export function today(): string {
  return localDay(new Date())
}

export function localDay(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}


/** YYYY-MM-DD theo lịch Việt Nam (Asia/Ho_Chi_Minh) — dùng cho báo cáo */
export function vnDay(d: Date | string | number = Date.now()): string {
  const ms = typeof d === 'number' ? d : new Date(d).getTime()
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms))
}
export function vnToday(): string { return vnDay(Date.now()) }
export function vnDaysAgo(n: number): string { return vnDay(Date.now() - n * 86_400_000) }
export function yesterday(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return localDay(d)
}

export function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return localDay(d)
}

/** "Thứ 2, 15/07" hoặc "Hôm nay" */
export function formatDate(dateStr: string): string {
  if (dateStr === today()) return 'Hôm nay'
  if (dateStr === yesterday()) return 'Hôm qua'
  const d = new Date(dateStr + 'T00:00:00')
  const days = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']
  return `${days[d.getDay()]}, ${d.getDate()}/${d.getMonth() + 1}`
}

/** Giờ "14:30" */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

/** Ngày giờ đầy đủ: "15/07/2026 14:30" */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
}

/* ─── HSD (hạn sử dụng) ─── */

/** Số ngày tới HSD. null nếu không có HSD. */
export function daysToExpiry(expiry: string): number | null {
  if (!expiry) return null
  const t = new Date(expiry + 'T00:00:00')
  const now = new Date(today() + 'T00:00:00')
  return Math.round((t.getTime() - now.getTime()) / 86400000)
}

export type ExpiryStatus = 'ok' | 'soon' | 'expired' | 'none'

export function expiryStatus(expiry: string, warnDays: number): ExpiryStatus {
  const n = daysToExpiry(expiry)
  if (n === null) return 'none'
  if (n < 0) return 'expired'
  if (n <= warnDays) return 'soon'
  return 'ok'
}

export function expiryText(expiry: string): string {
  const n = daysToExpiry(expiry)
  if (n === null) return 'Chưa có HSD'
  if (n < 0) return `Hết hạn ${-n} ngày`
  if (n === 0) return 'HSD hôm nay'
  return `HSD còn ${n} ngày`
}

/* ─── Chào hỏi ─── */
export function greeting(): string {
  const h = new Date().getHours()
  if (h < 6) return 'Chào buổi sáng sớm'
  if (h < 12) return 'Chào buổi sáng'
  if (h < 14) return 'Chào buổi trưa'
  if (h < 18) return 'Chào buổi chiều'
  return 'Chào buổi tối'
}

/* ─── Utils ─── */
export function uid(prefix: string): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return `${prefix}_${c.randomUUID()}`
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(16)
    c.getRandomValues(bytes)
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    return `${prefix}_${hex}`
  }
  throw new Error('crypto.randomUUID/getRandomValues không khả dụng')
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Bỏ dấu tiếng Việt để tìm kiếm */
export function normalizeVi(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
}

/** Tìm kiếm sản phẩm: khớp tên, danh mục, barcode (cả không dấu) */
export function matchesSearch(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const h = haystack.toLowerCase()
  if (h.includes(q)) return true
  return normalizeVi(h).includes(normalizeVi(q))
}

/** ISO detection */
export const IS_IOS =
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
