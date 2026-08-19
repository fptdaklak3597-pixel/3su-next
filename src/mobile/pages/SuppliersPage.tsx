/**
 * 3SU Next — Nhà cung cấp & Công nợ NCC
 * Port từ 50-auth-cloud-ai.js (renderSuppliers) + nghiệp vụ suppliers.ts.
 */
import { useState, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmt, fmtShort, matchesSearch } from '@/core/format'
import { logError } from '@/core/errorLogger'
import {
  createSupplier, deleteSupplier, recordSupplierPayment, updateSupplier,
  supplierDebt, supplierTotalPurchases, totalSupplierDebt,
} from '@/core/domain/suppliers'
import { Sheet, ConfirmDialog, EmptyState } from '@/shared/components'
import { Search, Plus, Phone, Trash2 } from 'lucide-react'
import type { Supplier } from '@/core/types'

export function SuppliersPage() {
  const showToast = useApp((s) => s.showToast)
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [payFor, setPayFor] = useState<Supplier | null>(null)
  const [delTarget, setDelTarget] = useState<Supplier | null>(null)
  const [editTarget, setEditTarget] = useState<Supplier | null>(null)
  const [editForm, setEditForm] = useState({ name: '', phone: '' })
  const [form, setForm] = useState({ name: '', phone: '', address: '', note: '', leadDays: 2 })
  const [payAmount, setPayAmount] = useState(0)

  const suppliers = useLiveQuery(() => dbx.suppliers.filter((s) => !s.deleted).toArray(), [], [] as Supplier[])
  const receipts = useLiveQuery(() => dbx.goodsReceipts.toArray(), [], [])
  const payments = useLiveQuery(() => dbx.supplierPayments.toArray(), [], [])

  const rows = useMemo(() => {
    return suppliers
      .filter((s) => matchesSearch(s.name + ' ' + s.phone, query))
      .map((s) => ({
        s,
        debt: supplierDebt(s.id, receipts, payments),
        total: supplierTotalPurchases(s.id, receipts),
      }))
      .sort((a, b) => b.debt - a.debt || b.total - a.total)
  }, [suppliers, receipts, payments, query])

  const debtSum = totalSupplierDebt(suppliers, receipts, payments)

  async function handleAdd() {
    try {
      await createSupplier(form)
      showToast('✓ Đã thêm nhà cung cấp', 'ok')
      setShowAdd(false)
      setForm({ name: '', phone: '', address: '', note: '', leadDays: 2 })
    } catch (e) {
      logError(e, 'supplier.add')
      showToast(e instanceof Error ? e.message : 'Lỗi khi thêm', 'bad')
    }
  }

  async function handlePay() {
    if (!payFor) return
    try {
      await recordSupplierPayment({ supplierId: payFor.id, amount: payAmount, note: 'Trả nợ NCC' })
      showToast(`✓ Đã trả ${fmt(payAmount)}`, 'ok')
      setPayFor(null)
      setPayAmount(0)
    } catch (e) {
      logError(e, 'supplier.pay')
      showToast(e instanceof Error ? e.message : 'Lỗi khi trả nợ', 'bad')
    }
  }

  async function handleEdit() {
    if (!editTarget) return
    try {
      await updateSupplier(editTarget.id, { name: editForm.name, phone: editForm.phone })
      showToast('✓ Đã lưu NCC', 'ok')
      setEditTarget(null)
    } catch (e) {
      logError(e, 'supplier.edit')
      showToast(e instanceof Error ? e.message : 'Lỗi khi sửa', 'bad')
    }
  }

  async function handleDelete() {
    if (!delTarget) return
    try {
      await deleteSupplier(delTarget.id)
      showToast('Đã xóa nhà cung cấp', 'ok')
      setDelTarget(null)
    } catch (e) {
      logError(e, 'supplier.delete')
      showToast('Lỗi khi xóa', 'bad')
    }
  }

  const payDebt = payFor ? supplierDebt(payFor.id, receipts, payments) : 0

  return (
    <div className="flex flex-col h-full">
      <header className="app-hdr bordered">
        <div>
          <div className="font-brand text-[17px] font-medium" style={{ color: 'var(--ink)' }}>Nhà cung cấp</div>
          <div className="text-[11px]" style={{ color: 'var(--mute)' }}>
            {suppliers.length} NCC · nợ {fmtShort(debtSum)}đ
          </div>
        </div>
        <button className="btn-back" onClick={() => setShowAdd(true)} aria-label="Thêm NCC">
          <Plus size={18} />
        </button>
      </header>

      <div className="px-4 pt-3 pb-2">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--mute-2)' }} />
          <input className="field-input pl-9 text-sm" placeholder="Tìm nhà cung cấp…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {rows.map(({ s, debt, total }) => (
          <div key={s.id} className="list-row">
            <button className="flex-1 min-w-0 text-left flex items-center gap-3" onClick={() => debt > 0 && setPayFor(s)}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-brand font-medium"
                style={{ background: 'var(--paper-2)', color: 'var(--ink-2)' }}>
                {s.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{s.name}</div>
                <div className="text-[11px] flex items-center gap-1" style={{ color: 'var(--mute)' }}>
                  <Phone size={10} /> {s.phone || '—'} · nhập {fmtShort(total)}đ
                </div>
              </div>
              <div className="text-right">
                {debt > 0 ? (
                  <span className="text-sm font-medium" style={{ color: 'var(--down)' }}>Nợ {fmtShort(debt)}đ</span>
                ) : (
                  <span className="text-xs" style={{ color: 'var(--mute-2)' }}>—</span>
                )}
              </div>
            </button>
            <button className="ml-2 p-1.5" onClick={() => { setEditTarget(s); setEditForm({ name: s.name, phone: s.phone || '' }) }} aria-label="Sửa NCC" style={{ color: 'var(--mute-2)' }}>
              Sửa
            </button>
            <button className="ml-2 p-1.5" onClick={() => setDelTarget(s)} aria-label="Xóa NCC" style={{ color: 'var(--mute-2)' }}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {rows.length === 0 && <EmptyState icon="🚚" title="Chưa có nhà cung cấp" sub="Bấm + để thêm nhà cung cấp đầu tiên" />}
      </div>

      {/* Add supplier */}
      <Sheet open={showAdd} onClose={() => setShowAdd(false)} title="Thêm nhà cung cấp">
        <div className="flex flex-col gap-3">
          <input className="field-input" placeholder="Tên NCC *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="field-input" placeholder="Điện thoại" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input className="field-input" placeholder="Địa chỉ" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <div className="flex items-center gap-2">
            <span className="text-sm whitespace-nowrap" style={{ color: 'var(--mute)' }}>Giao sau (ngày)</span>
            <input className="field-input" type="number" min={0} max={60} value={form.leadDays} onChange={(e) => setForm({ ...form, leadDays: Number(e.target.value) || 0 })} />
          </div>
          <input className="field-input" placeholder="Ghi chú" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <button className="btn-cta mt-2" onClick={handleAdd}>Thêm nhà cung cấp</button>
        </div>
      </Sheet>

      {/* Pay supplier */}
      <Sheet open={!!payFor} onClose={() => setPayFor(null)} title={`Trả nợ — ${payFor?.name || ''}`}>
        <div className="text-sm mb-3" style={{ color: 'var(--mute)' }}>
          Đang nợ: <b style={{ color: 'var(--down)' }}>{fmt(payDebt)}</b>
        </div>
        <input
          className="field-input text-lg text-center font-medium mb-3"
          type="number" inputMode="numeric" placeholder="Số tiền trả"
          value={payAmount || ''}
          onChange={(e) => setPayAmount(Number(e.target.value) || 0)}
        />
        <div className="flex gap-2 mb-4">
          {[100000, 500000, 1000000].map((v) => (
            <button key={v} className="chip flex-1 justify-center" onClick={() => setPayAmount(v)}>{v / 1000}k</button>
          ))}
          <button className="chip flex-1 justify-center" onClick={() => setPayAmount(payDebt)}>Đủ</button>
        </div>
        <button className="btn-cta" onClick={handlePay} disabled={payAmount <= 0}>
          Xác nhận trả {payAmount > 0 ? fmt(payAmount) : ''}
        </button>
      </Sheet>

      <Sheet open={!!editTarget} onClose={() => setEditTarget(null)} title={`Sửa — ${editTarget?.name || ''}`}>
        <div className="flex flex-col gap-3">
          <input className="field-input" placeholder="Tên NCC *" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          <input className="field-input" placeholder="Điện thoại" type="tel" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
          <button className="btn-cta mt-2" onClick={handleEdit}>Lưu</button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={!!delTarget}
        title="Xóa nhà cung cấp"
        message={`Xóa "${delTarget?.name}"? Lịch sử nhập hàng vẫn được giữ.`}
        confirmLabel="Xóa"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  )
}
