/**
 * Ghi chú web — thêm nhanh, lọc, ghim, sửa inline. Cùng dữ liệu với app điện thoại.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Check,
  Pencil,
  Pin,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { dbx } from '@/core/db'
import {
  NOTE_TYPE_LABELS,
  addNote,
  deleteNote,
  filterNotes,
  groupNotes,
  sortNotes,
  toggleNoteDone,
  toggleNotePin,
  updateNote,
  type NoteFilterSeg,
} from '@/core/domain/notes'
import { logError } from '@/core/errorLogger'
import { useApp } from '@/core/store'
import { ConfirmDialog } from '@/shared/components'
import { WebEmpty } from '@/web/components/WebEmpty'
import type { Note, NoteType } from '@/core/types'

const NOTE_TYPES: { v: NoteType; label: string }[] = [
  { v: 'todo', label: 'Việc' },
  { v: 'idea', label: 'Ý tưởng' },
  { v: 'note', label: 'Ghi chú' },
]

const SEGS: { v: NoteFilterSeg; label: string }[] = [
  { v: 'all', label: 'Tất cả' },
  { v: 'open', label: 'Chưa xong' },
  { v: 'done', label: 'Đã xong' },
  { v: 'pinned', label: 'Đã ghim' },
]

function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function NoteRow({
  note,
  editing,
  draft,
  draftType,
  onStartEdit,
  onDraft,
  onDraftType,
  onSave,
  onCancel,
  onToggleDone,
  onTogglePin,
  onDelete,
}: {
  note: Note
  editing: boolean
  draft: string
  draftType: NoteType
  onStartEdit: () => void
  onDraft: (v: string) => void
  onDraftType: (t: NoteType) => void
  onSave: () => void
  onCancel: () => void
  onToggleDone: () => void
  onTogglePin: () => void
  onDelete: () => void
}) {
  return (
    <article className={`web-note-card type-${note.type} ${note.done ? 'is-done' : ''} ${note.pinned ? 'is-pin' : ''}`}>
      <button
        type="button"
        className={`web-note-check ${note.done ? 'on' : ''}`}
        onClick={onToggleDone}
        aria-label={note.done ? 'Đánh dấu chưa xong' : 'Đánh dấu xong'}
      >
        {note.done && <Check size={12} strokeWidth={3} />}
      </button>

      <div className="web-note-body">
        {editing ? (
          <>
            <textarea
              className="web-input web-note-edit"
              rows={3}
              value={draft}
              onChange={(e) => onDraft(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Escape') onCancel()
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave()
              }}
            />
            <div className="web-note-edit-bar">
              <div className="web-note-type-row">
                {NOTE_TYPES.map((t) => (
                  <button
                    key={t.v}
                    type="button"
                    className={`web-note-chip ${draftType === t.v ? 'on' : ''}`}
                    onClick={() => onDraftType(t.v)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="web-note-edit-actions">
                <button type="button" className="web-btn" onClick={onCancel}>Hủy</button>
                <button type="button" className="web-btn pri" disabled={!draft.trim()} onClick={onSave}>
                  Lưu
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              className="web-note-text"
              onDoubleClick={onStartEdit}
              title="Nhấp đúp để sửa"
            >
              {note.text}
            </button>
            <div className="web-note-meta">
              <span className={`web-note-badge type-${note.type}`}>{NOTE_TYPE_LABELS[note.type]}</span>
              <span>{shortDate(note.date)}</span>
            </div>
          </>
        )}
      </div>

      {!editing && (
        <div className="web-note-actions">
          <button
            type="button"
            className={`web-note-ico ${note.pinned ? 'on' : ''}`}
            onClick={onTogglePin}
            aria-label="Ghim"
            title="Ghim"
          >
            <Pin size={14} fill={note.pinned ? 'currentColor' : 'none'} />
          </button>
          <button type="button" className="web-note-ico" onClick={onStartEdit} aria-label="Sửa" title="Sửa">
            <Pencil size={14} />
          </button>
          <button type="button" className="web-note-ico danger" onClick={onDelete} aria-label="Xóa" title="Xóa">
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </article>
  )
}

export function WebNotesPage() {
  const showToast = useApp((s) => s.showToast)
  const notes = useLiveQuery(() => dbx.notes.filter((n) => !n.deleted).toArray(), [], [] as Note[])
  const [text, setText] = useState('')
  const [type, setType] = useState<NoteType>('todo')
  const [seg, setSeg] = useState<NoteFilterSeg>('all')
  const [query, setQuery] = useState('')
  const [doneOpen, setDoneOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editType, setEditType] = useState<NoteType>('note')
  const [delTarget, setDelTarget] = useState<Note | null>(null)
  const [adding, setAdding] = useState(false)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const t = window.setTimeout(() => composerRef.current?.focus(), 40)
    return () => window.clearTimeout(t)
  }, [])

  const filtered = useMemo(
    () => sortNotes(filterNotes(notes, { query, seg })),
    [notes, query, seg],
  )
  const groups = useMemo(() => groupNotes(filtered), [filtered])
  const openCount = notes.filter((n) => !n.done).length

  async function add() {
    const t = text.trim()
    if (!t || adding) return
    setAdding(true)
    try {
      await addNote(t, type)
      setText('')
      composerRef.current?.focus()
    } catch (e) {
      logError(e, 'notes.add')
      showToast('Không thêm được ghi chú', 'bad')
    } finally {
      setAdding(false)
    }
  }

  function startEdit(n: Note) {
    setEditId(n.id)
    setEditText(n.text)
    setEditType(n.type)
  }

  async function saveEdit() {
    if (!editId || !editText.trim()) return
    try {
      await updateNote(editId, { text: editText, type: editType })
      setEditId(null)
      showToast('Đã lưu ghi chú', 'ok')
    } catch (e) {
      logError(e, 'notes.update')
      showToast('Không lưu được', 'bad')
    }
  }

  async function confirmDelete() {
    if (!delTarget) return
    try {
      await deleteNote(delTarget.id)
      if (editId === delTarget.id) setEditId(null)
      showToast('Đã xóa ghi chú', 'ok')
    } catch (e) {
      logError(e, 'notes.delete')
      showToast('Không xóa được', 'bad')
    } finally {
      setDelTarget(null)
    }
  }

  function renderList(items: Note[]) {
    return items.map((n) => (
      <NoteRow
        key={n.id}
        note={n}
        editing={editId === n.id}
        draft={editText}
        draftType={editType}
        onStartEdit={() => startEdit(n)}
        onDraft={setEditText}
        onDraftType={setEditType}
        onSave={() => void saveEdit()}
        onCancel={() => setEditId(null)}
        onToggleDone={() => void toggleNoteDone(n.id)}
        onTogglePin={() => void toggleNotePin(n.id)}
        onDelete={() => setDelTarget(n)}
      />
    ))
  }

  return (
    <div className="web-page web-notes-page">
      <div className="web-ph">
        <div>
          <h2>Ghi chú</h2>
          <p>
            {openCount} việc chưa xong · {notes.length} ghi chú
          </p>
        </div>
      </div>

      <div className="web-notes-shell">
        <section className="web-notes-composer">
          <textarea
            ref={composerRef}
            className="web-input web-notes-ta"
            rows={3}
            placeholder="Ghi nhanh việc cần làm, ý tưởng, nhắc nhở…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void add()
              }
            }}
          />
          <div className="web-notes-composer-bar">
            <div className="web-note-type-row">
              {NOTE_TYPES.map((t) => (
                <button
                  key={t.v}
                  type="button"
                  className={`web-note-chip ${type === t.v ? 'on' : ''}`}
                  onClick={() => setType(t.v)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="web-notes-composer-hint">Enter thêm · Shift+Enter xuống dòng</div>
            <button
              type="button"
              className="web-btn pri"
              onClick={() => void add()}
              disabled={!text.trim() || adding}
            >
              <Plus size={15} /> Thêm
            </button>
          </div>
        </section>

        <div className="web-notes-toolbar">
          <div className="web-notes-segs">
            {SEGS.map((s) => (
              <button
                key={s.v}
                type="button"
                className={`web-chip ${seg === s.v ? 'on' : ''}`}
                onClick={() => setSeg(s.v)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <label className="web-notes-search">
            <Search size={14} />
            <input
              className="web-input"
              placeholder="Tìm ghi chú…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button type="button" className="web-notes-clear" onClick={() => setQuery('')} aria-label="Xóa tìm">
                <X size={14} />
              </button>
            )}
          </label>
        </div>

        {filtered.length === 0 ? (
          <div className="web-notes-empty-wrap">
            <WebEmpty
              title={notes.length === 0 ? 'Chưa có ghi chú' : 'Không khớp bộ lọc'}
              sub={
                notes.length === 0
                  ? 'Ghi việc cần làm hoặc ý tưởng. Ghim cái quan trọng lên trên.'
                  : 'Thử đổi lọc hoặc từ khóa tìm.'
              }
            />
          </div>
        ) : (
          <div className="web-notes-groups">
            {groups.pinned.length > 0 && (
              <section className="web-notes-group">
                <header>
                  <h3>Đã ghim</h3>
                  <span>{groups.pinned.length}</span>
                </header>
                <div className="web-notes-list">{renderList(groups.pinned)}</div>
              </section>
            )}
            {(seg === 'all' || seg === 'open' || seg === 'pinned') && groups.open.length > 0 && (
              <section className="web-notes-group">
                <header>
                  <h3>{seg === 'pinned' ? 'Khác' : 'Đang làm'}</h3>
                  <span>{groups.open.length}</span>
                </header>
                <div className="web-notes-list">{renderList(groups.open)}</div>
              </section>
            )}
            {groups.done.length > 0 && (
              <section className="web-notes-group">
                <header>
                  <button type="button" className="web-notes-group-toggle" onClick={() => setDoneOpen((v) => !v)}>
                    <h3>Đã xong</h3>
                    <span>{groups.done.length}</span>
                    <span className="web-notes-caret">{doneOpen || seg === 'done' ? '▾' : '▸'}</span>
                  </button>
                </header>
                {(doneOpen || seg === 'done') && (
                  <div className="web-notes-list">{renderList(groups.done)}</div>
                )}
              </section>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!delTarget}
        title="Xóa ghi chú?"
        message={delTarget ? `"${delTarget.text.slice(0, 80)}${delTarget.text.length > 80 ? '…' : ''}" sẽ bị xóa.` : ''}
        confirmLabel="Xóa"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  )
}
