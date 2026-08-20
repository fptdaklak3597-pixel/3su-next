import { createHmac, timingSafeEqual } from 'node:crypto'

export const MAX_REQUEST_BYTES = 64 * 1024
export const MAX_TICKET_BYTES = 16 * 1024
export const MAX_CLOCK_SKEW_MS = 5 * 60_000
export const DEFAULT_QUEUE_LIMIT = 20
export const DEFAULT_RATE_LIMIT = 30
export const DEFAULT_RATE_WINDOW_MS = 60_000

function ownObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function boundedString(value, max, label, required = false) {
  const text = String(value ?? '')
  if (required && !text.trim()) throw new Error(`${label} bị thiếu`)
  if (text.length > max) throw new Error(`${label} quá dài`)
  return text
}

function finiteNumber(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label} không hợp lệ`)
  }
  return number
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char])
}

/** Strict runtime validator shared by HTTP and cloud jobs. */
export function normalizePrintTicket(raw) {
  if (!ownObject(raw)) throw new Error('Phiếu in không hợp lệ')
  if (raw.v !== 1) throw new Error('Phiếu in sai phiên bản')
  if (raw.kind !== 'sale' && raw.kind !== 'test') throw new Error('Phiếu in thiếu kind')

  const shopIn = ownObject(raw.shop) ? raw.shop : {}
  const printerIn = ownObject(raw.printer) ? raw.printer : {}
  const ticket = {
    v: 1,
    kind: raw.kind,
    width: Number(raw.width) === 80 ? 80 : 58,
    copies: Math.max(1, Math.min(5, Math.trunc(finiteNumber(raw.copies ?? 1, 'Số bản in', { min: 1, max: 5 })))),
    shop: {
      name: boundedString(shopIn.name, 160, 'Tên cửa hàng'),
      phone: boundedString(shopIn.phone, 40, 'Số điện thoại'),
      address: boundedString(shopIn.address, 240, 'Địa chỉ'),
    },
    printer: {
      templateHeader: boundedString(printerIn.templateHeader, 240, 'Tiêu đề'),
      templateFooter: boundedString(printerIn.templateFooter, 240, 'Lời cuối'),
      fontSize: finiteNumber(printerIn.fontSize ?? 12, 'Cỡ chữ', { min: 8, max: 24 }),
    },
  }

  if (ticket.kind === 'sale') {
    if (!ownObject(raw.sale)) throw new Error('Phiếu bán thiếu dữ liệu')
    const sale = raw.sale
    if (!Array.isArray(sale.items) || sale.items.length < 1 || sale.items.length > 80) {
      throw new Error('Số dòng hàng không hợp lệ')
    }
    ticket.sale = {
      id: boundedString(sale.id, 120, 'Mã hóa đơn', true),
      date: boundedString(sale.date, 80, 'Ngày hóa đơn'),
      items: sale.items.map((item, index) => {
        if (!ownObject(item)) throw new Error(`Dòng hàng ${index + 1} không hợp lệ`)
        return {
          name: boundedString(item.name, 160, `Tên hàng ${index + 1}`, true),
          qty: finiteNumber(item.qty, `Số lượng ${index + 1}`, { min: Number.EPSILON, max: 1_000_000 }),
          price: finiteNumber(item.price, `Đơn giá ${index + 1}`, { min: 0, max: 1_000_000_000_000 }),
        }
      }),
      total: finiteNumber(sale.total, 'Tổng tiền', { min: 0, max: 1_000_000_000_000 }),
      discount: finiteNumber(sale.discount ?? 0, 'Giảm giá', { min: 0, max: 1_000_000_000_000 }),
      payMethod: boundedString(sale.payMethod, 40, 'Phương thức thanh toán'),
      tendered: finiteNumber(sale.tendered ?? 0, 'Khách đưa', { min: 0, max: 1_000_000_000_000 }),
      debtAmount: finiteNumber(sale.debtAmount ?? 0, 'Công nợ', { min: 0, max: 1_000_000_000_000 }),
      customerName: boundedString(sale.customerName, 160, 'Tên khách'),
      cashier: boundedString(sale.cashier, 160, 'Thu ngân'),
    }
  }

  const bytes = Buffer.byteLength(JSON.stringify(ticket), 'utf8')
  if (bytes > MAX_TICKET_BYTES) throw new Error('Phiếu in quá lớn')
  return ticket
}

function money(value) {
  return Math.round(Number(value) || 0).toLocaleString('vi-VN')
}

export function ticketHtml(rawTicket, now = new Date()) {
  const ticket = normalizePrintTicket(rawTicket)
  const width = ticket.width
  const style = `@page{size:${width}mm auto;margin:0}body{box-sizing:border-box;margin:0;width:${width}mm;font:${ticket.printer.fontSize}px sans-serif;padding:4mm;overflow-wrap:anywhere}.center{text-align:center}.row{display:flex;justify-content:space-between;gap:8px}.total{font-weight:700;border-top:1px dashed #000;margin-top:6px;padding-top:6px}`
  const header = ticket.printer.templateHeader ? `<div class="center">${escapeHtml(ticket.printer.templateHeader)}</div>` : ''
  const footer = ticket.printer.templateFooter ? `<div class="center">${escapeHtml(ticket.printer.templateFooter)}</div>` : ''
  if (ticket.kind === 'test') {
    return `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body><div class="center"><b>3SU — KIỂM TRA MÁY IN</b><br>${escapeHtml(ticket.shop.name || '3SU')}<br>${escapeHtml(now.toLocaleString('vi-VN'))}</div></body></html>`
  }
  const sale = ticket.sale
  const rows = sale.items.map((item) => `<div><div>${escapeHtml(item.name)}</div><div class="row"><span>${escapeHtml(item.qty)}</span><span>${money(item.price * item.qty)}</span></div></div>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body><div class="center"><b>${escapeHtml(ticket.shop.name || '3SU')}</b></div>${header}<div>HĐ ${escapeHtml(sale.id)}</div>${rows}<div class="row total"><span>Tổng</span><span>${money(sale.total)}</span></div>${footer}</body></html>`
}

export function signPrintBody(secret, timestamp, nonce, body) {
  if (typeof secret !== 'string' || secret.length < 16) throw new Error('Print secret tối thiểu 16 ký tự')
  return createHmac('sha256', secret)
    .update(`${timestamp}.${nonce}.${body}`, 'utf8')
    .digest('hex')
}

function equalHex(left, right) {
  if (!/^[0-9a-f]{64}$/i.test(String(left)) || !/^[0-9a-f]{64}$/i.test(String(right))) return false
  const a = Buffer.from(String(left).toLowerCase(), 'hex')
  const b = Buffer.from(String(right).toLowerCase(), 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function verifyPrintSignature({ secret, timestamp, nonce, signature, body, now = Date.now() }) {
  const parsedTimestamp = Number(timestamp)
  if (!Number.isSafeInteger(parsedTimestamp) || Math.abs(now - parsedTimestamp) > MAX_CLOCK_SKEW_MS) {
    return { ok: false, status: 401, error: 'timestamp' }
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(String(nonce ?? ''))) {
    return { ok: false, status: 401, error: 'nonce' }
  }
  let expected
  try { expected = signPrintBody(secret, String(timestamp), String(nonce), String(body)) } catch {
    return { ok: false, status: 401, error: 'secret' }
  }
  return equalHex(expected, signature)
    ? { ok: true, status: 200 }
    : { ok: false, status: 401, error: 'signature' }
}

export function createReplayGuard(maxEntries = 5_000) {
  const seen = new Map()
  return {
    consume(nonce, expiresAt, now = Date.now()) {
      for (const [key, expiry] of seen) if (expiry <= now) seen.delete(key)
      if (seen.has(nonce)) return false
      if (seen.size >= maxEntries) {
        const oldest = seen.keys().next().value
        if (oldest) seen.delete(oldest)
      }
      seen.set(nonce, expiresAt)
      return true
    },
    size() { return seen.size },
  }
}

export function createRateLimiter({ limit = DEFAULT_RATE_LIMIT, windowMs = DEFAULT_RATE_WINDOW_MS } = {}) {
  const buckets = new Map()
  return {
    allow(key, now = Date.now()) {
      const current = buckets.get(key)
      if (!current || now - current.startedAt >= windowMs) {
        buckets.set(key, { startedAt: now, count: 1 })
        return true
      }
      current.count += 1
      return current.count <= limit
    },
  }
}

export class PrintQueueFullError extends Error {
  constructor() {
    super('Hàng đợi in đã đầy')
    this.name = 'PrintQueueFullError'
  }
}

export function createSerialQueue(worker, { maxPending = DEFAULT_QUEUE_LIMIT } = {}) {
  const pending = []
  let active = false

  async function drain() {
    if (active) return
    active = true
    try {
      while (pending.length > 0) {
        const job = pending.shift()
        try { job.resolve(await worker(job.value)) } catch (error) { job.reject(error) }
      }
    } finally {
      active = false
    }
  }

  return {
    enqueue(value) {
      if (pending.length >= maxPending) return Promise.reject(new PrintQueueFullError())
      return new Promise((resolve, reject) => {
        pending.push({ value, resolve, reject })
        void drain()
      })
    },
    pending() { return pending.length + (active ? 1 : 0) },
  }
}

function loopbackHost(host) {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost'
}

export function resolveAgentConfig(env = process.env) {
  const port = Number(env.PORT || 9101)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT không hợp lệ')
  const lan = String(env.PRINT_AGENT_LAN || '') === '1'
  const host = String(env.PRINT_AGENT_HOST || (lan ? '0.0.0.0' : '127.0.0.1')).trim()
  const secret = String(env.PRINT_AGENT_SECRET || '')
  const remote = !loopbackHost(host)
  if (remote && secret.length < 16) {
    throw new Error('PRINT_AGENT_SECRET tối thiểu 16 ký tự khi mở agent ra LAN')
  }
  const queueLimit = Number(env.PRINT_QUEUE_LIMIT || DEFAULT_QUEUE_LIMIT)
  if (!Number.isSafeInteger(queueLimit) || queueLimit < 1 || queueLimit > 500) throw new Error('PRINT_QUEUE_LIMIT không hợp lệ')
  return { port, host, secret, requireAuth: remote || secret.length > 0, queueLimit }
}
