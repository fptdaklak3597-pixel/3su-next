import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { downloadXmlBlob, gdtFormFromRecord, printInvoiceHtml } from '@/core/domain/invoicePreview'
import { fmt } from '@/core/format'
import { invoiceExtra, invoiceListStatus, invoiceTotal } from '@/core/domain/invoices'
import type { InvoiceRecord } from '@/core/types'

const GDT_HOME = 'https://hoadondientu.gdt.gov.vn/'
type Tab = 'gdt' | 'html' | 'xml'

export function InvoiceGdtPreview({
  open,
  inv,
  printHtml,
  gdtHtml,
  xml,
  onClose,
  onImport,
  onPrintBlocked,
}: {
  open: boolean
  inv: InvoiceRecord | null
  printHtml: string
  gdtHtml: string
  xml: string
  onClose: () => void
  onImport?: () => void
  onPrintBlocked?: () => void
}) {
  const extra = inv ? invoiceExtra(inv) : {}
  const form = inv ? gdtFormFromRecord(inv) : null
  const hasGdt = !!gdtHtml.trim()
  const [tab, setTab] = useState<Tab>(hasGdt ? 'gdt' : 'html')

  useEffect(() => {
    if (open) setTab(hasGdt ? 'gdt' : 'html')
  }, [open, hasGdt, inv?.id])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !inv || !form) return null

  const title = `Hóa đơn ${form.khhdon || extra.khhdon || ''}${form.shdon ? ` · ${form.shdon}` : ''}`
  const printTarget = hasGdt && tab === 'gdt' ? gdtHtml : printHtml
  const st = invoiceListStatus(inv)

  return createPortal(
    <div className="inv-gdt-overlay" role="dialog" aria-modal="true" aria-labelledby="inv-gdt-title" onClick={onClose}>
      <section className="inv-gdt-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="inv-gdt-head">
          <div className="inv-gdt-heading">
            <h2 id="inv-gdt-title" className="inv-gdt-title">{title.trim() || `Hóa đơn ${inv.code}`}</h2>
            <p className="inv-gdt-sub">{extra.sellerName || 'Hóa đơn đã tải về máy'}</p>
          </div>
          <div className="inv-gdt-actions">
            <a className="inv-gdt-btn inv-gdt-official" href={GDT_HOME} target="_blank" rel="noreferrer">
              Mở GDT chính thức
            </a>
            {xml ? (
              <button type="button" className="inv-gdt-btn" onClick={() => downloadXmlBlob(xml, `${inv.code || 'hoadon'}.xml`)}>
                Tải XML
              </button>
            ) : null}
            <button
              type="button"
              className="inv-gdt-btn"
              onClick={() => { if (!printInvoiceHtml(printTarget || printHtml)) onPrintBlocked?.() }}
            >
              In / Lưu PDF
            </button>
            {onImport ? (
              <button type="button" className="inv-gdt-btn pri" onClick={onImport}>Nhập kho</button>
            ) : null}
            <button type="button" className="inv-gdt-btn inv-gdt-close" onClick={onClose} aria-label="Đóng trình xem hóa đơn">×</button>
          </div>
        </header>

        <dl className="inv-gdt-meta">
          <div><dt>Người bán</dt><dd>{extra.sellerName || '—'}</dd></div>
          <div><dt>Mã số thuế</dt><dd>{extra.nbmst || '—'}</dd></div>
          <div><dt>Ký hiệu / Số</dt><dd>{[form.khhdon, form.shdon].filter(Boolean).join(' / ') || inv.code || '—'}</dd></div>
          <div><dt>Ngày lập</dt><dd>{inv.date || '—'}</dd></div>
          <div><dt>Tổng thanh toán</dt><dd>{fmt(invoiceTotal(inv))}</dd></div>
          <div><dt>Tình trạng hóa đơn</dt><dd>{st.label}</dd></div>
        </dl>

        <div className="inv-gdt-tabs" role="tablist" aria-label="Định dạng hóa đơn">
          {([
            ['gdt', 'GDT'],
            ['html', 'HTML'],
            ['xml', 'XML'],
          ] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`inv-gdt-tab ${tab === id ? 'on' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="inv-gdt-panels">
          {tab === 'gdt' ? (
            <section className="inv-gdt-panel" role="tabpanel" aria-label="GDT">
              {hasGdt ? (
                <iframe className="inv-gdt-frame" title="Hóa đơn GDT" sandbox="" referrerPolicy="no-referrer" srcDoc={gdtHtml} />
              ) : (
                <p className="inv-gdt-missing">
                  Chưa có tờ gốc từ trang thuế. Máy 3SU Invoice gửi tờ GDT khi quét lại hóa đơn này.
                </p>
              )}
            </section>
          ) : null}

          {tab === 'html' ? (
            <section className="inv-gdt-panel" role="tabpanel" aria-label="HTML">
              {printHtml.trim() ? (
                <iframe className="inv-gdt-frame" title="Hóa đơn HTML cục bộ" sandbox="" referrerPolicy="no-referrer" srcDoc={printHtml} />
              ) : (
                <p className="inv-gdt-missing">Không có bản HTML cục bộ.</p>
              )}
            </section>
          ) : null}

          {tab === 'xml' ? (
            <section className="inv-gdt-panel" role="tabpanel" aria-label="XML">
              {xml.trim() ? (
                <pre className="inv-gdt-code">{xml}</pre>
              ) : (
                <p className="inv-gdt-missing">Không có dữ liệu XML cục bộ.</p>
              )}
            </section>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  )
}
