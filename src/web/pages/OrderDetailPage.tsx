/**
 * Chi tiết đơn web — in + hủy hoàn kho.
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
import { payLabel } from '@/web/lib/listFilters'

export function WebOrderDetailPage() {
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
    return <div className="web-page" style={{ color: 'var(--kv-subtle)' }}>Không tìm thấy đơn hàng</div>
  }

  async function handleVoid() {
    try {
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
    <div className="web-page">
      <div className="web-ph">
        <div>
          <h2>Chi tiết đơn</h2>
          <p>{formatDateTime(sale.date)} · {payLabel(sale.payMethod)}{customer ? ` · ${customer.name}` : ''}</p>
        </div>
        <div className="web-ph-actions">
          <button className="web-btn" onClick={() => navigate('/don-hang')}>Danh sách</button>
          <button className="web-btn" onClick={handlePrint}>In hóa đơn</button>
          {!sale.voided && <button className="web-btn danger" onClick={() => setConfirmVoid(true)}>Hủy đơn</button>}
        </div>
      </div>

      {sale.voided && (
        <p className="web-sub" style={{ color: 'var(--bad)' }}>Đã hủy{sale.voidReason ? ` — ${sale.voidReason}` : ''}</p>
      )}

      <div className="web-table-wrap">
        <table className="web-table">
          <thead>
            <tr>
              <th>Món</th>
              <th>SL</th>
              <th>Đơn giá</th>
              <th>Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((it, i) => (
              <tr key={i} className="static">
                <td>{it.name}</td>
                <td>{it.qty}{it.unitRatio > 1 ? ` ${it.unit}` : ''}</td>
                <td>{fmt(it.price)}</td>
                <td>{fmt(it.price * it.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="web-card" style={{ marginTop: 12, maxWidth: 420 }}>
        {sale.discount > 0 && <div className="web-ln"><span>Giảm giá</span><span>-{fmt(sale.discount)}</span></div>}
        <div className="web-ln big"><span>Tổng cộng</span><span>{fmt(sale.total)}</span></div>
        <div className="web-ln"><span>Lợi nhuận</span><span>{fmt(sale.profit)}</span></div>
        {sale.payMethod === 'cash' && (
          <>
            <div className="web-ln"><span>Khách đưa</span><span>{fmt(sale.tendered)}</span></div>
            <div className="web-ln"><span>Tiền thối</span><span>{fmt(sale.change)}</span></div>
          </>
        )}
        {sale.debtAmount > 0 && <div className="web-ln"><span>Ghi nợ</span><span>{fmt(sale.debtAmount)}</span></div>}
      </div>

      {confirmVoid && (
        <div className="web-card" style={{ marginTop: 12, maxWidth: 420 }}>
          <p className="text-sm mb-2">Nhập lý do hủy — hoàn kho và hoàn nợ. Không hoàn tác.</p>
          <input className="web-input mb-2" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="VD: khách đổi ý" />
          <div className="web-ph-actions">
            <button className="web-btn" onClick={() => setConfirmVoid(false)}>Không</button>
            <button className="web-btn danger" disabled={!voidReason.trim()} onClick={() => void handleVoid()}>Hủy đơn</button>
          </div>
        </div>
      )}
    </div>
  )
}
