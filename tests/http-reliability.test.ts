import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHttpTransport, gzipJson, ungzipJson } from '@/core/sync/http'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  readonly url: string
  readonly protocols: string | string[] | undefined
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  closed = false

  constructor(url: string | URL, protocols?: string | string[]) {
    this.url = String(url)
    this.protocols = protocols
    FakeWebSocket.instances.push(this)
  }

  close(): void {
    this.closed = true
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  FakeWebSocket.instances = []
})

describe('HTTP deadlines and validation', () => {
  it('hủy request treo khi quá timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      }),
    ))

    const transport = createHttpTransport({
      baseUrl: 'https://api.example.test',
      shopId: 'shop',
      getToken: async () => 'token',
      timeoutMs: 25,
    })

    const pending = transport.pullOps(0)
    const assertion = expect(pending).rejects.toThrow(/quá thời gian/)
    await vi.advanceTimersByTimeAsync(30)
    await assertion
  })

  it('từ chối response push sai schema', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ acked: 'not-an-array', seq: 1 }), { status: 200 }),
    ))

    const transport = createHttpTransport({
      baseUrl: 'https://api.example.test',
      shopId: 'shop',
      getToken: async () => 'token',
    })

    await expect(transport.pushOps([])).rejects.toThrow(/push không hợp lệ/)
  })
})

describe('snapshot encoding limits', () => {
  it('mã hóa base64 theo chunk cho payload lớn', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    vi.stubGlobal('DecompressionStream', undefined)
    const source = { text: 'x'.repeat(250_000), nested: { value: 42 } }

    const encoded = await gzipJson(source)

    expect(encoded.length).toBeGreaterThan(250_000)
    await expect(ungzipJson<typeof source>(encoded)).resolves.toEqual(source)
  })
})

describe('WebSocket lifecycle', () => {
  it('không đưa bearer token vào query string', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const transport = createHttpTransport({
      baseUrl: 'https://api.example.test',
      shopId: 'shop 1',
      getToken: async () => 'header.payload.signature',
    })

    transport.connect(() => {})
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))

    const socket = FakeWebSocket.instances[0]!
    expect(socket.url).toBe('wss://api.example.test/v1/shops/shop%201/ws')
    expect(socket.url).not.toContain('token=')
    expect(socket.protocols).toEqual(['firebase-auth', 'header.payload.signature'])
    transport.disconnect()
    expect(socket.closed).toBe(true)
  })

  it('không mở socket muộn sau khi đã disconnect', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    let resolveToken!: (token: string) => void
    const token = new Promise<string>((resolve) => { resolveToken = resolve })
    const transport = createHttpTransport({
      baseUrl: 'https://api.example.test',
      shopId: 'shop',
      getToken: () => token,
    })

    transport.connect(() => {})
    transport.disconnect()
    resolveToken('late-token')
    await Promise.resolve()
    await Promise.resolve()

    expect(FakeWebSocket.instances).toHaveLength(0)
  })
})
