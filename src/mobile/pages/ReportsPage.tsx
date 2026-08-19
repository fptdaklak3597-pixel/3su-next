/**
 * 3SU Next — Báo cáo (Reports)
 * Port từ 17a-reports-ext.js: preset kỳ, metric toggle, so sánh kỳ trước,
 * biểu đồ, top sản phẩm / danh mục, phân bổ thanh toán.
 */
import { useState, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmt, fmtShort, formatDate } from '@/core/format'
import { buildReport, type ReportPreset, type ReportMetric, type ReportFilters } from '@/core/domain/reports'
import { productCategories } from '@/core/domain/inventory'
import { answerQuestion } from '@/core/browser/quickAnswers'
import { Sparkles, Send } from 'lucide-react'
import type { Sale, Product, Customer } from '@/core/types'

const PRESETS: { key: ReportPreset; label: string }[] = [
  { key: '7', label: '7 ngày' },
  { key: '30', label: '30 ngày' },
  { key: 'mtd', label: 'Tháng này' },
  { key: 'ytd', label: 'Năm nay' },
  { key: 'all', label: 'Tất cả' },
]

export function ReportsPage() {
  const settings = useApp((s) => s.settings)
  const [preset, setPreset] = useState<ReportPreset>('7')
  const [metric, setMetric] = useState<ReportMetric>('profit')
  const [cat, setCat] = useState('all')
  const [compare, setCompare] = useState(true)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const sales = useLiveQuery(() => dbx.sales.toArray(), [], [] as Sale[])
  const customers = useLiveQuery(() => dbx.customers.toArray(), [], [] as Customer[])
  const products = useLiveQuery(
    () => dbx.products.filter((p) => !p.deleted).toArray(),
    [],
    [] as Product[],
  )

  const cats = useMemo(() => productCategories(products), [products])

  const report = useMemo(() => {
    const filters: ReportFilters = {
      preset, from, to, metric, cat, pay: 'all', customerId: null, compare,
    }
    return buildReport(sales, products, filters)
  }, [sales, products, preset, from, to, metric, cat, compare])

  const chartData = report.daily.map((d) => ({
    label: formatDate(d.date).replace('Hôm nay', 'HN').replace('Hôm qua', 'HQ'),
    value: metric === 'profit' ? d.profit : d.revenue,
  }))

  const mainValue = metric === 'profit' ? report.profit : report.revenue
  const prevValue = report.prev ? (metric === 'profit' ? report.prev.profit : report.prev.revenue) : null
  const delta = prevValue !== null && prevValue > 0
    ? Math.round(((mainValue - prevValue) / prevValue) * 100)
    : null

  const maxProdQty = report.topProducts[0]?.qty || 1

  return (
    <div className="flex flex-col h-full">
      <header className="app-hdr bordered">
        <div>
          <div className="font-brand text-[17px] font-medium" style={{ color: 'var(--ink)' }}>Báo cáo</div>
          <div className="text-[11px]" style={{ color: 'var(--mute)' }}>
            {formatDate(report.from)} → {formatDate(report.to)}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {/* Trợ lý nhanh */}
        <Assistant sales={sales} customers={customers} products={products} lowStock={settings.lowStock} />

        {/* Preset kỳ */}
        <div className="flex gap-2 overflow-x-auto py-3 -mx-1 px-1">
          {PRESETS.map((p) => (
            <button key={p.key} className={`chip ${preset === p.key ? 'active' : ''}`} onClick={() => setPreset(p.key)}>
              {p.label}
            </button>
          ))}
          <button className={`chip ${preset === 'custom' ? 'active' : ''}`} onClick={() => setPreset('custom')}>Từ ngày</button>
        </div>
        {preset === 'custom' && (
          <div className="flex gap-2 mb-3">
            <input className="field-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input className="field-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}

        {/* Metric toggle */}
        <div className="flex rounded-xl p-1 mb-4" style={{ background: 'var(--paper-2)', border: '0.5px solid var(--hair)' }}>
          {(['profit', 'revenue'] as ReportMetric[]).map((m) => (
            <button
              key={m}
              className="flex-1 py-2 rounded-lg text-sm font-medium transition-all"
              style={metric === m
                ? { background: 'var(--surface)', color: 'var(--ink)', boxShadow: '0 1px 3px rgba(0,0,0,.08)' }
                : { color: 'var(--mute)' }}
              onClick={() => setMetric(m)}
            >
              {m === 'profit' ? 'Lợi nhuận' : 'Doanh thu'}
            </button>
          ))}
        </div>

        {/* Hero metric */}
        <div className="card p-5 mb-4">
          <div className="text-xs font-medium mb-1" style={{ color: 'var(--mute)' }}>
            {metric === 'profit' ? 'Tổng lợi nhuận' : 'Tổng doanh thu'}
          </div>
          <div className="stat-num text-[34px] leading-none font-medium" style={{ color: 'var(--ink)' }}>
            {fmt(mainValue)}
          </div>
          {delta !== null && (
            <div className="mt-2 text-xs font-medium" style={{ color: delta >= 0 ? 'var(--up)' : 'var(--down)' }}>
              {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% so với kỳ trước
            </div>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <MiniStat label="Đơn hàng" value={String(report.orders)} />
          <MiniStat label="Sản phẩm" value={String(report.items)} />
          <MiniStat label="TB/đơn" value={fmtShort(report.avgOrder)} />
        </div>

        {/* Chart */}
        {chartData.length > 0 && (
          <div className="card p-4 mb-4">
            <div className="text-xs font-medium mb-3" style={{ color: 'var(--mute)' }}>
              Xu hướng {metric === 'profit' ? 'lợi nhuận' : 'doanh thu'}
            </div>
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradMetric" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--gold)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--gold)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--hair-2)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--mute)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--mute)' }} tickLine={false} axisLine={false} tickFormatter={(v) => fmtShort(v)} width={54} />
                  <Tooltip
                    formatter={(v: number) => [fmt(v), metric === 'profit' ? 'Lợi nhuận' : 'Doanh thu']}
                    contentStyle={{ background: 'var(--surface)', border: '0.5px solid var(--hair)', borderRadius: 12, fontSize: 12 }}
                    labelStyle={{ color: 'var(--mute)' }}
                  />
                  <Area type="monotone" dataKey="value" stroke="var(--gold)" strokeWidth={2} fill="url(#gradMetric)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Top sản phẩm */}
        <div className="section-label">Sản phẩm bán chạy</div>
        <div className="card divide-y" style={{ borderColor: 'var(--hair)' }}>
          {report.topProducts.slice(0, 8).map((p, i) => (
            <div key={p.productId} className="flex items-center gap-3 px-4 py-3">
              <span className="stat-num text-sm w-5 text-center" style={{ color: i < 3 ? 'var(--gold)' : 'var(--mute-2)' }}>
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{p.name}</div>
                <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--paper-2)' }}>
                  <div className="h-full rounded-full" style={{ width: `${(p.qty / maxProdQty) * 100}%`, background: 'var(--gold)' }} />
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{p.qty}</div>
                <div className="text-[11px]" style={{ color: 'var(--mute)' }}>{fmtShort(p.revenue)}</div>
              </div>
            </div>
          ))}
          {report.topProducts.length === 0 && (
            <div className="text-center py-8 text-sm" style={{ color: 'var(--mute)' }}>Chưa có dữ liệu bán hàng</div>
          )}
        </div>

        {/* Danh mục */}
        {report.topCategories.length > 0 && (
          <>
            <div className="section-label">Theo danh mục</div>
            <div className="card px-4 py-1">
              {report.topCategories.map((c) => (
                <div key={c.cat} className="flex items-center justify-between py-2.5" style={{ borderBottom: '0.5px solid var(--hair-2)' }}>
                  <span className="text-sm" style={{ color: 'var(--ink-2)' }}>{c.cat}</span>
                  <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{fmtShort(c.revenue)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Thanh toán */}
        {report.payBreakdown.length > 0 && (
          <>
            <div className="section-label">Hình thức thanh toán</div>
            <div className="grid grid-cols-3 gap-2">
              {report.payBreakdown.map((p) => (
                <div key={p.method} className="card p-3 text-center">
                  <div className="text-[11px] mb-1" style={{ color: 'var(--mute)' }}>{p.method}</div>
                  <div className="stat-num text-base font-medium" style={{ color: 'var(--ink)' }}>{p.count}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--mute-2)' }}>{fmtShort(p.amount)}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Filters phụ */}
        <div className="section-label">Bộ lọc</div>
        <div className="flex flex-wrap gap-2">
          <button className={`chip ${cat === 'all' ? 'active' : ''}`} onClick={() => setCat('all')}>Tất cả danh mục</button>
          {cats.map((c) => (
            <button key={c} className={`chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
        <label className="flex items-center gap-3 mt-4 px-1 cursor-pointer" onClick={() => setCompare(!compare)}>
          <span className="w-10 h-6 rounded-full relative transition-colors" style={{ background: compare ? 'var(--up)' : 'var(--hair)' }}>
            <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: compare ? 18 : 2 }} />
          </span>
          <span className="text-sm" style={{ color: 'var(--ink-2)' }}>So sánh với kỳ trước</span>
        </label>

        <div className="text-center text-[11px] mt-6" style={{ color: 'var(--mute-2)' }}>
          Ngưỡng tồn kho thấp: {settings.lowStock} · dữ liệu lưu trên máy
        </div>
      </div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3 text-center">
      <div className="stat-num text-lg font-medium" style={{ color: 'var(--ink)' }}>{value}</div>
      <div className="text-[11px] mt-0.5" style={{ color: 'var(--mute)' }}>{label}</div>
    </div>
  )
}

/* ─── Trợ lý hỏi đáp nhanh ─── */
const SUGGESTIONS = ['Hôm nay bán sao?', 'Tuần qua lời bao nhiêu?', 'Bán chạy hôm nay', 'Khách đang nợ?', 'Sắp hết hàng?']

function Assistant({ sales, customers, products, lowStock }: {
  sales: Sale[]
  customers: Customer[]
  products: Product[]
  lowStock: number
}) {
  const [q, setQ] = useState('')
  const [answer, setAnswer] = useState('')

  async function ask(text: string) {
    const query = text.trim()
    if (!query) return
    setQ(query)
    const a = await answerQuestion(query, sales, customers, products, lowStock)
    setAnswer(a)
  }

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={15} style={{ color: 'var(--gold)' }} />
        <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Trợ lý cửa hàng</span>
      </div>
      <div className="flex gap-2">
        <input
          className="field-input text-sm flex-1"
          placeholder="Hỏi về doanh thu, công nợ, tồn kho…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask(q)}
        />
        <button className="btn-back" onClick={() => ask(q)} aria-label="Hỏi">
          <Send size={16} />
        </button>
      </div>
      <div className="flex gap-1.5 flex-wrap mt-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="chip !text-[11px]" onClick={() => ask(s)}>{s}</button>
        ))}
      </div>
      {answer && (
        <div className="mt-3 px-3 py-2.5 rounded-xl text-sm leading-relaxed" style={{ background: 'var(--paper-2)', color: 'var(--ink-2)' }}
          dangerouslySetInnerHTML={{ __html: answer }} />
      )}
    </div>
  )
}
