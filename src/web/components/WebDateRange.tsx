/**
 * Khoảng ngày — lịch popover gắn body, không dùng input type=date.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays } from 'lucide-react'
import { today } from '@/core/format'

const DOW = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number)
  return { y, m, d }
}

function labelDay(iso: string): string {
  const { d, m, y } = parts(iso)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}

function labelRange(from: string, to: string): string {
  if (from && to && from === to) return labelDay(from)
  if (from && to) return `${labelDay(from)} – ${labelDay(to)}`
  if (from) return `Từ ${labelDay(from)}`
  if (to) return `Đến ${labelDay(to)}`
  return 'Chọn ngày'
}

function nextRange(from: string, to: string, day: string): { from: string; to: string } {
  if (!from || (from && to)) return { from: day, to: '' }
  if (day < from) return { from: day, to: from }
  return { from, to: day }
}

function monthCells(y: number, m: number): { iso: string; inMonth: boolean }[] {
  const first = new Date(y, m - 1, 1)
  const pad = (first.getDay() + 6) % 7
  const last = new Date(y, m, 0).getDate()
  const prevLast = new Date(y, m - 1, 0).getDate()
  const cells: { iso: string; inMonth: boolean }[] = []
  for (let i = pad; i > 0; i--) {
    const pm = m === 1 ? 12 : m - 1
    const py = m === 1 ? y - 1 : y
    cells.push({ iso: ymd(py, pm, prevLast - i + 1), inMonth: false })
  }
  for (let d = 1; d <= last; d++) cells.push({ iso: ymd(y, m, d), inMonth: true })
  while (cells.length % 7) {
    const n = cells.length - pad - last + 1
    const nm = m === 12 ? 1 : m + 1
    const ny = m === 12 ? y + 1 : y
    cells.push({ iso: ymd(ny, nm, n), inMonth: false })
  }
  return cells
}

export function WebDateRange({
  from,
  to,
  onChange,
  active,
  single,
  placeholder,
}: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
  active?: boolean
  single?: boolean
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const seed = from || to || today()
  const seedP = parts(seed)
  const [view, setView] = useState({ y: seedP.y, m: seedP.m })

  useEffect(() => {
    if (!open) return
    const s = from || to || today()
    const p = parts(s)
    setView({ y: p.y, m: p.m })
  }, [open, from, to])

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const w = 308
    const h = 360
    let left = r.left
    let top = r.bottom + 6
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8
    if (top + h > window.innerHeight - 8) top = r.top - h - 6
    if (top < 8) top = 8
    if (left < 8) left = 8
    setPos({ top, left })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const cells = monthCells(view.y, view.m)
  const todayIso = today()
  const on = !!active || open || (!single && !!(from || to))

  function shift(delta: number) {
    const d = new Date(view.y, view.m - 1 + delta, 1)
    setView({ y: d.getFullYear(), m: d.getMonth() + 1 })
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`web-daterange ${on ? 'on' : ''} ${open ? 'open' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <CalendarDays size={15} />
        <span>{single ? (from ? labelDay(from) : (placeholder || 'Chọn ngày')) : labelRange(from, to)}</span>
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          className="web-cal"
          role="dialog"
          aria-label={single ? (placeholder || 'Chọn ngày') : 'Chọn khoảng ngày'}
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="web-cal-h">
            <button type="button" className="web-cal-nav" onClick={() => shift(-1)} aria-label="Tháng trước">‹</button>
            <b>Tháng {view.m} {view.y}</b>
            <button type="button" className="web-cal-nav" onClick={() => shift(1)} aria-label="Tháng sau">›</button>
          </div>
          <div className="web-cal-dow">
            {DOW.map((d) => <span key={d}>{d}</span>)}
          </div>
          <div className="web-cal-grid">
            {cells.map((c) => {
              const start = from && c.iso === from
              const end = to && c.iso === to
              const mid = from && to && c.iso > from && c.iso < to
              const isToday = c.iso === todayIso
              return (
                <button
                  key={c.iso}
                  type="button"
                  className={[
                    'web-cal-d',
                    c.inMonth ? '' : 'mute',
                    start || end ? 'pick' : '',
                    mid ? 'mid' : '',
                    isToday ? 'today' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => {
                    if (single) {
                      onChange(c.iso, c.iso)
                      setOpen(false)
                      return
                    }
                    const n = nextRange(from, to, c.iso)
                    onChange(n.from, n.to)
                  }}
                >
                  {Number(c.iso.slice(8))}
                </button>
              )
            })}
          </div>
          <div className="web-cal-f">
            <button type="button" onClick={() => { onChange('', ''); setOpen(false) }}>Xóa</button>
            <span className="web-cal-hint">{single ? '' : from && !to ? 'Bấm ngày kết thúc' : 'Bấm ngày bắt đầu'}</span>
            <button type="button" className="pri" onClick={() => setOpen(false)}>Xong</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
