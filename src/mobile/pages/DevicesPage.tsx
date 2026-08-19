/**
 * 3SU Next — Ghép đôi thiết bị (Device pairing)
 * Port từ 60-device-pairing.js: đăng ký thiết bị, mã ghép đôi, gỡ thiết bị.
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { logError } from '@/core/errorLogger'
import {
  registerThisDevice, removeDevice, devicePlatform, setDeviceRole,
} from '@/core/domain/devices'
import { pullCloudSnapshot, pushLocalSnapshot } from '@/core/sync/engine'
import { textQrSrc } from '@/core/browser/textQr'
import { ConfirmDialog, EmptyState } from '@/shared/components'
import { ChevronLeft, Smartphone, Trash2, CloudOff, Cloud } from 'lucide-react'
import { cloudSendEmailLink, cloudSignInGoogle, isFirebaseConfigured } from '@/core/sync/firebase'
import { apiBase, attachExistingCloudShop, connectCloud, createCloudShop, createPairCode, disconnectCloud, getCloudShopId, isCloudPaused, redeemPairCode } from '@/core/sync/cloud'
import type { PairedDevice } from '@/core/types'

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'vừa xong'
  if (m < 60) return `${m} phút trước`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} giờ trước`
  return `${Math.floor(h / 24)} ngày trước`
}

function CloudSyncSection() {
  const showToast = useApp((s) => s.showToast)
  const [email, setEmail] = useState('')
  const [pairIn, setPairIn] = useState('')
  const [cloudCode, setCloudCode] = useState('')
  const [shopId, setShopId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [paused, setPaused] = useState(false)
  const configured = isFirebaseConfigured() && !!apiBase()

  useEffect(() => {
    void getCloudShopId().then(setShopId)
    void isCloudPaused().then(setPaused)
  }, [])

  async function afterAuth() {
    const id = (await getCloudShopId()) || (await attachExistingCloudShop())
    if (id) {
      await connectCloud()
      setShopId(id)
      showToast('Đã vào cửa hàng', 'ok')
      return
    }
    showToast('Đăng nhập OK — bấm Tạo cửa hàng nếu đây là máy đầu', 'ok')
  }

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center gap-2 mb-2">
        {shopId ? <Cloud size={16} style={{ color: 'var(--up)' }} /> : <CloudOff size={16} style={{ color: 'var(--mute)' }} />}
        <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Cloud sync đa thiết bị</span>
      </div>
      <p className="text-[11px] mb-2" style={{ color: 'var(--mute)' }}>
        Máy đầu: tạo cửa hàng. Máy mới / nhân viên: nhập mã, dùng Gmail của họ — không lấy email chủ.
      </p>
      {!configured && (
        <p className="text-[11px]" style={{ color: 'var(--mute)' }}>
          Chưa cấu hình VITE_FIREBASE_* / VITE_API_BASE — app vẫn chạy offline.
        </p>
      )}
      {configured && !shopId && (
        <div className="flex flex-col gap-2">
          <input className="field-input" placeholder="Email cloud" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn-cta" disabled={busy} onClick={() => {
            setBusy(true)
            cloudSendEmailLink(email).then(() => showToast('Đã gửi mail xác nhận. Mở hộp thư rồi bấm liên kết.', 'ok')).catch((e) => showToast(e instanceof Error ? e.message : 'Lỗi', 'bad')).finally(() => setBusy(false))
          }}>Gửi mail vào cửa hàng</button>
          <button className="btn-ghost text-sm" disabled={busy} onClick={() => {
            setBusy(true)
            cloudSignInGoogle().then((u) => { if (u) return afterAuth() }).catch((e) => showToast(e instanceof Error ? e.message : 'Lỗi', 'bad')).finally(() => setBusy(false))
          }}>Đăng nhập Google</button>
          <button className="btn-ghost text-sm" disabled={busy} onClick={() => {
            setBusy(true)
            createCloudShop().then((id) => connectCloud().then(() => { setShopId(id); showToast('Đã tạo cửa hàng cloud', 'ok') })).catch((e) => showToast(e instanceof Error ? e.message : 'Lỗi', 'bad')).finally(() => setBusy(false))
          }}>Tạo cửa hàng cloud</button>
          <div className="flex gap-2">
            <input className="field-input flex-1" placeholder="Mã ghép 6 ký tự" value={pairIn} onChange={(e) => setPairIn(e.target.value.toUpperCase())} />
            <button className="btn-ghost" disabled={busy} onClick={() => {
              setBusy(true)
              redeemPairCode(pairIn).then((id) => connectCloud().then(() => { setShopId(id); showToast('Đã ghép máy', 'ok') })).catch((e) => showToast(e instanceof Error ? e.message : 'Lỗi', 'bad')).finally(() => setBusy(false))
            }}>Ghép</button>
          </div>
        </div>
      )}
      {shopId && (
        <div>
          <p className="text-[11px] mb-2" style={{ color: 'var(--mute)' }}>Shop {shopId}</p>
          <button className="btn-cta" disabled={busy} onClick={() => {
            setBusy(true)
            createPairCode().then((r) => setCloudCode(r.code)).catch((e) => showToast(e instanceof Error ? e.message : 'Lỗi', 'bad')).finally(() => setBusy(false))
          }}>Tạo mã QR ghép máy</button>
          {cloudCode && (
            <div className="text-center mt-3">
              <div className="stat-num text-2xl tracking-[0.3em]">{cloudCode}</div>
              <img src={textQrSrc(cloudCode)} alt="QR ghép máy" className="mx-auto mt-2 max-w-[140px] rounded-lg" />
            </div>
          )}
          <button className="btn-ghost text-sm w-full mt-3" disabled={busy} onClick={() => {
            setBusy(true)
            pushLocalSnapshot().then(() => {
              showToast('Đã đẩy bản sao lên cloud', 'ok')
            }).catch((e) => showToast(e instanceof Error ? e.message : 'Lỗi đẩy bản sao', 'bad')).finally(() => setBusy(false))
          }}>Đẩy bản sao lên cloud</button>
          <button className="btn-ghost text-sm w-full mt-3" disabled={busy} onClick={() => {
            if (!confirm('Kéo dữ liệu cloud sẽ thay dữ liệu trên máy này. Tiếp tục?')) return
            setBusy(true)
            pullCloudSnapshot(true).then(() => {
              showToast('Đã kéo dữ liệu cloud', 'ok')
              setTimeout(() => window.location.reload(), 600)
            }).catch((e) => showToast(e instanceof Error ? e.message : 'Lỗi kéo dữ liệu', 'bad')).finally(() => setBusy(false))
          }}>Kéo dữ liệu từ cloud</button>
          <button className="btn-ghost text-sm w-full mt-3" disabled={busy || paused} onClick={() => {
            setBusy(true)
            disconnectCloud().then(() => {
              setPaused(true)
              showToast('Đã ngắt cloud', 'ok')
            }).catch((e) => showToast(e instanceof Error ? e.message : 'Lỗi ngắt cloud', 'bad')).finally(() => setBusy(false))
          }}>Ngắt cloud</button>
          <button className="btn-ghost text-sm w-full mt-3" disabled={busy || !paused} onClick={() => {
            setBusy(true)
            connectCloud({ resume: true }).then((ok) => {
              if (ok) {
                setPaused(false)
                showToast('Đã bật lại cloud', 'ok')
              } else {
                showToast('Không nối được cloud', 'bad')
              }
            }).catch((e) => showToast(e instanceof Error ? e.message : 'Lỗi bật cloud', 'bad')).finally(() => setBusy(false))
          }}>Bật lại cloud</button>
        </div>
      )}
    </div>
  )
}

export function DevicesPage() {
  const navigate = useNavigate()
  const showToast = useApp((s) => s.showToast)
  const [delTarget, setDelTarget] = useState<PairedDevice | null>(null)

  const devices = useLiveQuery(() => dbx.devices.toArray(), [], [] as PairedDevice[])

  // Đăng ký thiết bị này khi mở trang
  useEffect(() => {
    registerThisDevice().catch((e) => logError(e, 'device.register'))
  }, [])

  async function handleDelete() {
    if (!delTarget) return
    try {
      await removeDevice(delTarget.id)
      showToast('Đã gỡ thiết bị', 'ok')
      setDelTarget(null)
    } catch (e) {
      logError(e, 'device.remove')
      showToast(e instanceof Error ? e.message : 'Lỗi', 'bad')
    }
  }

  const sorted = [...devices].sort((a, b) => Number(b.isThis ?? false) - Number(a.isThis ?? false) || b.lastSeen - a.lastSeen)

  return (
    <div className="flex flex-col h-full">
      <header className="app-hdr bordered">
        <button className="btn-back" onClick={() => navigate('/them')}>
          <ChevronLeft size={20} />
        </button>
        <div className="font-brand text-[17px] font-medium flex-1 text-center" style={{ color: 'var(--ink)' }}>Thiết bị</div>
        <div className="w-9" />
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-6 max-w-[520px] mx-auto w-full">
        <CloudSyncSection />

        <div className="section-label">Thiết bị đã ghép ({devices.length})</div>
        {sorted.map((d) => (
          <div key={d.id} className="list-row">
            <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'var(--paper-2)', color: d.isThis ? 'var(--up)' : 'var(--mute)' }}>
              <Smartphone size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{d.name}</span>
                {d.isThis && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--paper-2)', color: 'var(--up)' }}>thiết bị này</span>}
                {d.role === 'print-agent' && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--paper-2)', color: 'var(--gold)' }}>máy in</span>}
              </div>
              <div className="text-[11px]" style={{ color: 'var(--mute)' }}>
                {d.platform} · hoạt động {timeAgo(d.lastSeen)}
              </div>
            </div>
            <button className="text-[10px] px-1.5" style={{ color: 'var(--mute)' }} onClick={() => void setDeviceRole(d.id, d.role === 'print-agent' ? '' : 'print-agent')}>
              {d.role === 'print-agent' ? 'Bỏ tag' : 'Tag in'}
            </button>
            {!d.isThis && (
              <button className="p-1.5" onClick={() => setDelTarget(d)} aria-label="Gỡ" style={{ color: 'var(--mute-2)' }}>
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
        {devices.length === 0 && <EmptyState icon="📱" title="Chưa có thiết bị" sub="Thiết bị này sẽ tự đăng ký" />}

        <p className="text-[11px] text-center mt-6" style={{ color: 'var(--mute-2)' }}>
          Nền tảng hiện tại: {devicePlatform()}
        </p>
      </div>

      <ConfirmDialog
        open={!!delTarget}
        title="Gỡ thiết bị?"
        message={`Gỡ "${delTarget?.name}" khỏi danh sách máy này?`}
        confirmLabel="Gỡ"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  )
}
