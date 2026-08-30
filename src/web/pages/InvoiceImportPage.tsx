/**
 * Nhập từ hoá đơn — giữ parser mobile, bọc khung web.
 */
import { InvoiceImportPage } from '@/mobile/pages/InvoiceImportPage'

export function WebInvoiceImportPage() {
  return (
    <div className="web-page web-embed">
      <div className="web-ph">
        <div>
          <div className="web-eyebrow">Giao dịch</div>
          <h2>Nhập từ hoá đơn</h2>
        </div>
      </div>
      <InvoiceImportPage />
    </div>
  )
}
