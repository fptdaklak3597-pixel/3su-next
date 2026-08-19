import { Link } from 'react-router-dom'
import { daysLeft, daysUsed, fmtAgo, fmtDuration, type AdminShop } from './api'
import { HEALTH_LABEL, PLAN_LABEL, remainingTone, shopHealth } from './health'

export function ShopTable({ shops, empty }: { shops: AdminShop[]; empty: string }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Cửa hàng</th>
            <th>Liên hệ</th>
            <th>Gói</th>
            <th>Tình trạng</th>
            <th>Sử dụng</th>
            <th>Thời hạn</th>
            <th>Sync cuối</th>
          </tr>
        </thead>
        <tbody>
          {shops.map((s) => {
            const health = shopHealth(s)
            const left = daysLeft(s.expiresAt)
            const tone = remainingTone(s.expiresAt)
            const opened = daysUsed(s.createdAt)
            const stale = !s.lastOpAt || Date.now() - s.lastOpAt >= 48 * 60 * 60 * 1000
            const remainFill = s.expiresAt == null || (left != null && left < 0)
              ? 0
              : Math.min(1, Math.max(0, (left ?? 0) / Math.max(left ?? 1, 30)))
            return (
              <tr key={s.shopId}>
                <td>
                  <Link to={`/shops/${s.shopId}`}>
                    <strong>{s.name || '(chưa đặt tên)'}</strong>
                    <span className="admin-id">{s.shopId}</span>
                  </Link>
                </td>
                <td>
                  <div>{s.ownerEmail || s.ownerUid}</div>
                  <span className="admin-mute">{s.phone || '—'}</span>
                </td>
                <td><span className={`admin-plan is-${s.plan || 'trial'}`}>{PLAN_LABEL[s.plan] || s.plan || '—'}</span></td>
                <td><span className={`admin-health is-${health}`}>{HEALTH_LABEL[health]}</span></td>
                <td>
                  <div>{fmtDuration(s.todaySeconds)}</div>
                  <span className="admin-mute">
                    {s.opsToday ? `${s.opsToday} op` : ''}
                    {s.opsToday && opened != null ? ' · ' : ''}
                    {opened == null ? (s.opsToday ? '' : '—') : `Đã mở ${opened} ngày`}
                  </span>
                </td>
                <td>
                  <div className={`admin-remain is-${tone}`}>
                    {s.expiresAt == null ? 'Không hạn' : left != null && left >= 0 ? `còn ${left} ngày` : 'đã hết'}
                  </div>
                  <div className={`admin-mini-bar is-${tone}`}>
                    <i style={{ width: `${Math.round(remainFill * 100)}%` }} />
                  </div>
                </td>
                <td className={stale ? 'is-stale' : ''}>{fmtAgo(s.lastOpAt)}</td>
              </tr>
            )
          })}
          {shops.length === 0 && (
            <tr><td colSpan={7} className="admin-empty">{empty}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
