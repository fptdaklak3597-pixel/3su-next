/**
 * 3SU Next — Khách hàng & Công nợ
 * Port từ 15a-customers.js: CRUD, debt tracking, payment history.
 */
import { useState, useMemo, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmt, matchesSearch } from '@/core/format'
import { logError } from '@/core/errorLogger'
import { createConfirmGate } from '@/core/confirmGate'
import { addCustomer, deleteCustomer, payDebt, updateCustomer } from '@/core/domain/customers'
import { exportCustomerDebtXlsx } from '@/core/domain/reports'
import { payQrSrc } from '@/core/domain/vietqr'
import { ConfirmDialog, Sheet } from '@/shared/components'
import { Search, Plus, Trash2 } from 'lucide-react'
import type { Customer } from '@/core/types'

export function CustomersPage() {
  const showToast = useApp((s) => s.showToast)
  const settings = useApp((s) => s.settings)
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editFor, setEditFor] = useState<Customer | null>(null)
  const [payFor, setPayFor] = useState<Customer | null>(null)
  const [delTarget, setDelTarget] = useState<Customer | null>(null)
  const [form, setForm] = useState({ name: '', phone: '', note: '', wholesale: false })
  const [editForm, setEditForm] = useState({ name: '', phone: '', note: '', wholesale: false })
  const [payAmount, setPayAmount] = useState(0)
  const [processing, setProcessing] = useState(false)
  const confirmGate = useRef(createConfirmGate())

  const customers = useLiveQuery(
    () => dbx.customers.filter((c) => !c.deleted).toArray(),
    [],
    [] as Customer[],
  )

  const filtered = useMemo(() => {
    return customers
      .filter((c) => matchesSearch(c.name + ' ' + c.phone, query))
      .sort((a, b) => b.debt - a.debt || b.totalSpent - a.totalSpent)
  }, [customers, query])

  const totalDebt = customers.reduce((a, c) => a + Math.max(0, c.debt), 0)

  async function handleAdd() {
    if (!form.name.trim()) { showToast('Nhập tên khách', 'bad'); return }
    try {
      await addCustomer({ name: form.name.trim(), phone: form.phone.trim(), note: form.note.trim(), wholesale: form.wholesale })
      showToast('✓ Đã thêm khách hàng', 'ok')
      setShowAdd(false)
      setForm({ name: '', phone: '', note: '', wholesale: false })
    } catch (e) {
      logError(e, 'customer.add')
      showToast('Lỗi khi thêm', 'bad')
    }
  }

  async function handleEdit() {
    if (!editFor || !editForm.name.trim()) { showToast('Nhập tên khách', 'bad'); return }
    try {
      await updateCustomer(editFor.id, {
        name: editForm.name.trim(),
        phone: editForm.phone.trim(),
        note: editForm.note.trim(),
        wholesale: editForm.wholesale,
      })
      showToast('✓ Đã lưu khách', 'ok')
      setEditFor(null)
    } catch (e) {
      logError(e, 'customer.edit')
      showToast(e instanceof Error ? e.message : 'Lỗi khi sửa', 'bad')
    }
  }

  async function handleDelete() {
    if (!delTarget) return
    try {
      await deleteCustomer(delTarget.id)
      showToast('Đã xóa khách', 'ok')
      setDelTarget(null)
    } catch (e) {
      logError(e, 'customer.delete')
      showToast(e instanceof Error ? e.message : 'Lỗi khi xóa', 'bad')
    }
  }

  async function handlePay() {
    if (!payFor || payAmount <= 0) return
    if (!confirmGate.current.tryEnter()) return
    setProcessing(true)
    try {
      const applied = await payDebt(payFor.id, payAmount)
      showToast(`✓ Đã thu ${fmt(applied)}`, 'ok')
      setPayFor(null)
      setPayAmount(0)
    } catch (e) {
      logError(e, 'customer.pay')
      showToast(e instanceof Error ? e.message : 'Lỗi khi thu tiền', 'bad')
    } finally {
      setProcessing(false)
      confirmGate.current.leave()
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header className="app-hdr bordered">
        <div>
          <div className="font-brand text-[17px] font-medium" style={{ color: 'var(--ink)' }}>Khách hàng</div>
          <div className="text-xs" style={{ color: 'var(--mute)' }}>
            {customers.length} khách · nợ {fmt(totalDebt)}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost text-sm" onClick={() => { try { void exportCustomerDebtXlsx(customers) } catch (e) { logError(e, 'debt.xlsx') } }}>Excel</button>
          <button className="btn-back" onClick={() => setShowAdd(true)} aria-label="Thêm khách">
            <Plus size={18} />
          </button>
        </div>
      </header>

      <div className="px-4 pt-3 pb-2">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--mute-2)' }} />
          <input className="field-input pl-9 text-sm" placeholder="Tìm khách hàng…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {filtered.map((c) => (
          <div key={c.id} className="list-row">
            <button className="flex-1 min-w-0 text-left flex items-center gap-3" onClick={() => c.debt > 0 && setPayFor(c)}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-brand font-medium"
                style={{ background: 'var(--paper-2)', color: 'var(--ink-2)' }}>
                {c.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>
                  {c.name}
                  {c.wholesale ? <span className="text-[10px] ml-1 px-1.5 py-0.5 rounded" style={{ background: 'var(--paper)', color: 'var(--mute)' }}>Sỉ</span> : null}
                </div>
                <div className="text-[11px]" style={{ color: 'var(--mute)' }}>
                  {c.phone || '—'} · {c.orderCount} đơn
                </div>
              </div>
              <div className="text-right">
                {c.debt > 0 ? (
                  <span className="text-sm font-medium" style={{ color: 'var(--down)' }}>{fmt(c.debt)}</span>
                ) : c.debt < 0 ? (
                  <span className="text-sm font-medium" style={{ color: 'var(--up)' }}>dư {fmt(-c.debt)}</span>
                ) : (
                  <span className="text-xs" style={{ color: 'var(--mute-2)' }}>—</span>
                )}
              </div>
            </button>
            <button
              className="ml-2 text-xs px-2"
              onClick={() => {
                setEditFor(c)
                setEditForm({ name: c.name, phone: c.phone || '', note: c.note || '', wholesale: !!c.wholesale })
              }}
            >Sửa</button>
            <button
              className="ml-2 p-1.5"
              onClick={() => c.debt <= 0 && setDelTarget(c)}
              disabled={c.debt > 0}
              aria-label={c.debt > 0 ? 'Còn nợ, không xóa được' : 'Xóa khách'}
              title={c.debt > 0 ? 'Thu hết nợ rồi mới xóa được' : 'Xóa khách'}
              style={{ color: 'var(--mute-2)', opacity: c.debt > 0 ? 0.4 : 1 }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-16 text-sm" style={{ color: 'var(--mute)' }}>Chưa có khách hàng</div>
        )}
      </div>

      {/* Add customer sheet */}
      <Sheet open={showAdd} onClose={() => setShowAdd(false)} title="Thêm khách hàng">
        <div className="flex flex-col gap-3">
          <input className="field-input" placeholder="Tên khách *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="field-input" placeholder="Số điện thoại" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input className="field-input" placeholder="Ghi chú" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <label className="flex items-center gap-2 text-sm py-1">
            <input type="checkbox" checked={form.wholesale} onChange={(e) => setForm({ ...form, wholesale: e.target.checked })} />
            Khách mua giá sỉ
          </label>
          <button className="btn-cta mt-2" onClick={handleAdd}>Thêm khách hàng</button>
        </div>
      </Sheet>

      <Sheet open={!!editFor} onClose={() => setEditFor(null)} title="Sửa khách hàng">
        <div className="flex flex-col gap-3">
          <input className="field-input" placeholder="Tên khách *" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          <input className="field-input" placeholder="Số điện thoại" type="tel" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
          <input className="field-input" placeholder="Ghi chú" value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} />
          <label className="flex items-center gap-2 text-sm py-1">
            <input type="checkbox" checked={editForm.wholesale} onChange={(e) => setEditForm({ ...editForm, wholesale: e.target.checked })} />
            Khách mua giá sỉ
          </label>
          <button className="btn-cta mt-2" onClick={() => void handleEdit()}>Lưu</button>
        </div>
      </Sheet>

      {/* Pay debt sheet */}
      <Sheet open={!!payFor} onClose={() => setPayFor(null)} title={`Thu nợ — ${payFor?.name || ''}`}>
        <div className="text-sm mb-3" style={{ color: 'var(--mute)' }}>
          Đang nợ: <b style={{ color: 'var(--down)' }}>{fmt(payFor?.debt || 0)}</b>
        </div>
        <input
          className="field-input text-lg text-center font-medium mb-3"
          type="number"
          inputMode="numeric"
          placeholder="Số tiền thu"
          value={payAmount || ''}
          onChange={(e) => setPayAmount(Number(e.target.value) || 0)}
        />
        <div className="flex gap-2 mb-4">
          {[50000, 100000, 200000].map((v) => (
            <button key={v} className="chip flex-1 justify-center" onClick={() => setPayAmount(v)}>{v / 1000}k</button>
          ))}
          <button className="chip flex-1 justify-center" onClick={() => setPayAmount(payFor?.debt || 0)}>Đủ</button>
        </div>
        {payAmount > 0 && payQrSrc(settings, payAmount, '3SU thu no') && (
          <div className="text-center mb-3">
            <img src={payQrSrc(settings, payAmount, '3SU thu no')!} alt="VietQR thu nợ" className="mx-auto max-w-[160px] rounded-lg" />
          </div>
        )}
        <button className="btn-cta" onClick={handlePay} disabled={!payFor || processing || payAmount <= 0 || payAmount > payFor.debt}>
          Xác nhận thu {payAmount > 0 ? fmt(payAmount) : ''}
        </button>
      </Sheet>

      <ConfirmDialog
        open={!!delTarget}
        title="Xóa khách"
        message={`Xóa "${delTarget?.name}"? Đơn cũ vẫn giữ. Không ghi nợ khách này nữa.`}
        confirmLabel="Xóa"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  )
}
