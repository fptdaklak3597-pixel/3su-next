
/**
 * Báo cáo web — kỳ, KPI, top hàng, thanh toán.
 */
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, Printer, TrendingUp, Sparkles, BarChart3 } from 'lucide-react'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmt, fmtShort } from '@/core/format'
import { salesInDateRange } from '@/core/domain/sales'
import { buildReport, exportReportXlsx, reportSalesWindow, type ReportFilters, type ReportMetric, type ReportPreset } from '@/core/domain/reports'
import { logError } from '@/core/errorLogger'
import { productCategories } from '@/core/domain/inventory'
import { answerQuestion } from '@/core/browser/quickAnswers'
import { WebEmpty } from '@/web/components/WebEmpty'
import { WebDateRange } from '@/web/components/WebDateRange'
import type { Customer, Product, Sale } from '@/core/types'

const PRESETS: { key: ReportPreset; label: string }[] = [
  { key: '7', label: '7 ngày' },
  { key: '30', label: '30 ngày' },
  { key: 'mtd', label: 'Tháng này' },
  { key: 'ytd', label: 'Năm nay' },
  { key: 'all', label: 'Tất cả' },
]

export function WebReportsPage() {
  const settings = useApp((s) => s.settings)
  const [preset, setPreset] = useState<ReportPreset>('mtd')
  const [metric, setMetric] = useState<ReportMetric>('revenue')
  const [cat, setCat] = useState('all')
  const [q, setQ] = useState('')
  const [answer, setAnswer] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const salesWindow = useMemo(() => reportSalesWindow({
    preset, from, to, metric, cat, pay: 'all', customerId: null, compare: true,
  }), [preset, from, to, metric, cat])
  const sales = useLiveQuery(
    () => salesInDateRange(salesWindow.from, salesWindow.to),
    [salesWindow.from, salesWindow.to],
    [] as Sale[],
  )
  const customers = useLiveQuery(() => dbx.customers.toArray(), [], [] as Customer[])
  const products = useLiveQuery(() => dbx.products.filter((p) => !p.deleted).toArray(), [], [] as Product[])
  const cats = useMemo(() => productCategories(products), [products])

  const report = useMemo(() => {
    const filters: ReportFilters = {
      preset, from, to, metric, cat, pay: 'all', customerId: null, compare: true,
    }
    return buildReport(sales, products, filters)
  }, [sales, products, preset, from, to, metric, cat])

  const main = metric === 'profit' ? report.profit : report.revenue
  const prev = report.prev ? (metric === 'profit' ? report.prev.profit : report.prev.revenue) : null
  const delta = prev !== null && prev > 0 ? Math.round(((main - prev) / prev) * 100) : null
  const maxBar = Math.max(1, ...report.daily.map((d) => (metric === 'profit' ? d.profit : d.revenue)))

  async function ask(text: string) {
    const query = text.trim()
    if (!query) return
    setQ(query)
    setAnswer(await answerQuestion(query, sales, customers, products, settings.lowStock))
  }

  return (
    <div className="web-page">
      <div className="web-list-hdr">
        <div>
          <div className="web-eyebrow">Phân tích</div>
          <h1 className="web-list-title">Báo cáo</h1>
          <div className="web-list-sub">{report.from} → {report.to}</div>
        </div>
        <div className="web-list-hdr-actions">
          <button className="web-btn" onClick={() => {
            try { void exportReportXlsx(report) } catch (e) { logError(e, 'report.xlsx') }
          }}><Download size={13} strokeWidth={1.6} />Xuất Excel</button>
          <button className="web-btn" onClick={() => window.print()}><Printer size={13} strokeWidth={1.6} />In kỳ này</button>
        </div>
      </div>

      <div className="web-chips">
        {PRESETS.map((p) => (
          <button key={p.key} className={`web-chip ${preset === p.key ? 'on' : ''}`} onClick={() => setPreset(p.key)}>{p.label}</button>
        ))}
        <WebDateRange
          from={from}
          to={to}
          active={preset === 'custom'}
          onChange={(a, b) => { setFrom(a); setTo(b); setPreset(a || b ? 'custom' : 'mtd') }}
        />
        <button className={`web-chip ${metric === 'revenue' ? 'on' : ''}`} onClick={() => setMetric('revenue')}>Doanh thu</button>
        <button className={`web-chip ${metric === 'profit' ? 'on' : ''}`} onClick={() => setMetric('profit')}>Lợi nhuận</button>
        <button className={`web-chip ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>Mọi nhóm</button>
        {cats.map((c) => (
          <button key={c} className={`web-chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>

      <div className="web-reports-kpis">
        <div className="web-kpi-card">
          <div className="web-kpi-head">
            <div className="web-kpi-label">{metric === 'profit' ? 'Lợi nhuận' : 'Doanh thu'}</div>
            <div className="web-kpi-ico blue"><TrendingUp size={13} strokeWidth={1.6} /></div>
          </div>
          <div className="web-kpi-val">{fmt(main)}</div>
          <div className={`web-kpi-desc ${delta !== null && delta < 0 ? 'dn' : ''}`}>
            {delta === null ? 'Chưa có kỳ trước' : `${delta >= 0 ? '↗' : '↘'} ${Math.abs(delta)}% so với kỳ trước`}
          </div>
        </div>
        <div className="web-kpi-card">
          <div className="web-kpi-head">
            <div className="web-kpi-label">Đơn</div>
            <div className="web-kpi-ico green"><BarChart3 size={13} strokeWidth={1.6} /></div>
          </div>
          <div className="web-kpi-val">{report.orders}</div>
          <div className="web-kpi-desc">{report.items} món</div>
        </div>
        <div className="web-kpi-card">
          <div className="web-kpi-head">
            <div className="web-kpi-label">TB/đơn</div>
            <div className="web-kpi-ico orange"><Sparkles size={13} strokeWidth={1.6} /></div>
          </div>
          <div className="web-kpi-val">{fmtShort(report.avgOrder)}</div>
          <div className="web-kpi-desc">{report.payBreakdown.map((p) => `${p.method} ${p.count}`).join(' · ') || '—'}</div>
        </div>
      </div>

      {report.daily.length > 0 && (
        <div className="web-card" style={{ marginBottom: 12 }}>
          <h3>Xu hướng</h3>
          <div className="web-bars">
            {report.daily.map((d) => {
              const v = metric === 'profit' ? d.profit : d.revenue
              return (
                <div key={d.date} className="web-bar" title={`${d.date}: ${fmt(v)}`}>
                  <i style={{ height: `${Math.max(4, (v / maxBar) * 100)}%` }} />
                  <span>{d.date.slice(8)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {report.orders === 0 && (
        <WebEmpty title="Chưa có đơn trong kỳ này" sub="Bán đơn đầu để thấy doanh thu, lợi nhuận và top hàng." />
      )}

      <div className="web-reports-2col">
        <div className="web-card">
          <h3>Sản phẩm bán chạy</h3>
          {report.topProducts.slice(0, 10).map((p, i) => (
            <div key={p.productId} className="web-rank">
              <span>{i + 1}. {p.name}</span>
              <span>{p.qty} · {fmtShort(p.revenue)}</span>
            </div>
          ))}
          {report.topProducts.length === 0 && <div className="text-[13px]" style={{ color: 'var(--kv-subtle)' }}>Chưa có dữ liệu</div>}
        </div>
        <div className="web-card">
          <h3>Theo danh mục</h3>
          {report.topCategories.map((c) => (
            <div key={c.cat} className="web-rank">
              <span>{c.cat}</span>
              <span>{fmtShort(c.revenue)}</span>
            </div>
          ))}
          {report.topCategories.length === 0 && <div className="text-[13px]" style={{ color: 'var(--kv-subtle)' }}>Chưa có dữ liệu</div>}
        </div>
      </div>

      <div className="web-card" style={{ marginTop: 12 }}>
        <div>
          <h3>Hỏi nhanh</h3>
          <input
            className="web-search mb-2"
            style={{ paddingLeft: 12 }}
            placeholder="Hôm nay bán sao?"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void ask(q)}
          />
          <div className="web-chips">
            {['Hôm nay bán sao?', 'Tháng này lãi không?', 'Khách đang nợ?', 'Sắp hết hàng?', 'Hàng nào bán chạy?'].map((s) => (
              <button key={s} className="web-chip" onClick={() => void ask(s)}>{s}</button>
            ))}
          </div>
          {answer && <div className="text-sm mt-2" dangerouslySetInnerHTML={{ __html: answer }} />}
        </div>
      </div>
    </div>
  )
}
