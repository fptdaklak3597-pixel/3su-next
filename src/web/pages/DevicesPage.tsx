/**
 * Danh sách thiết bị đã thấy trên máy này (in / gỡ).
 * Thiết bị trên máy này. Đồng bộ cửa hàng: cùng email chủ, hoặc mã một lần.
 */
import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { logError } from '@/core/errorLogger'
import { devicePlatform, registerThisDevice, removeDevice, setDeviceRole } from '@/core/domain/devices'
import { pullCloudSnapshot, pushLocalSnapshot } from '@/core/sync/engine'
import { connectCloud, disconnectCloud, isCloudPaused } from '@/core/sync/cloud'
import {
  approveInvoicePairing, currentRoleForDevices, currentShopForDevices, denyInvoicePairing,
  listInvoiceDevices, lookupInvoicePairing, revokeInvoiceDevice, type InvoiceDeviceRow,
} from '@/core/sync/invoiceDevices'
import { ConfirmDialog } from '@/shared/components'
import { WebEmpty } from '@/web/components/WebEmpty'
import type { PairedDevice } from '@/core/types'

function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1) return 'vừa xong'
  if (m < 60) return `${m} phút trước`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} giờ trước`
  return `${Math.floor(h / 24)} ngày trước`
}

export function WebDevicesPage() {
  const showToast = useApp((s) => s.showToast)
  const [delTarget, setDelTarget] = useState<PairedDevice | null>(null)
  const [busy, setBusy] = useState(false)
  const [paused, setPaused] = useState(false)
  const devices = useLiveQuery(() => dbx.devices.toArray(), [], [] as PairedDevice[])

  // Thiết bị hóa đơn (desktop)
  const [invoiceDevices, setInvoiceDevices] = useState<InvoiceDeviceRow[]>([])
  const [invBusy, setInvBusy] = useState(false)
  const [pairCode, setPairCode] = useState('')
  const [pairInfo, setPairInfo] = useState<{ deviceName: string; status: string } | null>(null)
  const [role, setRole] = useState('')
  const [revokeTarget, setRevokeTarget] = useState<InvoiceDeviceRow | null>(null)

  const reloadInvoiceDevices = () => {
    void currentShopForDevices().then((shopId) => {
      if (!shopId) return
      listInvoiceDevices(shopId).then(setInvoiceDevices).catch(() => setInvoiceDevices([]))
    })
    void currentRoleForDevices().then(setRole)
  }

  useEffect(() => {
    registerThisDevice().catch((e) => logError(e, 'device.register'))
    void isCloudPaused().then(setPaused)
    reloadInvoiceDevices()
  }, [])

  const sorted = [...devices].sort((a, b) => Number(b.isThis ?? false) - Number(a.isThis ?? false) || b.lastSeen - a.lastSeen)

  const normalizeCode = (raw: string) => raw.trim().toUpperCase()

  const checkPairing = () => {
    const code = normalizeCode(pairCode)
    if (!code) return
    setInvBusy(true)
    lookupInvoicePairing(code)
      .then((info) => {
        setPairInfo({ deviceName: info.deviceName, status: info.status })
      })
      .catch((e) => {
        setPairInfo(null)
        showToast(e instanceof Error ? e.message : 'Không tra được mã', 'bad')
      })
      .finally(() => setInvBusy(false))
  }

  const actOnPairing = (approve: boolean) => {
    const code = normalizeCode(pairCode)
    if (!code) return
    setInvBusy(true)
    void currentShopForDevices()
      .then(async (shopId) => {
        if (!shopId) throw new Error('Chưa vào cửa hàng cloud')
        if (approve) await approveInvoicePairing(code, shopId)
        else await denyInvoicePairing(code)
        showToast(approve ? 'Đã duyệt máy' : 'Đã từ chối máy', 'ok')
        setPairCode('')
        setPairInfo(null)
        reloadInvoiceDevices()
      })
      .catch((e) => showToast(e instanceof Error ? e.message : 'Lỗi xử lý mã', 'bad'))
      .finally(() => setInvBusy(false))
  }

  const revokeDevice = (deviceId: string) => {
    setInvBusy(true)
    void currentShopForDevices()
      .then(async (shopId) => {
        if (!shopId) throw new Error('Chưa vào cửa hàng cloud')
        await revokeInvoiceDevice(shopId, deviceId)
        showToast('Đã thu hồi quyền thiết bị', 'ok')
        reloadInvoiceDevices()
      })
      .catch((e) => showToast(e instanceof Error ? e.message : 'Lỗi thu hồi', 'bad'))
      .finally(() => {
        setInvBusy(false)
        setRevokeTarget(null)
      })
  }

  return (
    <div className="web-page">
      <div className="web-ph">
        <div>
          <h2>Thiết bị</h2>
          <p>Máy đã mở app trên trình duyệt này. Máy mới: Tài khoản → tạo mã. Nhân viên dùng Gmail của họ.</p>
        </div>
      </div>

      <div className="web-hub">
        <div className="web-card">
          <div className="web-settings-block-t">Đồng bộ</div>
          <p className="web-sub" style={{ marginTop: 8 }}>
            Chủ cửa hàng đăng nhập cùng email trên mọi máy. Máy mới hoặc nhân viên: mở <strong>Tài khoản</strong>, nhập mã một lần — dùng Gmail của họ, không lấy email chủ.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="web-btn"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                pushLocalSnapshot().then(() => {
                  showToast('Đã đẩy bản sao lên cloud', 'ok')
                }).catch((e) => showToast(e instanceof Error ? e.message : 'Lỗi đẩy bản sao', 'bad')).finally(() => setBusy(false))
              }}
            >
              Đẩy bản sao lên cloud
            </button>
            <button
              type="button"
              className="web-btn"
              disabled={busy}
              onClick={() => {
                if (!confirm('Kéo dữ liệu cloud sẽ thay dữ liệu trên máy này. Tiếp tục?')) return
                setBusy(true)
                pullCloudSnapshot(true).then(() => {
                  showToast('Đã kéo dữ liệu cloud', 'ok')
                  setTimeout(() => window.location.reload(), 600)
                }).catch((e) => showToast(e instanceof Error ? e.message : 'Lỗi kéo dữ liệu', 'bad')).finally(() => setBusy(false))
              }}
            >
              Kéo dữ liệu từ cloud
            </button>
            <button
              type="button"
              className="web-btn"
              disabled={busy || paused}
              onClick={() => {
                setBusy(true)
                disconnectCloud().then(() => {
                  setPaused(true)
                  showToast('Đã ngắt cloud', 'ok')
                }).catch((e) => showToast(e instanceof Error ? e.message : 'Lỗi ngắt cloud', 'bad')).finally(() => setBusy(false))
              }}
            >
              Ngắt cloud
            </button>
            <button
              type="button"
              className="web-btn"
              disabled={busy || !paused}
              onClick={() => {
                setBusy(true)
                connectCloud({ resume: true }).then((ok) => {
                  if (ok) {
                    setPaused(false)
                    showToast('Đã bật lại cloud', 'ok')
                  } else {
                    showToast('Không nối được cloud', 'bad')
                  }
                }).catch((e) => showToast(e instanceof Error ? e.message : 'Lỗi bật cloud', 'bad')).finally(() => setBusy(false))
              }}
            >
              Bật lại cloud
            </button>
          </div>
        </div>

        <div className="web-card">
          <div className="web-settings-block-t">Thiết bị đã thấy</div>
          {sorted.length === 0 ? (
            <div style={{ marginTop: 12 }}>
              <WebEmpty title="Chưa có thiết bị" sub="Máy này tự đăng ký khi mở trang." />
            </div>
          ) : (
            <div className="web-table-wrap" style={{ marginTop: 12 }}>
              <table className="web-table">
                <thead>
                  <tr>
                    <th>Tên</th>
                    <th>Nền tảng</th>
                    <th>Hoạt động</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((d) => (
                    <tr key={d.id} className="static">
                      <td>{d.name}{d.isThis && <span className="web-badge ok ml-2">máy này</span>}</td>
                      <td>{d.platform}</td>
                      <td>{timeAgo(d.lastSeen)}</td>
                      <td>
                        {d.role === 'print-agent' && <span className="web-badge ok mr-2">máy in</span>}
                        <button type="button" className="web-btn" style={{ height: 28 }} onClick={() => void setDeviceRole(d.id, d.role === 'print-agent' ? '' : 'print-agent')}>
                          {d.role === 'print-agent' ? 'Bỏ tag in' : 'Tag máy in'}
                        </button>
                        {!d.isThis && <button type="button" className="web-btn" style={{ height: 28, marginLeft: 6 }} onClick={() => setDelTarget(d)}>Gỡ</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="web-sub" style={{ marginTop: 12 }}>Nền tảng hiện tại: {devicePlatform()}</p>
        </div>

        <div className="web-card">
          <div className="web-settings-block-t">Thiết bị hóa đơn (máy tính)</div>
          <p className="web-sub" style={{ marginTop: 8 }}>
            App 3SU Invoice trên máy tính phải được duyệt qua đây mới chạy được. Mở app, nhập mã hiển thị trên đó vào ô dưới rồi bấm <strong>Duyệt máy</strong>.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={pairCode}
              onChange={(e) => { setPairCode(e.target.value.toUpperCase()); setPairInfo(null) }}
              placeholder="MãVD-AB12"
              maxLength={10}
              aria-label="Mã ghép nối"
              style={{
                border: '1px solid var(--kv-border, #cbd5e1)', borderRadius: 8, padding: '7px 10px',
                font: 'inherit', textTransform: 'uppercase', width: 130, letterSpacing: '.06em',
              }}
            />
            <button type="button" className="web-btn" disabled={invBusy || !pairCode.trim()} onClick={checkPairing}>
              Kiểm tra
            </button>
            {pairInfo && pairInfo.status === 'pending' && (
              <>
                <span className="web-badge ok">“{pairInfo.deviceName || 'Máy không tên'}” đang chờ</span>
                <button type="button" className="web-btn pri" disabled={invBusy} onClick={() => actOnPairing(true)}>
                  Duyệt máy
                </button>
                <button type="button" className="web-btn" disabled={invBusy} onClick={() => actOnPairing(false)}>
                  Từ chối
                </button>
              </>
            )}
            {pairInfo && pairInfo.status !== 'pending' && (
              <span className="web-badge">Mã đã được xử lý trước đó</span>
            )}
          </div>

          <div className="web-table-wrap" style={{ marginTop: 14 }}>
            <table className="web-table">
              <thead>
                <tr>
                  <th>Máy</th>
                  <th>Trạng thái</th>
                  <th>Hoạt động lần cuối</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invoiceDevices.length === 0 ? (
                  <tr className="static"><td colSpan={4}>Chưa có máy nào được duyệt.</td></tr>
                ) : invoiceDevices.map((d) => (
                  <tr key={d.deviceId} className="static">
                    <td>{d.deviceName || d.deviceId}</td>
                    <td>
                      {d.status === 'active'
                        ? <span className="web-badge ok">đang hoạt động</span>
                        : <span className="web-badge">đã thu hồi</span>}
                    </td>
                    <td>{d.lastSeenAt ? timeAgo(d.lastSeenAt) : 'chưa có'}</td>
                    <td>
                      {d.status === 'active' && role === 'owner' && (
                        <button type="button" className="web-btn" style={{ height: 28 }} onClick={() => setRevokeTarget(d)}>
                          Thu hồi
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!delTarget}
        title="Gỡ thiết bị?"
        message={`Gỡ "${delTarget?.name}" khỏi danh sách máy này?`}
        confirmLabel="Gỡ"
        danger
        onConfirm={async () => {
          if (!delTarget) return
          try {
            await removeDevice(delTarget.id)
            showToast('Đã gỡ thiết bị', 'ok')
          } catch (e) {
            logError(e, 'device.remove')
            showToast(e instanceof Error ? e.message : 'Lỗi', 'bad')
          } finally {
            setDelTarget(null)
          }
        }}
        onCancel={() => setDelTarget(null)}
      />

      <ConfirmDialog
        open={!!revokeTarget}
        title="Thu hồi thiết bị?"
        message={`Thu hồi quyền của "${revokeTarget?.deviceName || revokeTarget?.deviceId}"? App 3SU Invoice trên máy này sẽ bị khóa ở lần kiểm tra kế tiếp.`}
        confirmLabel="Thu hồi"
        danger
        onConfirm={async () => {
          if (!revokeTarget) return
          revokeDevice(revokeTarget.deviceId)
        }}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  )
}
