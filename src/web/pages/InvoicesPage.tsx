/**
 * Hóa đơn điện tử web — danh sách + thêm + hủy.
 */
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmt, matchesSearch, today } from '@/core/format'
import { logError } from '@/core/errorLogger'
import { createInvoice, deleteInvoice, INVOICE_STATUS_LABEL, invoiceTotal, setInvoiceStatus } from '@/core/domain/invoices'
import { ConfirmDialog, Sheet } from '@/shared/components'
import { WebEmpty } from '@/web/components/WebEmpty'
import type { InvoiceRecord } from '@/core/types'

export function WebInvoicesPage() {
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

  return (
    <div className="web-page">
      <div className="web-ph">
        <div>
          <h2>Sổ hóa đơn</h2>
          <p>{invoices.length} HĐ · {fmt(totalSum)}</p>
        </div>
        <button className="web-btn pri" onClick={() => setShowAdd(true)}>+ Thêm HĐ</button>
      </div>

      <input className="web-search mb-3" style={{ paddingLeft: 12 }} placeholder="Tìm số HĐ / người bán…" value={query} onChange={(e) => setQuery(e.target.value)} />

      {rows.length === 0 ? (
        <WebEmpty title="Chưa có hóa đơn" sub="Ghi HĐĐT đã phát hành hoặc nhập từ file ở Nhập hàng.">
          <button className="web-btn pri" onClick={() => setShowAdd(true)}>+ Thêm HĐ</button>
        </WebEmpty>
      ) : (
        <div className="web-table-wrap">
          <table className="web-table">
            <thead>
              <tr>
                <th>Số / ký hiệu</th>
                <th>Người bán</th>
                <th>Ngày</th>
                <th>Tổng</th>
                <th>Trạng thái</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => {
                const seller = String((inv.data as { sellerName?: string }).sellerName ?? '')
                return (
                  <tr key={inv.id} className="static">
                    <td>{inv.code}{inv.saleId ? <div className="web-sub">Đơn {inv.saleId.slice(-6)}</div> : null}</td>
                    <td>{seller || '—'}</td>
                    <td>{inv.date}</td>
                    <td>{fmt(invoiceTotal(inv))}</td>
                    <td>
                      <span className={`web-badge ${inv.status === 'issued' ? 'ok' : inv.status === 'cancelled' ? 'out' : 'low'}`}>
                        {INVOICE_STATUS_LABEL[inv.status]}
                      </span>
                    </td>
                    <td>
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
