/**
 * 3SU Next — Hoá đơn điện tử (GDT)
 * Danh sách hoá đơn, xem tờ GDT, lọc, cảnh báo máy Invoice.
 */
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmt, fmtShort, today } from '@/core/format'
import { logError } from '@/core/errorLogger'
import {
  createInvoice, deleteInvoice,
  invoiceTotal, INVOICE_STATUS_LABEL, invoiceExtra, invoiceXmlState,
  filterInvoiceRows, invoicePeriodRange,
  type InvoicePeriod, type InvoiceStatusFilter, type InvoiceStockFilter,
} from '@/core/domain/invoices'
import { invoiceSyncCaption, useInvoicePageSync } from '@/core/sync/invoicePageSync'
import { useInvoiceLinkHealth } from '@/core/sync/invoiceLink'
import { draftImportFromInvoice, gdtHtmlForInvoice, loadInvoiceXmlPreview } from '@/core/domain/invoicePreview'
import type { ParsedInvoice } from '@/core/domain/invoiceImport'
import { Sheet, ConfirmDialog, EmptyState } from '@/shared/components'
import { InvoiceGdtPreview } from '@/shared/InvoiceGdtPreview'
import { InvoiceLinkBanner } from '@/shared/InvoiceLinkBanner'
import { ChevronLeft, Plus, Search, Trash2, FileText } from 'lucide-react'
import type { InvoiceRecord } from '@/core/types'

const STATUS_COLOR: Record<InvoiceRecord['status'], string> = {
  draft: 'var(--mute)',
  issued: 'var(--up)',
  cancelled: 'var(--down)',
}

type PreviewState = { inv: InvoiceRecord; xml: string; parsed: ParsedInvoice | null; html: string }

export function InvoicesPage() {
  const navigate = useNavigate()
  const showToast = useApp((s) => s.showToast)
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState<InvoicePeriod>('all')
  const [status, setStatus] = useState<InvoiceStatusFilter>('all')
  const [stock, setStock] = useState<InvoiceStockFilter>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [delTarget, setDelTarget] = useState<InvoiceRecord | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [form, setForm] = useState({ code: '', sellerName: '', nbmst: '', amount: 0, tax: 0, date: today(), saleId: '' })

  const sync = useInvoicePageSync()
  const link = useInvoiceLinkHealth()
  const invoices = useLiveQuery(() => dbx.invoices.filter((i) => !i.deleted).toArray(), [], [] as InvoiceRecord[])
  const range = useMemo(() => invoicePeriodRange(period, '', ''), [period])
  const rows = useMemo(
    () => filterInvoiceRows(invoices, { query, from: range.from, to: range.to, status, stock }),
    [invoices, query, range, status, stock],
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

  async function handleDelete() {
    if (!delTarget) return
    try {
      await deleteInvoice(delTarget.id)
      showToast('Đã xóa hóa đơn', 'ok')
      setDelTarget(null)
    } catch (e) {
      logError(e, 'invoice.delete')
      showToast('Lỗi khi xóa', 'bad')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header className="app-hdr bordered">
        <button className="btn-back" onClick={() => navigate('/them')}>
          <ChevronLeft size={20} />
        </button>
        <div className="flex-1 text-center">
          <div className="font-brand text-[17px] font-medium" style={{ color: 'var(--ink)' }}>Hóa đơn điện tử</div>
          <div className="text-[11px]" style={{ color: 'var(--mute)' }}>{rows.length} / {invoices.length} hóa đơn · {fmtShort(totalSum)}đ</div>
          <div className="text-[10px]" style={{ color: 'var(--mute-2)' }}>{invoiceSyncCaption(sync)}</div>
        </div>
        <button className="btn-back" onClick={() => setShowAdd(true)} aria-label="Thêm hóa đơn">
          <Plus size={18} />
        </button>
      </header>

      <div className="px-4 pt-3 pb-2">
        <InvoiceLinkBanner health={link} />
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--mute-2)' }} />
          <input className="field-input pl-9 text-sm" placeholder="Tìm số HĐ, người bán, MST…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {([['all', 'Mọi ngày'], ['month', 'Tháng này'], ['lastMonth', 'Tháng trước']] as [InvoicePeriod, string][]).map(([v, l]) => (
            <button key={v} type="button" className={`chip ${period === v ? 'active' : ''}`} onClick={() => setPeriod(v)}>{l}</button>
          ))}
          {([['all', 'Mọi TT'], ['issued', 'Phát hành'], ['cancelled', 'Đã hủy']] as [InvoiceStatusFilter, string][]).map(([v, l]) => (
            <button key={v} type="button" className={`chip ${status === v ? 'active' : ''}`} onClick={() => setStatus(v)}>{l}</button>
          ))}
          {([['all', 'Kho: hết'], ['open', 'Chưa nhập'], ['received', 'Đã nhập']] as [InvoiceStockFilter, string][]).map(([v, l]) => (
            <button key={v} type="button" className={`chip ${stock === v ? 'active' : ''}`} onClick={() => setStock(v)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {rows.map((inv) => {
          const extra = invoiceExtra(inv)
          return (
            <div key={inv.id} className="list-row">
              <button className="flex-1 min-w-0 text-left flex items-center gap-3" onClick={() => void openPreview(inv)}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'var(--paper-2)', color: 'var(--gold)' }}>
                  <FileText size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{inv.code}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ color: STATUS_COLOR[inv.status], background: 'var(--paper-2)' }}>
                      {INVOICE_STATUS_LABEL[inv.status]}
                    </span>
                  </div>
                  <div className="text-[11px] truncate" style={{ color: 'var(--mute)' }}>
                    {inv.date || '—'} · {extra.sellerName || '—'}{extra.nbmst ? ` · ${extra.nbmst}` : ''}
                    {extra.source === 'desktop' ? ' · từ máy tính' : ''}
                    {extra.receiptId ? ' · Đã nhập kho' : ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{fmt(invoiceTotal(inv))}</div>
                  <div className="text-[10px]" style={{ color: 'var(--mute)' }}>XML {invoiceXmlState(inv)}</div>
                </div>
              </button>
              <button className="ml-2 p-1.5" onClick={() => setDelTarget(inv)} aria-label="Xóa" style={{ color: 'var(--mute-2)' }}>
                <Trash2 size={15} />
              </button>
            </div>
          )
        })}
        {rows.length === 0 && (
          <EmptyState
            icon="🧾"
            title={invoices.length === 0 ? 'Chưa có hóa đơn đã quét' : 'Không có hóa đơn khớp lọc'}
            sub="Máy 3SU Invoice quét xong sẽ hiện hết ở đây"
          />
        )}
      </div>

      <Sheet open={showAdd} onClose={() => setShowAdd(false)} title="Thêm hóa đơn sổ tay">
        <div className="flex flex-col gap-3">
          <input className="field-input" placeholder="Số / ký hiệu hóa đơn *" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <input className="field-input" placeholder="Tên người bán" value={form.sellerName} onChange={(e) => setForm({ ...form, sellerName: e.target.value })} />
          <input className="field-input" placeholder="Mã số thuế người bán" value={form.nbmst} onChange={(e) => setForm({ ...form, nbmst: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs" style={{ color: 'var(--mute)' }}>Tiền hàng</span>
              <input className="field-input" type="number" inputMode="numeric" value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) || 0 })} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs" style={{ color: 'var(--mute)' }}>Thuế GTGT</span>
              <input className="field-input" type="number" inputMode="numeric" value={form.tax || ''} onChange={(e) => setForm({ ...form, tax: Number(e.target.value) || 0 })} />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs" style={{ color: 'var(--mute)' }}>Ngày hóa đơn</span>
            <input className="field-input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </label>
          <input className="field-input" placeholder="Mã đơn bán (tuỳ chọn)" value={form.saleId} onChange={(e) => setForm({ ...form, saleId: e.target.value })} />
          <div className="text-sm text-right" style={{ color: 'var(--mute)' }}>
            Tổng: <b style={{ color: 'var(--ink)' }}>{fmt(form.amount + form.tax)}</b>
          </div>
          <button className="btn-cta" onClick={handleAdd}>Thêm hóa đơn</button>
        </div>
      </Sheet>

      <InvoiceGdtPreview
        open={!!preview}
        title={preview ? preview.inv.code : 'Hóa đơn'}
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
        message={`Xóa hóa đơn ${delTarget?.code}? Hành động này không thể hoàn tác.`}
        confirmLabel="Xóa"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  )
}
