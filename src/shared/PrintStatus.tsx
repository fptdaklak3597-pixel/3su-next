import { useEffect, useState } from 'react'
import { onPrintAgentOnline } from '@/core/browser/printPresence'
import { refreshPrintAgentStatus } from '@/core/browser/printQueue'

/** Dòng trạng thái máy in PC — chữ thường, không thuật ngữ. */
export function PrintStatusLine() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const off = onPrintAgentOnline(setOn)
    void refreshPrintAgentStatus()
    const t = setInterval(() => { void refreshPrintAgentStatus() }, 8000)
    return () => { off(); clearInterval(t) }
  }, [])
  return (
    <p className="text-sm" style={{ color: on ? 'var(--ok, #047857)' : 'var(--kv-subtle, #64748b)' }}>
      {on ? 'Máy tính đang mở — bán là in.' : 'Máy tính chưa mở trang Máy in.'}
    </p>
  )
}

/** Chấm nhỏ trên POS — xanh = máy in PC đang mở. */
export function PrintStatusDot() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const off = onPrintAgentOnline(setOn)
    void refreshPrintAgentStatus()
    const t = setInterval(() => { void refreshPrintAgentStatus() }, 8000)
    return () => { off(); clearInterval(t) }
  }, [])
  return (
    <span title={on ? 'Máy tính đang mở — bán là in' : 'Máy tính chưa mở trang Máy in'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: on ? 'var(--ok, #047857)' : 'rgba(255,255,255,.7)' }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: on ? '#047857' : '#94a3b8' }} />
      {on ? 'In sẵn' : 'Chưa in'}
    </span>
  )
}
