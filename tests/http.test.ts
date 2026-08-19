import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createHttpTransport,
  fetchWithTimeout,
  gzipJson,
  HttpTimeoutError,
  ungzipJson,
} from '@/core/sync/http'
import type { SyncOp } from '@/core/types'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('http transport', () => {
  it('gzipJson / ungzipJson khôi phục object (kể cả khi không có CompressionStream)', async () => {
    const src = { a: 1, b: 'x' }
    const b64 = await gzipJson(src)
    expect(typeof b64).toBe('string')
    expect(await ungzipJson<typeof src>(b64)).toEqual(src)
  })

  it('mã hóa snapshot lớn theo chunk, không vượt giới hạn đối số JS', async () => {
    const src = { text: 'abc-'.repeat(100_000) }
    const b64 = await gzipJson(src)
    expect(await ungzipJson<typeof src>(b64)).toEqual(src)
  })

  it('pushOps / pullOps gọi đúng URL + Bearer', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/ops') && init?.method === 'POST') {
        return new Response(JSON.stringify({ acked: ['op1'], seq: 7 }), { status: 200 })
      }
      if (url.includes('/ops?since=')) {
        return new Response(JSON.stringify({ ops: [], seq: 7 }), { status: 200 })
      }
      return new Response('no', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const t = createHttpTransport({
      baseUrl: 'http://127.0.0.1:8787',
      shopId: 'shop_1',
      getToken: async () => 'tok',
    })
    const op = { id: 'op1' } as SyncOp
    const pushed = await t.pushOps([op])
    expect(pushed).toEqual({ acked: ['op1'], seq: 7 })
    const pulled = await t.pullOps(3, 50)
    expect(pulled.seq).toBe(7)

    const post = fetchMock.mock.calls[0]
    expect(String(post[0])).toBe('http://127.0.0.1:8787/v1/shops/shop_1/ops')
    expect((post[1]?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    expect(String(fetchMock.mock.calls[1][0])).toContain('since=3&limit=50')
  })

  it('pullSnapshot giải nén gzipBase64', async () => {
    const snap = { shopId: 's', seq: 1 }
    const gzipBase64 = await gzipJson(snap)
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ gzipBase64, upToSeq: 4 }), { status: 200 }),
    ))
    const t = createHttpTransport({
      baseUrl: 'http://x',
      shopId: 's',
      getToken: async () => 't',
    })
    const got = await t.pullSnapshot()
    expect(got?.upToSeq).toBe(4)
    expect(got?.snapshot).toEqual(snap)
  })

  it('hủy request treo khi quá timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      }),
    ))

    const request = fetchWithTimeout('https://example.invalid', {}, 25)
    const assertion = expect(request).rejects.toBeInstanceOf(HttpTimeoutError)
    await vi.advanceTimersByTimeAsync(30)
    await assertion
  })

  it('từ chối payload pull sai schema', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ops: 'not-an-array', seq: 1 }), { status: 200 }),
    ))
    const t = createHttpTransport({
      baseUrl: 'http://x', shopId: 's', getToken: async () => 't',
    })
    await expect(t.pullOps(0)).rejects.toThrow(/pull không hợp lệ/)
  })
})
