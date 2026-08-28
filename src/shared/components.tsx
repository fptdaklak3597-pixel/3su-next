/**
 * 3SU Next — UI components dùng chung (Modal, Sheet, Toast, Celebration)
 */
import { type ReactNode, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmtShort } from '@/core/format'
import { syncStatusBadge } from '@/core/domain/health-banners'
import { useServiceWorkerUpdate } from '@/shared/pwa'

/* ─── Bottom Sheet ─── */
export function Sheet({ open, onClose, title, children, overlayClassName, closeOnOverlay = true, portal = false }: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  overlayClassName?: string
  closeOnOverlay?: boolean
  portal?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null
  const node = (
    <div className={['sheet-overlay', overlayClassName].filter(Boolean).join(' ')} onClick={closeOnOverlay ? onClose : undefined}>
      <div className="sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        {title && <h2 className="font-brand text-lg font-medium mb-4" style={{ color: 'var(--ink)' }}>{title}</h2>}
        {children}
      </div>
    </div>
  )
  return portal ? createPortal(node, document.body) : node
}

/* ─── Modal (centered) ─── */
export function Modal({ open, onClose, children }: {
  open: boolean
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

/* ─── Confirm dialog ─── */
export function ConfirmDialog({
  open, title, message, confirmLabel = 'Xác nhận', danger, confirmDisabled, children, onConfirm, onCancel,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  confirmDisabled?: boolean
  children?: ReactNode
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal open={open} onClose={onCancel}>
      <h3 className="font-brand text-base font-medium mb-2" style={{ color: 'var(--ink)' }}>{title}</h3>
      <p className="text-sm mb-5" style={{ color: 'var(--mute)' }}>{message}</p>
      {children}
      <div className="flex gap-2">
        <button className="btn-ghost flex-1" onClick={onCancel}>Hủy</button>
        <button
          className={`flex-1 py-3 rounded-xl font-semibold text-sm text-white ${danger ? 'bg-down' : 'bg-ink'}`}
          disabled={confirmDisabled}
          style={confirmDisabled ? { opacity: 0.45 } : undefined}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

/* ─── Toast (global, render 1 lần ở root) ─── */
export function ToastHost() {
  const toast = useApp((s) => s.toast)
  if (!toast) return null
  return <div className={`toast show ${toast.kind}`}>{toast.msg}</div>
}

/* ─── Celebration overlay ─── */
export function CelebrationHost() {
  const celebration = useApp((s) => s.celebration)
  const dismiss = useApp((s) => s.dismissCelebration)
  if (!celebration) return null
  return (
    <div className="celebration" onClick={dismiss}>
      <div className="amount">+{fmtShort(celebration.amount)}<span className="text-2xl">đ</span></div>
      <div className="msg">{celebration.msg}</div>
    </div>
  )
}

/* ─── Offline / sync bar ─── */
export function OfflineBar() {
  const navigate = useNavigate()
  const online = useApp((s) => s.online)
  const sync = useApp((s) => s.sync)
  const poisonedRow = useLiveQuery(() => dbx.meta.get('sync:poisoned'), [])
  const poisoned = Array.isArray(poisonedRow?.value) ? poisonedRow.value.length : 0
  const badge = syncStatusBadge({
    online,
    pendingOps: sync.pendingOps,
    status: sync.status,
    poisoned,
  })
  if (!online) {
    return (
      <div className="text-center py-1.5 text-xs font-medium text-white bg-mute-2" style={{ zIndex: 50 }}>
        Mất mạng — dữ liệu lưu trên máy, sẽ đồng bộ khi có mạng lại
      </div>
    )
  }
  if (!badge) return null
  return (
    <button
      type="button"
      className={`w-full text-center py-1.5 text-xs font-medium text-white ${badge.tone === 'bad' ? 'bg-down' : 'bg-mute-2'}`}
      style={{ zIndex: 50 }}
      onClick={() => { if (badge.to) navigate(badge.to) }}
    >
      {badge.to ? `${badge.text} — mở Cài đặt` : badge.text}
    </button>
  )
}

/* ─── Service worker update bar ─── */
export function SwUpdateBanner() {
  const { updateAvailable, applyUpdate } = useServiceWorkerUpdate()

  if (!updateAvailable) return null
  return (
    <div
      className="flex items-center justify-center gap-3 py-2 px-4 text-sm font-medium text-white bg-brand"
      style={{ zIndex: 50 }}
    >
      <span>Có bản mới</span>
      <button
        type="button"
        className="rounded-lg bg-white/20 px-3 py-1 font-semibold hover:bg-white/30"
        onClick={applyUpdate}
      >
        Cập nhật
      </button>
    </div>
  )
}

/* ─── Empty state ─── */
export function EmptyState({ icon, title, sub }: { icon?: string; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {icon && <div className="text-4xl mb-3">{icon}</div>}
      <div className="font-brand text-base font-medium" style={{ color: 'var(--ink-2)' }}>{title}</div>
      {sub && <div className="text-sm mt-1" style={{ color: 'var(--mute)' }}>{sub}</div>}
    </div>
  )
}

/* ─── Section header ─── */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="section-label">{children}</div>
}
