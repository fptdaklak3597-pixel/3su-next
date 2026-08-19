/**
 * 3SU Next — Hoá đơn điện tử (GDT)
 * Port từ 25-invoices-gdt.js: danh sách hoá đơn, tạo, phát hành, hủy.
 */
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmt, fmtShort, today, matchesSearch } from '@/core/format'
import { logError } from '@/core/errorLogger'
import {
  createInvoice, setInvoiceStatus, deleteInvoice,
  invoiceTotal, INVOICE_STATUS_LABEL,
} from '@/core/domain/invoices'
import { Sheet, ConfirmDialog, EmptyState } from '@/shared/components'
import { ChevronLeft, Plus, Search, Trash2, FileText } from 'lucide-react'
import type { InvoiceRecord } from '@/core/types'

const STATUS_COLOR: Record<InvoiceRecord['status'], string> = {
  draft: 'var(--mute)',
  issued: 'var(--up)',
  cancelled: 'var(--down)',
}

export function InvoicesPage() {
  const navigate = useNavigate()
  const showToast = useApp((s) => s.showToast)
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [delTarget, setDelTarget] = useState<InvoiceRecord | null>(null)
  const [form, setForm] = useState({ code: '', sellerName: '', nbmst: '', amount: 0, tax: 0, date: today(), saleId: '' })

  const invoices = useLiveQuery(() => dbx.invoices.filter((i) => !i.deleted).toArray(), [], [] as InvoiceRecord[])

  const rows = useMemo(() => {
    return invoices
      .filter((i) => matchesSearch(i.code + ' ' + String((i.data as { sellerName?: string }).sellerName ?? ''), query))
      .sort((a, b) => b.ts - a.ts)
  }, [invoices, query])

  const totalSum = invoices.filter((i) => i.status !== 'cancelled').reduce((a, i) => a + invoiceTotal(i), 0)

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

  async function toggleStatus(inv: InvoiceRecord) {
    const next = inv.status === 'issued' ? 'cancelled' : 'issued'
    try {
      await setInvoiceStatus(inv.id, next)
      showToast(next === 'issued' ? '✓ Đã phát hành' : 'Đã hủy hóa đơn', 'ok')
    } catch (e) {
      logError(e, 'invoice.status')
      showToast('Lỗi', 'bad')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header className="app-hdr bordered">
        <button className="btn-back" onClick={() => navigate('/them')}>
          <ChevronLeft size={20} />
        </button>
        <div className="flex-1 text-center">
          <div className="font-brand text-[17px] font-medium" style={{ color: 'var(--ink)' }}>Sổ hóa đơn</div>
          <div className="text-[11px]" style={{ color: 'var(--mute)' }}>{invoices.length} hóa đơn · {fmtShort(totalSum)}đ</div>
        </div>
        <button className="btn-back" onClick={() => setShowAdd(true)} aria-label="Thêm hóa đơn">
          <Plus size={18} />
        </button>
      </header>

      <div className="px-4 pt-3 pb-2">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--mute-2)' }} />
          <input className="field-input pl-9 text-sm" placeholder="Tìm số hóa đơn, người bán…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {rows.map((inv) => {
          const data = inv.data as { sellerName?: string; nbmst?: string }
          return (
            <div key={inv.id} className="list-row">
              <button className="flex-1 min-w-0 text-left flex items-center gap-3" onClick={() => toggleStatus(inv)}>
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
                    {data.sellerName || '—'} {data.nbmst ? `· MST ${data.nbmst}` : ''} · {inv.date}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{fmt(invoiceTotal(inv))}</div>
                  {inv.tax > 0 && <div className="text-[10px]" style={{ color: 'var(--mute)' }}>thuế {fmtShort(inv.tax)}đ</div>}
                </div>
              </button>
              <button className="ml-2 p-1.5" onClick={() => setDelTarget(inv)} aria-label="Xóa" style={{ color: 'var(--mute-2)' }}>
                <Trash2 size={15} />
              </button>
            </div>
          )
        })}
        {rows.length === 0 && <EmptyState icon="🧾" title="Chưa có hóa đơn" sub="Bấm + để ghi sổ tay — không nối cổng thuế" />}
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
