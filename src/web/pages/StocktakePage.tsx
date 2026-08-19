/**
 * Kiểm kê / dự báo web — ?tab=forecast mở tab dự báo.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmtNum } from '@/core/format'
import { forecastStock, saveStocktake, selectStocktakeRows } from '@/core/domain/inventory'
import { createPurchaseOrder, forecastToPoRows } from '@/core/domain/purchase'
import { attachHidBarcode } from '@/core/browser/hidBarcode'
import { logError } from '@/core/errorLogger'
import { ConfirmDialog } from '@/shared/components'
import { WebEmpty } from '@/web/components/WebEmpty'
import type { Product, Sale, Supplier } from '@/core/types'

export function WebStocktakePage() {
  const navigate = useNavigate()
  const showToast = useApp((s) => s.showToast)
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'forecast' ? 'forecast' : 'stocktake'
  const [actual, setActual] = useState<Record<string, number>>({})
  const [touched, setTouched] = useState<Record<string, true>>({})
  const [note, setNote] = useState('')
  const [confirmSave, setConfirmSave] = useState(false)
  const [saving, setSaving] = useState(false)
  const [scanQ, setScanQ] = useState('')
  const [poBusy, setPoBusy] = useState(false)

  const suppliers = useLiveQuery(() => dbx.suppliers.filter((s) => !s.deleted).toArray(), [], [] as Supplier[])

  const products = useLiveQuery(() => dbx.products.filter((p) => !p.deleted).toArray(), [], [] as Product[])
  const sales = useLiveQuery(() => dbx.sales.toArray(), [], [] as Sale[])

  const rows = useMemo(
    () => products.slice().sort((a, b) => a.name.localeCompare(b.name, 'vi')).map((p) => ({
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

  function markActual(productId: string, value: number) {
    setTouched((t) => ({ ...t, [productId]: true }))
    setActual((a) => ({ ...a, [productId]: value }))
  }
  const forecast = useMemo(() => forecastStock(products, sales, 30), [products, sales])

  useEffect(() => attachHidBarcode((code) => {
    const p = products.find((x) => x.barcode && x.barcode === code)
    if (!p) { showToast('Không thấy mã ' + code, 'bad'); return }
    setTouched((t) => ({ ...t, [p.id]: true }))
    setActual((a) => ({ ...a, [p.id]: (a[p.id] ?? p.stock) + 1 }))
    setScanQ(p.name)
    showToast('Đếm +1 ' + p.name, 'ok')
  }), [products, showToast])

  function setTab(next: 'stocktake' | 'forecast') {
    setParams(next === 'forecast' ? { tab: 'forecast' } : {}, { replace: true })
  }

  async function handleSave() {
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

  return (
    <div className="web-page">
      <div className="web-ph">
        <div>
          <h2>{tab === 'forecast' ? 'Dự báo nhập' : 'Kiểm kê'}</h2>
          <p>{tab === 'forecast' ? 'Sắp hết theo tốc độ bán 30 ngày' : `${diffCount} dòng lệch · ${saveRows.length} dòng sẽ lưu`}</p>
        </div>
        {tab === 'stocktake' && (
          <button className="web-btn pri" disabled={saveRows.length === 0 || saving} onClick={() => setConfirmSave(true)}>
            Lưu kiểm kê
          </button>
        )}
        {tab === 'forecast' && (
          <button className="web-btn pri" disabled={poBusy || forecast.every((f) => f.suggestedQty <= 0)} onClick={async () => {
            const sup = suppliers[0]
            if (!sup) { showToast('Thêm nhà cung cấp trước', 'bad'); return }
            const poRows = forecastToPoRows(forecast, products)
            if (!poRows.length) { showToast('Không có món cần nhập', 'bad'); return }
            setPoBusy(true)
            try {
              const po = await createPurchaseOrder({
                supplierId: sup.id,
                supplierName: sup.name,
                rows: poRows,
                note: 'Từ dự báo tồn',
              })
              showToast(`✓ Đã tạo ${po.code} cho ${sup.name}`, 'ok')
              navigate('/nhap-hang')
            } catch (e) {
              logError(e, 'po.forecast')
              showToast(e instanceof Error ? e.message : 'Lỗi tạo đơn', 'bad')
            } finally {
              setPoBusy(false)
            }
          }}>Tạo phiếu nhập từ dự báo</button>
        )}
      </div>

      <div className="web-chips">
        <button className={`web-chip ${tab === 'stocktake' ? 'on' : ''}`} onClick={() => setTab('stocktake')}>Kiểm kê</button>
        <button className={`web-chip ${tab === 'forecast' ? 'on' : ''}`} onClick={() => setTab('forecast')}>Dự báo</button>
      </div>

      {tab === 'stocktake' ? (
        products.length === 0 ? (
          <WebEmpty title="Chưa có hàng để kiểm kê" sub="Thêm hàng hoặc nạp mẫu ở Hàng hóa.">
            <button className="web-btn pri" onClick={() => navigate('/kho')}>Mở hàng hóa</button>
          </WebEmpty>
        ) : (
          <>
            <input className="web-search mb-2" style={{ paddingLeft: 12 }} placeholder="Quét mã hoặc tìm tên…" value={scanQ} onChange={(e) => setScanQ(e.target.value)} />
            <div className="web-table-wrap">
              <table className="web-table">
                <thead>
                  <tr>
                    <th>Tên hàng</th>
                    <th>Sổ sách</th>
                    <th>Thực tế</th>
                    <th>Lệch</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.filter((r) => !scanQ || r.name.toLowerCase().includes(scanQ.toLowerCase())).map((r) => {
                    const diff = r.actual - r.system
                    return (
                      <tr key={r.productId} className="static">
                        <td>{r.name}</td>
                        <td>{r.system} {r.unit}</td>
                        <td>
                          <input
                            className="web-input"
                            style={{ width: 88, height: 30, textAlign: 'center' }}
                            type="number"
                            value={actual[r.productId] ?? r.system}
                            onChange={(e) => markActual(r.productId, Number(e.target.value) || 0)}
                          />
                        </td>
                        <td style={{ color: diff === 0 ? undefined : diff > 0 ? 'var(--ok)' : 'var(--bad)' }}>
                          {diff === 0 ? '—' : `${diff > 0 ? '+' : ''}${diff}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <input className="web-search mt-3" style={{ paddingLeft: 12 }} placeholder="Ghi chú kiểm kê" value={note} onChange={(e) => setNote(e.target.value)} />
          </>
        )
      ) : (
        <div className="web-table-wrap">
          <table className="web-table">
            <thead>
              <tr>
                <th>Tên hàng</th>
                <th>Bán / tháng</th>
                <th>Còn khoảng</th>
                <th>Gợi ý nhập</th>
              </tr>
            </thead>
            <tbody>
              {forecast.map((f) => (
                <tr key={f.productId} className="static">
                  <td>{f.name}</td>
                  <td>{fmtNum(f.avgPerDay * 30)}</td>
                  <td>
                    {f.daysLeft === Infinity ? '—' : (
                      <span className={`web-badge ${f.daysLeft <= 7 ? 'out' : 'low'}`}>~{f.daysLeft} ngày</span>
                    )}
                  </td>
                  <td>{f.suggestedQty}</td>
                </tr>
              ))}
              {forecast.length === 0 && (
                <tr className="static">
                  <td colSpan={4} className="web-table-empty">
                    Chưa đủ dữ liệu bán hàng để dự báo
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirmSave}
        title="Lưu kiểm kê?"
        message={`${saveRows.length} dòng đã đếm sẽ được ghi. ${diffCount} dòng lệch sổ sẽ chỉnh tồn.`}
        confirmLabel="Lưu"
        onConfirm={handleSave}
        onCancel={() => setConfirmSave(false)}
      />
    </div>
  )
}
