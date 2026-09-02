import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { downloadXmlBlob, printInvoiceHtml } from '@/core/domain/invoicePreview'

export function InvoiceGdtPreview({
  open,
  title,
  html,
  xml,
  xmlMissing,
  onClose,
  onImport,
  onPrintBlocked,
}: {
  open: boolean
  title: string
  html: string
  xml: string
  xmlMissing?: boolean
  onClose: () => void
  onImport?: () => void
  onPrintBlocked?: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="inv-gdt-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="inv-gdt-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="inv-gdt-head">
          <div>
            <h2 className="inv-gdt-title">{title}</h2>
            {xmlMissing ? <p className="inv-gdt-sub">Chưa có file XML — tờ này chỉ có số máy đã gửi.</p> : null}
          </div>
          <div className="inv-gdt-actions">
            {xml ? (
              <button type="button" onClick={() => downloadXmlBlob(xml, `${title || 'hoadon'}.xml`)}>
                Tải XML
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                if (!printInvoiceHtml(html)) onPrintBlocked?.()
              }}
            >
              In / Lưu PDF
            </button>
            {onImport ? (
              <button type="button" className="pri" onClick={onImport}>Nhập kho từ HĐ</button>
            ) : null}
            <button type="button" className="inv-gdt-close" onClick={onClose} aria-label="Đóng">×</button>
          </div>
        </header>
        <iframe
          className="inv-gdt-frame"
          title="Xem hóa đơn GDT"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={html}
        />
      </div>
    </div>,
    document.body,
  )
}
