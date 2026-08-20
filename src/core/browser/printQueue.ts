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
import {
  getLanPrintSecret,
  lanAgentNeedsSecret,
  normalizeLanAgentUrl,
  signedLanPrintHeaders,
} from './printAgentAuth'

export type PrintVia = 'lan' | 'cloud' | 'local' | 'none'

export interface PrintDispatchResult {
  via: PrintVia
  error?: string
}

const LAN_TIMEOUT_MS = 4_000
const PRINT_WS_RECONNECT_MAX_MS = 30_000

function lanUrl(base: string, path: string): string {
  return `${normalizeLanAgentUrl(base).replace(/\/+$/, '')}${path}`
}

export async function tryLanPrint(agentUrl: string, ticket: PrintTicket): Promise<boolean> {
  const normalizedUrl = normalizeLanAgentUrl(agentUrl)
  if (!normalizedUrl) return false
  const normalizedTicket = parsePrintTicket(ticket)
  const body = JSON.stringify({ ticket: normalizedTicket })
  const secret = await getLanPrintSecret()
  if (lanAgentNeedsSecret(normalizedUrl) && !secret) return false

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (secret) Object.assign(headers, await signedLanPrintHeaders(secret, body))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LAN_TIMEOUT_MS)
  try {
    const response = await fetch(lanUrl(normalizedUrl, '/print'), {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
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
 * Token chỉ nằm trong subprotocol, không fallback sang query string.
 */
export function connectPrintAgentSocket(onJob: () => void): () => void {
  let stopped = false
  let ws: WebSocket | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  let attempts = 0
  let generation = 0

  function schedule(expectedGeneration: number) {
    if (stopped || expectedGeneration !== generation || retry) return
    const base = Math.min(PRINT_WS_RECONNECT_MAX_MS, 1_000 * (2 ** Math.min(attempts, 5)))
    const delay = base + Math.floor(Math.random() * Math.min(1_000, base * 0.2))
    attempts += 1
    retry = setTimeout(() => {
      retry = null
      void open(expectedGeneration)
    }, delay)
  }

  async function open(expectedGeneration: number) {
    if (stopped || expectedGeneration !== generation) return
    try {
      const base = apiBase()
      const shopId = await getCloudShopId()
      if (!base || !shopId || stopped || expectedGeneration !== generation) return
      const token = await getCloudIdToken()
      if (stopped || expectedGeneration !== generation) return
      const wsBase = base.replace(/\/+$/, '').replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
      const next = new WebSocket(
        `${wsBase}/v1/shops/${encodeURIComponent(shopId)}/ws?role=print`,
        ['firebase-auth', token],
      )
      ws?.close()
      ws = next
      next.onopen = () => {
        if (next !== ws || expectedGeneration !== generation) return
        attempts = 0
        setPrintAgentOnline(true)
      }
      next.onmessage = (event) => {
        if (next !== ws || expectedGeneration !== generation) return
        try {
          const message = JSON.parse(String(event.data)) as { t?: string }
          if (message.t === 'print') onJob()
        } catch { /* payload không hợp lệ */ }
      }
      next.onerror = () => {
        if (next === ws) next.close()
      }
      next.onclose = () => {
        if (next === ws) ws = null
        if (stopped || expectedGeneration !== generation) return
        setPrintAgentOnline(false)
        schedule(expectedGeneration)
      }
    } catch {
      schedule(expectedGeneration)
    }
  }

  generation += 1
  void open(generation)
  return () => {
    stopped = true
    generation += 1
    if (retry) clearTimeout(retry)
    retry = null
    const current = ws
    ws = null
    current?.close()
    setPrintAgentOnline(false)
  }
}
