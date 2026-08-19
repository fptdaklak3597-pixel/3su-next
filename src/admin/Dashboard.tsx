import { Link } from 'react-router-dom'
import { fmtDuration } from './api'
import { filterFleet, isExpiringSoon, shopHealth } from './health'
import { ShopTable } from './ShopTable'
import { useAdminStore } from './store'

export function Dashboard() {
  const { shops, busy, err, q } = useAdminStore()
  const filtered = filterFleet(shops, q, 'all')
  const live = shops.filter((s) => shopHealth(s) === 'sống').length
  const expiring = shops.filter((s) => isExpiringSoon(s)).length
  const locked = shops.filter((s) => s.status === 'locked').length
  const top = [...shops]
    .filter((s) => (s.todaySeconds ?? 0) > 0)
    .sort((a, b) => (b.todaySeconds ?? 0) - (a.todaySeconds ?? 0))
    .slice(0, 8)

  return (
    <div className="admin-page">
      <h1 className="admin-title">Tổng quan</h1>
      {err && <p className="admin-err">{err}</p>}
      <div className="admin-kpis">
        <div className="admin-kpi"><span>Cửa hàng</span><strong>{shops.length}</strong></div>
        <div className="admin-kpi is-live"><span>Đang sống</span><strong>{live}</strong></div>
        <div className="admin-kpi is-soon"><span>Sắp hết hạn</span><strong>{expiring}</strong></div>
        <div className="admin-kpi is-lock"><span>Đã khoá</span><strong>{locked}</strong></div>
      </div>
      <section className="admin-card-block">
        <h2>Dùng nhiều hôm nay</h2>
        {top.length === 0 ? (
          <p className="admin-usage-empty">Chưa có giờ dùng hôm nay</p>
        ) : (
          <ol className="admin-top-usage">
            {top.map((s) => (
              <li key={s.shopId}>
                <Link to={`/shops/${s.shopId}`}>{s.name || s.shopId}</Link>
                <strong>{fmtDuration(s.todaySeconds)}</strong>
              </li>
            ))}
          </ol>
        )}
      </section>
      <ShopTable shops={filtered.slice(0, 10)} empty={busy ? 'Đang tải…' : 'Không có shop'} />
    </div>
  )
}
