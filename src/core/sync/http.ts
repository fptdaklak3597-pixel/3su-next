/**
 * HttpTransport — nối 3su-next với 3su-cloud (spec mục 4).
 */
import type { SyncOp } from '../types'
import type { SnapshotFile } from './snapshot'
import type { PullResult, PushResult, ServerMsg, SyncTransport } from './transport'

export interface HttpTransportOpts {
  baseUrl: string
  shopId: string
  getToken: () => Promise<string>
}

export function createHttpTransport(opts: HttpTransportOpts): SyncTransport {
  let ws: WebSocket | null = null
  let onMsg: ((m: ServerMsg) => void) | null = null

  async function headers(): Promise<HeadersInit> {
    const token = await opts.getToken()
    return { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  }

  function url(path: string): string {
    return `${opts.baseUrl.replace(/\/+$/, '')}/v1/shops/${encodeURIComponent(opts.shopId)}${path}`
  }

  return {
    async pushOps(ops: SyncOp[]): Promise<PushResult> {
      const res = await fetch(url('/ops'), { method: 'POST', headers: await headers(), body: JSON.stringify({ ops }) })
      if (!res.ok) throw new Error(await err(res))
      return res.json() as Promise<PushResult>
    },
    async pullOps(sinceSeq: number, limit = 500): Promise<PullResult> {
      const res = await fetch(url(`/ops?since=${sinceSeq}&limit=${limit}`), { headers: await headers() })
      if (!res.ok) throw new Error(await err(res))
      return res.json() as Promise<PullResult>
    },
    async pushSnapshot(s: SnapshotFile, upToSeq: number): Promise<void> {
      const gzipBase64 = await gzipJson(s)
      const res = await fetch(url('/snapshot'), {
        method: 'POST',
        headers: await headers(),
        body: JSON.stringify({ gzipBase64, upToSeq }),
      })
      if (!res.ok) throw new Error(await err(res))
    },
    async pullSnapshot(): Promise<{ snapshot: SnapshotFile; upToSeq: number } | null> {
      const res = await fetch(url('/snapshot'), { headers: await headers() })
      if (!res.ok) throw new Error(await err(res))
      const body = (await res.json()) as { gzipBase64?: string; snapshot?: null; upToSeq: number }
      if (!body.gzipBase64) return null
      const snapshot = await ungzipJson<SnapshotFile>(body.gzipBase64)
      return { snapshot, upToSeq: body.upToSeq }
    },
    connect(handler: (m: ServerMsg) => void): void {
      onMsg = handler
      void opts.getToken().then((token) => {
        const base = opts.baseUrl.replace(/\/+$/, '').replace(/^http/, 'ws')
        const wsUrl = `${base}/v1/shops/${encodeURIComponent(opts.shopId)}/ws`
        ws?.close()
        try {
          ws = new WebSocket(wsUrl, ['firebase-auth', token])
        } catch {
          ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`)
        }
        ws.onmessage = (ev) => {
          try {
            onMsg?.(JSON.parse(String(ev.data)) as ServerMsg)
          } catch { /* */ }
        }
      })
    },
    disconnect(): void {
      ws?.close()
      ws = null
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

export async function gzipJson(data: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(data))
  if (typeof CompressionStream === 'undefined') return btoa(String.fromCharCode(...bytes))
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  const buf = await new Response(stream).arrayBuffer()
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

export async function ungzipJson<T>(b64: string): Promise<T> {
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  if (typeof DecompressionStream === 'undefined') {
    return JSON.parse(new TextDecoder().decode(raw)) as T
  }
  try {
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))
    const text = await new Response(stream).text()
    return JSON.parse(text) as T
  } catch {
    return JSON.parse(new TextDecoder().decode(raw)) as T
  }
}

export async function apiGet<T>(baseUrl: string, path: string, getToken: () => Promise<string>): Promise<T> {
  const token = await getToken()
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await err(res))
  return res.json() as Promise<T>
}

export async function apiPost<T>(baseUrl: string, path: string, getToken: () => Promise<string>, body?: unknown): Promise<T> {
  const token = await getToken()
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await err(res))
  return res.json() as Promise<T>
}
