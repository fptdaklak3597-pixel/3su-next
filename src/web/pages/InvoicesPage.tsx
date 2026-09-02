/**
 * Hóa đơn điện tử web — danh sách đã quét (giống máy Invoice) + xem tờ GDT + lọc.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search } from 'lucide-react'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmt, today } from '@/core/format'
import { logError } from '@/core/errorLogger'
import {
  createInvoice, deleteInvoice, INVOICE_STATUS_LABEL, invoiceExtra, invoicePeriodRange,
  invoiceTotal, invoiceXmlState, filterInvoiceRows, setInvoiceStatus,
  type InvoicePeriod, type InvoiceStatusFilter, type InvoiceStockFilter, type InvoiceXmlFilter,
} from '@/core/domain/invoices'
import { draftImportFromInvoice, gdtHtmlForInvoice, loadInvoiceXmlPreview } from '@/core/domain/invoicePreview'
import { invoiceSyncCaption, useInvoicePageSync } from '@/core/sync/invoicePageSync'
import { useInvoiceLinkHealth } from '@/core/sync/invoiceLink'
import { ConfirmDialog, Sheet } from '@/shared/components'
import { InvoiceGdtPreview } from '@/shared/InvoiceGdtPreview'
import { InvoiceLinkBanner } from '@/shared/InvoiceLinkBanner'
import { WebEmpty } from '@/web/components/WebEmpty'
import { WebDateRange } from '@/web/components/WebDateRange'
import type { InvoiceRecord } from '@/core/types'
import type { ParsedInvoice } from '@/core/domain/invoiceImport'

type PreviewState = { inv: InvoiceRecord; xml: string; parsed: ParsedInvoice | null; html: string }

export function WebInvoicesPage() {
  const navigate = useNavigate()
  const showToast = useApp((s) => s.showToast)
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState<InvoicePeriod>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState<InvoiceStatusFilter>('all')
  const [stock, setStock] = useState<InvoiceStockFilter>('all')
  const [xml, setXml] = useState<InvoiceXmlFilter>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [delTarget, setDelTarget] = useState<InvoiceRecord | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [form, setForm] = useState({ code: '', sellerName: '', nbmst: '', amount: 0, tax: 0, date: today(), saleId: '' })

  const sync = useInvoicePageSync()
  const link = useInvoiceLinkHealth()
  const invoices = useLiveQuery(() => dbx.invoices.filter((i) => !i.deleted).toArray(), [], [] as InvoiceRecord[])
  const range = useMemo(() => invoicePeriodRange(period, from, to), [period, from, to])
  const rows = useMemo(
    () => filterInvoiceRows(invoices, { query, from: range.from, to: range.to, status, stock, xml }),
    [invoices, query, range, status, stock, xml],
  )
  const totalSum = rows.filter((i) => i.status !== 'cancelled').reduce((a, i) => a + invoiceTotal(i), 0)

  async function openPreview(inv: InvoiceRecord) {
    const extra = invoiceExtra(inv)
    if (extra.hasXml) {
      try {
        const p = await loadInvoiceXmlPreview(inv)
        setPreview({ inv, ...p })
        return
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Không tải được XML', 'bad')
      }
    }
    setPreview({ inv, xml: '', parsed: null, html: gdtHtmlForInvoice(inv) })
  }

  async function handleAdd() {
    if (!form.code.trim()) { showToast('Nhập số/ký hiệu hóa đơn', 'bad'); return }
    try {
      await createInvoice({
        code: form.code.trim(),
        type: 'gdt',
        amount: form.amount,
        tax: form.tax,
        date: form.date,
        status: 'issued',
        data: { sellerName: form.sellerName.trim(), nbmst: form.nbmst.trim() },
        saleId: form.saleId.trim() || undefined,
      })
      showToast('✓ Đã thêm hóa đơn', 'ok')
      setShowAdd(false)
      setForm({ code: '', sellerName: '', nbmst: '', amount: 0, tax: 0, date: today(), saleId: '' })
    } catch (e) {
      logError(e, 'invoice.add')
      showToast('Lỗi khi thêm', 'bad')
    }
  }

  return (
    <div className="web-page">
      <div className="web-ph">
        <div>
          <div className="web-eyebrow">Giao dịch</div>
          <h2>Hóa đơn điện tử</h2>
          <p>{rows.length} / {invoices.length} HĐ · {fmt(totalSum)}</p>
          <p className="web-sub">{invoiceSyncCaption(sync)}</p>
        </div>
        <button className="web-btn pri" onClick={() => setShowAdd(true)}>+ Thêm HĐ</button>
      </div>

      <InvoiceLinkBanner health={link} />

      <div className="web-orders-filters">
        <div className="web-chips" style={{ marginBottom: 0 }}>
          {([['all', 'Tất cả ngày'], ['month', 'Tháng này'], ['lastMonth', 'Tháng trước']] as [InvoicePeriod, string][]).map(([v, l]) => (
            <button key={v} type="button" className={`web-chip ${period === v ? 'on' : ''}`} onClick={() => { setPeriod(v); setFrom(''); setTo('') }}>{l}</button>
          ))}
          {([['all', 'Mọi trạng thái'], ['issued', 'Đã phát hành'], ['cancelled', 'Đã hủy']] as [InvoiceStatusFilter, string][]).map(([v, l]) => (
            <button key={v} type="button" className={`web-chip ${status === v ? 'on' : ''}`} onClick={() => setStatus(v)}>{l}</button>
          ))}
          {([['all', 'Kho: tất cả'], ['open', 'Chưa nhập kho'], ['received', 'Đã nhập kho']] as [InvoiceStockFilter, string][]).map(([v, l]) => (
            <button key={v} type="button" className={`web-chip ${stock === v ? 'on' : ''}`} onClick={() => setStock(v)}>{l}</button>
          ))}
          {([['all', 'XML: tất cả'], ['yes', 'Có XML'], ['no', 'Chưa XML']] as [InvoiceXmlFilter, string][]).map(([v, l]) => (
            <button key={v} type="button" className={`web-chip ${xml === v ? 'on' : ''}`} onClick={() => setXml(v)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="web-order-bar">
        <div className="web-find" style={{ flex: 1, marginBottom: 0 }}>
          <Search size={16} strokeWidth={1.8} />
          <input
            className="web-search"
            placeholder="Tìm số HĐ, người bán, MST…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <WebDateRange
          from={from}
          to={to}
          active={period === 'custom'}
          onChange={(a, b) => { setFrom(a); setTo(b); setPeriod(a || b ? 'custom' : 'all') }}
        />
      </div>

      {rows.length === 0 ? (
        <WebEmpty
          title={invoices.length === 0 ? 'Chưa có hóa đơn đã quét' : 'Không có hóa đơn khớp lọc'}
          sub="Máy 3SU Invoice quét xong sẽ hiện hết ở đây. Có thể thêm sổ tay nếu cần."
        >
          <button className="web-btn pri" onClick={() => setShowAdd(true)}>+ Thêm HĐ</button>
        </WebEmpty>
      ) : (
        <div className="web-table-wrap">
          <table className="web-table">
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Số / ký hiệu</th>
                <th>Người bán</th>
                <th>Tổng</th>
                <th>XML</th>
                <th>Trạng thái</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => {
                const extra = invoiceExtra(inv)
                return (
                  <tr key={inv.id} className="static">
                    <td>{inv.date || '—'}</td>
                    <td>{inv.code}{inv.saleId ? <div className="web-sub">Đơn {inv.saleId.slice(-6)}</div> : null}</td>
                    <td>
                      {extra.sellerName || '—'}
                      {extra.nbmst ? <div className="web-sub">{extra.nbmst}</div> : null}
                      {extra.source === 'desktop' ? <div className="web-sub">từ máy tính</div> : null}
                      {extra.receiptId ? <div className="web-sub">Đã nhập kho</div> : null}
                    </td>
                    <td>{fmt(invoiceTotal(inv))}</td>
                    <td>{invoiceXmlState(inv)}</td>
                    <td>
                      <span className={`web-badge ${inv.status === 'issued' ? 'ok' : inv.status === 'cancelled' ? 'out' : 'low'}`}>
                        {INVOICE_STATUS_LABEL[inv.status]}
                      </span>
                    </td>
                    <td>
                      <button className="web-btn" style={{ height: 28 }} onClick={() => void openPreview(inv)}>Xem</button>
                      {' '}
                      <button
                        className="web-btn"
                        style={{ height: 28 }}
                        onClick={() => void setInvoiceStatus(inv.id, inv.status === 'issued' ? 'cancelled' : 'issued')}
                      >
                        {inv.status === 'issued' ? 'Hủy HĐ' : 'Phát hành'}
                      </button>
                      {' '}
                      <button className="web-btn" style={{ height: 28 }} onClick={() => setDelTarget(inv)}>Xóa</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={showAdd} onClose={() => setShowAdd(false)} title="Thêm hóa đơn">
        <div className="flex flex-col gap-2">
          <input className="web-input" placeholder="Số / ký hiệu *" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <input className="web-input" placeholder="Người bán" value={form.sellerName} onChange={(e) => setForm({ ...form, sellerName: e.target.value })} />
          <input className="web-input" placeholder="MST người bán" value={form.nbmst} onChange={(e) => setForm({ ...form, nbmst: e.target.value })} />
          <input className="web-input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <input className="web-input" type="number" placeholder="Tiền hàng" value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) || 0 })} />
          <input className="web-input" type="number" placeholder="Thuế" value={form.tax || ''} onChange={(e) => setForm({ ...form, tax: Number(e.target.value) || 0 })} />
          <input className="web-input" placeholder="Mã đơn bán (tuỳ chọn)" value={form.saleId} onChange={(e) => setForm({ ...form, saleId: e.target.value })} />
          <button className="web-btn pri" onClick={handleAdd}>Lưu</button>
        </div>
      </Sheet>

      <InvoiceGdtPreview
        open={!!preview}
        title={preview ? `Hóa đơn ${preview.inv.code}` : 'Hóa đơn'}
        html={preview?.html || ''}
        xml={preview?.xml || ''}
        xmlMissing={!!preview && !preview.xml}
        onClose={() => setPreview(null)}
        onImport={preview?.parsed ? () => {
          void draftImportFromInvoice(preview.inv, preview.parsed!)
            .then(() => { setPreview(null); navigate('/nhap-hang/hoa-don') })
            .catch((e) => showToast(e instanceof Error ? e.message : 'Không tạo được phiếu', 'bad'))
        } : undefined}
        onPrintBlocked={() => showToast('Trình duyệt chặn cửa sổ in', 'bad')}
      />

      <ConfirmDialog
        open={!!delTarget}
        title="Xóa hóa đơn?"
        message={`Xóa ${delTarget?.code}?`}
        confirmLabel="Xóa"
        danger
        onConfirm={async () => {
          if (!delTarget) return
          try {
            await deleteInvoice(delTarget.id)
            showToast('Đã xóa hóa đơn', 'ok')
          } catch (e) {
            logError(e, 'invoice.delete')
            showToast('Lỗi khi xóa', 'bad')
          } finally {
            setDelTarget(null)
          }
        }}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  )
}
