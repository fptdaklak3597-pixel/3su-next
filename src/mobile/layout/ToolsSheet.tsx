/**
 * Sheet "Thêm" — các mục phụ trợ theo quyền của user hiện tại.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { PackagePlus, BarChart3, Truck, StickyNote, Settings, X, Plus, Pin, Users } from 'lucide-react'
import { Sheet } from '@/shared/components'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { hasPerm } from '@/core/domain/auth'
import { addNote, toggleNoteDone, toggleNotePin, deleteNote, sortNotes } from '@/core/domain/notes'
import type { Note, UserPerms } from '@/core/types'

const ITEMS: Array<{
  path?: string
  notes?: boolean
  label: string
  sub: string
  icon: typeof PackagePlus
  perm?: keyof UserPerms
}> = [
  { path: '/nhap-hang', label: 'Nhập hàng', sub: 'Phiếu nhập kho nhanh', icon: PackagePlus, perm: 'inventory' },
  { path: '/bao-cao', label: 'Báo cáo', sub: 'Doanh thu, lời, xu hướng', icon: BarChart3, perm: 'reports' },
  { path: '/nha-cung-cap', label: 'Nhà cung cấp', sub: 'Nguồn hàng và công nợ', icon: Truck, perm: 'suppliers' },
  { path: '/khach-hang', label: 'Khách hàng', sub: 'Nợ và lịch sử mua', icon: Users, perm: 'sell' },
  { notes: true, label: 'Ghi chú', sub: 'Việc cần làm, ý tưởng', icon: StickyNote },
  { path: '/cai-dat', label: 'Cài đặt', sub: 'Shop, in, dữ liệu', icon: Settings, perm: 'settings' },
]

export function ToolsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const user = useApp((s) => s.user)
  const [notesOpen, setNotesOpen] = useState(false)
  const visibleItems = ITEMS.filter((it) => !it.perm || !user || hasPerm(user, it.perm))

  function go(path: string) {
    onClose()
    navigate(path)
  }

  return (
    <>
      <Sheet open={open && !notesOpen} onClose={onClose} title="Thêm">
        <div className="text-[11px] mb-3" style={{ color: 'var(--mute)' }}>Công cụ phụ trợ</div>
        <div className="flex flex-col gap-1.5">
          {visibleItems.map((it) => {
            const Icon = it.icon
            return (
              <button
                key={it.label}
                className="list-row"
                onClick={() => {
                  if (it.notes) setNotesOpen(true)
                  else if (it.path) go(it.path)
                }}
              >
                <div className="w-9 h-9 rounded-[10px] flex items-center justify-center" style={{ background: 'var(--paper)' }}>
                  <Icon size={18} />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-[15px] font-medium" style={{ color: 'var(--ink)' }}>{it.label}</div>
                  <div className="text-[11.5px]" style={{ color: 'var(--mute)' }}>{it.sub}</div>
                </div>
              </button>
            )
          })}
        </div>
      </Sheet>
      <NotesOverlay open={notesOpen} onClose={() => setNotesOpen(false)} />
    </>
  )
}

function NotesOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const notes = useLiveQuery(() => dbx.notes.filter((n) => !n.deleted).toArray(), [], [] as Note[])
  const [text, setText] = useState('')
  const sorted = sortNotes(notes)

  async function add() {
    if (!text.trim()) return
    await addNote(text.trim())
    setText('')
  }

  if (!open) return null
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <div className="flex items-center justify-between mb-3">
          <div className="font-brand text-[17px] font-medium">Ghi chú</div>
          <button className="btn-back" onClick={onClose} aria-label="Đóng"><X size={18} /></button>
        </div>
        <div className="flex gap-2 mb-3">
          <input className="field-input text-sm" placeholder="Việc cần làm…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
          <button className="btn-ghost" onClick={() => void add()} aria-label="Thêm"><Plus size={16} /></button>
        </div>
        <div className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto">
          {sorted.map((n) => (
            <div key={n.id} className="list-row">
              <button className="flex-1 text-left min-w-0" onClick={() => void toggleNoteDone(n.id)}>
                <div className={`text-[14px] ${n.done ? 'line-through' : ''}`} style={{ color: n.done ? 'var(--mute)' : 'var(--ink)' }}>{n.text}</div>
              </button>
              <button className="p-1" onClick={() => void toggleNotePin(n.id)} aria-label="Ghim">
                <Pin size={14} style={{ color: n.pinned ? 'var(--gold)' : 'var(--mute-2)' }} />
              </button>
              <button className="p-1 text-[11px]" style={{ color: 'var(--mute)' }} onClick={() => void deleteNote(n.id)}>Xóa</button>
            </div>
          ))}
          {sorted.length === 0 && (
            <div className="text-center py-6 text-sm" style={{ color: 'var(--mute)' }}>Chưa có ghi chú</div>
          )}
        </div>
      </div>
    </div>
  )
}
