/**
 * Phiếu in có cấu trúc — điện thoại gửi JSON, máy in PC tự dựng HTML/ESC/POS.
 * Không chuyển HTML từ điện thoại (tránh XSS như relay cũ).
 */
import type { PrinterSettings, Sale, ShopInfo } from '../types'
import type { ReceiptContext } from './print'

export interface PrintTicketV1 {
  v: 1
  kind: 'sale' | 'test'
  width: 58 | 80
  copies: number
  shop: { name: string; phone: string; address: string }
  printer: { templateHeader: string; templateFooter: string; fontSize: number }
  sale?: {
    id: string
    date: string
    items: { name: string; qty: number; price: number }[]
    total: number
    discount: number
    payMethod: string
    tendered: number
    debtAmount: number
    customerName: string
    cashier: string
  }
}

export type PrintTicket = PrintTicketV1

const MAX_TICKET_BYTES = 16 * 1024

export function saleTicketFromContext(ctx: ReceiptContext, copies = 1): PrintTicket {
  const { sale, shop, printer } = ctx
  return {
    v: 1,
    kind: 'sale',
    width: printer.width === 80 ? 80 : 58,
    copies: Math.max(1, Math.min(5, copies || 1)),
    shop: { name: shop.name || '', phone: shop.phone || '', address: shop.address || '' },
    printer: {
      templateHeader: printer.templateHeader || '',
      templateFooter: printer.templateFooter || '',
      fontSize: printer.fontSize || 0,
    },
    sale: {
      id: sale.id,
      date: sale.date,
      items: (sale.items || []).map((it) => ({
        name: String(it.name || ''),
        qty: Number(it.qty) || 0,
        price: Number(it.price) || 0,
      })),
      total: Number(sale.total) || 0,
      discount: Number(sale.discount) || 0,
      payMethod: String(sale.payMethod || 'cash'),
      tendered: Number(sale.tendered) || 0,
      debtAmount: Number(sale.debtAmount) || 0,
      customerName: ctx.customerName || '',
      cashier: ctx.cashier || '',
    },
  }
}

export function testTicket(shopName: string, width: 58 | 80 = 58): PrintTicket {
  return {
    v: 1,
    kind: 'test',
    width: width === 80 ? 80 : 58,
    copies: 1,
    shop: { name: shopName || '', phone: '', address: '' },
    printer: { templateHeader: 'KIỂM TRA MÁY IN', templateFooter: '', fontSize: 12 },
  }
}

export function parsePrintTicket(raw: unknown): PrintTicket {
  if (!raw || typeof raw !== 'object') throw new Error('Phiếu in không hợp lệ')
  const o = raw as Record<string, unknown>
  if (o.v !== 1) throw new Error('Phiếu in sai phiên bản')
  const kind = o.kind === 'test' ? 'test' : o.kind === 'sale' ? 'sale' : ''
  if (!kind) throw new Error('Phiếu in thiếu kind')
  const width = Number(o.width) === 80 ? 80 : 58
  const copies = Math.max(1, Math.min(5, Number(o.copies) || 1))
  const shopIn = o.shop && typeof o.shop === 'object' ? o.shop as Record<string, unknown> : {}
  const prIn = o.printer && typeof o.printer === 'object' ? o.printer as Record<string, unknown> : {}
  const ticket: PrintTicket = {
    v: 1,
    kind,
    width,
    copies,
    shop: {
      name: String(shopIn.name || ''),
      phone: String(shopIn.phone || ''),
      address: String(shopIn.address || ''),
    },
    printer: {
      templateHeader: String(prIn.templateHeader || ''),
      templateFooter: String(prIn.templateFooter || ''),
      fontSize: Number(prIn.fontSize) || 0,
    },
  }
  if (kind === 'sale') {
    const s = o.sale && typeof o.sale === 'object' ? o.sale as Record<string, unknown> : null
    if (!s || !String(s.id || '')) throw new Error('Phiếu bán thiếu id')
    const items = Array.isArray(s.items) ? s.items : []
    if (!items.length) throw new Error('Phiếu bán thiếu món')
    ticket.sale = {
      id: String(s.id),
      date: String(s.date || ''),
      items: items.slice(0, 80).map((it) => {
        const row = it && typeof it === 'object' ? it as Record<string, unknown> : {}
        return {
          name: String(row.name || '').slice(0, 120),
          qty: Number(row.qty) || 0,
          price: Number(row.price) || 0,
        }
      }),
      total: Number(s.total) || 0,
      discount: Number(s.discount) || 0,
      payMethod: String(s.payMethod || 'cash'),
      tendered: Number(s.tendered) || 0,
      debtAmount: Number(s.debtAmount) || 0,
      customerName: String(s.customerName || ''),
      cashier: String(s.cashier || ''),
    }
  }
  const bytes = new TextEncoder().encode(JSON.stringify(ticket)).length
  if (bytes > MAX_TICKET_BYTES) throw new Error('Phiếu in quá lớn')
  return ticket
}

export function receiptContextFromTicket(ticket: PrintTicket): ReceiptContext | null {
  if (ticket.kind !== 'sale' || !ticket.sale) return null
  const s = ticket.sale
  const sale: Sale = {
    id: s.id,
    items: s.items.map((it) => ({
      productId: '',
      name: it.name,
      qty: it.qty,
      price: it.price,
      cost: 0,
      unit: '',
      unitRatio: 1,
    })),
    total: s.total,
    profit: 0,
    discount: s.discount,
    payMethod: s.payMethod === 'transfer' ? 'transfer' : s.payMethod === 'debt' ? 'debt' : 'cash',
    tendered: s.tendered,
    change: Math.max(0, s.tendered - s.total),
    debtAmount: s.debtAmount,
    customerId: null,
    date: s.date || new Date().toISOString(),
  }
  const shop: ShopInfo = ticket.shop
  const printer: PrinterSettings = {
    width: ticket.width,
    fontSize: ticket.printer.fontSize,
    autoPrintAfterSale: false,
    cloudRelay: false,
    lanAgentUrl: '',
    templateHeader: ticket.printer.templateHeader,
    templateFooter: ticket.printer.templateFooter,
    showLogo: false,
  }
  return { sale, shop, printer, customerName: s.customerName || null, cashier: s.cashier }
}

/** Bỏ dấu tiếng Việt — ESC/POS nhiều máy không có Unicode. */
export function foldVi(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
}

function escPosLine(text: string, width = 32): Uint8Array {
  const t = foldVi(text).slice(0, width)
  return new TextEncoder().encode(t + '\n')
}

/** ESC/POS tối thiểu: init, căn giữa header, cắt giấy. */
export function ticketToEscPos(ticket: PrintTicket): Uint8Array {
  const parts: Uint8Array[] = []
  const push = (a: ArrayLike<number> | string) => {
    parts.push(typeof a === 'string' ? new TextEncoder().encode(a) : new Uint8Array(a))
  }
  push([0x1b, 0x40]) // init
  push([0x1b, 0x61, 0x01]) // center
  if (ticket.shop.name) parts.push(escPosLine(ticket.shop.name))
  if (ticket.kind === 'test') {
    parts.push(escPosLine('3SU - KIEM TRA MAY IN'))
    parts.push(escPosLine(new Date().toLocaleString('vi-VN')))
  } else if (ticket.sale) {
    parts.push(escPosLine(ticket.printer.templateHeader || 'PHIEU BAN HANG'))
    push([0x1b, 0x61, 0x00])
    parts.push(escPosLine('HD: ' + ticket.sale.id))
    for (const it of ticket.sale.items) {
      parts.push(escPosLine(`${it.name} x${it.qty}`))
      parts.push(escPosLine('  ' + Math.round(it.price * it.qty)))
    }
    parts.push(escPosLine('TONG: ' + Math.round(ticket.sale.total)))
    if (ticket.printer.templateFooter) parts.push(escPosLine(ticket.printer.templateFooter))
  }
  push('\n\n')
  push([0x1d, 0x56, 0x00]) // cut
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
