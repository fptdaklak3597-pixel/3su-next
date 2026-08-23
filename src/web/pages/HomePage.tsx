/**
 * 3SU Web — Tổng quan (Dashboard 2 cột cân đối, giao diện KiotViet sáng).
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Banknote,
  ClipboardList,
  Undo2,
  TrendingUp,
  CheckCircle2,
  Circle,
} from 'lucide-react'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { dayStats, weekProfitSeries, totalDebt, salesInDateRange } from '@/core/domain/sales'
import { forecastStock } from '@/core/domain/inventory'
import { fmt, localDay, today, yesterday, daysToExpiry, escapeHtml, vnDaysAgo, vnToday } from '@/core/format'
import type { Product, Sale, Customer } from '@/core/types'
import { PrintStatusLine } from '@/shared/PrintStatus'
import { useDisplayMode, useInstallPrompt } from '@/shared/pwa'
import { WebSeedSheet } from '@/web/components/WebSeedSheet'

export function WebHomePage() {
  const navigate = useNavigate()
  const settings = useApp((s) => s.settings)
  const shop = useApp((s) => s.shop)
  const [seedOpen, setSeedOpen] = useState(false)
  const { canInstall, installed, promptInstall } = useInstallPrompt()
  const displayMode = useDisplayMode()
  const showInstall = displayMode !== 'standalone' && !installed

  const sales = useLiveQuery(() => salesInDateRange(vnDaysAgo(13), vnToday()), [], [] as Sale[])
  const customers = useLiveQuery(() => dbx.customers.filter((c) => !c.deleted).toArray(), [], [] as Customer[])
  const products = useLiveQuery(() => dbx.products.filter((p) => !p.deleted).toArray(), [], [] as Product[])

  const stats = useMemo(() => {
    const t = dayStats(sales, today())
    const y = dayStats(sales, yesterday())
    const revDiff = t.revenue - y.revenue
    const revPct = y.revenue > 0 ? Math.round((revDiff / y.revenue) * 100) : (t.revenue > 0 ? 100 : 0)
    const returned = sales.filter((s) => s.voided && localDay(s.date) === today()).reduce((a, s) => a + s.total, 0)
    const monthDays = new Date().getDate()
    const series = weekProfitSeries(sales, monthDays)
    const debt = totalDebt(customers)
    const names = new Map(customers.map((c) => [c.id, c.name]))
    const recent = [...sales]
      .filter((s) => !s.voided)
      .sort((a, b) => +new Date(b.date) - +new Date(a.date))
      .slice(0, 6)
      .map((s) => ({
        id: s.id,
        name: s.customerId ? (names.get(s.customerId) || 'Khách lẻ') : 'Khách lẻ',
        total: s.total,
        when: timeAgo(s.date),
      }))
    const nearHsd = products.filter((p) => {
      const d = daysToExpiry(p.expiry)
      return d !== null && d >= 0 && d <= settings.hsdWarnDays
    })
    const todos: { text: string; to: string }[] = []
    for (const f of forecastStock(products, sales).filter((x) => x.daysLeft <= 7 && x.suggestedQty > 0).slice(0, 2)) {
      todos.push({ text: `${f.name} còn ${Math.round(f.daysLeft)} ngày`, to: '/kiem-ke?tab=forecast' })
    }
    if (debt > 0) todos.push({ text: `Công nợ ${fmt(debt)}`, to: '/khach-hang' })
    for (const p of nearHsd.slice(0, 1)) todos.push({ text: `${p.name} gần HSD`, to: `/kho/${p.id}` })
    return { t, y, revDiff, revPct, returned, series, recent, todos }
  }, [sales, customers, products, settings.lowStock, settings.hsdWarnDays])

  const emptyShop = products.length === 0 && sales.length === 0

  return (
    <div className="web-page">
      <div className="web-grid-dash">
        
        {/* ─── CỘT TRÁI (NỘI DUNG CHÍNH - 68%) ─── */}
        <div className="web-dash-main">
          
          {/* Onboarding khi cửa hàng mới chưa có hàng */}
          {emptyShop && (
            <div className="web-onboard">
              <div className="web-onboard-h">Cửa hàng chưa có hàng</div>
              <div className="web-onboard-sub">
                Làm lần lượt: hàng → bán đơn đầu → (tuỳ) STK VietQR → tab Máy in trên máy tính.
              </div>
              <div className="web-onboard-steps">
                <span className="web-onboard-step ok">
                  <CheckCircle2 size={15} /> Tạo tài khoản
                </span>
                <span className={`web-onboard-step ${products.length ? 'ok' : ''}`}>
                  {products.length ? <CheckCircle2 size={15} /> : <Circle size={15} />} Có hàng trong kho
                </span>
                <span className={`web-onboard-step ${sales.length ? 'ok' : ''}`}>
                  {sales.length ? <CheckCircle2 size={15} /> : <Circle size={15} />} Đã bán đơn đầu
                </span>
                <span className={`web-onboard-step ${settings.bankAccount ? 'ok' : ''}`}>
                  {settings.bankAccount ? <CheckCircle2 size={15} /> : <Circle size={15} />} Điền STK VietQR
                </span>
              </div>
              <div className="web-onboard-actions">
                <button type="button" className="web-btn pri" onClick={() => navigate('/kho/new')}>
                  + Thêm hàng mới
                </button>
                <button type="button" className="web-btn" onClick={() => setSeedOpen(true)}>
                  Nạp mẫu 500 mặt hàng
                </button>
              </div>
            </div>
          )}

          {/* 4 Thẻ thống kê KPI hôm nay */}
          <div className="web-kpis-4">
            <div className="web-kpi-card">
              <div className="web-kpi-head">
                <span className="web-kpi-label">Doanh thu hôm nay</span>
                <div className="web-kpi-ico blue"><Banknote size={17} /></div>
              </div>
              <div className="web-kpi-val">{fmt(stats.t.revenue)}</div>
              <div className="web-kpi-desc">
                {stats.y.revenue === 0 && stats.t.revenue === 0
                  ? 'Chưa có đơn hôm nay'
                  : stats.revDiff >= 0
                    ? `↗ hơn hôm qua ${stats.revPct}%`
                    : `↘ ít hơn hôm qua ${Math.abs(stats.revPct)}%`}
              </div>
            </div>

            <div className="web-kpi-card">
              <div className="web-kpi-head">
                <span className="web-kpi-label">Số đơn hàng</span>
                <div className="web-kpi-ico purple"><ClipboardList size={17} /></div>
              </div>
              <div className="web-kpi-val">{stats.t.orders}</div>
              <div className="web-kpi-desc">
                {stats.t.orders === 0 ? '0 đơn hoàn tất' : `${stats.t.items} món đã bán`}
              </div>
            </div>

            <div className="web-kpi-card">
              <div className="web-kpi-head">
                <span className="web-kpi-label">Lợi nhuận tạm tính</span>
                <div className="web-kpi-ico green"><TrendingUp size={17} /></div>
              </div>
              <div className="web-kpi-val">{fmt(stats.t.profit)}</div>
              <div className="web-kpi-desc">
                {stats.t.revenue > 0 ? `Tỷ suất LN: ${Math.round((stats.t.profit / stats.t.revenue) * 100)}%` : 'Tỷ suất: --%'}
              </div>
            </div>

            <div className="web-kpi-card">
              <div className="web-kpi-head">
                <span className="web-kpi-label">Khách trả hàng</span>
                <div className="web-kpi-ico orange"><Undo2 size={17} /></div>
              </div>
              <div className="web-kpi-val">{fmt(stats.returned)}</div>
              <div className="web-kpi-desc">
                {stats.returned === 0 ? '0 phiếu trả hôm nay' : 'Đơn đã hủy trong ngày'}
              </div>
            </div>
          </div>

          {/* Biểu đồ doanh thu tháng */}
          <div className="web-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 14 }}>Doanh thu thuần tháng này</h3>
                <span style={{ fontSize: 12, color: 'var(--kv-subtle)' }}>Tháng {new Date().getMonth() + 1}/{new Date().getFullYear()}</span>
              </div>
              <button
                type="button"
                className="web-btn"
                onClick={() => {
                  const w = window.open('', '_blank')
                  if (!w) return
                  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Báo cáo ngày</title>
                    <style>body{font:14px sans-serif;padding:16px}h1{font-size:18px}</style></head><body>
                    <h1>${escapeHtml(shop.name || '3SU')} — ${today()}</h1>
                    <p>Doanh thu ${fmt(stats.t.revenue)} · Lợi nhuận ${fmt(stats.t.profit)} · ${stats.t.orders} đơn</p>
                    </body></html>`)
                  w.document.close()
                  w.print()
                }}
              >
                In báo cáo ngày
              </button>
            </div>
            <MonthBars data={stats.series} />
          </div>
        </div>

        {/* ─── CỘT PHẢI (WIDGETS & TIỆN ÍCH - 32%) ─── */}
        <div className="web-dash-side">
          
          {showInstall && (
            <div className="web-card" style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 13.5 }}>Ghim ra màn hình</h3>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--kv-muted)', lineHeight: 1.4 }}>
                {canInstall ? 'Cài như phần mềm — lần sau mở từ desktop.' : 'Mở bằng Chrome rồi thêm ra màn hình chính.'}
              </p>
              <button type="button" className="web-btn pri" disabled={!canInstall} onClick={() => void promptInstall()}>
                Cài đặt ứng dụng
              </button>
            </div>
          )}

          {/* Widget Máy in — giống mockup */}
          <div className="web-card" style={{ marginBottom: 16 }}>
            <div className="side-title" style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12 }}>Máy in bill</div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              background: 'var(--kv-surface-2)', border: '1px solid var(--kv-line)', borderRadius: 8, padding: '10px 12px',
            }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>Trang Máy in trên máy tính</div>
                <PrintStatusLine />
              </div>
              <button
                type="button"
                className="web-btn"
                style={{ color: 'var(--blue)', background: 'var(--blue-soft)', borderColor: '#BFDBFE', fontWeight: 600, fontSize: 12 }}
                onClick={() => navigate('/may-in')}
              >
                Mở trang in
              </button>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--kv-muted)', lineHeight: 1.4 }}>
              Mở tab Máy in và giữ nguyên. Điện thoại bán hàng sẽ tự động in bill.
            </p>
          </div>

          {/* Widget Thao tác nhanh — giống mockup */}
          <div className="web-card" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 13.5 }}>Thao tác nhanh</h3>
            <div className="web-shortcut-grid">
              <button type="button" className="web-sc-item" onClick={() => navigate('/nhap-hang')}>
                <strong>📥 Nhập hàng</strong>
                <span>Từ nhà cung cấp</span>
              </button>
              <button type="button" className="web-sc-item" onClick={() => navigate('/kiem-ke')}>
                <strong>📋 Kiểm kê</strong>
                <span>Cân đối tồn kho</span>
              </button>
              <button type="button" className="web-sc-item" onClick={() => navigate('/khach-hang')}>
                <strong>👥 Khách nợ</strong>
                <span>Thu nợ & lịch sử</span>
              </button>
              <button type="button" className="web-sc-item" onClick={() => navigate('/bao-cao')}>
                <strong>📊 Báo cáo</strong>
                <span>Chi tiết doanh thu</span>
              </button>
            </div>
          </div>

          {/* Hoạt động gần đây */}
          <div className="web-card">
            <h3 style={{ margin: '0 0 10px', fontSize: 13.5 }}>Hoạt động gần đây</h3>
            {stats.recent.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '22px 10px', color: 'var(--kv-muted)', fontSize: 12 }}>
                Chưa có giao dịch phát sinh hôm nay.
              </div>
            ) : (
              stats.recent.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className="web-act"
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={() => navigate(`/don-hang/${it.id}`)}
                >
                  <div className="web-av">{it.name.charAt(0)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      Bán đơn cho {it.name}
                    </p>
                    <div className="t" style={{ fontSize: 11, color: 'var(--kv-subtle)' }}>{it.when}</div>
                  </div>
                  <div className="m" style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--kv-fg)' }}>
                    {fmt(it.total)}
                  </div>
                </button>
              ))
            )}

            {stats.todos.length > 0 && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--kv-line)' }}>
                {stats.todos.map((it) => (
                  <button key={it.text} type="button" className="web-rank w-full text-left" onClick={() => navigate(it.to)}>
                    <span>{it.text}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

        </div>

      </div>
      <WebSeedSheet open={seedOpen} onClose={() => setSeedOpen(false)} />
    </div>
  )
}

function MonthBars({ data }: { data: { date: string; revenue: number }[] }) {
  const max = Math.max(0, ...data.map((d) => d.revenue))
  const show = data.filter((_, i) => data.length <= 12 || i % Math.ceil(data.length / 12) === 0 || i === data.length - 1)
  // Chưa có doanh thu: vẽ cột minh họa mờ (giống mockup), không để toàn bộ phẳng 0.
  const demo = max <= 0
  const demoH = [12, 28, 16, 40, 22, 48, 32, 62, 78]
  return (
    <div className="web-bars">
      {show.map((d, i) => {
        const h = demo
          ? demoH[i % demoH.length]
          : Math.max(6, (d.revenue / max) * 100)
        return (
          <div key={d.date} className="web-bar">
            <i style={{ height: `${h}%`, opacity: demo ? 0.45 : 1 }} />
            <span>{d.date.slice(8)}</span>
          </div>
        )
      })}
    </div>
  )
}

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'Vừa xong'
  if (m < 60) return `${m} phút trước`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} giờ trước`
  if (h < 48) return 'Hôm qua'
  return `${Math.floor(h / 24)} ngày trước`
}
