/**
 * 3SU Next — Trang chủ (Home dashboard)
 * Port từ 13-home.js: hero profit, sparkline, stats, greeting, CTA.
 */
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { dayStats, weekProfitSeries, totalDebt } from '@/core/domain/sales'
import { fmt, fmtShort, today, yesterday, greeting } from '@/core/format'
import { Bell, ChevronRight, LayoutGrid, Smartphone } from 'lucide-react'
import { useInstallPrompt, useDisplayMode } from '@/shared/pwa'

export function HomePage() {
  const navigate = useNavigate()
  const shop = useApp((s) => s.shop)
  const online = useApp((s) => s.online)
  const cart = useApp((s) => s.cart)
  const { canInstall, installed, promptInstall } = useInstallPrompt()
  const displayMode = useDisplayMode()
  const showInstall = displayMode !== 'standalone' && !installed

  const sales = useLiveQuery(() => dbx.sales.toArray(), [], [])
  const customers = useLiveQuery(() => dbx.customers.toArray(), [], [])

  const stats = useMemo(() => {
    const t = dayStats(sales, today())
    const y = dayStats(sales, yesterday())
    const diff = t.profit - y.profit
    const pct = y.profit > 0 ? Math.round((diff / y.profit) * 100) : (t.profit > 0 ? 100 : 0)
    const debt = totalDebt(customers)
    const series = weekProfitSeries(sales, 7)
    return { t, y, diff, pct, debt, series }
  }, [sales, customers])

  const cartCount = cart.reduce((a, c) => a + c.qty, 0)

  return (
    <div className="pb-6">
      {/* Header */}
      <header className="app-hdr">
        <div className="font-brand text-[15px] font-medium flex items-center gap-2" style={{ color: 'var(--ink)' }}>
          {shop.name}
          {!online && (
            <span className="text-[10px] font-sans font-medium px-2 py-0.5 rounded-full bg-mute-2/20 text-mute">
              Mất mạng
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button className="btn-back" onClick={() => navigate('/them')} aria-label="Thêm">
            <LayoutGrid size={18} />
          </button>
          <button className="btn-back" onClick={() => navigate('/cai-dat')} aria-label="Cài đặt">
            <Bell size={18} />
          </button>
        </div>
      </header>

      <div className="px-6 max-w-[520px] mx-auto w-full">
        {/* Greeting */}
        <div className="mt-4 font-brand italic text-base" style={{ color: 'var(--mute)' }}>
          {greeting()}, chúc bạn buôn may bán đắt.
        </div>
        {showInstall && (
          <button className="card w-full p-4 mt-3 flex items-center gap-3 text-left" onClick={() => void promptInstall()}>
            <Smartphone size={20} style={{ color: 'var(--gold)' }} />
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Ghim ra màn hình</div>
              <div className="text-[11.5px]" style={{ color: 'var(--mute)' }}>
                {canInstall ? 'Chạm để cài app — lần sau mở như phần mềm' : 'Mở bằng Chrome rồi thêm ra màn hình chính'}
              </div>
            </div>
          </button>
        )}

        {/* Hero profit */}
        <section className="py-6">
          <div className="font-brand italic stat-num text-[clamp(64px,20vw,96px)] leading-[0.9] tracking-tight" style={{ color: 'var(--ink)' }}>
            {Math.round(stats.t.profit).toLocaleString('vi-VN')}
          </div>
          <div className="font-brand italic text-base mt-2" style={{ color: 'var(--mute)' }}>
            {stats.t.profit === 0 ? 'chưa có lời' : stats.t.profit < 0 ? 'đang lỗ' : 'đồng lời hôm nay'}
          </div>

          {/* Delta */}
          <div className={`mt-4 text-xs font-medium flex items-center gap-2 ${stats.diff > 0 ? 'text-up' : stats.diff < 0 ? 'text-down' : 'text-mute'}`}>
            {stats.y.profit === 0 && stats.t.profit === 0 ? (
              <span>Chưa có đơn hôm nay</span>
            ) : stats.diff >= 0 ? (
              <span>↗ Hơn hôm qua <b className="font-brand">{stats.pct}%</b></span>
            ) : (
              <span>↘ Ít hơn hôm qua <b className="font-brand">{Math.abs(stats.pct)}%</b></span>
            )}
          </div>

          {/* Sparkline */}
          <Sparkline data={stats.series} />
        </section>

        {/* Stats row */}
        <section className="flex border-t border-b py-4" style={{ borderColor: 'var(--hair)' }}>
          <div className="flex-1 pr-3">
            <div className="stat-num text-xl" style={{ color: 'var(--ink)' }}>{fmtShort(stats.t.revenue)}</div>
            <div className="text-[10px] font-medium mt-1 tracking-widest uppercase" style={{ color: 'var(--mute)' }}>Doanh thu</div>
          </div>
          <div className="flex-1 px-3 border-l" style={{ borderColor: 'var(--hair)' }}>
            <div className="stat-num text-xl" style={{ color: 'var(--ink)' }}>{stats.t.orders}</div>
            <div className="text-[10px] font-medium mt-1 tracking-widest uppercase" style={{ color: 'var(--mute)' }}>Đơn</div>
          </div>
          <div className="flex-1 pl-3 border-l" style={{ borderColor: 'var(--hair)' }}>
            <div className="stat-num text-xl" style={{ color: 'var(--ink)' }}>{fmtShort(stats.debt)}</div>
            <div className="text-[10px] font-medium mt-1 tracking-widest uppercase" style={{ color: 'var(--mute)' }}>Còn nợ</div>
          </div>
        </section>

        {/* CTA */}
        <section className="pt-6 flex flex-col gap-3">
          {cartCount > 0 && (
            <button className="btn-ghost w-full text-center italic font-brand" onClick={() => navigate('/ban-hang')}>
              Tiếp tục đơn đang dở ({cartCount} món)
            </button>
          )}
          <button className="btn-outline" onClick={() => navigate('/ban-hang')}>
            <span>Bắt đầu bán</span>
            <ChevronRight size={16} />
          </button>
        </section>
      </div>
    </div>
  )
}

/* ─── Sparkline SVG ─── */
function Sparkline({ data }: { data: { date: string; profit: number }[] }) {
  const nonZero = data.filter((d) => d.profit !== 0).length
  if (nonZero < 2) return null

  const W = 300, H = 42, pad = 3
  const max = Math.max(1, ...data.map((d) => Math.abs(d.profit)))
  const xStep = (W - pad * 2) / (data.length - 1)
  const y0 = H / 2 + (H / 2 - pad)

  const points = data.map((d, i) => ({
    x: pad + i * xStep,
    y: y0 - (d.profit / max) * (H / 2 - pad),
    d,
  }))

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const fillPath = linePath + ` L${points[points.length - 1].x.toFixed(1)},${y0} L${points[0].x.toFixed(1)},${y0} Z`
  const last = points[points.length - 1]

  return (
    <svg className="mt-4 w-full h-[42px]" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <path d={fillPath} fill="var(--mute-2)" opacity={0.18} />
      <path d={linePath} fill="none" stroke="var(--ink-3)" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r={2.5} fill="var(--ink)" />
    </svg>
  )
}
