import { describe, expect, it } from 'vitest'
import {
  PrintQueueFullError,
  createRateLimiter,
  createReplayGuard,
  createSerialQueue,
  normalizePrintTicket,
  resolveAgentConfig,
  signPrintBody,
  ticketHtml,
  verifyPrintSignature,
} from '../scripts/print-agent-core.mjs'

function validTicket() {
  return {
    v: 1,
    kind: 'sale',
    width: 58,
    copies: 1,
    shop: { name: 'Cửa hàng', phone: '', address: '' },
    printer: { templateHeader: 'PHIẾU BÁN HÀNG', templateFooter: 'Cảm ơn', fontSize: 12 },
    sale: {
      id: 's1', date: '2026-08-20T00:00:00.000Z',
      items: [{ name: 'Nước', qty: 2, price: 10_000 }],
      total: 20_000, discount: 0, payMethod: 'cash', tendered: 20_000,
      debtAmount: 0, customerName: '', cashier: '',
    },
  }
}

describe('print ticket validation and rendering', () => {
  it('chuẩn hóa phiếu hợp lệ và từ chối số không hữu hạn', () => {
    expect(normalizePrintTicket(validTicket())).toMatchObject({ v: 1, kind: 'sale', width: 58 })
    expect(() => normalizePrintTicket({
      ...validTicket(),
      sale: { ...validTicket().sale, items: [{ name: 'X', qty: Number.NaN, price: 1 }] },
    })).toThrow(/Số lượng/)
    expect(() => normalizePrintTicket({
      ...validTicket(),
      sale: { ...validTicket().sale, total: Number.POSITIVE_INFINITY },
    })).toThrow(/Tổng tiền/)
  })

  it('giới hạn số dòng và chiều dài trường', () => {
    expect(() => normalizePrintTicket({
      ...validTicket(),
      sale: {
        ...validTicket().sale,
        items: Array.from({ length: 81 }, (_, index) => ({ name: `SP ${index}`, qty: 1, price: 1 })),
      },
    })).toThrow(/Số dòng/)
    expect(() => normalizePrintTicket({
      ...validTicket(),
      shop: { name: 'x'.repeat(161), phone: '', address: '' },
    })).toThrow(/Tên cửa hàng quá dài/)
  })

  it('escape toàn bộ dữ liệu chèn vào HTML', () => {
    const raw = validTicket()
    raw.shop.name = '<script>alert(1)</script>'
    raw.sale.id = '<img src=x onerror=alert(2)>'
    raw.sale.items[0]!.name = 'A&B <b>đậm</b>'
    const html = ticketHtml(raw, new Date('2026-08-20T00:00:00.000Z'))

    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<img src=x onerror=alert(2)>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('A&amp;B &lt;b&gt;đậm&lt;/b&gt;')
  })
})

describe('LAN request authentication', () => {
  it('HMAC gắn với timestamp, nonce và exact body', () => {
    const secret = '0123456789abcdef0123456789abcdef'
    const timestamp = '1787184000000'
    const nonce = 'nonce_abcdefghijklmnop'
    const body = JSON.stringify({ ticket: validTicket() })
    const signature = signPrintBody(secret, timestamp, nonce, body)

    expect(verifyPrintSignature({ secret, timestamp, nonce, signature, body, now: Number(timestamp) })).toMatchObject({ ok: true })
    expect(verifyPrintSignature({ secret, timestamp, nonce, signature, body: body + ' ', now: Number(timestamp) })).toMatchObject({ ok: false, error: 'signature' })
    expect(verifyPrintSignature({ secret, timestamp, nonce, signature, body, now: Number(timestamp) + 10 * 60_000 })).toMatchObject({ ok: false, error: 'timestamp' })
  })

  it('replay guard chỉ cho nonce dùng một lần trong cửa sổ', () => {
    const guard = createReplayGuard()
    expect(guard.consume('nonce-1', 2_000, 1_000)).toBe(true)
    expect(guard.consume('nonce-1', 2_000, 1_001)).toBe(false)
    expect(guard.consume('nonce-1', 4_000, 2_001)).toBe(true)
  })

  it('rate limiter giới hạn theo client và reset theo cửa sổ', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1_000 })
    expect(limiter.allow('ip', 0)).toBe(true)
    expect(limiter.allow('ip', 1)).toBe(true)
    expect(limiter.allow('ip', 2)).toBe(false)
    expect(limiter.allow('other', 2)).toBe(true)
    expect(limiter.allow('ip', 1_001)).toBe(true)
  })
})

describe('bounded serial print queue', () => {
  it('chạy tuần tự và từ chối khi pending queue đầy', async () => {
    const order: string[] = []
    const releases: Array<() => void> = []
    const queue = createSerialQueue<number, number>(async (value) => {
      order.push(`start-${value}`)
      await new Promise<void>((resolve) => releases.push(resolve))
      order.push(`end-${value}`)
      return value
    }, { maxPending: 1 })

    const first = queue.enqueue(1)
    await Promise.resolve()
    const second = queue.enqueue(2)
    const third = queue.enqueue(3)
    await expect(third).rejects.toBeInstanceOf(PrintQueueFullError)

    releases.shift()?.()
    await expect(first).resolves.toBe(1)
    await Promise.resolve()
    releases.shift()?.()
    await expect(second).resolves.toBe(2)
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2'])
  })
})

describe('agent bind policy', () => {
  it('mặc định chỉ bind loopback không cần secret', () => {
    expect(resolveAgentConfig({})).toMatchObject({ host: '127.0.0.1', port: 9101, requireAuth: false })
  })

  it('mở LAN bắt buộc secret mạnh', () => {
    expect(() => resolveAgentConfig({ PRINT_AGENT_LAN: '1' })).toThrow(/PRINT_AGENT_SECRET/)
    expect(() => resolveAgentConfig({ PRINT_AGENT_HOST: '0.0.0.0', PRINT_AGENT_SECRET: 'short' })).toThrow(/16 ký tự/)
    expect(resolveAgentConfig({
      PRINT_AGENT_LAN: '1',
      PRINT_AGENT_SECRET: '0123456789abcdef0123456789abcdef',
      PRINT_QUEUE_LIMIT: '12',
    })).toMatchObject({ host: '0.0.0.0', requireAuth: true, queueLimit: 12 })
  })
})
