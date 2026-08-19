/**
 * 3SU Next — Chi tiết đơn hàng + Hủy đơn
 */
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { voidSale } from '@/core/domain/sales'
import { dispatchPrint, printResultToast } from '@/core/browser/printQueue'
import { fmt, formatDateTime } from '@/core/format'
import { logError } from '@/core/errorLogger'
import { ChevronLeft, Printer } from 'lucide-react'

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const showToast = useApp((s) => s.showToast)
  const shop = useApp((s) => s.shop)
  const settings = useApp((s) => s.settings)
  const user = useApp((s) => s.user)
  const [confirmVoid, setConfirmVoid] = useState(false)
  const [voidReason, setVoidReason] = useState('')

  const sale = useLiveQuery(() => (id ? dbx.sales.get(id) : undefined), [id])
  const customer = useLiveQuery(
    () => (sale?.customerId ? dbx.customers.get(sale.customerId) : undefined),
    [sale?.customerId],
  )

  if (!sale) {
    return (
      <div className="p-6 text-center" style={{ color: 'var(--mute)' }}>Không tìm thấy đơn hàng</div>
    )
  }

  const payLabel = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', debt: 'Ghi nợ' }[sale.payMethod] || sale.payMethod

  async function handleVoid() {
    try {
      if (sale!.debtAmount > 0 && customer && customer.debt < sale!.debtAmount) {
        showToast('Khách đã trả cho đơn này', 'ok')
      }
      await voidSale(sale!.id, voidReason.trim())
      showToast('Đã hủy đơn', 'ok')
      navigate('/don-hang')
    } catch (e) {
      logError(e, 'order.void')
      showToast('Lỗi khi hủy đơn', 'bad')
    }
  }

  async function handlePrint() {
    const r = await dispatchPrint({
      sale: sale!,
      shop,
      printer: settings.printer,
      customerName: customer?.name ?? null,
      cashier: user?.name || user?.username || '',
    })
    const t = printResultToast(r)
    showToast(t.text, t.kind)
  }

  return (
    <div className="flex flex-col h-full">
      <header className="app-hdr bordered">
        <button className="btn-back" onClick={() => navigate('/don-hang')}>
          <ChevronLeft size={20} />
        </button>
        <div className="text-center flex-1">
          <div className="font-brand text-[17px] font-medium" style={{ color: 'var(--ink)' }}>Chi tiết đơn</div>
          <div className="text-[11px]" style={{ color: 'var(--mute)' }}>{formatDateTime(sale.date)}</div>
        </div>
        <div className="w-9" />
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {sale.voided && (
          <div className="mb-4 p-3 rounded-xl text-sm font-medium text-center" style={{ background: 'rgba(158,74,62,.1)', color: 'var(--down)' }}>
            Đã hủy{sale.voidReason ? ` — ${sale.voidReason}` : ''}
          </div>
        )}

        {/* Items */}
        <div className="card p-4 mb-4">
          {sale.items.map((it, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b last:border-0" style={{ borderColor: 'var(--hair-2)' }}>
              <div>
                <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{it.name}</div>
                <div className="text-[11px]" style={{ color: 'var(--mute)' }}>
                  {it.qty} × {fmt(it.price)}{it.unitRatio > 1 ? ` / ${it.unit}` : ''}
                </div>
              </div>
              <div className="text-sm font-medium stat-num" style={{ color: 'var(--ink)' }}>
                {fmt(it.price * it.qty)}
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="card p-4 mb-4 flex flex-col gap-2 text-sm">
          {sale.discount > 0 && (
            <div className="flex justify-between"><span style={{ color: 'var(--mute)' }}>Giảm giá</span><span style={{ color: 'var(--down)' }}>-{fmt(sale.discount)}</span></div>
          )}
          <div className="flex justify-between font-medium">
            <span style={{ color: 'var(--ink)' }}>Tổng cộng</span>
            <span className="stat-num" style={{ color: 'var(--ink)' }}>{fmt(sale.total)}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--mute)' }}>Lợi nhuận</span>
            <span className="stat-num" style={{ color: sale.profit >= 0 ? 'var(--up)' : 'var(--down)' }}>{fmt(sale.profit)}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--mute)' }}>Thanh toán</span>
            <span style={{ color: 'var(--ink-2)' }}>{payLabel}</span>
          </div>
          {sale.payMethod === 'cash' && (
            <>
              <div className="flex justify-between">
                <span style={{ color: 'var(--mute)' }}>Khách đưa</span>
                <span style={{ color: 'var(--ink-2)' }}>{fmt(sale.tendered)}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--mute)' }}>Tiền thối</span>
                <span style={{ color: 'var(--ink-2)' }}>{fmt(sale.change)}</span>
              </div>
            </>
          )}
          {sale.debtAmount > 0 && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--mute)' }}>Ghi nợ</span>
              <span style={{ color: 'var(--down)' }}>{fmt(sale.debtAmount)}</span>
            </div>
          )}
          {customer && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--mute)' }}>Khách hàng</span>
              <span style={{ color: 'var(--ink-2)' }}>{customer.name}</span>
            </div>
          )}
        </div>

        {/* Print + Void buttons */}
        <div className="flex gap-2">
          <button
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium"
            style={{ borderColor: 'var(--hair)', color: 'var(--ink-2)', background: 'var(--paper-2)' }}
            onClick={handlePrint}
          >
            <Printer size={17} />
            In hóa đơn
          </button>
          {!sale.voided && (
            <button className="btn-danger flex-1" onClick={() => setConfirmVoid(true)}>
              Hủy đơn hàng
            </button>
          )}
        </div>
      </div>

      {confirmVoid && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(15,23,42,0.45)' }} onClick={() => setConfirmVoid(false)}>
          <div className="card p-4 w-full max-w-md m-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm mb-2">Nhập lý do hủy — hoàn kho và hoàn nợ. Không hoàn tác.</p>
            <input className="field-input mb-3" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="VD: khách đổi ý" />
            <div className="flex gap-2">
              <button className="chip flex-1 justify-center" onClick={() => setConfirmVoid(false)}>Không</button>
              <button className="btn-danger flex-1" disabled={!voidReason.trim()} onClick={() => void handleVoid()}>Hủy đơn</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
