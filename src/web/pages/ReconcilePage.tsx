/**
 * Đối soát tồn / công nợ — chỉ đọc, không tự sửa số.
 */
import { useState } from 'react'
import { explainDebtDrift, explainStockDrift, reconcileBooks, type ReconcileReport } from '@/core/domain/reconcile'
import { logError } from '@/core/errorLogger'
import { fmtNum } from '@/core/format'

export function WebReconcilePage() {
  const [report, setReport] = useState<ReconcileReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function run() {
    setBusy(true)
    setErr('')
    try {
      setReport(await reconcileBooks())
    } catch (e) {
      logError(e, 'reconcile')
      setErr(e instanceof Error ? e.message : 'Lỗi đối soát')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="web-page">
      <div className="web-ph">
        <div>
          <div className="web-eyebrow">Báo cáo</div>
          <h2>Đối soát sổ</h2>
          <p>Tồn = tổng xuất nhập; nợ = đơn ghi nợ − phiếu thu. Lệch thì cờ đỏ — không tự sửa.</p>
        </div>
        <button className="web-btn pri" disabled={busy} onClick={() => void run()}>
          {busy ? 'Đang tính…' : 'Chạy đối soát'}
        </button>
      </div>

      {err && <p className="web-sub" style={{ color: 'var(--bad)' }}>{err}</p>}

      {report && (
        <>
          <div className="web-today" style={{ marginBottom: 12 }}>
            <div className="web-kpis">
              <div className="web-kpi">
                <div>
                  <div className="l">Hàng khớp</div>
                  <div className="n">{fmtNum(report.stockOk)}</div>
                </div>
              </div>
              <div className="web-kpi">
                <div>
                  <div className="l">Hàng lệch</div>
                  <div className="n" style={{ color: report.stockDrifts.length ? 'var(--bad)' : undefined }}>{fmtNum(report.stockDrifts.length)}</div>
                </div>
              </div>
              <div className="web-kpi">
                <div>
                  <div className="l">Khách khớp</div>
                  <div className="n">{fmtNum(report.debtOk)}</div>
                </div>
              </div>
              <div className="web-kpi">
                <div>
                  <div className="l">Nợ lệch</div>
                  <div className="n" style={{ color: report.debtDrifts.length ? 'var(--bad)' : undefined }}>{fmtNum(report.debtDrifts.length)}</div>
                </div>
              </div>
            </div>
          </div>

          {report.stockDrifts.length > 0 && (
            <div className="web-table-wrap" style={{ marginBottom: 16 }}>
              <table className="web-table">
                <thead>
                  <tr><th>Hàng</th><th>Tồn máy</th><th>Sổ xuất nhập</th><th>Lệch</th><th>Vì sao</th></tr>
                </thead>
                <tbody>
                  {report.stockDrifts.slice(0, 80).map((r) => (
                    <tr key={r.productId} className="static">
                      <td>{r.name}</td>
                      <td>{fmtNum(r.stock)}</td>
                      <td>{fmtNum(r.ledger)}</td>
                      <td style={{ color: 'var(--bad)' }}>{fmtNum(r.drift)}</td>
                      <td className="web-sub">{explainStockDrift(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report.debtDrifts.length > 0 && (
            <div className="web-table-wrap">
              <table className="web-table">
                <thead>
                  <tr><th>Khách</th><th>Nợ máy</th><th>Sổ đơn − thu</th><th>Lệch</th><th>Vì sao</th></tr>
                </thead>
                <tbody>
                  {report.debtDrifts.slice(0, 80).map((r) => (
                    <tr key={r.customerId} className="static">
                      <td>{r.name}</td>
                      <td>{fmtNum(r.debt)}</td>
                      <td>{fmtNum(r.ledger)}</td>
                      <td style={{ color: 'var(--bad)' }}>{fmtNum(r.drift)}</td>
                      <td className="web-sub">{explainDebtDrift(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report.stockDrifts.length === 0 && report.debtDrifts.length === 0 && (
            <p className="web-sub">Sổ khớp — tồn và công nợ trùng chứng từ.</p>
          )}
        </>
      )}
    </div>
  )
}
