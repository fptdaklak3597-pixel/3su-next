/**
 * Tờ hóa đơn kiểu GDT — cùng form với 3su-invoice (invoice-print.js).
 * Cloud chỉ lưu XML, không có HTML/XSLT gốc từ trang thuế.
 */
export interface GdtLineItem {
  ten?: string
  thhdvu?: string
  name?: string
  dvtinh?: string
  unit?: string
  sluong?: string | number
  soluong?: string | number
  quantity?: string | number
  dgia?: string | number
  dongia?: string | number
  price?: string | number
  thtien?: string | number
  thanhtien?: string | number
  amount?: string | number
  thsuat?: string
  taxRate?: string
  tthue?: string | number
  thtax?: string | number
  chkhau?: string | number
  discount?: string | number
  lhhhdvu?: string
  type?: string
  stt?: string | number
}

export interface GdtInvoiceForm {
  khhdon?: string
  shdon?: string | number
  khmshdon?: string
  thdon?: string
  tlhdon?: string
  tdlap?: string
  thtttoan?: string
  htttoan?: string
  mhdon?: string
  nbten?: string
  nbmst?: string
  nbdchi?: string
  nbstkhoan?: string
  nbtnhang?: string
  nmten?: string
  nmtnmua?: string
  nmmst?: string
  nmdchi?: string
  tgtcthue?: string | number
  tgtthue?: string | number
  tgtttbso?: string | number
  tgtttbchu?: string
  tgtckhau?: string | number
  tgtphi?: string | number
  nbtnban?: string
  ngayky?: string
  mtdtchieu?: string
  hdhhdvu?: GdtLineItem[]
  items?: GdtLineItem[]
  dshhdv?: GdtLineItem[]
  [key: string]: unknown
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char] || char))
}

function numberValue(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function fmtVND(value: unknown): string {
  return numberValue(value).toLocaleString('vi-VN')
}

export function invoiceYmd(value: unknown): string {
  if (!value) return ''
  const text = String(value)
  const direct = text.match(/^(\d{4}-\d{2}-\d{2})/)
  if (direct && !/[T ]/.test(text)) return direct[1] || ''
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return direct?.[1] || ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).reduce<Record<string, string>>((out, part) => {
    out[part.type] = part.value
    return out
  }, {})
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function formatInvoiceDate(value: unknown): string {
  const ymd = invoiceYmd(value)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ''
}

function xmlLocalName(node: Element): string {
  return String(node.localName || node.nodeName || '').replace(/^.*:/, '')
}

function xmlFirstByLocalName(rootEl: ParentNode | null, local: string): Element | null {
  if (!rootEl || typeof (rootEl as Document).getElementsByTagName !== 'function') return null
  const wanted = String(local || '').toLowerCase()
  const nodes = (rootEl as Document).getElementsByTagName('*')
  for (let i = 0; i < nodes.length; i += 1) {
    const el = nodes[i]
    if (el && xmlLocalName(el).toLowerCase() === wanted) return el
  }
  return null
}

function xmlAllByLocalName(rootEl: ParentNode | null, local: string): Element[] {
  const out: Element[] = []
  if (!rootEl || typeof (rootEl as Document).getElementsByTagName !== 'function') return out
  const wanted = String(local || '').toLowerCase()
  const nodes = (rootEl as Document).getElementsByTagName('*')
  for (let i = 0; i < nodes.length; i += 1) {
    const el = nodes[i]
    if (el && xmlLocalName(el).toLowerCase() === wanted) out.push(el)
  }
  return out
}

function xmlChildText(parent: ParentNode | null, local: string): string {
  const node = xmlFirstByLocalName(parent, local)
  return node ? String(node.textContent || '').trim() : ''
}

function xmlExtra(el: Element, field: string): string {
  const wanted = String(field || '').toLowerCase()
  const nodes = xmlAllByLocalName(el, 'TTin')
  for (const node of nodes) {
    if (xmlChildText(node, 'TTruong').toLowerCase() === wanted) {
      return xmlChildText(node, 'DLieu')
    }
  }
  return ''
}

export function detailFromXml(xmlText: string): GdtInvoiceForm | null {
  if (!xmlText || !String(xmlText).trim()) return null
  if (typeof DOMParser !== 'function') return null
  try {
    const doc = new DOMParser().parseFromString(String(xmlText), 'application/xml')
    if (!doc || doc.querySelector('parsererror')) return null
    const nban = xmlFirstByLocalName(doc, 'NBan')
    const nmua = xmlFirstByLocalName(doc, 'NMua')
    const items = xmlAllByLocalName(doc, 'HHDVu').map((el) => ({
      ten: xmlChildText(el, 'THHDVu'),
      thhdvu: xmlChildText(el, 'THHDVu'),
      dvtinh: xmlChildText(el, 'DVTinh'),
      sluong: xmlChildText(el, 'SLuong'),
      dgia: xmlChildText(el, 'DGia'),
      thtien: xmlChildText(el, 'ThTien'),
      thsuat: xmlChildText(el, 'TSuat'),
      tthue: xmlChildText(el, 'TThue') || xmlExtra(el, 'VATAmount'),
      chkhau: xmlChildText(el, 'STCKhau'),
      lhhhdvu: xmlChildText(el, 'MHHDVu'),
      stt: xmlChildText(el, 'STT'),
    }))
    return {
      khhdon: xmlChildText(doc, 'KHHDon'),
      shdon: xmlChildText(doc, 'SHDon'),
      khmshdon: xmlChildText(doc, 'KHMSHDon'),
      thdon: xmlChildText(doc, 'THDon'),
      tlhdon: xmlChildText(doc, 'THDon'),
      tdlap: xmlChildText(doc, 'NLap'),
      thtttoan: xmlChildText(doc, 'HTTToan'),
      htttoan: xmlChildText(doc, 'HTTToan'),
      mhdon: xmlChildText(doc, 'MCCQT'),
      nbten: nban ? xmlChildText(nban, 'Ten') : '',
      nbmst: nban ? xmlChildText(nban, 'MST') : '',
      nbdchi: nban ? xmlChildText(nban, 'DChi') : '',
      nbstkhoan: nban ? xmlChildText(nban, 'STKNHang') : '',
      nbtnhang: nban ? xmlChildText(nban, 'TNHang') : '',
      nmten: nmua ? xmlChildText(nmua, 'Ten') : '',
      nmtnmua: nmua ? xmlChildText(nmua, 'Ten') : '',
      nmmst: nmua ? xmlChildText(nmua, 'MST') : '',
      nmdchi: nmua ? xmlChildText(nmua, 'DChi') : '',
      tgtcthue: xmlChildText(doc, 'TgTCThue'),
      tgtthue: xmlChildText(doc, 'TgTThue'),
      tgtttbso: xmlChildText(doc, 'TgTTTBSo'),
      tgtttbchu: xmlChildText(doc, 'TgTTTBChu'),
      tgtckhau: xmlChildText(doc, 'TTCKTMai'),
      hdhhdvu: items,
    }
  } catch {
    return null
  }
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

export function fillFromXml(invoice: GdtInvoiceForm | null | undefined, xmlText: string): GdtInvoiceForm {
  const parsed = detailFromXml(xmlText) || {}
  const base: GdtInvoiceForm = invoice && typeof invoice === 'object' ? { ...invoice } : {}
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'hdhhdvu') {
      if (!Array.isArray(base.hdhhdvu) || !base.hdhhdvu.length) base.hdhhdvu = value as GdtLineItem[]
      continue
    }
    if (isBlank(base[key])) base[key] = value
  }
  return base
}

export function buildItemsTable(detail: GdtInvoiceForm): string {
  const items = detail?.hdhhdvu || detail?.items || detail?.dshhdv || []
  if (!Array.isArray(items) || !items.length) {
    return '<tr><td colspan="10" style="text-align:center;color:#666;padding:20px">Không có chi tiết hàng hóa trong phản hồi JSON.</td></tr>'
  }
  return items.map((item, index) => {
    const taxRate = item.thsuat ?? item.taxRate ?? ''
    const discount = item.chkhau ?? item.discount ?? 0
    return `<tr>
      <td class="tx-center">${index + 1}</td>
      <td class="tx-left">Hàng hóa, dịch vụ</td>
      <td class="tx-left" style="max-width:200px;word-wrap:break-word">${escapeHtml(item.lhhhdvu || item.type || '')}</td>
      <td class="tx-left">${escapeHtml(item.ten || item.thhdvu || item.name || '')}</td>
      <td class="tx-left">${escapeHtml(item.dvtinh || item.unit || '')}</td>
      <td class="tx-center">${escapeHtml(item.sluong ?? item.soluong ?? item.quantity ?? '')}</td>
      <td class="tx-center">${fmtVND(item.dgia ?? item.dongia ?? item.price)}</td>
      <td class="tx-center">${fmtVND(discount)}</td>
      <td class="tx-center">${escapeHtml(taxRate)}</td>
      <td class="tx-center">${fmtVND(item.thtien ?? item.thanhtien ?? item.amount)}</td>
    </tr>`
  }).join('')
}

export function renderInvoiceHtml(inv: GdtInvoiceForm, detail: GdtInvoiceForm = {}): string {
  const data: GdtInvoiceForm = { ...inv, ...detail }
  const date = formatInvoiceDate(data.tdlap)
  const [day = '', month = '', year = ''] = date.split('/')
  const title = data.tlhdon || data.thdon || 'HÓA ĐƠN GIÁ TRỊ GIA TĂNG'

  const items = data.hdhhdvu || data.items || data.dshhdv || []
  const taxSummary: Record<string, { preTax: number; tax: number }> = {}
  if (Array.isArray(items)) {
    for (const item of items) {
      const taxRate = String(item.thsuat ?? item.taxRate ?? '0%')
      if (!taxSummary[taxRate]) taxSummary[taxRate] = { preTax: 0, tax: 0 }
      taxSummary[taxRate].preTax += numberValue(item.thtien ?? item.thanhtien ?? item.amount)
      taxSummary[taxRate].tax += numberValue(item.tthue ?? item.thtax ?? 0)
    }
  }

  const taxSummaryRows = Object.entries(taxSummary).map(([rate, val]) =>
    `<tr><td class="tx-center">${escapeHtml(rate)}</td><td class="tx-center">${fmtVND(val.preTax)}</td><td class="tx-center">${fmtVND(val.tax)}</td></tr>`,
  ).join('')

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HĐ ${escapeHtml(data.khhdon || '')}-${escapeHtml(data.shdon ?? '')}</title><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{max-width:210mm;margin:0 auto;padding:20px;color:#111;background:#fff;font:13pt/1.5 "Times New Roman",serif}
  .actions{position:sticky;top:10px;display:flex;justify-content:flex-end;gap:8px;margin-bottom:10px}
  .actions button{padding:9px 14px;border:0;border-radius:7px;color:#fff;background:#087b71;font:14px Arial;cursor:pointer}
  .invoice-wrapper{border:3px double rgba(145,87,21,0.69);padding:20px;background:#fff}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:15px}
  .qr-section{width:80px;height:80px;border:1px dashed #999;display:flex;align-items:center;justify-content:center;font-size:10px;color:#999}
  .invoice-info{text-align:right}
  .invoice-info b{display:block;margin-bottom:3px}
  .title-section{text-align:center;margin:20px 0}
  .main-title{font-size:20pt;font-weight:bold;text-transform:uppercase;color:#000;margin-bottom:5px}
  .date-line{font-size:13pt;margin:5px 0}
  .mst-code{font-size:12pt;color:#666}
  .section{margin:15px 0}
  .section-title{font-weight:bold;margin-bottom:8px;font-size:13pt}
  .info-table{width:100%;border-collapse:collapse;margin:10px 0}
  .info-table td{padding:5px 8px;vertical-align:top;border:none}
  .info-table td:first-child{width:25%;font-weight:500}
  .divider{height:1px;background:rgba(145,87,21,0.3);margin:15px 0}
  table.items{width:100%;border-collapse:collapse;margin:15px 0}
  table.items th,table.items td{padding:7px;border:1px solid #000;font-size:12pt}
  table.items th{background:#f5f5f5;font-weight:bold;text-align:center}
  table.items td.tx-center{text-align:center}
  table.items td.tx-left{text-align:left}
  table.items td.tx-right{text-align:right}
  .summary-section{display:flex;gap:20px;margin-top:15px}
  .tax-summary{flex:1}
  .total-summary{flex:1}
  table.summary{width:100%;border-collapse:collapse}
  table.summary td{padding:5px 8px;border:1px solid #000}
  table.summary td:first-child{font-weight:500}
  table.summary .total-row td{font-size:14pt;font-weight:bold;background:#f9f9f9}
  .signature-section{display:flex;justify-content:space-between;margin-top:40px;text-align:center}
  .signature-box{width:45%}
  .signature-box h3{font-size:13pt;font-weight:bold;margin-bottom:5px}
  .signature-box .sub{font-size:11pt;font-style:italic;color:#666;margin-bottom:10px}
  .sign-valid{border:2px solid #23b709;padding:10px;background:#f0fff0;margin-top:10px;font-size:11pt}
  .sign-valid span{display:block;margin:2px 0}
  .sign-valid .valid-label{color:#23b709;font-weight:bold;font-size:12pt}
  .footer{margin-top:30px;padding-top:10px;border-top:1px dashed #aaa;color:#555;font-size:11pt;text-align:center}
  @media print{.actions{display:none}body{padding:0}.invoice-wrapper{border:none}}
  @media(max-width:600px){.summary-section{flex-direction:column}.signature-section{flex-direction:column;gap:20px}}
  </style></head><body>
  <div class="actions"><button onclick="window.print()">In / Lưu PDF</button></div>
  <div class="invoice-wrapper">
    <div class="header">
      <div class="qr-section">QR Code</div>
      <div class="invoice-info">
        <b>Mẫu số: ${escapeHtml(data.khmshdon || '')}</b>
        <b>Ký hiệu: ${escapeHtml(data.khhdon || '')}</b>
        <b>Số: ${escapeHtml(data.shdon ?? '')}</b>
      </div>
    </div>
    <div class="title-section">
      <div class="main-title">${escapeHtml(String(title).toUpperCase())}</div>
      <div class="date-line">Ngày ${day} tháng ${month} năm ${year}</div>
      ${data.mhdon ? `<div class="mst-code">Mã CQT: ${escapeHtml(data.mhdon)}</div>` : ''}
    </div>
    <div class="divider"></div>
    <div class="section">
      <div class="section-title">Thông tin người bán hàng</div>
      <table class="info-table">
        <tr><td>Tên người bán:</td><td>${escapeHtml(data.nbten || '')}</td></tr>
        <tr><td>Mã số thuế:</td><td>${escapeHtml(data.nbmst || '')}</td></tr>
        <tr><td>Địa chỉ:</td><td>${escapeHtml(data.nbdchi || '')}</td></tr>
        ${data.nbstkhoan || data.nbtnhang ? `<tr><td>Số tài khoản:</td><td>${escapeHtml(data.nbstkhoan || '')} ${data.nbtnhang ? `— ${escapeHtml(data.nbtnhang)}` : ''}</td></tr>` : ''}
      </table>
    </div>
    <div class="divider"></div>
    <div class="section">
      <div class="section-title">Thông tin người mua hàng</div>
      <table class="info-table">
        <tr><td>Tên người mua:</td><td>${escapeHtml(data.nmtnmua || data.nmten || '')}</td></tr>
        <tr><td>Mã số thuế:</td><td>${escapeHtml(data.nmmst || '')}</td></tr>
        <tr><td>Địa chỉ:</td><td>${escapeHtml(data.nmdchi || '')}</td></tr>
        <tr><td>Hình thức thanh toán:</td><td>${escapeHtml(data.thtttoan || '')}</td></tr>
      </table>
    </div>
    <div class="divider"></div>
    <div class="section">
      <table class="items">
        <thead><tr><th>STT</th><th>Tính chất</th><th>Loại hàng hóa đặc trưng</th><th>Tên hàng hóa, dịch vụ</th><th>Đơn vị tính</th><th>Số lượng</th><th>Đơn giá</th><th>Chiết khấu</th><th>Thuế suất</th><th>Thành tiền chưa có thuế GTGT</th></tr></thead>
        <tbody>${buildItemsTable(data)}</tbody>
      </table>
    </div>
    <div class="summary-section">
      <div class="tax-summary">
        <table class="summary">
          <thead><tr><td colspan="3" style="font-weight:bold;text-align:center">Thuế suất GTGT</td></tr></thead>
          <tr><td style="font-weight:500">Thuế suất</td><td style="font-weight:500">Tổng tiền chưa thuế</td><td style="font-weight:500">Tổng tiền thuế</td></tr>
          ${taxSummaryRows || '<tr><td colspan="3" style="text-align:center">—</td></tr>'}
        </table>
      </div>
      <div class="total-summary">
        <table class="summary">
          <tr><td>Tổng tiền chưa thuế:</td><td style="text-align:right">${fmtVND(data.tgtcthue)}</td></tr>
          <tr><td>Tổng tiền thuế GTGT:</td><td style="text-align:right">${fmtVND(data.tgtthue)}</td></tr>
          ${data.tgtphi ? `<tr><td>Tổng tiền phí:</td><td style="text-align:right">${fmtVND(data.tgtphi)}</td></tr>` : ''}
          ${data.tgtckhau ? `<tr><td>Tổng tiền chiết khấu thương mại:</td><td style="text-align:right">${fmtVND(data.tgtckhau)}</td></tr>` : ''}
          <tr class="total-row"><td>Tổng tiền thanh toán:</td><td style="text-align:right">${fmtVND(data.tgtttbso)}</td></tr>
          <tr><td colspan="2" style="font-style:italic">Số tiền viết bằng chữ: ${escapeHtml(data.tgtttbchu || '')}</td></tr>
        </table>
      </div>
    </div>
    <div class="signature-section">
      <div class="signature-box">
        <h3>NGƯỜI MUA HÀNG</h3>
        <div class="sub">(Ký và ghi rõ họ tên)</div>
        <div style="margin-top:55px">${escapeHtml(data.nmtnmua || data.nmten || '')}</div>
      </div>
      <div class="signature-box">
        <h3>NGƯỜI BÁN HÀNG</h3>
        <div class="sub">(Ký, ghi rõ họ tên và đóng dấu)</div>
        ${data.nbtnban ? `<div class="sign-valid">
          <span class="valid-label">Signature Valid</span>
          <span><b>Ký bởi:</b> ${escapeHtml(data.nbtnban)}</span>
          <span><b>Ngày ký:</b> ${escapeHtml(data.ngayky || data.tdlap || '')}</span>
        </div>` : '<div style="margin-top:55px">—</div>'}
      </div>
    </div>
    <div class="footer">
      <div>Mã tra cứu: ${escapeHtml(data.mtdtchieu || '')}</div>
      <div style="margin-top:5px">Tải bởi 3SU Invoice · Hỗ trợ 0333 818 471</div>
    </div>
  </div>
  </body></html>`
}
