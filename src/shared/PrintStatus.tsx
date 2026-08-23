import { useEffect, useState } from 'react'
import { onPrintAgentOnline } from '@/core/browser/printPresence'
import { refreshPrintAgentStatus } from '@/core/browser/printQueue'

/** Một poller dùng chung — pause khi tab ẩn. */
let refCount = 0
let sharedTimer: ReturnType<typeof setInterval> | null = null

function bumpSharedPoller(delta: number): void {
  refCount += delta
  if (refCount > 0 && !sharedTimer) {
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      void refreshPrintAgentStatus()
    }
    void refreshPrintAgentStatus()
    sharedTimer = setInterval(tick, 8000)
  }
  if (refCount <= 0) {
    refCount = 0
    if (sharedTimer) clearInterval(sharedTimer)
    sharedTimer = null
  }
}

function usePrintOnline(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const off = onPrintAgentOnline(setOn)
    bumpSharedPoller(1)
    return () => {
      off()
      bumpSharedPoller(-1)
    }
  }, [])
  return on
}

/** Dòng trạng thái máy in PC — chữ thường, không thuật ngữ. */
export function PrintStatusLine() {
  const on = usePrintOnline()
  return (
    <p className="text-sm" style={{ color: on ? 'var(--ok, #047857)' : 'var(--kv-subtle, #64748b)' }}>
      {on ? 'Máy tính đang mở — bán là in.' : 'Máy tính chưa mở trang Máy in.'}
    </p>
  )
}

/** Chấm nhỏ trên POS — xanh = máy in PC đang mở. */
export function PrintStatusDot() {
  const on = usePrintOnline()
  return (
    <span title={on ? 'Máy tính đang mở — bán là in' : 'Máy tính chưa mở trang Máy in'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: on ? 'var(--ok, #047857)' : 'rgba(255,255,255,.7)' }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: on ? '#047857' : '#94a3b8' }} />
      {on ? 'In sẵn' : 'Chưa in'}
    </span>
  )
}
