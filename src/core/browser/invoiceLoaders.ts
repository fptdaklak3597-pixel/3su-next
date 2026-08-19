/**
 * 3SU Next — Loader lazy-load cho nhập hoá đơn (Excel/PDF/ZIP/ảnh OCR)
 * Các thư viện nặng (xlsx, pdfjs-dist, jszip, tesseract.js) chỉ được tải
 * khi user thực sự chọn định dạng tương ứng — giữ bundle chính nhỏ.
 */
import {
  rowsToItems, itemsFromTextLines, parseEInvoiceXML, parseEInvoiceHTML,
  dateISO, type ParsedInvoice,
} from '../domain/invoiceImport'
import { localDay } from '../format'

function readBuf(file: File): Promise<ArrayBuffer> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result as ArrayBuffer)
    r.onerror = () => rej(new Error('Không đọc được file'))
    r.readAsArrayBuffer(file)
  })
}

function emptyInvoice(items: ParsedInvoice['items'], rawText = ''): ParsedInvoice {
  return {
    supplier: { name: '', mst: '', phone: '', addr: '' },
    date: localDay(new Date()),
    note: '', nbmst: '', khhdon: '', shdon: '',
    items, totals: { preTax: 0, tax: 0, grand: 0 }, rawText,
  }
}

/* ─── Excel (.xlsx/.xls) ─── */
export async function loadExcel(file: File): Promise<ParsedInvoice> {
  const XLSX = await import('xlsx')
  const buf = await readBuf(file)
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' })
  let supName = ''
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const r = rows[i] || []
    const txt = r.map((x) => String(x || '').trim()).filter(Boolean).join(' ')
    if (/(c[ôo]ng ty|cty|nh[aà] cung c[aấ]p|ncc|c\.ty)/i.test(txt) && txt.length < 120) { supName = txt; break }
  }
  const inv = emptyInvoice(rowsToItems(rows as string[][]))
  inv.supplier.name = supName
  return inv
}

/* ─── PDF (text layer + OCR fallback) ─── */
export async function loadPDF(file: File): Promise<ParsedInvoice> {
  const pdfjs = await import('pdfjs-dist')
  // Nạp worker qua URL để Vite bundle đúng
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const buf = await readBuf(file)
  const pdf = await pdfjs.getDocument({ data: buf }).promise
  let text = ''
  for (let p = 1; p <= pdf.numPages; p++) {
    const pg = await pdf.getPage(p)
    const c = await pg.getTextContent()
    const its = c.items
      .filter((it) => 'str' in it && (it as { str: string }).str.trim().length > 0)
      .map((it) => it as unknown as { str: string; transform: number[] })
    its.sort((a, b) => (b.transform[5] - a.transform[5]) || (a.transform[4] - b.transform[4]))
    const lines: string[] = []
    let cur: string[] = []
    let curY: number | null = null
    its.forEach((it) => {
      const y = Math.round(it.transform[5])
      if (curY === null || Math.abs(y - curY) <= 2) cur.push(it.str)
      else { if (cur.length) lines.push(cur.join(' ')); cur = [it.str] }
      curY = y
    })
    if (cur.length) lines.push(cur.join(' '))
    text += lines.join('\n') + '\n'
  }

  const stripped = text.replace(/\s+/g, '').length
  if (stripped >= 50) {
    const items = itemsFromTextLines(text)
    const inv = emptyInvoice(items, text)
    inv.date = dateISO(text) || localDay(new Date())
    const head = text.split(/\r?\n/).slice(0, 8)
    for (const ln of head) {
      const m = ln.match(/(C[ôo]ng ty[^.,;|\-\n]{2,60}|CTY[^.,;|\-\n]{2,60}|Nh[aà] cung c[aấ]p[^.,;|\-\n]{2,60})/i)
      if (m) { inv.supplier.name = m[1].trim().replace(/\s+/g, ' '); break }
    }
    return inv
  }
  // PDF dạng ảnh → render từng trang ra canvas rồi OCR
  const ocrTexts: string[] = []
  for (let p = 1; p <= Math.min(pdf.numPages, 5); p++) {
    const pg = await pdf.getPage(p)
    const vp = pg.getViewport({ scale: 2 })
    const cv = document.createElement('canvas')
    cv.width = vp.width
    cv.height = vp.height
    const ctx = cv.getContext('2d')
    if (!ctx) continue
    await pg.render({ canvasContext: ctx, viewport: vp, canvas: cv } as never).promise
    const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'))
    if (blob) ocrTexts.push(await ocrBlob(blob))
  }
  const rawText = ocrTexts.join('\n')
  return emptyInvoice(itemsFromTextLines(rawText), rawText)
}

/* ─── ZIP (ưu tiên XML > HTML bên trong) ─── */
export async function loadZIP(file: File): Promise<ParsedInvoice> {
  const JSZip = (await import('jszip')).default
  const buf = await readBuf(file)
  const zip = await JSZip.loadAsync(buf)
  const entries = Object.values(zip.files).filter((f) => !f.dir)
  const byName = (name: string) => entries.find((e) => e.name.toLowerCase().endsWith(name))
  const byExt = (ext: string) => entries.find((e) => e.name.toLowerCase().endsWith(ext))
  const target = byName('invoice.xml') || byExt('.xml') || byName('invoice.html') || byExt('.html') || byExt('.htm')
  if (!target) throw new Error('ZIP không chứa XML/HTML hoá đơn')
  const content = await target.async('string')
  if (target.name.toLowerCase().endsWith('.xml')) return parseEInvoiceXML(content)
  return parseEInvoiceHTML(content)
}

/* ─── Ảnh (OCR Tesseract tiếng Việt) ─── */
async function ocrBlob(blob: Blob): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('vie+eng')
  try {
    const { data } = await worker.recognize(blob)
    return data.text || ''
  } finally {
    await worker.terminate()
  }
}

export async function loadImage(file: File): Promise<ParsedInvoice> {
  const rawText = await ocrBlob(file)
  return emptyInvoice(itemsFromTextLines(rawText), rawText)
}

/** Bộ loader đầy đủ để truyền vào parseInvoiceFile(). */
export const invoiceLoaders = {
  excel: loadExcel,
  pdf: loadPDF,
  zip: loadZIP,
  image: loadImage,
}
