/**
 * 3SU Next — Nhập hàng từ hoá đơn (port 24-invoice-import.js)
 * Parser thuần (không phụ thuộc thư viện) cho:
 * - XML eInvoice TT78 VN (chính xác 100%)
 * - HTML eInvoice VN (heuristic theo bảng)
 * - CSV / TXT (bảng)
 * Excel/PDF/ZIP/ảnh được lazy-load thư viện (xlsx, pdfjs-dist, jszip) khi cần.
 * Sau khi parse → preview cho user sửa → commit qua saveGoodsReceipt().
 */
import { localDay } from '../format'

/* ─── Kiểu dữ liệu ─── */
export interface ParsedSupplier { name: string; mst: string; phone: string; addr: string }
export interface ParsedItem {
  name: string
  sku: string
  qty: number
  cost: number
  tax: number
  unit: string
  total: number
  /** Giá bán đề xuất */
  price: number
  /** Hệ số quy đổi đơn vị (null = chưa biết) */
  unitRatio: number | null
}
export interface InvoiceTotals { preTax: number; tax: number; grand: number }
export interface ParsedInvoice {
  supplier: ParsedSupplier
  date: string
  note: string
  nbmst: string
  khhdon: string
  shdon: string
  items: ParsedItem[]
  totals: InvoiceTotals
  rawText: string
}

/* ─── Helper parse số / ngày ─── */
/** Parse số kiểu VN: 1.234.567 hoặc 1,234,567 → 1234567; 12,5 → 12.5 */
export function numVN(v: unknown): number {
  if (v == null || v === '') return 0
  let s = String(v).trim()
  const hasComma = s.indexOf(',') >= 0
  const hasDot = s.indexOf('.') >= 0
  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (hasComma) {
    if (/,\d{1,2}$/.test(s)) s = s.replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (hasDot) {
    const dots = (s.match(/\./g) || []).length
    if (dots > 1) s = s.replace(/\./g, '')
    else if (!/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '')
  }
  s = s.replace(/[^\d.-]/g, '')
  const n = parseFloat(s)
  return isFinite(n) ? n : 0
}

/** Parse số strict (dấu chấm luôn là thập phân — cho XML/JSON). */
function numStrict(v: unknown): number {
  if (v == null || v === '') return 0
  const n = parseFloat(String(v).trim().replace(/,/g, ''))
  return isFinite(n) ? n : 0
}

function pct(v: unknown): number {
  if (v == null || v === '') return 0
  const s = String(v).trim()
  if (/kct|kkkt|không|khong/i.test(s)) return 0
  const m = s.match(/(\d+(?:[.,]\d+)?)/)
  return m ? numVN(m[1]) : 0
}

/** Chuẩn hoá ngày về YYYY-MM-DD. */
export function dateISO(s: unknown): string {
  if (!s) return ''
  let str = String(s).trim()
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0')
  m = str.match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/)
  if (m) return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0')
  m = str.match(/ng[aà]y\s+(\d{1,2})\s+th[aá]ng\s+(\d{1,2})\s+n[aă]m\s+(\d{4})/i)
  if (m) return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0')
  return ''
}

const DEFAULT_MARKUP = 1.35
function suggestSellPrice(cost: number, tax: number, unitRatio: number | null): number {
  let base = cost * (1 + tax / 100)
  if (unitRatio && unitRatio > 0) base = base / unitRatio
  const raw = base * DEFAULT_MARKUP
  return Math.max(500, Math.ceil(raw / 500) * 500)
}

/** Chuẩn hoá 1 dòng item, đảm bảo đủ field + gợi ý giá bán. */
function normItem(it: Partial<ParsedItem>): ParsedItem {
  const qty = Number(it.qty) || 0
  const cost = Number(it.cost) || 0
  const tax = Number(it.tax) || 0
  const unitRatio = it.unitRatio ?? null
  const total = Number(it.total) || qty * cost
  let price = Number(it.price) || 0
  if (!price && cost > 0) price = suggestSellPrice(cost, tax, unitRatio)
  return {
    name: String(it.name || '').trim(),
    sku: String(it.sku || '').trim(),
    qty,
    cost,
    tax,
    unit: String(it.unit || 'cái').trim() || 'cái',
    total,
    price,
    unitRatio,
  }
}

/* ─── XML eInvoice (TT78 VN) ─── */
export function parseEInvoiceXML(text: string): ParsedInvoice {
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  if (doc.querySelector('parsererror')) throw new Error('XML không hợp lệ')

  const getElAny = (root: ParentNode & Element, name: string): Element | null => {
    if (!root) return null
    const el = root.getElementsByTagNameNS?.('*', name)[0]
    if (el) return el
    const el2 = root.getElementsByTagName(name)[0]
    if (el2) return el2
    const all = root.getElementsByTagName('*')
    for (let i = 0; i < all.length; i++) {
      const node = all[i]
      const local = node.localName || node.tagName.split(':').pop() || ''
      if (local.toLowerCase() === name.toLowerCase()) return node
    }
    return null
  }
  const getTextAny = (root: ParentNode & Element, names: string[]): string => {
    for (const n of names) {
      const el = getElAny(root, n)
      if (el && el.textContent) return el.textContent.trim()
    }
    return ''
  }

  const nban = getElAny(doc as unknown as Element, 'NBan') || (doc as unknown as Element)
  const supName = getTextAny(nban, ['Ten', 'TenNBan', 'Name'])
  const supMST = getTextAny(nban, ['MST', 'MaSoThue', 'TaxCode'])
  const supPhone = getTextAny(nban, ['SDThoai', 'SDT', 'Phone', 'DienThoai'])
  const supAddr = getTextAny(nban, ['DChi', 'DiaChi', 'Address'])
  const date = dateISO(getTextAny(doc as unknown as Element, ['NLap', 'NgayLap', 'Ngay', 'Date']))
  const khhdon = getTextAny(doc as unknown as Element, ['KHHDon', 'KyHieu'])
  const shdon = getTextAny(doc as unknown as Element, ['SHDon', 'SoHoaDon', 'SoHDon', 'So'])

  let nodes: Element[] = doc.getElementsByTagNameNS
    ? [...doc.getElementsByTagNameNS('*', 'HHDVu')]
    : [...doc.getElementsByTagName('HHDVu')]
  if (!nodes.length) {
    nodes = [...doc.getElementsByTagName('*')].filter((e) => {
      const local = e.localName || e.tagName.split(':').pop() || ''
      if (/^DS/i.test(local)) return false // bỏ qua container danh sách (DSHHDVu…)
      return /HHDVu|HangHoa|DongHang/i.test(local) && !!(
        getElAny(e, 'THHDVu') || getElAny(e, 'TenHHDVu') || getElAny(e, 'TenHang') || getElAny(e, 'Ten')
      )
    })
  }

  const items = nodes.map((n) => {
    const name = getTextAny(n, ['THHDVu', 'TenHHDVu', 'TenHang', 'Ten'])
    const sku = getTextAny(n, ['MHHDVu', 'MaHHDVu', 'MaHang', 'MaHH', 'MaSP', 'MaHangHoa', 'Code', 'ItemCode', 'ProductCode'])
    const qty = numStrict(getTextAny(n, ['SLuong', 'SoLuong', 'SL', 'Qty', 'Quantity']))
    const cost = numStrict(getTextAny(n, ['DGia', 'DonGia', 'GiaBan', 'Gia', 'Price', 'Cost']))
    const unit = getTextAny(n, ['DVTinh', 'DonViTinh', 'DVT', 'Unit']) || 'cái'
    const tax = pct(getTextAny(n, ['TSuat', 'ThueSuat', 'TaxRate', 'Thue']))
    const total = numStrict(getTextAny(n, ['ThTien', 'ThanhTien', 'Total', 'Amount']))
    if (!name) return null
    const isDiscount = (!qty || qty === 0) && (total <= 0 || cost === 0)
    if (isDiscount) return null
    return normItem({ name, sku, qty: qty || 1, cost, unit, tax, total })
  }).filter((x): x is ParsedItem => x !== null)

  const totals: InvoiceTotals = {
    preTax: numStrict(getTextAny(doc as unknown as Element, ['TgTCThue', 'TongTienChuaThue', 'CongTienHang', 'PreTax'])),
    tax: numStrict(getTextAny(doc as unknown as Element, ['TgTThue', 'TongTienThue', 'TienThue', 'TaxAmount'])),
    grand: numStrict(getTextAny(doc as unknown as Element, ['TgTTTBSo', 'TongTienThanhToan', 'TongCong', 'GrandTotal'])),
  }

  return {
    supplier: { name: supName, mst: supMST, phone: supPhone, addr: supAddr },
    date: date || localDay(new Date()),
    note: supMST ? 'MST ' + supMST : '',
    nbmst: supMST,
    khhdon,
    shdon,
    items,
    totals,
    rawText: '',
  }
}

/* ─── CSV / bảng (Excel-like rows) ─── */
export function csvParse(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQ = false
  let i = 0
  text = text.replace(/^\uFEFF/, '')
  while (i < text.length) {
    const c = text[i]
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i += 2; continue } inQ = false; i++; continue }
      cur += c; i++; continue
    }
    if (c === '"') { inQ = true; i++; continue }
    if (c === ',' || c === ';' || c === '\t') { row.push(cur); cur = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; i++; continue }
    cur += c; i++
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row) }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && String(r[0]).trim()))
}

/** Chuyển ma trận dòng (từ CSV/Excel) thành items — dò header tự động. */
export function rowsToItems(rows: string[][]): ParsedItem[] {
  if (!rows || rows.length < 1) return []
  let hdr = 0
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    const joined = (rows[i] || []).join('|').toLowerCase()
    if (/t[eê]n|m[aă] h[aà]ng|s[lố]\s*l|so\s*luong|đ[ơo]n\s*gi[aá]|don\s*gia/.test(joined)) { hdr = i; break }
  }
  const headers = (rows[hdr] || []).map((s) => String(s || '').trim().toLowerCase())
  const findCol = (...keys: string[]): number => {
    for (const k of keys) {
      for (let j = 0; j < headers.length; j++) {
        if (headers[j] === k || headers[j].indexOf(k) >= 0) return j
      }
    }
    return -1
  }
  const C = {
    name: findCol('tên hàng', 'tên sản phẩm', 'ten hang', 'ten san pham', 'tên', 'ten', 'mat hang'),
    qty: findCol('số lượng', 'so luong', 'sl'),
    cost: findCol('đơn giá', 'don gia', 'giá nhập', 'gia nhap'),
    unit: findCol('đvt', 'dvt', 'đơn vị', 'don vi'),
    tax: findCol('thuế suất', 'thue suat', 'tsuat', 'vat', '%thuế'),
    total: findCol('thành tiền', 'thanh tien', 'tổng', 'tong'),
  }
  const out: ParsedItem[] = []
  for (let r = hdr + 1; r < rows.length; r++) {
    const row = rows[r] || []
    const get = (idx: number) => (idx >= 0 && row[idx] != null ? String(row[idx]).trim() : '')
    const name = get(C.name)
    if (!name || /^(tổng|cộng|total)/i.test(name)) continue
    let qty = numVN(get(C.qty))
    let cost = numVN(get(C.cost))
    const total = numVN(get(C.total))
    if (!cost && total && qty) cost = Math.round(total / qty)
    if (!qty) qty = 1
    out.push(normItem({ name, qty, cost, unit: get(C.unit) || 'cái', tax: pct(get(C.tax)), total }))
  }
  return out
}

export function parseCSVText(text: string): ParsedInvoice {
  return {
    supplier: { name: '', mst: '', phone: '', addr: '' },
    date: localDay(new Date()),
    note: '', nbmst: '', khhdon: '', shdon: '',
    items: rowsToItems(csvParse(text)),
    totals: { preTax: 0, tax: 0, grand: 0 },
    rawText: '',
  }
}

/* ─── PDF / ảnh: trích xuất dòng từ text thô (OCR hoặc PDF text layer) ─── */
export function itemsFromTextLines(text: string): ParsedItem[] {
  if (!text) return []
  const lines = text.split(/\r?\n/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const items: ParsedItem[] = []
  const rePrice = /([\d.,]{3,})/g
  for (const ln of lines) {
    if (/^(stt|tt|tên|mô tả|mã|số l|don\s*gia|tổng|cộng|total)/i.test(ln)) continue
    const nums = ln.match(rePrice) || []
    if (nums.length < 2) continue
    const all = nums.map(numVN)
    const big = all.filter((n) => n >= 1000)
    if (!big.length) continue
    const cost = big[big.length - 2] || big[0]
    const total = big[big.length - 1]
    const qtyCandidate = all.find((n) => n > 0 && n < 1000)
    let qty = qtyCandidate || 1
    if (total && cost && Math.abs(qty * cost - total) > total * 0.5) {
      const q2 = total / cost
      if (q2 > 0 && q2 < 10000) qty = Math.round(q2 * 100) / 100
    }
    const nameMatch = ln.match(/^(.+?)\s+[\d.,]{1,}/)
    const name = nameMatch ? nameMatch[1].trim() : ''
    if (!name || name.length < 2) continue
    items.push(normItem({ name, qty: qty || 1, cost: cost || 0, unit: 'cái', tax: 0, total: total || 0 }))
  }
  return items
}

/* ─── Router theo định dạng file ─── */
function readText(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result || ''))
    r.onerror = () => rej(new Error('Không đọc được file'))
    r.readAsText(file, 'utf-8')
  })
}

/**
 * Parse file hoá đơn. Hỗ trợ native: XML, HTML, CSV/TXT.
 * Excel/PDF/ZIP/ảnh cần thư viện lazy-load (gọi qua loader truyền vào).
 */
export async function parseInvoiceFile(
  file: File,
  loaders: {
    excel?: (file: File) => Promise<ParsedInvoice>
    pdf?: (file: File) => Promise<ParsedInvoice>
    zip?: (file: File) => Promise<ParsedInvoice>
    image?: (file: File) => Promise<ParsedInvoice>
  } = {},
): Promise<ParsedInvoice> {
  const name = (file.name || '').toLowerCase()
  const ext = name.split('.').pop() || ''

  if (ext === 'zip' || file.type === 'application/zip') {
    if (loaders.zip) return loaders.zip(file)
    throw new Error('Cần thư viện ZIP để đọc file này')
  }
  if (ext === 'xml' || /xml/.test(file.type || '')) {
    return parseEInvoiceXML(await readText(file))
  }
  if (ext === 'html' || ext === 'htm' || file.type === 'text/html') {
    const t = await readText(file)
    return parseEInvoiceHTML(t)
  }
  if (ext === 'xlsx' || ext === 'xlsm' || ext === 'xlsb' || ext === 'xls' || /spreadsheet/.test(file.type || '')) {
    if (loaders.excel) return loaders.excel(file)
    throw new Error('Cần thư viện Excel để đọc file này')
  }
  if (ext === 'csv' || ext === 'txt' || file.type === 'text/csv') {
    return parseCSVText(await readText(file))
  }
  if (ext === 'pdf' || file.type === 'application/pdf') {
    if (loaders.pdf) return loaders.pdf(file)
    throw new Error('Cần thư viện PDF để đọc file này')
  }
  if (/^image\//.test(file.type || '') || /\.(png|jpe?g|gif|bmp|webp)$/i.test(name)) {
    if (loaders.image) return loaders.image(file)
    throw new Error('Cần thư viện OCR để đọc ảnh hoá đơn')
  }
  throw new Error('Định dạng chưa hỗ trợ: ' + name)
}

/* ─── HTML eInvoice VN ─── */
export function parseEInvoiceHTML(text: string): ParsedInvoice {
  const doc = new DOMParser().parseFromString(text, 'text/html')
  const allText = (doc.body?.textContent || '').replace(/\s+/g, ' ')

  const tables = [...doc.querySelectorAll('table')]
  let itemTable: HTMLTableElement | null = doc.querySelector('table.items')
  if (!itemTable) {
    itemTable = tables.find((t) => {
      const hdrRow = t.querySelector('thead tr') || t.querySelector('tr')
      if (!hdrRow) return false
      const cells = [...hdrRow.querySelectorAll('th,td')].map((c) => c.textContent?.toLowerCase() || '')
      const j = cells.join('|')
      return /t[eê]n/.test(j) && /s[lố]\s*l|so\s*luong|sl/.test(j) && /[đd]\s*[ơo]n\s*gi[aá]|don\s*gia|gia/.test(j)
    }) || null
  }

  let supName = '', supMST = '', supAddr = '', supPhone = ''
  const infoTables = doc.querySelectorAll('table')
  const labelLookup = (regex: RegExp): string => {
    for (const tbl of infoTables) {
      for (const tr of tbl.querySelectorAll('tr')) {
        const tds = [...tr.querySelectorAll('th,td')]
        if (tds.length < 2) continue
        const lbl = tds[0].textContent?.toLowerCase() || ''
        if (regex.test(lbl)) {
          return tds.slice(1).map((t) => t.textContent?.trim() || '').filter(Boolean).join(' ').trim()
        }
      }
    }
    return ''
  }
  supName = labelLookup(/đ[ơo]n\s*v[ịi]\s*b[aá]n|b[eê]n\s*b[aá]n|ng[ưu]\s*[ờo]i\s*b[aá]n|c[ơo]ng\s*ty\s*b[aá]n/)
  supMST = labelLookup(/m[aã]\s*s[ốo]\s*thu[eế]/)
  supAddr = labelLookup(/đ[ịi]a\s*ch[ỉi]/)
  supPhone = labelLookup(/đi[ệe]n\s*tho[ạa]i|sđt|sdt/)

  let date = ''
  const dm = allText.match(/ng[aà]y\s+(\d{1,2})\s+th[aá]ng\s+(\d{1,2})\s+n[aă]m\s+(\d{4})/i)
    || allText.match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/)
  if (dm) date = dm[3] + '-' + String(dm[2]).padStart(2, '0') + '-' + String(dm[1]).padStart(2, '0')

  const items: ParsedItem[] = []
  if (itemTable) {
    const hdrRow = itemTable.querySelector('thead tr') || itemTable.querySelector('tr')
    const headers = hdrRow ? [...hdrRow.querySelectorAll('th,td')].map((c) => c.textContent?.toLowerCase().trim() || '') : []
    const findCol = (...res: string[]): number => {
      for (const rStr of res) {
        const re = new RegExp(rStr, 'i')
        for (let j = 0; j < headers.length; j++) if (re.test(headers[j])) return j
      }
      return -1
    }
    const cName = findCol('t[eê]n', 'm[oô]\s*t[aả]', 'h[aà]ng')
    const cQty = findCol('s[lố]\s*l', 'so\s*luong', '^sl$')
    const cUnit = findCol('đvt', 'đ[ơo]n\s*v[ịi]')
    const cCost = findCol('[đd]\s*[ơo]n\s*gi[aá]', 'don\s*gia', '^gia$')
    const cTax = findCol('thue', 'thu[eế]', 'tsuat', 'gtgt')
    const cTotal = findCol('th[aà]nh\s*ti[eề]n', 'thanh\s*tien', 't[oổ]ng')

    const bodyRows = [...itemTable.querySelectorAll('tr')].slice(hdrRow === itemTable.querySelector('tr') ? 1 : 0)
    for (const tr of bodyRows) {
      const cells = [...tr.querySelectorAll('td')]
      if (!cells.length) continue
      const get = (idx: number) => (idx >= 0 && cells[idx] ? cells[idx].textContent?.trim() || '' : '')
      const name = get(cName)
      if (!name || /^(tổng|cộng|total)/i.test(name)) continue
      let qty = numVN(get(cQty))
      let cost = numVN(get(cCost))
      const total = numVN(get(cTotal))
      if (!cost && total && qty) cost = Math.round(total / qty)
      if (!qty) qty = 1
      items.push(normItem({ name, qty, cost, unit: get(cUnit) || 'cái', tax: pct(get(cTax)), total }))
    }
  }

  const totals: InvoiceTotals = { preTax: 0, tax: 0, grand: 0 }
  const sumRoot = doc.querySelector('.summary, .totals') || doc.body
  const sumText = sumRoot?.textContent || ''
  const mPre = sumText.match(/(?:c[ộo]ng\s*ti[ềe]n\s*h[aà]ng|t[oổ]ng\s*ti[eề]n\s*ch[ưu]a)[^\d]+([\d.,]{4,})/i)
  const mTax = sumText.match(/(?:ti[ềe]n\s*thu[eế]|thu[eế]\s*gtgt)[^\d]+([\d.,]{4,})/i)
  const mGr = sumText.match(/t[oổ]ng\s*ti[ềe]n\s*thanh\s*to[aá]n[^\d]+([\d.,]{4,})/i)
  if (mPre) totals.preTax = numVN(mPre[1])
  if (mTax) totals.tax = numVN(mTax[1])
  if (mGr) totals.grand = numVN(mGr[1])

  const anyTax = items.some((it) => it.tax > 0)
  if (!anyTax && totals.preTax > 0 && totals.tax > 0) {
    const rate = Math.round((totals.tax / totals.preTax) * 100)
    items.forEach((it) => { it.tax = rate })
  }

  const shdonMatch = allText.match(/(?:S[ốo]\s*h[oó]a\s*đ[ơo]n|S[ốo]\s*HĐ|S[ốo]):?\s*(\d+)/i)
  const khhdonMatch = allText.match(/(?:K[yý]\s*hi[eệ]u):?\s*([A-Z0-9/]+)/i)

  return {
    supplier: { name: supName, mst: supMST, addr: supAddr, phone: supPhone },
    date: date || localDay(new Date()),
    note: supMST ? 'MST ' + supMST : '',
    nbmst: supMST,
    khhdon: khhdonMatch ? khhdonMatch[1] : labelLookup(/k[yý]\s*hi[eệ]u/),
    shdon: shdonMatch ? shdonMatch[1] : labelLookup(/s[ốo]\s*h[oó]a\s*đ[ơo]n|s[ốo]\s*hđ|s[ốo]/),
    items,
    totals,
    rawText: '',
  }
}
