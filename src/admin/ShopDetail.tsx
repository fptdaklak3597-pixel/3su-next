import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Activity, Clock, Mail, MapPin, Monitor, Phone, RefreshCw, Users } from 'lucide-react'
import {
  extendShop,
  fmtAgo,
  fmtDuration,
  fmtSession,
  fmtWhen,
  getAdminShop,
  lockShop,
  unlockShop,
  type AdminShop,
} from './api'
import { HEALTH_LABEL, PLAN_LABEL, licenseBar, shopHealth, usageHeatmap14 } from './health'

const MONTHS = [1, 3, 6, 12]

function copyText(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => {})
}

function InfoRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="admin-info-row">
      <span className="admin-info-ico">{icon}</span>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function ShopDetail() {
  const { id = '' } = useParams()
  const [shop, setShop] = useState<AdminShop | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(true)
  const [reason, setReason] = useState('')

  async function reload() {
    const row = await getAdminShop(id)
    setShop(row)
    setReason(row.lockedReason || '')
  }

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    void getAdminShop(id)
      .then((row) => { if (!cancelled) { setShop(row); setReason(row.lockedReason || ''); setErr('') } })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'Lỗi tải') })
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [id])

  async function act(fn: () => Promise<AdminShop>) {
    setBusy(true)
    setErr('')
    try {
      const row = await fn()
      await reload().catch(() => setShop(row))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Thao tác lỗi')
    } finally {
      setBusy(false)
    }
  }

  if (!shop && busy) return <p className="admin-empty">Đang tải…</p>
  if (!shop) return <p className="admin-err">{err || 'Không thấy shop'}</p>

  const health = shopHealth(shop)
  const bar = licenseBar(shop)
  const heat = usageHeatmap14(shop.usage)
  const opsMap = new Map((shop.opsDays ?? []).map((d) => [d.day, d.ops]))
  const maxHeat = Math.max(1, ...heat.map((c) => c.seconds || (opsMap.get(c.day) ?? 0)))
  const session = fmtSession(shop.activeFrom || shop.lastFrom, shop.activeTo || shop.lastTo)
  const missingProfile = !shop.name && !shop.phone && !shop.address

  return (
    <div className="admin-page">
      <p><Link to="/shops" className="admin-back">← Đội shop</Link></p>
      <header className="admin-detail-head">
        <div>
          <h1>{shop.name || '(chưa đặt tên)'}</h1>
          <p className="admin-id">
            {shop.shopId}
            <button type="button" className="admin-copy" onClick={() => copyText(shop.shopId)}>Copy</button>
          </p>
        </div>
        <span className={`admin-health is-${health}`}>{HEALTH_LABEL[health]}</span>
      </header>
      {err && <p className="admin-err">{err}</p>}

      <div className="admin-detail-grid">
        <section className="admin-card-block">
          <h2>Thông tin cửa hàng</h2>
          <dl className="admin-info-list">
            <InfoRow icon={<Mail size={14} />} label="Gmail">{shop.ownerEmail || '—'}</InfoRow>
            <InfoRow icon={<Phone size={14} />} label="SĐT">{shop.phone || '—'}</InfoRow>
            <InfoRow icon={<MapPin size={14} />} label="Địa chỉ">{shop.address || '—'}</InfoRow>
            <InfoRow icon={<Users size={14} />} label="Chủ UID">
              {shop.ownerUid}
              <button type="button" className="admin-copy" onClick={() => copyText(shop.ownerUid)}>Copy</button>
            </InfoRow>
            <InfoRow icon={<Users size={14} />} label="Thành viên">{shop.members?.length ?? 0}</InfoRow>
          </dl>
          {missingProfile ? (
            <p className="admin-mute">Chưa đồng bộ tên / SĐT / địa chỉ từ máy bán hàng.</p>
          ) : null}
        </section>

        <section className="admin-card-block">
          <h2>Giấy phép <span className={`admin-plan is-${shop.plan || 'trial'}`}>{PLAN_LABEL[shop.plan] || shop.plan}</span></h2>
          {bar.unlimited ? (
            <p className="admin-license-line">Không hạn</p>
          ) : (
            <>
              <p className="admin-license-line">
                Đã dùng {bar.usedDays} / {bar.totalDays} ngày
                {bar.totalDays ? ` · ${Math.round(bar.fill * 100)}%` : ''}
              </p>
              <div className="admin-license-bar"><i style={{ width: `${Math.round(bar.fill * 100)}%` }} /></div>
              <p className="admin-mute">
                Hết hạn {fmtWhen(shop.expiresAt)}
                {bar.leftDays != null ? ` · ${bar.leftDays >= 0 ? `còn ${bar.leftDays} ngày` : 'đã hết'}` : ''}
              </p>
            </>
          )}
          <div className="admin-actions">
            {MONTHS.map((m) => (
              <button key={m} type="button" disabled={busy} onClick={() => void act(() => extendShop(shop.shopId, m))}>
                +{m} tháng
              </button>
            ))}
          </div>
          {shop.status === 'locked' ? (
            <button type="button" disabled={busy} onClick={() => void act(() => unlockShop(shop.shopId))}>
              Mở khoá
            </button>
          ) : (
            <>
              <input
                className="admin-search"
                placeholder="Lý do khoá (tuỳ chọn)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <button type="button" className="is-danger" disabled={busy} onClick={() => void act(() => lockShop(shop.shopId, reason))}>
                Khoá cửa hàng
              </button>
            </>
          )}
          {shop.lockedReason ? <p className="admin-mute">Lý do: {shop.lockedReason}</p> : null}
        </section>

        <section className="admin-card-block">
          <h2>Hoạt động</h2>
          <dl className="admin-info-list">
            <InfoRow icon={<RefreshCw size={14} />} label="Sync cuối">{fmtAgo(shop.lastOpAt)}</InfoRow>
            <InfoRow icon={<Clock size={14} />} label="Thời gian">{session}</InfoRow>
            <InfoRow icon={<Monitor size={14} />} label="Máy online">{shop.devicesOnline ?? 0}</InfoRow>
            <InfoRow icon={<Activity size={14} />} label="Op hôm nay">{shop.opsToday ?? 0}</InfoRow>
            <InfoRow icon={<Clock size={14} />} label="Giờ dùng máy">{fmtDuration(shop.todaySeconds)}</InfoRow>
          </dl>
          <p className="admin-heat-label">Hoạt động 14 ngày qua</p>
          <div className="admin-heat">
            {heat.map((c) => {
              const ops = opsMap.get(c.day) ?? 0
              const weight = c.seconds || ops
              const t = weight / maxHeat
              return (
                <div key={c.day} className="admin-heat-cell" title={`${c.day} · ${fmtDuration(c.seconds)} · ${ops} op`}>
                  <i style={{ opacity: weight ? 0.25 + t * 0.75 : 0.12, background: weight ? '#F59E0B' : '#1F2937' }} />
                  <span>{c.day.slice(8)}/{c.day.slice(5, 7)}</span>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <section className="admin-card-block">
        <h2>Thành viên ({shop.members?.length ?? 0})</h2>
        <table className="admin-table">
          <thead>
            <tr><th>UID</th><th>Vai trò</th><th>Tham gia</th></tr>
          </thead>
          <tbody>
            {(shop.members ?? []).map((m) => (
              <tr key={m.uid}>
                <td className="admin-id">{m.uid}</td>
                <td><span className={`admin-role is-${m.role}`}>{m.role === 'owner' ? 'Chủ sở hữu' : 'Nhân viên'}</span></td>
                <td>{fmtWhen(m.addedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
