/**
 * Nhà cung cấp web — bảng + thêm + trả nợ.
 */
import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmt, matchesSearch } from '@/core/format'
import { logError } from '@/core/errorLogger'
import { createConfirmGate } from '@/core/confirmGate'
import {
  createSupplier, deleteSupplier, recordSupplierPayment, updateSupplier,
  supplierDebt, supplierMonthlyStatement, supplierTotalPurchases, totalSupplierDebt,
  exportSupplierDebtXlsx,
} from '@/core/domain/suppliers'
import { ConfirmDialog, Sheet } from '@/shared/components'
import { WebEmpty } from '@/web/components/WebEmpty'
import type { Supplier } from '@/core/types'

export function WebSuppliersPage() {
  const showToast = useApp((s) => s.showToast)
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [payFor, setPayFor] = useState<Supplier | null>(null)
  const [delTarget, setDelTarget] = useState<Supplier | null>(null)
  const [editTarget, setEditTarget] = useState<Supplier | null>(null)
  const [editForm, setEditForm] = useState({ name: '', phone: '' })
  const [form, setForm] = useState({ name: '', phone: '', address: '', note: '', leadDays: 2 })
  const [payAmount, setPayAmount] = useState(0)
  const [processing, setProcessing] = useState(false)
  const confirmGate = useRef(createConfirmGate())
  const [stmtFor, setStmtFor] = useState<Supplier | null>(null)
  const [stmtMonth, setStmtMonth] = useState(() => new Date().toISOString().slice(0, 7))

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
  const payDebt = payFor ? supplierDebt(payFor.id, receipts, payments) : 0

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
    if (!confirmGate.current.tryEnter()) return
    setProcessing(true)
    try {
      await recordSupplierPayment({ supplierId: payFor.id, amount: payAmount, note: 'Trả nợ NCC' })
      showToast(`✓ Đã trả ${fmt(payAmount)}`, 'ok')
      setPayFor(null)
      setPayAmount(0)
    } catch (e) {
      logError(e, 'supplier.pay')
      showToast(e instanceof Error ? e.message : 'Lỗi khi trả nợ', 'bad')
    } finally {
      setProcessing(false)
      confirmGate.current.leave()
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
      showToast(e instanceof Error ? e.message : 'Lỗi khi xóa', 'bad')
    }
  }

  return (
    <div className="web-page">
      <div className="web-ph">
        <div>
          <h2>Nhà cung cấp</h2>
          <p>{suppliers.length} NCC · nợ {fmt(debtSum)}</p>
        </div>
        <div className="web-ph-actions">
          <button className="web-btn" onClick={() => { try { void exportSupplierDebtXlsx(suppliers, receipts, payments) } catch (e) { logError(e, 'ncc.xlsx') } }}>Xuất Excel</button>
          <button className="web-btn pri" onClick={() => setShowAdd(true)}>+ Thêm NCC</button>
        </div>
      </div>

      <input className="web-search mb-3" style={{ paddingLeft: 12 }} placeholder="Tìm tên / SĐT…" value={query} onChange={(e) => setQuery(e.target.value)} />

      {rows.length === 0 ? (
        <WebEmpty title="Chưa có nhà cung cấp" sub="Thêm NCC để ghi công nợ khi nhập hàng.">
          <button className="web-btn pri" onClick={() => setShowAdd(true)}>+ Thêm NCC</button>
        </WebEmpty>
      ) : (
        <div className="web-table-wrap">
          <table className="web-table">
            <thead>
              <tr>
                <th>Tên</th>
                <th>SĐT</th>
                <th>Đã nhập</th>
                <th>Nợ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, debt, total }) => (
                <tr key={s.id} className="static">
                  <td>{s.name}</td>
                  <td>{s.phone || '—'}</td>
                  <td>{fmt(total)}</td>
                  <td style={{ color: debt > 0 ? 'var(--bad)' : undefined }}>{debt > 0 ? fmt(debt) : '0'}</td>
                  <td>
                    {debt > 0 && (
                      <button className="web-btn pri" style={{ height: 28 }} onClick={() => { setPayFor(s); setPayAmount(debt) }}>Trả nợ</button>
                    )}
                    {' '}
                    <button className="web-btn" style={{ height: 28 }} onClick={() => setStmtFor(s)}>Sao kê</button>
                    {' '}
                    <button className="web-btn" style={{ height: 28 }} onClick={() => { setEditTarget(s); setEditForm({ name: s.name, phone: s.phone || '' }) }}>Sửa</button>
                    {' '}
                    <button className="web-btn" style={{ height: 28 }} disabled={debt > 0} onClick={() => { if (debt > 0) return; setDelTarget(s) }}>Xóa</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={showAdd} onClose={() => setShowAdd(false)} title="Thêm nhà cung cấp">
        <div className="flex flex-col gap-2">
          <input className="web-input" placeholder="Tên NCC *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="web-input" placeholder="Điện thoại" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input className="web-input" placeholder="Địa chỉ" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <input className="web-input" placeholder="Ghi chú" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <button className="web-btn pri" onClick={handleAdd}>Thêm</button>
        </div>
      </Sheet>

      <Sheet open={!!payFor} onClose={() => setPayFor(null)} title={payFor ? `Trả nợ · ${payFor.name}` : 'Trả nợ'}>
        <div className="text-sm mb-2" style={{ color: 'var(--kv-muted)' }}>Đang nợ {fmt(payDebt)}</div>
        <input className="web-input" type="number" value={payAmount || ''} onChange={(e) => setPayAmount(Number(e.target.value) || 0)} />
        <button className="web-btn pri w-full mt-3" disabled={processing || payAmount <= 0 || payAmount > payDebt} onClick={handlePay}>Xác nhận trả {payAmount > 0 ? fmt(payAmount) : ''}</button>
      </Sheet>

      <Sheet open={!!stmtFor} onClose={() => setStmtFor(null)} title={stmtFor ? `Sao kê · ${stmtFor.name}` : 'Sao kê'}>
        <input className="web-input mb-2" type="month" value={stmtMonth} onChange={(e) => setStmtMonth(e.target.value)} />
        {stmtFor && (() => {
          const st = supplierMonthlyStatement(stmtFor.id, receipts, payments, stmtMonth)
          return (
            <div className="text-sm flex flex-col gap-1">
              <div className="flex justify-between"><span>Phiếu nhập</span><b>{st.receiptCount}</b></div>
              <div className="flex justify-between"><span>Đã nhập</span><b>{fmt(st.purchased)}</b></div>
              <div className="flex justify-between"><span>Trả theo phiếu</span><b>{fmt(st.paidOnReceipts)}</b></div>
              <div className="flex justify-between"><span>Trả riêng</span><b>{fmt(st.extraPaid)}</b></div>
              <div className="flex justify-between"><span>Còn tháng này</span><b>{fmt(st.net)}</b></div>
            </div>
          )
        })()}
      </Sheet>

      <Sheet open={!!editTarget} onClose={() => setEditTarget(null)} title={editTarget ? `Sửa · ${editTarget.name}` : 'Sửa NCC'}>
        <div className="flex flex-col gap-2">
          <input className="web-input" placeholder="Tên NCC *" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          <input className="web-input" placeholder="Điện thoại" type="tel" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
          <button className="web-btn pri" onClick={handleEdit}>Lưu</button>
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
