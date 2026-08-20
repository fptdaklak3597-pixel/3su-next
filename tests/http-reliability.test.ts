import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apiGet,
  createHttpTransport,
  gzipJson,
  ungzipJson,
} from '@/core/sync/http'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('HTTP deadlines', () => {
  it('abort request treo khi hết timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason ?? new DOMException('aborted', 'AbortError'))
        }, { once: true })
      }),
    ))

    const pending = apiGet('https://api.example.test', '/health', async () => 'token', 25)
    const assertion = expect(pending).rejects.toThrow(/quá thời gian 25ms/)
    await vi.advanceTimersByTimeAsync(30)
    await assertion
  })
})

describe('snapshot codec limits', () => {
  it('roundtrip payload lớn mà không spread toàn bộ byte array', async () => {
    const source = {
      rows: Array.from({ length: 4_000 }, (_, index) => ({
        id: `row-${index}`,
        name: `Sản phẩm ${index} ${'x'.repeat(40)}`,
        qty: index,
      })),
    }
    const encoded = await gzipJson(source)
    await expect(ungzipJson<typeof source>(encoded)).resolves.toEqual(source)
  })

  it('từ chối decompressed JSON vượt giới hạn', async () => {
    const encoded = await gzipJson({ text: 'x'.repeat(4_000) }, { maxJsonBytes: 10_000 })
    await expect(ungzipJson(encoded, { maxJsonBytes: 100 })).rejects.toThrow(/vượt giới hạn/)
  })

  it('từ chối base64 hỏng', async () => {
    await expect(ungzipJson('%%%')).rejects.toThrow(/base64 không hợp lệ/)
  })
})

describe('WebSocket token lifecycle', () => {
  it('không đặt Firebase token trong query URL', async () => {
    const instances: Array<{ url: string; protocols?: string | string[] }> = []
    class FakeWebSocket {
      onopen: ((event: Event) => void) | null = null
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      onclose: ((event: CloseEvent) => void) | null = null
      constructor(public url: string, public protocols?: string | string[]) {
        instances.push({ url, protocols })
      }
      close() { /* no-op */ }
    }
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)

    const t = createHttpTransport({
      baseUrl: 'https://api.example.test',
      shopId: 'shop 1',
      getToken: async () => 'header.payload.signature',
    })
    t.connect(() => {})
    await Promise.resolve()
    await Promise.resolve()

    expect(instances).toHaveLength(1)
    expect(instances[0]?.url).toBe('wss://api.example.test/v1/shops/shop%201/ws')
    expect(instances[0]?.url).not.toContain('token=')
    expect(instances[0]?.protocols).toEqual(['firebase-auth', 'header.payload.signature'])
    t.disconnect()
  })

  it('disconnect trước khi token resolve không mở socket muộn', async () => {
    let created = 0
    class FakeWebSocket {
      onopen: ((event: Event) => void) | null = null
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      onclose: ((event: CloseEvent) => void) | null = null
      constructor() { created += 1 }
      close() { /* no-op */ }
    }
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)

    const token = deferred<string>()
    const transport = createHttpTransport({
      baseUrl: 'https://api.example.test',
      shopId: 'shop',
      getToken: () => token.promise,
    })
    transport.connect(() => {})
    transport.disconnect()
    token.resolve('late-token')
    await Promise.resolve()
    await Promise.resolve()

    expect(created).toBe(0)
  })
})
