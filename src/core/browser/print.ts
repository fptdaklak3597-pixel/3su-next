/**
 * 3SU Next — In hoá đơn nhiệt (Receipt printing)
 * Port từ 50-auth-cloud-ai.js (_buildReceiptHTML/_doPrintReceipt) +
 * 56-cloud-print-relay.js (sanitize) + 57-print-agent.js (safe print).
 *
 * Local-first: iframe + window.print(). Cloud/LAN gửi phiếu JSON
 * (không HTML) — agent trên PC tự dựng hoá đơn rồi in.
 */
import type { Sale, ShopInfo, PrinterSettings } from '../types'
import { escapeHtml } from '../format'
import { receiptContextFromTicket } from './printTicket'

export interface ReceiptContext {
  sale: Sale
  shop: ShopInfo
  printer: PrinterSettings
  /** Tên khách hàng (đã resolve từ customerId) hoặc null = Khách lẻ */
  customerName?: string | null
  /** Tên thu ngân (user hiện tại) */
  cashier?: string
}

export interface BuiltReceipt {
  /** Phần thân hoá đơn (bên trong .rc-paper) */
  body: string
  /** Khối <style> đi kèm */
  css: string
  /** Khổ giấy (mm) */
  width: number
}

/** Preset khổ giấy nhiệt. */
function receiptPreset(width: number) {
  const w = Number(width || 58)
  return w >= 70
    ? { width: 80, fontSize: 9, lineHeight: 1.12, padX: 4, padY: 1.2, cutSpace: 0.4, itemCols: 'minmax(0,1fr) 7mm 13mm 15mm' }
    : { width: 58, fontSize: 8, lineHeight: 1.1, padX: 3, padY: 1, cutSpace: 0.3, itemCols: 'minmax(0,1fr) 5mm 9mm 11mm' }
}

const money = (n: number) => Math.round(Number(n) || 0).toLocaleString('vi-VN')

function qtyText(q: number): string {
  const n = Number(q)
  if (Number.isInteger(n) && n >= 0) return String(n)
  return String(q == null ? '' : q)
}

/**
 * Dựng HTML hoá đơn nhiệt từ một đơn bán.
 * Trả về body + css tách rời để tái sử dụng cho preview / cloud / print.
 */
export function buildReceiptHTML(ctx: ReceiptContext): BuiltReceipt {
  const { sale, shop, printer } = ctx
  const preset = receiptPreset(printer.width)
  const is80 = preset.width === 80
  const fontSize = printer.fontSize && printer.fontSize >= 7 && printer.fontSize <= 14
    ? printer.fontSize
    : preset.fontSize

  const items = sale.items || []
  const totalQty = items.reduce((a, it) => a + (Number(it.qty) || 0), 0)
  const fontStack = "-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif"
  const dt = sale.date ? new Date(sale.date) : new Date()
  const dateShort = dt.toLocaleDateString('vi-VN')
  const timeShort = dt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  const rowLR = (l: string, v: string) =>
    `<div class="rc-row"><span class="rc-l">${escapeHtml(l)}</span><span class="rc-r">${escapeHtml(v || '')}</span></div>`

  const parts: string[] = []
  parts.push('<div class="rc-inner">')

  if (printer.showLogo !== false && shop.name) parts.push(`<div class="rc-shop">${escapeHtml(shop.name)}</div>`)
  if (shop.address) parts.push(`<div class="rc-biz">${escapeHtml(shop.address)}</div>`)
  if (shop.phone) parts.push(`<div class="rc-biz">ĐT: ${escapeHtml(shop.phone)}</div>`)
  parts.push(`<div class="rc-title">${escapeHtml(printer.templateHeader || 'PHIẾU BÁN HÀNG')}</div>`)

  parts.push(rowLR('Số HĐ:', String(sale.id || '')))
  parts.push(`<div class="rc-row rc-split"><span class="rc-l">Ngày in: ${escapeHtml(dateShort)}</span><span class="rc-r">Giờ in: ${escapeHtml(timeShort)}</span></div>`)
  if (ctx.cashier) parts.push(rowLR('Thu ngân:', ctx.cashier))
  parts.push(rowLR('Khách hàng:', ctx.customerName || 'Khách lẻ'))

  parts.push('<div class="rc-rule"></div>')
  parts.push('<div class="rc-tbl-hd"><span class="c-name">Tên hàng</span><span class="c-qty">SL</span><span class="c-price">Đơn giá</span><span class="c-amt">T.Tiền</span></div>')
  parts.push('<div class="rc-rule thin"></div>')

  items.forEach((it, i) => {
    const nm = escapeHtml(String(it.name || '').trim())
    const qtyCell = escapeHtml(qtyText(it.qty))
    parts.push(
      `<div class="rc-tbl-row"><span class="c-name">${i + 1}) ${nm}</span>` +
      `<span class="c-qty">${qtyCell}</span>` +
      `<span class="c-price">${money(it.price)}</span>` +
      `<span class="c-amt">${money((Number(it.qty) || 0) * (Number(it.price) || 0))}</span></div>`,
    )
  })

  parts.push('<div class="rc-rule thin"></div>')
  const subtotal = sale.total + (sale.discount || 0)
  parts.push(`<div class="rc-tbl-row rc-tbl-sum"><span class="c-name">T.Cộng</span><span class="c-qty">${totalQty}</span><span class="c-price"></span><span class="c-amt">${money(subtotal)}</span></div>`)
  if ((sale.discount || 0) > 0) {
    parts.push(`<div class="rc-row rc-disc"><span class="rc-l">Giảm giá</span><span class="rc-r">${money(sale.discount)}</span></div>`)
  }

  const payLabel = sale.payMethod === 'cash' ? 'TIỀN MẶT' : sale.payMethod === 'transfer' ? 'CHUYỂN KHOẢN' : 'GHI NỢ'
  parts.push(`<div class="rc-grand"><span>${escapeHtml(payLabel)}</span><span>${money(sale.total)}</span></div>`)

  if (sale.payMethod === 'cash' && sale.tendered) {
    parts.push(`<div class="rc-row rc-tender"><span class="rc-l">Khách đưa</span><span class="rc-r">${money(sale.tendered)}</span></div>`)
    parts.push(`<div class="rc-row rc-tender"><span class="rc-l">Thối lại</span><span class="rc-r">${money(Math.max(0, sale.tendered - sale.total))}</span></div>`)
  }
  if (sale.debtAmount > 0) {
    parts.push(`<div class="rc-row rc-tender"><span class="rc-l">Ghi nợ</span><span class="rc-r">${money(sale.debtAmount)}</span></div>`)
  }

  if (printer.templateFooter) {
    parts.push('<div class="rc-rule thin"></div>')
    parts.push(`<div class="rc-foot">${escapeHtml(printer.templateFooter)}</div>`)
  }
  parts.push('</div>')
  parts.push('<div class="rc-cut"></div>')

  const css = `<style>
    :root{--paper-w:${preset.width}mm;--rc-pad-x:${preset.padX}mm;--rc-pad-y:${preset.padY}mm;--rc-cols:${preset.itemCols};}
    @page { size: ${preset.width}mm auto; margin: 0; }
    *{box-sizing:border-box}
    html,body{background:#fff;color:#000;margin:0;padding:0;width:var(--paper-w);max-width:var(--paper-w);overflow-x:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .rc-paper{width:100%;padding:var(--rc-pad-y) var(--rc-pad-x);margin:0;font-family:${fontStack};font-size:${fontSize}px;line-height:${preset.lineHeight};color:#000}
    .rc-inner{width:100%}
    .rc-shop{text-align:center;font-weight:800;font-size:${fontSize + 1}px;line-height:1.15;margin:0 0 2px;text-transform:uppercase;letter-spacing:.02em}
    .rc-biz{text-align:center;font-size:${Math.max(7, fontSize - 1)}px;line-height:1.2;margin:0 0 1px}
    .rc-title{text-align:center;font-weight:800;font-size:${fontSize}px;margin:3px 0 4px;line-height:1.15;text-transform:uppercase;letter-spacing:.04em}
    .rc-row{display:flex;justify-content:space-between;align-items:baseline;gap:2mm;line-height:1.2;margin:0}
    .rc-row .rc-l{flex:1;min-width:0;text-align:left}
    .rc-row .rc-r{flex:0 0 auto;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
    .rc-split .rc-l,.rc-split .rc-r{flex:1 1 50%}
    .rc-disc,.rc-tender{font-size:${Math.max(7, fontSize - 1)}px;margin-top:1px}
    .rc-rule{border-top:1px solid #000;height:0;margin:${is80 ? '3px' : '2px'} 0}
    .rc-rule.thin{margin:1px 0}
    .rc-tbl-hd,.rc-tbl-row{display:grid;grid-template-columns:var(--rc-cols);column-gap:1mm;align-items:baseline;width:100%;line-height:1.15}
    .rc-tbl-hd{font-weight:700;font-size:${Math.max(7, fontSize - 1)}px;text-transform:uppercase;margin:1px 0}
    .rc-tbl-row{margin:0}
    .rc-tbl-sum{font-weight:700;margin-top:1px}
    .c-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
    .c-qty{text-align:center;white-space:nowrap;font-variant-numeric:tabular-nums}
    .c-price,.c-amt{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
    .rc-grand{display:flex;justify-content:space-between;align-items:baseline;margin:${is80 ? '4px' : '3px'} 0 1px;font-weight:900;font-size:${fontSize + 2}px;line-height:1.1}
    .rc-grand span:last-child{font-variant-numeric:tabular-nums}
    .rc-foot{text-align:center;font-size:${Math.max(7, fontSize - 1)}px;line-height:1.2;margin:3px 0 0;text-transform:capitalize}
    .rc-cut{height:${preset.cutSpace * 2}mm;line-height:0;font-size:0}
    @media screen{ body{background:#eaeaea;padding:10px 0;width:auto;max-width:none}.rc-paper{background:#fff;box-shadow:0 4px 16px rgba(0,0,0,.14)} }
    @media print{ html,body{width:var(--paper-w);background:#fff}.rc-paper{box-shadow:none;page-break-after:auto} }
  </style>`

  return { body: parts.join(''), css, width: preset.width }
}

/** Dựng tài liệu in hoàn chỉnh (nhiều bản). */
export function receiptPrintDocument(built: BuiltReceipt, copies: number): string {
  const n = Math.max(1, Math.min(5, copies || 1))
  let all = ''
  for (let i = 0; i < n; i++) {
    all += `<div class="rc-paper">${built.body}</div>` + (i < n - 1 ? '<div style="page-break-after:always"></div>' : '')
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>In hóa đơn</title>${built.css}</head><body>${all}</body></html>`
}

/** In từ phiếu JSON (agent PC dựng HTML tại chỗ). */
export function printTicketLocal(ticket: import('./printTicket').PrintTicket): boolean {
  if (ticket.kind === 'test') {
    const html = buildTestReceiptHtml(ticket.shop.name, ticket.width)
    return printHtmlDocument(html)
  }
  const ctx = receiptContextFromTicket(ticket)
  if (!ctx) return false
  return printReceiptLocal(ctx, ticket.copies)
}

function printHtmlDocument(html: string): boolean {
  try {
    const old = document.getElementById('receipt-print-frame')
    if (old) old.remove()
    const frame = document.createElement('iframe')
    frame.id = 'receipt-print-frame'
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none'
    document.body.appendChild(frame)
    const doc = frame.contentWindow!.document
    doc.open()
    doc.write(html)
    doc.close()
    setTimeout(() => {
      try {
        frame.contentWindow!.focus()
        frame.contentWindow!.print()
      } catch { /* PWA có thể chặn print — bỏ qua */ }
    }, 320)
    setTimeout(() => frame.remove(), 10000)
    return true
  } catch {
    return false
  }
}

/**
 * In hoá đơn trên máy này (iframe ẩn + window.print).
 * Trả về true nếu đã gửi được lệnh in.
 */
export function printReceiptLocal(ctx: ReceiptContext, copies = 1): boolean {
  try {
    const built = buildReceiptHTML(ctx)
    return printHtmlDocument(receiptPrintDocument(built, copies))
  } catch {
    return false
  }
}

/**
 * Sanitize HTML hoá đơn trước khi gửi lên cloud (port từ print agent).
 * Chặn script/iframe/sự kiện, chỉ giữ thẻ an toàn cho hoá đơn.
 */
export function sanitizeReceiptHtml(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html')
    doc.querySelectorAll('script,iframe,object,embed,link,base,form,input,svg,math,audio,video,source,noscript')
      .forEach((n) => n.remove())
    sanitizeEl(doc.documentElement)
    return '<!doctype html>' + doc.documentElement.outerHTML
  } catch {
    // Không fallback regex yếu (dễ bypass) — trả tài liệu rỗng an toàn
    return '<!doctype html><html><body></body></html>'
  }
}

const ALLOWED_TAGS = new Set(['HTML', 'HEAD', 'BODY', 'META', 'TITLE', 'STYLE', 'DIV', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'SMALL', 'BR', 'HR', 'P', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'IMG'])
const ALLOWED_ATTRS = new Set(['class', 'style', 'width', 'height', 'colspan', 'rowspan', 'align', 'charset', 'alt'])
const IMG_SRC_OK = /^https:\/\/api\.qrserver\.com\//i

function sanitizeStyleText(t: string): string {
  return String(t || '').replace(/@import[^;]*;?/gi, '').replace(/url\s*\(\s*(['"]?)(?!data:)[^)]*\1\s*\)/gi, 'none')
}

function sanitizeEl(el: Element): void {
  const kids = Array.from(el.childNodes)
  for (const ch of kids) {
    if (ch.nodeType === 1) {
      const node = ch as Element
      const tag = node.tagName
      if (!ALLOWED_TAGS.has(tag)) { node.remove(); continue }
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase()
        const val = attr.value || ''
        if (name.indexOf('on') === 0) { node.removeAttribute(attr.name); continue }
        if (tag === 'IMG' && name === 'src') { if (!IMG_SRC_OK.test(val.trim())) node.removeAttribute(attr.name); continue }
        if (name === 'style') { node.setAttribute('style', sanitizeStyleText(val)); continue }
        if (!ALLOWED_ATTRS.has(name)) node.removeAttribute(attr.name)
      }
      if (tag === 'STYLE') node.textContent = sanitizeStyleText(node.textContent || '')
      sanitizeEl(node)
    } else if (ch.nodeType === 8) {
      ch.remove()
    }
  }
}

/** HTML phiếu in thử kết nối (port từ cloud relay). */
export function buildTestReceiptHtml(shopName: string, width: number): string {
  const w = Number(width) || 58
  return '<!doctype html><html><head><meta charset="utf-8">' +
    `<style>@page{size:${w}mm auto;margin:0}body{margin:0;width:${w}mm;font:12px ui-monospace,monospace}.rc-paper{padding:4mm;text-align:center;line-height:1.6}</style>` +
    '</head><body><div class="rc-paper"><b>3SU — KIỂM TRA KẾT NỐI</b><br>' +
    escapeHtml(shopName || '') + '<br>' + new Date().toLocaleString('vi-VN') +
    '<br>--------------------------<br>Điện thoại gửi lệnh: OK<br>Máy tính nhận lệnh: OK<br>Máy in in được: OK</div></body></html>'
}
