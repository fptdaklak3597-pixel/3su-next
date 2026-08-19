import { apiGet, apiPost } from '@/core/sync/http'
import { apiBase } from '@/core/sync/cloud'
import { adminToken } from './session'

export type AdminShop = {
  shopId: string
  name: string
  phone: string
  address: string
  ownerUid: string
  ownerEmail: string
  status: 'trial' | 'active' | 'expired' | 'locked'
  plan: string
  expiresAt: number | null
  lockedReason: string
  createdAt: number
  updatedAt: number
  lastOpAt: number | null
  todaySeconds?: number
  usageTotalSeconds?: number
  usageAvgSeconds?: number
  usage?: Array<{ day: string; seconds: number; lastEmail: string; updatedAt: number }>
  opsToday?: number
  devicesOnline?: number
  devicesToday?: number
  activeFrom?: number | null
  activeTo?: number | null
  lastFrom?: number | null
  lastTo?: number | null
  opsDays?: Array<{ day: string; ops: number }>
  members?: Array<{ uid: string; role: string; addedAt: number }>
}

function base(): string {
  if (import.meta.env.DEV) return ''
  const url = apiBase()
  if (!url) throw new Error('Chưa cấu hình VITE_API_BASE')
  return url
}

export async function loginAdmin(username: string, password: string): Promise<{ token: string; username: string }> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 8000)
  let res: Response
  try {
    res = await fetch(`${base()}/v1/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: ac.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('Không kết nối được máy chủ (8787)')
    if (e instanceof TypeError) throw new Error('Không kết nối được máy chủ. Chạy npm run dev:admin và wrangler trên 8787.')
    throw e
  } finally {
    clearTimeout(t)
  }
  const raw = await res.text()
  let body: { token?: string; username?: string; error?: string } = {}
  try { body = JSON.parse(raw) as { token?: string; username?: string; error?: string } } catch { /* HTML / proxy */ }
  if (!res.ok) {
    if (res.status === 502 || res.status === 503 || /ECONNREFUSED|proxy error/i.test(raw)) {
      throw new Error('Máy chủ 8787 không chạy. Mở terminal 3su-cloud: npx wrangler dev --ip 127.0.0.1 --port 8787')
    }
    throw new Error(body.error || `Đăng nhập lỗi (${res.status})`)
  }
  if (!body.token) throw new Error('Thiếu token')
  return { token: body.token, username: body.username || username }
}

export async function listAdminShops(q = '', status = ''): Promise<AdminShop[]> {
  const params = new URLSearchParams()
  if (q.trim()) params.set('q', q.trim())
  if (status) params.set('status', status)
  const qs = params.toString()
  const res = await apiGet<{ shops: AdminShop[] }>(base(), `/v1/admin/shops${qs ? `?${qs}` : ''}`, adminToken)
  return res.shops
}

export async function getAdminShop(id: string): Promise<AdminShop> {
  return apiGet<AdminShop>(base(), `/v1/admin/shops/${encodeURIComponent(id)}`, adminToken)
}

export async function extendShop(id: string, months: number): Promise<AdminShop> {
  return apiPost<AdminShop>(base(), `/v1/admin/shops/${encodeURIComponent(id)}/extend`, adminToken, { months })
}

export async function lockShop(id: string, reason: string): Promise<AdminShop> {
  return apiPost<AdminShop>(base(), `/v1/admin/shops/${encodeURIComponent(id)}/lock`, adminToken, { reason })
}

export async function unlockShop(id: string): Promise<AdminShop> {
  return apiPost<AdminShop>(base(), `/v1/admin/shops/${encodeURIComponent(id)}/unlock`, adminToken)
}

export const STATUS_LABEL: Record<AdminShop['status'], string> = {
  trial: 'Dùng thử',
  active: 'Đang dùng',
  expired: 'Hết hạn',
  locked: 'Đã khoá',
}

export function fmtWhen(ms: number | null | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('vi-VN')
}

export function fmtClock(ms: number | null | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleTimeString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function fmtDay(ms: number | null | undefined): string {
  if (!ms) return '—'
  const [, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms)).split('-')
  return `${d}/${m}`
}

export function fmtSession(from: number | null | undefined, to: number | null | undefined, today = vnToday()): string {
  if (!from) return '—'
  const end = to || from
  const day = vnToday(from) === today ? 'Hôm nay' : fmtDay(from)
  if (Math.abs(end - from) < 60_000) return `${day} · ${fmtClock(from)}`
  return `${day} · ${fmtClock(from)} – ${fmtClock(end)}`
}

function vnToday(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now))
}

export function daysLeft(expiresAt: number | null): number | null {
  if (expiresAt == null) return null
  return Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000))
}

const DAY = 24 * 60 * 60 * 1000

/** Số ngày shop đã mở, tính từ createdAt đến hiện tại. */
export function daysUsed(createdAt: number | null | undefined): number | null {
  if (!createdAt) return null
  return Math.max(0, Math.floor((Date.now() - createdAt) / DAY))
}

export function fmtUsed(createdAt: number | null | undefined): string {
  const n = daysUsed(createdAt)
  if (n == null) return '—'
  if (n === 0) return `Hôm nay · mở ${fmtWhen(createdAt)}`
  return `${n} ngày · mở ${new Date(createdAt!).toLocaleDateString('vi-VN')}`
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || sec <= 0) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}p`
  if (m > 0) return `${m} phút`
  return '< 1 phút'
}

export function fmtAgo(ms: number | null | undefined): string {
  if (!ms) return '—'
  const d = Date.now() - ms
  if (d < 60_000) return 'vừa xong'
  if (d < 3600_000) return `${Math.floor(d / 60_000)} phút trước`
  if (d < DAY) return `${Math.floor(d / 3600_000)} giờ trước`
  if (d < 7 * DAY) return `${Math.floor(d / DAY)} ngày trước`
  return fmtWhen(ms)
}
