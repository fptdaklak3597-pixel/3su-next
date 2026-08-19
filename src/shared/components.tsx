/**
 * 3SU Next — UI components dùng chung (Modal, Sheet, Toast, Celebration)
 */
import { type ReactNode, useEffect } from 'react'
import { useApp } from '@/core/store'
import { fmtShort } from '@/core/format'

/* ─── Bottom Sheet ─── */
export function Sheet({ open, onClose, title, children }: {
  open: boolean
  onClose: () => void
  title?: string
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
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        {title && <h2 className="font-brand text-lg font-medium mb-4" style={{ color: 'var(--ink)' }}>{title}</h2>}
        {children}
      </div>
    </div>
  )
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
export function ConfirmDialog({ open, title, message, confirmLabel = 'Xác nhận', danger, onConfirm, onCancel }: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal open={open} onClose={onCancel}>
      <h3 className="font-brand text-base font-medium mb-2" style={{ color: 'var(--ink)' }}>{title}</h3>
      <p className="text-sm mb-5" style={{ color: 'var(--mute)' }}>{message}</p>
      <div className="flex gap-2">
        <button className="btn-ghost flex-1" onClick={onCancel}>Hủy</button>
        <button
          className={`flex-1 py-3 rounded-xl font-semibold text-sm text-white ${danger ? 'bg-down' : 'bg-ink'}`}
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

/* ─── Offline bar ─── */
export function OfflineBar() {
  const online = useApp((s) => s.online)
  if (online) return null
  return (
    <div className="text-center py-1.5 text-xs font-medium text-white bg-mute-2" style={{ zIndex: 50 }}>
      Mất mạng — dữ liệu lưu trên máy, sẽ đồng bộ khi có mạng lại
    </div>
  )
}

/* ─── Update banner ─── */
export function UpdateBanner({ ready, onApply }: { ready: boolean; onApply: () => void }) {
  if (!ready) return null
  return (
    <div className="flex items-center justify-center gap-3 py-2 px-4 text-xs font-medium"
      style={{ background: 'var(--gold)', color: '#fff' }}>
      <span>Có phiên bản mới — cập nhật sau ca cho chắc</span>
      <button className="underline font-bold" onClick={onApply}>Cập nhật sau ca</button>
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
