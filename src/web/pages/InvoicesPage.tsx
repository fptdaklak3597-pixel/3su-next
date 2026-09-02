/**
 * Hóa đơn điện tử — danh sách cho người bán: tìm, lọc, bấm xem tờ GDT.
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
  createInvoice, deleteInvoice,
  invoiceDisplayCode, invoiceExtra, invoiceListStatus, invoicePeriodRange, invoiceTotal, filterInvoiceRows,
  type InvoicePeriod, type InvoiceStatusFilter, type InvoiceStockFilter,
} from '@/core/domain/invoices'
import { draftImportFromInvoice, gdtHtmlForInvoice, loadInvoicePreview } from '@/core/domain/invoicePreview'
import { invoiceSyncCaption, useInvoicePageSync } from '@/core/sync/invoicePageSync'
import { invoiceLinkShortText, useInvoiceLinkHealth } from '@/core/sync/invoiceLink'
import { paginate } from '@/web/lib/listFilters'
import { ConfirmDialog, Sheet } from '@/shared/components'
import { InvoiceGdtPreview } from '@/shared/InvoiceGdtPreview'
import { WebDateRange } from '@/web/components/WebDateRange'
import type { InvoiceRecord } from '@/core/types'
import type { ParsedInvoice } from '@/core/domain/invoiceImport'

type PreviewState = {
  inv: InvoiceRecord
  xml: string
  parsed: ParsedInvoice | null
  printHtml: string
  gdtHtml: string
}

export function WebInvoicesPage() {
  const navigate = useNavigate()
  const showToast = useApp((s) => s.showToast)
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState<InvoicePeriod>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState<InvoiceStatusFilter>('all')
  const [stock, setStock] = useState<InvoiceStockFilter>('all')
  const [page, setPage] = useState(1)
  const [showAdd, setShowAdd] = useState(false)
  const [delTarget, setDelTarget] = useState<InvoiceRecord | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [form, setForm] = useState({ code: '', sellerName: '', nbmst: '', amount: 0, tax: 0, date: today(), saleId: '' })

  const sync = useInvoicePageSync()
  const link = useInvoiceLinkHealth()
  const invoices = useLiveQuery(() => dbx.invoices.filter((i) => !i.deleted).toArray(), [], [] as InvoiceRecord[])
  const range = useMemo(() => invoicePeriodRange(period, from, to), [period, from, to])
  const filtered = useMemo(
    () => filterInvoiceRows(invoices, { query, from: range.from, to: range.to, status, stock }),
    [invoices, query, range, status, stock],
  )
  const { rows, pages } = paginate(filtered, page, 20)
  const totalSum = filtered.filter((i) => i.status !== 'cancelled').reduce((a, i) => a + invoiceTotal(i), 0)

  function resetPage() { setPage(1) }

  async function openPreview(inv: InvoiceRecord) {
    setOpeningId(inv.id)
    try {
      const p = await loadInvoicePreview(inv)
      setPreview({
        inv,
        xml: p.xml,
        parsed: p.parsed,
        printHtml: p.printHtml,
        gdtHtml: p.gdtHtml,
      })
    } catch (e) {
      setPreview({
        inv,
        xml: '',
        parsed: null,
        printHtml: gdtHtmlForInvoice(inv),
        gdtHtml: '',
      })
      showToast(e instanceof Error ? e.message : 'Không tải được tờ hóa đơn', 'bad')
    } finally {
      setOpeningId(null)
    }
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

  const linkShort = link && link.kind !== 'ok' ? invoiceLinkShortText(link) : ''

  return (
    <div className="web-page">
      <div className="web-list-hdr">
        <div>
          <div className="web-eyebrow">Giao dịch</div>
          <h1 className="web-list-title">Hóa đơn điện tử</h1>
          <div className="web-list-sub">
            <strong>{filtered.length}</strong> hóa đơn · tổng <strong>{fmt(totalSum)}</strong>
            {linkShort ? (
              <>
                <span className="web-list-sub-sep" />
                <button type="button" className="web-list-sub-link" onClick={() => navigate(link?.to || '/thiet-bi')}>
                  {linkShort}
                </button>
              </>
            ) : (
              <>
                <span className="web-list-sub-sep" />
                <span>{invoiceSyncCaption(sync)}</span>
              </>
            )}
          </div>
        </div>
        <div className="web-list-hdr-actions">
          <button className="web-btn" onClick={() => setShowAdd(true)}>Thêm sổ tay</button>
        </div>
      </div>

      <div className="web-orders-filters">
        <div className="web-chips" style={{ marginBottom: 0 }}>
          {([['all', 'Mọi ngày'], ['month', 'Tháng này'], ['lastMonth', 'Tháng trước']] as [InvoicePeriod, string][]).map(([v, l]) => (
            <button
              key={v}
              type="button"
              className={`web-chip ${period === v ? 'on' : ''}`}
              onClick={() => { setPeriod(v); setFrom(''); setTo(''); resetPage() }}
            >
              {l}
            </button>
          ))}
          {([['all', 'Mọi HĐ'], ['issued', 'Phát hành'], ['cancelled', 'Đã hủy']] as [InvoiceStatusFilter, string][]).map(([v, l]) => (
            <button key={`st-${v}`} type="button" className={`web-chip ${status === v ? 'on' : ''}`} onClick={() => { setStatus(v); resetPage() }}>{l}</button>
          ))}
          {([['all', 'Mọi kho'], ['open', 'Chưa nhập'], ['received', 'Đã nhập']] as [InvoiceStockFilter, string][]).map(([v, l]) => (
            <button key={`kho-${v}`} type="button" className={`web-chip ${stock === v ? 'on' : ''}`} onClick={() => { setStock(v); resetPage() }}>{l}</button>
          ))}
        </div>
      </div>

      <div className="web-order-bar web-inv-bar">
        <div className="web-find" style={{ flex: 1, marginBottom: 0 }}>
          <Search size={16} strokeWidth={1.8} />
          <input
            className="web-search"
            placeholder="Tìm số HĐ, người bán, MST…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); resetPage() }}
          />
        </div>
        <WebDateRange
          from={from}
          to={to}
          active={period === 'custom'}
          onChange={(a, b) => { setFrom(a); setTo(b); setPeriod(a || b ? 'custom' : 'all'); resetPage() }}
        />
      </div>

      <div className="web-table-wrap">
        <table className="web-table">
          <thead>
            <tr>
              <th>Ngày</th>
              <th>Số hóa đơn</th>
              <th>Người bán</th>
              <th className="num">Tổng</th>
              <th>Tình trạng</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((inv) => {
              const extra = invoiceExtra(inv)
              const st = invoiceListStatus(inv)
              return (
                <tr key={inv.id} onClick={() => void openPreview(inv)}>
                  <td>{inv.date || '—'}</td>
                  <td>
                    {invoiceDisplayCode(inv)}
                    {openingId === inv.id ? <div className="web-sub" style={{ margin: 0 }}>Đang mở…</div> : null}
                  </td>
                  <td>
                    {extra.sellerName || '—'}
                    {extra.nbmst ? <div className="web-sub" style={{ margin: 0 }}>{extra.nbmst}</div> : null}
                  </td>
                  <td className="num">{fmt(invoiceTotal(inv))}</td>
                  <td>
                    <span className={`web-badge ${st.tone}`}>{st.label}</span>
                  </td>
                  <td className="inv-actions">
                    <button
                      className="web-btn"
                      style={{ height: 28 }}
                      onClick={(e) => { e.stopPropagation(); setDelTarget(inv) }}
                    >
                      Xóa
                    </button>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="web-table-empty">
                  {invoices.length === 0
                    ? 'Chưa có hóa đơn. Máy 3SU Invoice quét xong sẽ hiện ở đây.'
                    : 'Không khớp bộ lọc'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="web-foot">
          <span>Trang {page}/{pages}</span>
          <span>
            <button className="web-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trước</button>
            {' '}
            <button className="web-btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Sau</button>
          </span>
        </div>
      )}

      <Sheet open={showAdd} onClose={() => setShowAdd(false)} title="Thêm hóa đơn sổ tay">
        <div className="flex flex-col gap-2">
          <input className="web-input" placeholder="Số / ký hiệu *" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <input className="web-input" placeholder="Người bán" value={form.sellerName} onChange={(e) => setForm({ ...form, sellerName: e.target.value })} />
          <input className="web-input" placeholder="MST người bán" value={form.nbmst} onChange={(e) => setForm({ ...form, nbmst: e.target.value })} />
          <input className="web-input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <input className="web-input" type="number" placeholder="Tiền hàng" value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) || 0 })} />
          <input className="web-input" type="number" placeholder="Thuế" value={form.tax || ''} onChange={(e) => setForm({ ...form, tax: Number(e.target.value) || 0 })} />
          <button className="web-btn pri" onClick={handleAdd}>Lưu</button>
        </div>
      </Sheet>

      <InvoiceGdtPreview
        open={!!preview}
        inv={preview?.inv || null}
        printHtml={preview?.printHtml || ''}
        gdtHtml={preview?.gdtHtml || ''}
        xml={preview?.xml || ''}
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
        message={`Xóa ${delTarget?.code}? Chỉ xóa trên 3SU, không hủy trên trang thuế.`}
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
