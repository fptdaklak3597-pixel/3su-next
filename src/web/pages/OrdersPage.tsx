/**
 * Đơn hàng web — bảng theo khung đã chốt.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { voidSale } from '@/core/domain/sales'
import { logError } from '@/core/errorLogger'
import { fmt, formatTime, localDay, today, daysAgo, matchesSearch } from '@/core/format'
import { paginate, payLabel } from '@/web/lib/listFilters'
import { WebDateRange } from '@/web/components/WebDateRange'
import type { Sale, Customer } from '@/core/types'

type Period = 'today' | 'week' | 'month' | 'all' | 'custom'
type Pay = 'all' | 'cash' | 'transfer' | 'debt'

export function WebOrdersPage() {
  const navigate = useNavigate()
  const showToast = useApp((s) => s.showToast)
  const [period, setPeriod] = useState<Period>('today')
  const [pay, setPay] = useState<Pay>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [voidTarget, setVoidTarget] = useState<Sale | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const sales = useLiveQuery(() => dbx.sales.toArray(), [], [] as Sale[])
  const customers = useLiveQuery(() => dbx.customers.toArray(), [], [] as Customer[])
  const names = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers])

  const filtered = useMemo(() => {
    let fromDay: string | null = null
    let toDay: string | null = null
    if (period === 'custom') {
      fromDay = from || null
      toDay = to || null
    } else if (period === 'today') fromDay = today()
    else if (period === 'week') fromDay = daysAgo(7)
    else if (period === 'month') fromDay = daysAgo(30)
    return sales
      .filter((s) => !s.voided)
      .filter((s) => {
        const day = localDay(s.date)
        if (fromDay && day < fromDay) return false
        if (toDay && day > toDay) return false
        if (pay !== 'all' && s.payMethod !== pay) return false
        const cust = s.customerId ? names.get(s.customerId) || '' : ''
        if (query && !s.items.some((it) => matchesSearch(it.name, query)) && !matchesSearch(cust, query) && !matchesSearch(s.id, query)) return false
        return true
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [sales, period, pay, query, names, from, to])

  const total = filtered.reduce((a, s) => a + s.total, 0)
  const { rows, pages } = paginate(filtered, page, 15)

  return (
    <div className="web-page">
      <div className="web-ph">
        <div>
          <h2>Đơn hàng</h2>
          <p>{filtered.length} đơn · {fmt(total)}</p>
        </div>
      </div>

      <div className="web-chips">
        {([['today', 'Hôm nay'], ['week', '7 ngày'], ['month', '30 ngày'], ['all', 'Tất cả']] as [Period, string][]).map(([v, l]) => (
          <button key={v} className={`web-chip ${period === v ? 'on' : ''}`} onClick={() => { setPeriod(v); setFrom(''); setTo(''); setPage(1) }}>{l}</button>
        ))}
        {([['all', 'Mọi hình thức'], ['cash', 'Tiền mặt'], ['transfer', 'CK'], ['debt', 'Ghi nợ']] as [Pay, string][]).map(([v, l]) => (
          <button key={v} className={`web-chip ${pay === v ? 'on' : ''}`} onClick={() => { setPay(v); setPage(1) }}>{l}</button>
        ))}
      </div>

      <div className="web-order-bar">
        <input
          className="web-search"
          style={{ paddingLeft: 12 }}
          placeholder="Tìm mã đơn / món / khách…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1) }}
        />
        <WebDateRange
          from={from}
          to={to}
          active={period === 'custom'}
          onChange={(a, b) => { setFrom(a); setTo(b); setPeriod(a || b ? 'custom' : 'all'); setPage(1) }}
        />
      </div>

      <div className="web-table-wrap">
        <table className="web-table">
          <thead>
            <tr>
              <th>Giờ</th>
              <th>Khách</th>
              <th>Món</th>
              <th>Tổng</th>
              <th>Thanh toán</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} onClick={() => navigate(`/don-hang/${s.id}`)}>
                <td>{formatTime(s.date)}</td>
                <td>{s.customerId ? (names.get(s.customerId) || 'Khách lẻ') : 'Khách lẻ'}</td>
                <td>{s.items.map((it) => it.name).slice(0, 2).join(', ')}{s.items.length > 2 ? '…' : ''}</td>
                <td>{fmt(s.total)}</td>
                <td>{payLabel(s.payMethod)}{s.debtAmount > 0 ? ` · nợ ${fmt(s.debtAmount)}` : ''}</td>
                <td>
                  <button
                    className="web-btn"
                    style={{ height: 28 }}
                    onClick={(e) => { e.stopPropagation(); setVoidTarget(s) }}
                  >
                    Hủy
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="web-table-empty">Chưa có đơn</td>
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
      {voidTarget && (
        <div className="web-card" style={{ marginTop: 12, maxWidth: 420 }}>
          <p className="text-sm mb-2">Lý do hủy đơn {voidTarget.id.slice(-6)} — hoàn kho / hoàn nợ.</p>
          <input className="web-input mb-2" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="VD: khách đổi ý" />
          <div className="web-ph-actions">
            <button className="web-btn" onClick={() => { setVoidTarget(null); setVoidReason('') }}>Không</button>
            <button className="web-btn danger" disabled={!voidReason.trim()} onClick={async () => {
              try {
                const cust = voidTarget.customerId
                  ? customers.find((c) => c.id === voidTarget.customerId)
                  : undefined
                if (voidTarget.debtAmount > 0 && cust && cust.debt < voidTarget.debtAmount) {
                  showToast('Khách đã trả cho đơn này', 'ok')
                }
                await voidSale(voidTarget.id, voidReason.trim())
                showToast('Đã hủy đơn', 'ok')
              } catch (e) {
                logError(e, 'order.void')
                showToast(e instanceof Error ? e.message : 'Lỗi khi hủy đơn', 'bad')
              } finally {
                setVoidTarget(null)
                setVoidReason('')
              }
            }}>Hủy đơn</button>
          </div>
        </div>
      )}
    </div>
  )
}
