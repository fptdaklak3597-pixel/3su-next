/**
 * Gửi phiếu in: LAN trước (cùng Wi‑Fi), rồi Worker (điện thoại 4G).
 */
import { apiBase, getCloudShopId } from '../sync/cloud'
import { apiGet, apiPost } from '../sync/http'
import { getCloudIdToken } from '../sync/firebase'
import type { ReceiptContext } from './print'
import { printReceiptLocal } from './print'
import { parsePrintTicket, saleTicketFromContext, testTicket, type PrintTicket } from './printTicket'
import { isPrintAgentOnline, setPrintAgentOnline } from './printPresence'

export type PrintVia = 'lan' | 'cloud' | 'local' | 'none'

export interface PrintDispatchResult {
  via: PrintVia
  error?: string
}

const LAN_TIMEOUT_MS = 1800

function lanUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

export async function tryLanPrint(agentUrl: string, ticket: PrintTicket): Promise<boolean> {
  const url = lanUrl(agentUrl, '/print')
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), LAN_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticket }),
      signal: ac.signal,
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

export async function refreshPrintAgentStatus(): Promise<boolean> {
  const base = apiBase()
  const shopId = await getCloudShopId()
  if (!base || !shopId) {
    setPrintAgentOnline(false)
    return false
  }
  try {
    const s = await apiGet<{ online?: boolean }>(
      base,
      `/v1/shops/${encodeURIComponent(shopId)}/print-status`,
      getCloudIdToken,
    )
    const on = !!s.online
    setPrintAgentOnline(on)
    return on
  } catch {
    return isPrintAgentOnline()
  }
}

export async function enqueueCloudPrintJob(ticket: PrintTicket): Promise<{ id: string }> {
  const base = apiBase()
  const shopId = await getCloudShopId()
  if (!base || !shopId) throw new Error('Chưa đăng nhập cửa hàng')
  parsePrintTicket(ticket)
  return apiPost<{ id: string }>(
    base,
    `/v1/shops/${encodeURIComponent(shopId)}/print-jobs`,
    getCloudIdToken,
    { ticket },
  )
}

export async function listCloudPrintJobs(): Promise<{ jobs: Array<{ id: string; status: string; ticket: PrintTicket; createdAt: number }> }> {
  const base = apiBase()
  const shopId = await getCloudShopId()
  if (!base || !shopId) throw new Error('Chưa nối cloud')
  return apiGet(base, `/v1/shops/${encodeURIComponent(shopId)}/print-jobs`, getCloudIdToken)
}

export async function claimCloudPrintJob(id: string, agentId: string): Promise<{ ticket: PrintTicket } | null> {
  const base = apiBase()
  const shopId = await getCloudShopId()
  if (!base || !shopId) throw new Error('Chưa nối cloud')
  return apiPost(
    base,
    `/v1/shops/${encodeURIComponent(shopId)}/print-jobs/${encodeURIComponent(id)}/claim`,
    getCloudIdToken,
    { agentId },
  )
}

export async function ackCloudPrintJob(id: string, status: 'done' | 'error', error = ''): Promise<void> {
  const base = apiBase()
  const shopId = await getCloudShopId()
  if (!base || !shopId) throw new Error('Chưa nối cloud')
  await apiPost(
    base,
    `/v1/shops/${encodeURIComponent(shopId)}/print-jobs/${encodeURIComponent(id)}/ack`,
    getCloudIdToken,
    { status, error },
  )
}

/**
 * auto: LAN → cloud (nếu bật) → in máy này nếu tự-in hoặc remote lỗi.
 * this-device: chỉ iframe local.
 */
export async function dispatchPrint(
  ctx: ReceiptContext,
  mode: 'auto' | 'this-device' = 'auto',
): Promise<PrintDispatchResult> {
  if (mode === 'this-device') {
    return printReceiptLocal(ctx) ? { via: 'local' } : { via: 'none', error: 'Không in được trên thiết bị này' }
  }
  const printer = ctx.printer
  const ticket = saleTicketFromContext(ctx)

  if (printer.lanAgentUrl) {
    if (await tryLanPrint(printer.lanAgentUrl, ticket)) return { via: 'lan' }
  }

  const agentOn = isPrintAgentOnline() || await refreshPrintAgentStatus()
  if (agentOn || printer.cloudRelay) {
    try {
      await enqueueCloudPrintJob(ticket)
      return { via: 'cloud' }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gửi in lỗi'
      if (printer.autoPrintAfterSale && printReceiptLocal(ctx)) return { via: 'local', error: msg }
      return { via: 'none', error: msg }
    }
  }
  if (printer.autoPrintAfterSale) {
    return printReceiptLocal(ctx) ? { via: 'local' } : { via: 'none', error: 'Không in được trên máy này' }
  }
  return { via: 'none' }
}

export async function dispatchTestPrint(shopName: string, printer: ReceiptContext['printer']): Promise<PrintDispatchResult> {
  const ticket = testTicket(shopName, printer.width)
  if (printer.lanAgentUrl && await tryLanPrint(printer.lanAgentUrl, ticket)) return { via: 'lan' }
  const agentOn = isPrintAgentOnline() || await refreshPrintAgentStatus()
  if (agentOn || printer.cloudRelay) {
    try {
      await enqueueCloudPrintJob(ticket)
      return { via: 'cloud' }
    } catch (e) {
      return { via: 'none', error: e instanceof Error ? e.message : 'Gửi in lỗi' }
    }
  }
  return { via: 'none', error: 'Mở trang Máy in trên máy tính rồi bấm lại' }
}

export function printResultToast(r: PrintDispatchResult): { text: string; kind: 'ok' | 'bad' } {
  if (r.via === 'lan' || r.via === 'cloud') return { text: 'Đang in ở máy tính…', kind: 'ok' }
  if (r.via === 'local') return { text: r.error ? `In máy này (${r.error})` : 'Đang in trên máy này…', kind: 'ok' }
  return { text: r.error || 'Chưa gửi được lệnh in', kind: 'bad' }
}

/** Lỗi fetch mạng → câu tiếng Việt, không để nguyên "Failed to fetch". */
export function cloudPrintErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : ''
  if (!msg || /failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return 'Không gọi được máy chủ. Kiểm tra mạng / địa chỉ API rồi bấm Thử lại.'
  }
  return msg
}

/**
 * WS role=print — điện thoại/Cài đặt đọc /print-status từ socket này.
 * Không mở socket này thì chỗ khác vẫn thấy "chưa mở trang Máy in".
 */
export function connectPrintAgentSocket(onJob: () => void): () => void {
  let stopped = false
  let ws: WebSocket | null = null
  let retry: ReturnType<typeof setTimeout> | null = null

  async function open() {
    if (stopped) return
    const base = apiBase()
    const shopId = await getCloudShopId()
    if (!base || !shopId) return
    const token = await getCloudIdToken()
    const wsBase = base.replace(/\/+$/, '').replace(/^http/, 'ws')
    const wsUrl = `${wsBase}/v1/shops/${encodeURIComponent(shopId)}/ws?role=print`
    try {
      ws = new WebSocket(wsUrl, ['firebase-auth', token])
    } catch {
      ws = new WebSocket(`${wsUrl}&token=${encodeURIComponent(token)}`)
    }
    ws.onopen = () => setPrintAgentOnline(true)
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(String(ev.data)) as { t?: string }
        if (m.t === 'print') onJob()
      } catch { /* */ }
    }
    ws.onclose = () => {
      if (stopped) return
      setPrintAgentOnline(false)
      retry = setTimeout(() => { void open() }, 3000)
    }
  }

  void open()
  return () => {
    stopped = true
    if (retry) clearTimeout(retry)
    ws?.close()
  }
}
