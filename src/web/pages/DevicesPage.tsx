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

  useEffect(() => {
    registerThisDevice().catch((e) => logError(e, 'device.register'))
    void isCloudPaused().then(setPaused)
  }, [])

  const sorted = [...devices].sort((a, b) => Number(b.isThis ?? false) - Number(a.isThis ?? false) || b.lastSeen - a.lastSeen)

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
    </div>
  )
}
