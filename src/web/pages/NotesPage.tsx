/**
 * Ghi chú web — thêm, xong, ghim, xóa. Cùng dữ liệu với app điện thoại.
 */
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Pin, Plus } from 'lucide-react'
import { dbx } from '@/core/db'
import { addNote, deleteNote, sortNotes, toggleNoteDone, toggleNotePin } from '@/core/domain/notes'
import { logError } from '@/core/errorLogger'
import { useApp } from '@/core/store'
import { WebEmpty } from '@/web/components/WebEmpty'
import type { Note } from '@/core/types'

export function WebNotesPage() {
  const showToast = useApp((s) => s.showToast)
  const notes = useLiveQuery(() => dbx.notes.filter((n) => !n.deleted).toArray(), [], [] as Note[])
  const [text, setText] = useState('')
  const sorted = sortNotes(notes)

  async function add() {
    const t = text.trim()
    if (!t) return
    try {
      await addNote(t)
      setText('')
    } catch (e) {
      logError(e, 'notes.add')
      showToast('Không thêm được ghi chú', 'bad')
    }
  }

  return (
    <div className="web-page">
      <div className="web-ph">
        <div>
          <h2>Ghi chú</h2>
          <p>{sorted.filter((n) => !n.done).length} việc chưa xong · {sorted.length} ghi chú</p>
        </div>
      </div>

      <div className="web-card" style={{ maxWidth: 720 }}>
        <div className="web-notes-add">
          <input
            className="web-input"
            placeholder="Việc cần làm…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void add() }}
          />
          <button type="button" className="web-btn pri" onClick={() => void add()} disabled={!text.trim()}>
            <Plus size={15} /> Thêm
          </button>
        </div>

        {sorted.length === 0 ? (
          <WebEmpty title="Chưa có ghi chú" sub="Ghi việc cần làm hoặc ý tưởng. Ghim cái quan trọng lên trên." />
        ) : (
          <div className="web-notes-list">
            {sorted.map((n) => (
              <div key={n.id} className={`web-note ${n.done ? 'is-done' : ''} ${n.pinned ? 'is-pin' : ''}`}>
                <button type="button" className="web-note-text" onClick={() => void toggleNoteDone(n.id)}>
                  {n.text}
                </button>
                <button
                  type="button"
                  className={`web-btn ${n.pinned ? 'pri' : ''}`}
                  style={{ height: 28 }}
                  onClick={() => void toggleNotePin(n.id)}
                  aria-label="Ghim"
                >
                  <Pin size={13} />
                </button>
                <button type="button" className="web-btn" style={{ height: 28 }} onClick={() => void deleteNote(n.id)}>
                  Xóa
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
