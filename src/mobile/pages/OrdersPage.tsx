import { salesInDateRange } from '@/core/domain/sales'
/**
 * 3SU Next — Lịch sử đơn hàng
 * Port từ 15-orders.js: filter theo ngày/pay/khách/search, nhóm theo ngày.
 */
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { fmt, fmtShort, formatTime, localDay, today, yesterday, formatDate, daysAgo, matchesSearch, vnDaysAgo, vnToday } from '@/core/format'
import { ChevronLeft, Search } from 'lucide-react'
import type { Sale } from '@/core/types'

type PeriodFilter = 'all' | 'today' | 'week' | 'month'
type PayFilter = 'all' | 'cash' | 'transfer' | 'debt'

export function OrdersPage() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState<PeriodFilter>('today')
  const [pay, setPay] = useState<PayFilter>('all')
  const [query, setQuery] = useState('')

  const sales = useLiveQuery(() => salesInDateRange(vnDaysAgo(59), vnToday()), [], [] as Sale[])
  const customers = useLiveQuery(() => dbx.customers.toArray(), [], [])

  const filtered = useMemo(() => {
    let from: string | null = null
    if (period === 'today') from = today()
    else if (period === 'week') from = daysAgo(7)
    else if (period === 'month') from = daysAgo(30)

    return sales
      .filter((s) => !s.voided)
      .filter((s) => {
        if (from && localDay(s.date) < from) return false
        if (pay !== 'all' && s.payMethod !== pay) return false
        if (query && !s.items.some((it) => matchesSearch(it.name, query))) return false
        return true
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [sales, period, pay, query])

  const total = filtered.reduce((a, s) => a + s.total, 0)
  const totalProfit = filtered.reduce((a, s) => a + s.profit, 0)

  // Nhóm theo ngày
  const groups = useMemo(() => {
    const map: Record<string, Sale[]> = {}
    filtered.forEach((s) => {
      const d = localDay(s.date)
      if (!map[d]) map[d] = []
      map[d].push(s)
    })
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered])

  const payLabel = (m: string) => ({ cash: 'Tiền mặt', transfer: 'CK', debt: 'Ghi nợ' }[m] || m)

  return (
    <div className="flex flex-col h-full">
      <header className="app-hdr bordered">
        <button className="btn-back" onClick={() => navigate('/')}>
          <ChevronLeft size={20} />
        </button>
        <div className="text-center flex-1">
          <div className="font-brand text-[17px] font-medium" style={{ color: 'var(--ink)' }}>Đơn hàng</div>
          <div className="text-[11px]" style={{ color: 'var(--mute)' }}>
            {filtered.length} đơn · {fmtShort(total)} · lời {fmtShort(totalProfit)}
          </div>
        </div>
        <div className="w-9" />
      </header>

      {/* Filters */}
      <div className="px-4 pt-3 pb-2 flex flex-col gap-2">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--mute-2)' }} />
          <input className="field-input pl-9 text-sm" placeholder="Tìm theo tên món…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {([['today', 'Hôm nay'], ['week', '7 ngày'], ['month', '30 ngày'], ['all', 'Tất cả']] as [PeriodFilter, string][]).map(([v, l]) => (
            <button key={v} className={`chip ${period === v ? 'active' : ''}`} onClick={() => setPeriod(v)}>{l}</button>
          ))}
          <span className="w-px bg-hair mx-1" />
          {([['all', 'Tất cả'], ['cash', 'Tiền mặt'], ['transfer', 'CK'], ['debt', 'Ghi nợ']] as [PayFilter, string][]).map(([v, l]) => (
            <button key={v} className={`chip ${pay === v ? 'active' : ''}`} onClick={() => setPay(v)}>{l}</button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {groups.map(([date, daySales]) => {
          const dayTotal = daySales.reduce((a, s) => a + s.total, 0)
          const label = date === today() ? 'Hôm nay' : date === yesterday() ? 'Hôm qua' : formatDate(date)
          return (
            <div key={date}>
              <div className="section-label">{label} · {daySales.length} đơn · {fmtShort(dayTotal)}</div>
              {daySales.map((s) => {
                const cust = s.customerId ? customers.find((c) => c.id === s.customerId) : null
                return (
                  <button key={s.id} className="list-row" onClick={() => navigate(`/don-hang/${s.id}`)}>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{
                      background: s.payMethod === 'cash' ? 'var(--up)' : s.payMethod === 'transfer' ? 'var(--gold)' : 'var(--down)'
                    }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>
                        {s.items[0]?.name || '—'}{s.items.length > 1 ? ` · ${s.items.length - 1} món khác` : ''}
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: 'var(--mute)' }}>
                        {formatTime(s.date)} · {payLabel(s.payMethod)} · {s.items.reduce((a, i) => a + i.qty, 0)} món
                        {cust ? ` · ${cust.name}` : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium stat-num" style={{ color: 'var(--ink)' }}>{fmt(s.total)}</div>
                      <div className="text-[11px] stat-num" style={{ color: s.profit < 0 ? 'var(--down)' : 'var(--mute)' }}>
                        {s.profit >= 0 ? '+' : ''}{fmt(s.profit)}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div className="text-center py-16 text-sm" style={{ color: 'var(--mute)' }}>Chưa có đơn nào</div>
        )}
      </div>
    </div>
  )
}
