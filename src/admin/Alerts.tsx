import { Link } from 'react-router-dom'
import { ALERT_LABEL, matchesSearch, shopAlertReasons } from './health'
import { useAdminStore } from './store'

export function Alerts() {
  const { shops, busy, err, q } = useAdminStore()
  const rows = shops
    .filter((s) => matchesSearch(s, q))
    .map((shop) => ({ shop, reasons: shopAlertReasons(shop) }))
    .filter((r) => r.reasons.length > 0)

  return (
    <div className="admin-page">
      <h1 className="admin-title">Cảnh báo</h1>
      {err && <p className="admin-err">{err}</p>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Cửa hàng</th>
              <th>Lý do</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ shop, reasons }) => (
              <tr key={shop.shopId}>
                <td>
                  <Link to={`/shops/${shop.shopId}`}>
                    <strong>{shop.name || '(chưa đặt tên)'}</strong>
                    <span className="admin-id">{shop.shopId}</span>
                  </Link>
                </td>
                <td>
                  <ul className="admin-reason-list">
                    {reasons.map((r) => <li key={r}>{ALERT_LABEL[r]}</li>)}
                  </ul>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={2} className="admin-empty">{busy ? 'Đang tải…' : 'Không có cảnh báo'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
