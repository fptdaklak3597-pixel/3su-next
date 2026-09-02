/**
 * Tình trạng máy 3SU Invoice trên tab Hóa đơn.
 * Desktop heartbeat mỗi 5 phút; session cloud 15 phút — quá 15 phút = mất kết nối.
 */
import { useEffect, useState } from 'react'
import { apiBase } from './cloud'
import {
  currentShopForDevices,
  listInvoiceDevices,
  type InvoiceDeviceRow,
} from './invoiceDevices'

export const INVOICE_LINK_STALE_MS = 15 * 60 * 1000
export const INVOICE_LINK_POLL_MS = 30_000

export type InvoiceLinkKind = 'ok' | 'no_shop' | 'no_device' | 'stale' | 'gdt_auth' | 'error'

export interface InvoiceLinkHealth {
  kind: InvoiceLinkKind
  text: string
  to?: string
  tone: 'ok' | 'warn' | 'bad'
  deviceName?: string
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  })
}

export function invoiceLinkHealth(opts: {
  shopId: string | null
  apiConfigured: boolean
  devices: InvoiceDeviceRow[]
  error?: string | null
  now?: number
}): InvoiceLinkHealth {
  const now = opts.now ?? Date.now()
  if (opts.error) {
    return { kind: 'error', tone: 'bad', text: `Không kiểm tra được máy 3SU Invoice. ${opts.error}`, to: '/thiet-bi' }
  }
  if (!opts.apiConfigured) {
    return { kind: 'error', tone: 'bad', text: 'Chưa cấu hình cloud — không kiểm tra được máy 3SU Invoice.', to: '/thiet-bi' }
  }
  if (!opts.shopId) {
    return {
      kind: 'no_shop',
      tone: 'bad',
      text: 'Chưa vào cửa hàng cloud. Máy 3SU Invoice không đẩy được hóa đơn.',
      to: '/thiet-bi',
    }
  }

  const active = opts.devices.filter((d) => d.status === 'active')
  if (!active.length) {
    return {
      kind: 'no_device',
      tone: 'bad',
      text: 'Chưa kết nối máy 3SU Invoice. Mở app trên máy tính rồi duyệt mã ở Thiết bị.',
      to: '/thiet-bi',
    }
  }

  const fresh = active.filter((d) => typeof d.lastSeenAt === 'number' && now - d.lastSeenAt <= INVOICE_LINK_STALE_MS)
  if (!fresh.length) {
    const newest = [...active].sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0))[0]
    const when = newest?.lastSeenAt ? ` Lần cuối ${timeLabel(newest.lastSeenAt)}.` : ' Máy đã duyệt nhưng chưa thấy hoạt động.'
    return {
      kind: 'stale',
      tone: 'bad',
      text: `Máy 3SU Invoice mất kết nối.${when}`,
      to: '/thiet-bi',
      deviceName: newest?.deviceName,
    }
  }

  const needTax = fresh.find((d) => d.gdtStatus === 'auth_required')
  if (needTax) {
    return {
      kind: 'gdt_auth',
      tone: 'warn',
      text: 'Máy Invoice đang nối cloud nhưng cần đăng nhập lại trang thuế.',
      to: '/thiet-bi',
      deviceName: needTax.deviceName,
    }
  }

  const name = fresh[0]?.deviceName
  return {
    kind: 'ok',
    tone: 'ok',
    text: name ? `Máy Invoice đang kết nối · ${name}` : 'Máy Invoice đang kết nối',
    deviceName: name,
  }
}

/** Một dòng ngắn trên danh sách web — không chiếm hết hàng tiêu đề. */
export function invoiceLinkShortText(health: InvoiceLinkHealth): string {
  if (health.kind === 'ok') return ''
  if (health.kind === 'stale') return 'Máy Invoice mất kết nối'
  if (health.kind === 'no_device') return 'Chưa kết nối máy Invoice'
  if (health.kind === 'no_shop') return 'Chưa vào cửa hàng cloud'
  if (health.kind === 'gdt_auth') return 'Máy Invoice cần đăng nhập thuế'
  if (health.text.includes('Chưa cấu hình cloud')) return 'Chưa nối cloud'
  return 'Không kiểm tra được máy Invoice'
}

export function useInvoiceLinkHealth(): InvoiceLinkHealth | null {
  const [health, setHealth] = useState<InvoiceLinkHealth | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const configured = !!apiBase()
      try {
        const shopId = await currentShopForDevices()
        if (!configured || !shopId) {
          if (!cancelled) setHealth(invoiceLinkHealth({ shopId, apiConfigured: configured, devices: [] }))
          return
        }
        const devices = await listInvoiceDevices(shopId)
        if (!cancelled) setHealth(invoiceLinkHealth({ shopId, apiConfigured: configured, devices }))
      } catch (e) {
        if (!cancelled) {
          setHealth(invoiceLinkHealth({
            shopId: null,
            apiConfigured: configured,
            devices: [],
            error: e instanceof Error ? e.message : 'Lỗi mạng',
          }))
        }
      }
    }
    void load()
    const timer = setInterval(() => { void load() }, INVOICE_LINK_POLL_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  return health
}
