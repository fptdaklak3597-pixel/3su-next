/**
 * 3SU Next — Kiểm kê & Dự báo tồn kho
 * Port từ 16b-stocktake.js (kiểm kê, điều chỉnh tồn) và 28-stock-forecast.js
 * (dự báo ngày hết hàng dựa trên tốc độ bán).
 */
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmtNum, vnDaysAgo, vnToday } from '@/core/format'
import { salesInDateRange } from '@/core/domain/sales'
import { saveStocktake, forecastStock, selectStocktakeRows } from '@/core/domain/inventory'
import { logError } from '@/core/errorLogger'
import { ConfirmDialog } from '@/shared/components'
import { ChevronLeft, ClipboardCheck, TrendingDown } from 'lucide-react'
import type { Product, Sale } from '@/core/types'

type Tab = 'stocktake' | 'forecast'

export function StocktakePage() {
  const navigate = useNavigate()
  const showToast = useApp((s) => s.showToast)
  const [tab, setTab] = useState<Tab>('stocktake')
  const [actual, setActual] = useState<Record<string, number>>({})
  const [touched, setTouched] = useState<Record<string, true>>({})
  const [note, setNote] = useState('')
  const [confirmSave, setConfirmSave] = useState(false)
  const [saving, setSaving] = useState(false)

  const products = useLiveQuery(
    () => dbx.products.filter((p) => !p.deleted).toArray(),
    [],
    [] as Product[],
  )
  const sales = useLiveQuery(() => salesInDateRange(vnDaysAgo(29), vnToday()), [], [] as Sale[])

  /* ─── Kiểm kê ─── */
  const rows = useMemo(
    () =>
      products
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
        .map((p) => ({
          productId: p.id,
          name: p.name,
          unit: p.unit,
          system: p.stock,
          actual: actual[p.id] ?? p.stock,
        })),
    [products, actual],
  )

  const diffCount = rows.filter((r) => r.actual !== r.system).length
  const saveRows = selectStocktakeRows(rows, new Set(Object.keys(touched)))

  function markActual(productId: string, raw: string) {
    setTouched((t) => ({ ...t, [productId]: true }))
    if (raw.trim() === '') {
      setActual((a) => {
        const next = { ...a }
        delete next[productId]
        return next
      })
      return
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    setActual((a) => ({ ...a, [productId]: n }))
  }

  async function handleSaveStocktake() {
    setSaving(true)
    try {
      const picked = selectStocktakeRows(rows, new Set(Object.keys(touched)))
      await saveStocktake(
        picked.map((r) => ({ productId: r.productId, name: r.name, system: r.system, actual: r.actual })),
        note.trim(),
      )
      showToast(`✓ Đã kiểm kê ${picked.length} sản phẩm`, 'ok')
      setActual({})
      setTouched({})
      setNote('')
      navigate('/kho')
    } catch (e) {
      logError(e, 'stocktake.save')
      showToast('Lỗi khi lưu kiểm kê', 'bad')
    } finally {
      setSaving(false)
      setConfirmSave(false)
    }
  }

  /* ─── Dự báo ─── */
  const forecast = useMemo(() => forecastStock(products, sales, 30), [products, sales])

  return (
    <div className="flex flex-col h-full">
      <header className="app-hdr bordered">
        <button className="btn-back" onClick={() => navigate('/kho')}>
          <ChevronLeft size={20} />
        </button>
        <div className="font-brand text-[17px] font-medium flex-1 text-center" style={{ color: 'var(--ink)' }}>
          Kiểm kê & Dự báo
        </div>
        <div className="w-9" />
      </header>

      {/* Tabs */}
      <div className="px-4 pt-3">
        <div className="flex rounded-xl p-1" style={{ background: 'var(--paper-2)', border: '0.5px solid var(--hair)' }}>
          {([['stocktake', 'Kiểm kê'], ['forecast', 'Dự báo']] as [Tab, string][]).map(([t, label]) => (
            <button
              key={t}
              className="flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all"
              style={tab === t
                ? { background: 'var(--surface)', color: 'var(--ink)', boxShadow: '0 1px 3px rgba(0,0,0,.08)' }
                : { color: 'var(--mute)' }}
              onClick={() => setTab(t)}
            >
              {t === 'stocktake' ? <ClipboardCheck size={15} /> : <TrendingDown size={15} />}
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'stocktake' ? (
        <div className="flex-1 overflow-y-auto px-4 py-4 pb-32">
          <div className="text-[12px] mb-3" style={{ color: 'var(--mute)' }}>
            Nhập số lượng thực tế. Chênh lệch sẽ được điều chỉnh vào tồn kho.
          </div>
          <div className="flex flex-col gap-2">
            {rows.map((r) => {
              const diff = r.actual - r.system
              return (
                <div key={r.productId} className="card p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{r.name}</div>
                    <div className="text-[11px]" style={{ color: 'var(--mute)' }}>
                      Sổ sách: {r.system} {r.unit}
                      {diff !== 0 && (
                        <span style={{ color: diff > 0 ? 'var(--up)' : 'var(--down)' }}>
                          {' '}· {diff > 0 ? '+' : ''}{diff}
                        </span>
                      )}
                    </div>
                  </div>
                  <input
                    className="field-input !py-2 !px-3 w-20 text-center text-sm"
                    type="number"
                    inputMode="numeric"
                    value={actual[r.productId] ?? r.system}
                    onChange={(e) => markActual(r.productId, e.target.value)}
                  />
                </div>
              )
            })}
          </div>
          <input
            className="field-input mt-3 text-sm"
            placeholder="Ghi chú kiểm kê"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <div className="mt-4">
            <button className="btn-cta" disabled={saveRows.length === 0 || saving} onClick={() => setConfirmSave(true)}>
              Lưu kiểm kê ({saveRows.length} dòng)
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="text-[12px] mb-3" style={{ color: 'var(--mute)' }}>
            Dựa trên tốc độ bán 30 ngày gần nhất. Sản phẩm sắp hết hàng được liệt kê trước.
          </div>
          <div className="flex flex-col gap-2">
            {forecast.map((f) => {
              const urgent = f.daysLeft <= 7
              return (
                <div key={f.productId} className="card p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{f.name}</div>
                    <div className="text-[11px]" style={{ color: 'var(--mute)' }}>
                      Bán {fmtNum(f.avgPerDay * 30)}/tháng · gợi ý nhập {f.suggestedQty}
                    </div>
                  </div>
                  <span className={`stock-badge ${urgent ? 'out' : 'ok'}`}>
                    {f.daysLeft === Infinity ? '—' : `~${f.daysLeft} ngày`}
                  </span>
                </div>
              )
            })}
            {forecast.length === 0 && (
              <div className="text-center py-16 text-sm" style={{ color: 'var(--mute)' }}>
                Chưa đủ dữ liệu bán hàng để dự báo
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmSave}
        title="Lưu kiểm kê?"
        message={`${saveRows.length} dòng đã đếm sẽ được ghi. ${diffCount} dòng lệch sổ sẽ chỉnh tồn.`}
        confirmLabel="Lưu"
        onConfirm={handleSaveStocktake}
        onCancel={() => setConfirmSave(false)}
      />
    </div>
  )
}
