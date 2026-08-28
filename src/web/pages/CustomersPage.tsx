/**
 * Khách hàng web — bảng + phân khúc + thu nợ.
 */
import { useState, useMemo, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmt, matchesSearch, vnDaysAgo, vnToday } from '@/core/format'
import { logError } from '@/core/errorLogger'
import { createConfirmGate } from '@/core/confirmGate'
import { addCustomer, deleteCustomer, payDebt, updateCustomer, customerSegments, debtReceiptSale } from '@/core/domain/customers'
import { salesInDateRange } from '@/core/domain/sales'
import { exportCustomerDebtXlsx } from '@/core/domain/reports'
import { dispatchPrint, printResultToast } from '@/core/browser/printQueue'
import { payQrSrc } from '@/core/domain/vietqr'
import { ConfirmDialog, Sheet } from '@/shared/components'
import type { Customer, Sale } from '@/core/types'

type Seg = 'all' | 'debt' | 'vip' | 'loyal' | 'new' | 'sleep' | 'ws'

export function WebCustomersPage() {
  const showToast = useApp((s) => s.showToast)
  const settings = useApp((s) => s.settings)
  const shop = useApp((s) => s.shop)
  const user = useApp((s) => s.user)
  const [query, setQuery] = useState('')
  const [seg, setSeg] = useState<Seg>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [editFor, setEditFor] = useState<Customer | null>(null)
  const [payFor, setPayFor] = useState<Customer | null>(null)
  const [delTarget, setDelTarget] = useState<Customer | null>(null)
  const [form, setForm] = useState({ name: '', phone: '', note: '', wholesale: false })
  const [editForm, setEditForm] = useState({ name: '', phone: '', note: '', wholesale: false })
  const [processing, setProcessing] = useState(false)
  const confirmGate = useRef(createConfirmGate())
  const [payAmount, setPayAmount] = useState(0)

  const customers = useLiveQuery(
    () => dbx.customers.filter((c) => !c.deleted).toArray(),
    [],
    [] as Customer[],
  )
  const sales = useLiveQuery(() => salesInDateRange(vnDaysAgo(364), vnToday()), [], [] as Sale[])
  const segs = useMemo(() => customerSegments(customers, sales), [customers, sales])

  const filtered = useMemo(() => {
    return customers
      .filter((c) => {
        if (!matchesSearch(c.name + ' ' + c.phone, query)) return false
        if (seg === 'debt') return c.debt > 0
        if (seg === 'vip') return segs.vipIds.has(c.id)
        if (seg === 'loyal') return segs.loyalIds.has(c.id)
        if (seg === 'new') return segs.newIds.has(c.id)
        if (seg === 'sleep') return segs.sleepIds.has(c.id)
        if (seg === 'ws') return !!c.wholesale
        return true
      })
      .sort((a, b) => b.debt - a.debt || b.totalSpent - a.totalSpent)
  }, [customers, query, seg, segs])

  const totalDebt = customers.reduce((a, c) => a + Math.max(0, c.debt), 0)
  const debtN = customers.filter((c) => c.debt > 0).length

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
      const r = await dispatchPrint({
        sale: debtReceiptSale(applied, payFor.id),
        shop,
        printer: settings.printer,
        customerName: payFor.name,
        cashier: user?.name || user?.username || 'Thu nợ',
      })
      const t = printResultToast(r)
      showToast(`✓ Đã thu ${fmt(applied)} · ${t.text}`, t.kind)
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
    <div className="web-page">
      <div className="web-ph">
        <div>
          <h2>Khách hàng</h2>
          <p>{totalDebt > 0 ? `${debtN} khách còn nợ ${fmt(totalDebt)}` : 'Chưa ai nợ tiền'}</p>
        </div>
        <div className="web-ph-actions">
          <button className="web-btn" onClick={() => { try { void exportCustomerDebtXlsx(customers) } catch (e) { logError(e, 'debt.xlsx') } }}>Xuất Excel</button>
          <button className="web-btn pri" onClick={() => setShowAdd(true)}>+ Thêm khách</button>
        </div>
      </div>

      <div className="web-chips">
        <button className={`web-chip ${seg === 'all' ? 'on' : ''}`} onClick={() => setSeg('all')}>Tất cả</button>
        <button className={`web-chip ${seg === 'debt' ? 'on' : ''}`} onClick={() => setSeg('debt')}>Còn nợ</button>
        <button className={`web-chip ${seg === 'vip' ? 'on' : ''}`} onClick={() => setSeg('vip')}>Khách sộp</button>
        <button className={`web-chip ${seg === 'loyal' ? 'on' : ''}`} onClick={() => setSeg('loyal')}>Khách quen</button>
        <button className={`web-chip ${seg === 'new' ? 'on' : ''}`} onClick={() => setSeg('new')}>Mới ghé</button>
        <button className={`web-chip ${seg === 'sleep' ? 'on' : ''}`} onClick={() => setSeg('sleep')}>Lâu chưa ghé</button>
        <button className={`web-chip ${seg === 'ws' ? 'on' : ''}`} onClick={() => setSeg('ws')}>Lấy sỉ</button>
      </div>

      <input
        className="web-search mb-3"
        style={{ paddingLeft: 12 }}
        placeholder="Tìm theo tên hoặc số điện thoại"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="web-table-wrap">
        <table className="web-table">
          <thead>
            <tr>
              <th>Tên</th>
              <th>SĐT</th>
              <th>Đã mua</th>
              <th>Nợ</th>
              <th>Giá</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} onClick={() => c.debt > 0 && setPayFor(c)}>
                <td>
                  {c.name}
                  {segs.vipIds.has(c.id) && <span className="web-badge low ml-2">Sộp</span>}
                </td>
                <td>{c.phone || '—'}</td>
                <td>{fmt(c.totalSpent)}</td>
                <td style={{ color: c.debt > 0 ? 'var(--bad)' : undefined }}>{c.debt > 0 ? fmt(c.debt) : '—'}</td>
                <td>{c.wholesale ? 'Sỉ' : ''}</td>
                <td>
                  <button
                    className="web-btn"
                    style={{ height: 28 }}
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditFor(c)
                      setEditForm({ name: c.name, phone: c.phone || '', note: c.note || '', wholesale: !!c.wholesale })
                    }}
                  >Sửa</button>
                  {' '}
                  {c.debt > 0 && (
                    <button
                      className="web-btn pri"
                      style={{ height: 28 }}
                      onClick={(e) => { e.stopPropagation(); setPayFor(c) }}
                    >
                      Thu nợ
                    </button>
                  )}
                  {' '}
                  <button
                    className="web-btn"
                    style={{ height: 28 }}
                    disabled={c.debt > 0}
                    title={c.debt > 0 ? 'Thu hết nợ rồi mới xóa được' : 'Xóa khách'}
                    onClick={(e) => { e.stopPropagation(); if (c.debt <= 0) setDelTarget(c) }}
                  >
                    Xóa
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="web-table-empty">
                  {query || seg !== 'all' ? 'Không có khách nào ở đây' : 'Chưa lưu khách nào'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Sheet open={showAdd} onClose={() => setShowAdd(false)} title="Thêm khách">
        <div className="flex flex-col gap-2">
          <input className="web-input" placeholder="Tên" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="web-input" placeholder="SĐT" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input className="web-input" placeholder="Ghi chú" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.wholesale} onChange={(e) => setForm({ ...form, wholesale: e.target.checked })} />
            Khách mua giá sỉ
          </label>
          <button className="web-btn pri" onClick={handleAdd}>Lưu</button>
        </div>
      </Sheet>

      <Sheet open={!!editFor} onClose={() => setEditFor(null)} title="Sửa khách">
        <div className="flex flex-col gap-2">
          <input className="web-input" placeholder="Tên" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          <input className="web-input" placeholder="SĐT" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
          <input className="web-input" placeholder="Ghi chú" value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={editForm.wholesale} onChange={(e) => setEditForm({ ...editForm, wholesale: e.target.checked })} />
            Khách mua giá sỉ
          </label>
          <button className="web-btn pri" onClick={() => void handleEdit()}>Lưu</button>
        </div>
      </Sheet>

      <Sheet open={!!payFor} onClose={() => setPayFor(null)} title={payFor ? `Thu nợ · ${payFor.name}` : 'Thu nợ'}>
        <div className="text-sm mb-2" style={{ color: 'var(--kv-muted)' }}>Còn nợ {payFor ? fmt(payFor.debt) : ''}</div>
        <input
          className="web-input"
          type="number"
          min={0}
          placeholder="Số tiền"
          value={payAmount || ''}
          onChange={(e) => setPayAmount(Number(e.target.value) || 0)}
        />
        {payAmount > 0 && payQrSrc(settings, payAmount, '3SU thu no') && (
          <img src={payQrSrc(settings, payAmount, '3SU thu no')!} alt="VietQR thu nợ" className="mx-auto max-w-[160px] rounded-lg my-3" />
        )}
        <button className="web-btn pri w-full mt-3" onClick={handlePay} disabled={!payFor || processing || payAmount <= 0 || payAmount > payFor.debt}>Thu {payAmount > 0 ? fmt(payAmount) : ''}</button>
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
