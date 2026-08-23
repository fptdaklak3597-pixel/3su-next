/**
 * HttpTransport — nối 3su-next với 3su-cloud (spec mục 4).
 */
import type { SyncOp } from '../types'
import type { SnapshotFile } from './snapshot'
import type { PullResult, PushResult, ServerMsg, SyncTransport } from './transport'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_WS_RECONNECT_MS = 1_000
const MAX_WS_RECONNECT_MS = 30_000
const MAX_SNAPSHOT_SOURCE_BYTES = 100 * 1024 * 1024
const MAX_SNAPSHOT_WIRE_BYTES = 25 * 1024 * 1024
const BASE64_CHUNK = 0x8000

export interface HttpTransportOpts {
  baseUrl: string
  shopId: string
  getToken: () => Promise<string>
  requestTimeoutMs?: number
  /** Alias tương thích các caller/test cũ. */
  timeoutMs?: number
  wsReconnectBaseMs?: number
}

export interface SnapshotCodecOptions {
  maxJsonBytes?: number
  maxWireBytes?: number
}

export class HttpTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Yêu cầu quá thời gian ${timeoutMs}ms`)
    this.name = 'HttpTimeoutError'
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Timeout không hợp lệ')
  const controller = new AbortController()
  const upstream = init.signal
  let upstreamAbort: (() => void) | null = null
  if (upstream) {
    if (upstream.aborted) controller.abort(upstream.reason)
    else {
      upstreamAbort = () => controller.abort(upstream.reason)
      upstream.addEventListener('abort', upstreamAbort, { once: true })
    }
  }
  const timer = setTimeout(() => controller.abort(new HttpTimeoutError(timeoutMs)), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason instanceof HttpTimeoutError) {
      throw controller.signal.reason
    }
    throw error
  } finally {
    clearTimeout(timer)
    if (upstream && upstreamAbort) upstream.removeEventListener('abort', upstreamAbort)
  }
}

export function createHttpTransport(opts: HttpTransportOpts): SyncTransport {
  let ws: WebSocket | null = null
  let onMsg: ((m: ServerMsg) => void) | null = null
  let active = false
  let generation = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  const timeoutMs = opts.requestTimeoutMs ?? opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const reconnectBase = Math.max(100, opts.wsReconnectBaseMs ?? DEFAULT_WS_RECONNECT_MS)

  async function headers(): Promise<HeadersInit> {
    const token = await opts.getToken()
    return { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  }

  function url(path: string): string {
    return `${opts.baseUrl.replace(/\/+$/, '')}/v1/shops/${encodeURIComponent(opts.shopId)}${path}`
  }

  function clearReconnect(): void {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  function scheduleReconnect(expectedGeneration: number): void {
    if (!active || expectedGeneration !== generation || reconnectTimer) return
    const exponential = Math.min(MAX_WS_RECONNECT_MS, reconnectBase * (2 ** Math.min(reconnectAttempts, 5)))
    const jitter = Math.floor(exponential * 0.2 * Math.random())
    reconnectAttempts += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void openSocket(expectedGeneration)
    }, exponential + jitter)
  }

  async function openSocket(expectedGeneration: number): Promise<void> {
    if (!active || expectedGeneration !== generation) return
    try {
      const token = await opts.getToken()
      if (!active || expectedGeneration !== generation) return
      const base = opts.baseUrl.replace(/\/+$/, '').replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
      if (!/^wss?:\/\//.test(base)) throw new Error('WebSocket URL không hợp lệ')
      const next = new WebSocket(`${base}/v1/shops/${encodeURIComponent(opts.shopId)}/ws`, ['firebase-auth', token])
      ws?.close()
      ws = next
      next.onopen = () => {
        if (next !== ws || expectedGeneration !== generation) return
        reconnectAttempts = 0
      }
      next.onmessage = (ev) => {
        if (next !== ws || expectedGeneration !== generation) return
        try {
          onMsg?.(JSON.parse(String(ev.data)) as ServerMsg)
        } catch { /* payload WS không hợp lệ: bỏ qua */ }
      }
      next.onerror = () => {
        if (next === ws) next.close()
      }
      next.onclose = () => {
        if (next === ws) ws = null
        scheduleReconnect(expectedGeneration)
      }
    } catch {
      scheduleReconnect(expectedGeneration)
    }
  }

  return {
    confirmsAppliedOpsGc: true,
    async pushOps(ops: SyncOp[]): Promise<PushResult> {
      const res = await fetchWithTimeout(url('/ops'), {
        method: 'POST', headers: await headers(), body: JSON.stringify({ ops }),
      }, timeoutMs)
      if (!res.ok) throw new Error(await err(res))
      const body = await res.json() as PushResult
      if (!Array.isArray(body.acked) || !Number.isSafeInteger(body.seq) || body.seq < 0) {
        throw new Error('Phản hồi push không hợp lệ')
      }
      return body
    },
    async pullOps(sinceSeq: number, limit = 500): Promise<PullResult> {
      const res = await fetchWithTimeout(url(`/ops?since=${sinceSeq}&limit=${limit}`), {
        headers: await headers(),
      }, timeoutMs)
      if (!res.ok) throw new Error(await err(res))
      const body = await res.json() as PullResult
      if (!Array.isArray(body.ops) || !Number.isSafeInteger(body.seq) || body.seq < 0) {
        throw new Error('Phản hồi pull không hợp lệ')
      }
      const watermark = body.appliedGcBeforeMs
      const minSeq = body.minSeq
      const extra: Pick<PullResult, 'appliedGcBeforeMs' | 'minSeq'> = {}
      if (Number.isSafeInteger(watermark) && watermark! > 0 && watermark! <= Date.now()) {
        extra.appliedGcBeforeMs = watermark
      }
      if (Number.isSafeInteger(minSeq) && minSeq! >= 0) extra.minSeq = minSeq
      return { ops: body.ops, seq: body.seq, ...extra }
    },
    async pushSnapshot(s: SnapshotFile, upToSeq: number): Promise<void> {
      const gzipBase64 = await gzipJson(s)
      const res = await fetchWithTimeout(url('/snapshot'), {
        method: 'POST',
        headers: await headers(),
        body: JSON.stringify({ gzipBase64, upToSeq }),
      }, timeoutMs)
      if (!res.ok) throw new Error(await err(res))
    },
    async pullSnapshot(): Promise<{ snapshot: SnapshotFile; upToSeq: number } | null> {
      const res = await fetchWithTimeout(url('/snapshot'), { headers: await headers() }, timeoutMs)
      if (!res.ok) throw new Error(await err(res))
      const body = (await res.json()) as { gzipBase64?: string; snapshot?: null; upToSeq: number }
      if (!body.gzipBase64) return null
      if (!Number.isSafeInteger(body.upToSeq) || body.upToSeq < 0) throw new Error('Mốc snapshot không hợp lệ')
      const snapshot = await ungzipJson<SnapshotFile>(body.gzipBase64)
      return { snapshot, upToSeq: body.upToSeq }
    },
    connect(handler: (m: ServerMsg) => void): void {
      onMsg = handler
      active = true
      generation += 1
      reconnectAttempts = 0
      clearReconnect()
      ws?.close()
      ws = null
      void openSocket(generation)
    },
    disconnect(): void {
      active = false
      generation += 1
      clearReconnect()
      const current = ws
      ws = null
      current?.close()
      onMsg = null
    },
  }
}

async function err(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string }
    const msg = j.error || res.statusText
    if (msg === 'SHOP_LOCKED' || msg === 'SHOP_EXPIRED') {
      void import('./license').then((m) => m.applyLicenseError(msg)).catch(() => {})
    }
    return msg
  } catch {
    return res.statusText
  }
}

function finiteLimit(value: number | undefined, fallback: number, label: string): number {
  const limit = value ?? fallback
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error(`${label} không hợp lệ`)
  return limit
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    const chunk = bytes.subarray(i, Math.min(bytes.length, i + BASE64_CHUNK))
    let part = ''
    for (let j = 0; j < chunk.length; j += 1) part += String.fromCharCode(chunk[j]!)
    binary += part
  }
  return btoa(binary)
}

function base64ToBytes(b64: string, maxWireBytes: number): Uint8Array {
  if (typeof b64 !== 'string'
    || b64.length % 4 === 1
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    throw new Error('Snapshot base64 không hợp lệ')
  }
  if (b64.length > Math.ceil(maxWireBytes * 4 / 3) + 4) {
    throw new Error('Snapshot nén vượt giới hạn')
  }
  let binary: string
  try {
    binary = atob(b64)
  } catch {
    throw new Error('Snapshot base64 không hợp lệ')
  }
  if (binary.length > maxWireBytes) throw new Error('Snapshot nén vượt giới hạn')
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

/** Tạo ArrayBuffer sở hữu riêng để Blob không nhận SharedArrayBuffer qua generic ArrayBufferLike. */
function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return copy.buffer
}

export async function gzipJson(data: unknown, options: SnapshotCodecOptions = {}): Promise<string> {
  const maxJsonBytes = finiteLimit(options.maxJsonBytes, MAX_SNAPSHOT_SOURCE_BYTES, 'Giới hạn JSON')
  const maxWireBytes = finiteLimit(options.maxWireBytes, MAX_SNAPSHOT_WIRE_BYTES, 'Giới hạn snapshot nén')
  const json = JSON.stringify(data)
  if (json === undefined) throw new Error('Snapshot không thể tuần tự hóa')
  const bytes = new TextEncoder().encode(json)
  if (bytes.length > maxJsonBytes) throw new Error('Snapshot vượt giới hạn dữ liệu')
  if (typeof CompressionStream === 'undefined') {
    if (bytes.length > maxWireBytes) throw new Error('Snapshot nén vượt giới hạn')
    return bytesToBase64(bytes)
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer())
  if (compressed.length > maxWireBytes) throw new Error('Snapshot nén vượt giới hạn')
  return bytesToBase64(compressed)
}

export async function ungzipJson<T>(b64: string, options: SnapshotCodecOptions = {}): Promise<T> {
  const maxJsonBytes = finiteLimit(options.maxJsonBytes, MAX_SNAPSHOT_SOURCE_BYTES, 'Giới hạn JSON')
  const maxWireBytes = finiteLimit(options.maxWireBytes, MAX_SNAPSHOT_WIRE_BYTES, 'Giới hạn snapshot nén')
  const raw = base64ToBytes(b64, maxWireBytes)
  if (typeof DecompressionStream === 'undefined') {
    if (raw.byteLength > maxJsonBytes) throw new Error('Snapshot giải nén vượt giới hạn')
    return JSON.parse(new TextDecoder().decode(raw)) as T
  }
  try {
    const stream = new Blob([ownedBuffer(raw)]).stream().pipeThrough(new DecompressionStream('gzip'))
    const buf = await new Response(stream).arrayBuffer()
    if (buf.byteLength > maxJsonBytes) throw new Error('Snapshot giải nén vượt giới hạn')
    return JSON.parse(new TextDecoder().decode(buf)) as T
  } catch (error) {
    // Snapshot legacy chưa gzip vẫn được đọc, nhưng không được nuốt lỗi giới hạn.
    if (error instanceof Error && error.message.includes('vượt giới hạn')) throw error
    if (raw.byteLength > maxJsonBytes) throw new Error('Snapshot giải nén vượt giới hạn')
    return JSON.parse(new TextDecoder().decode(raw)) as T
  }
}

export async function apiGet<T>(
  baseUrl: string,
  path: string,
  getToken: () => Promise<string>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const token = await getToken()
  const res = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, '')}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  }, timeoutMs)
  if (!res.ok) throw new Error(await err(res))
  return res.json() as Promise<T>
}

export async function apiPost<T>(
  baseUrl: string,
  path: string,
  getToken: () => Promise<string>,
  body?: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const token = await getToken()
  const res = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, timeoutMs)
  if (!res.ok) throw new Error(await err(res))
  return res.json() as Promise<T>
}
