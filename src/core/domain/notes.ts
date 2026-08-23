/**
 * 3SU Next — Ghi chú nhanh
 * Port từ 30-tools-units.js: todo / ý tưởng / ghi chú, ghim, đánh dấu xong.
 */
import { dbx } from '../db'
import type { Note, NoteType } from '../types'
import { uid, matchesSearch } from '../format'
import { makeOp, persistOp, requestFlush } from '../sync/engine'

export async function addNote(text: string, type: NoteType = 'note'): Promise<Note> {
  const n: Note = {
    id: uid('nt'),
    text: text.trim(),
    date: new Date().toISOString(),
    type,
    done: false,
    pinned: false,
  }
  await dbx.transaction('rw', [dbx.notes, dbx.syncQueue, dbx.appliedOps], async () => {
    const op = makeOp('note.upsert', null)
    n.hlc = op.hlc
    await dbx.notes.add(n)
    op.payload = n
    await persistOp(op)
  })
  requestFlush()
  return n
}

export async function updateNote(
  id: string,
  patch: { text?: string; type?: NoteType },
): Promise<void> {
  await dbx.transaction('rw', [dbx.notes, dbx.syncQueue, dbx.appliedOps], async () => {
    const n = await dbx.notes.get(id)
    if (!n || n.deleted) return
    const op = makeOp('note.upsert', null)
    const updated: Note = {
      ...n,
      text: patch.text !== undefined ? patch.text.trim() : n.text,
      type: patch.type !== undefined ? patch.type : n.type,
      hlc: op.hlc,
    }
    if (!updated.text) throw new Error('Nội dung ghi chú không được trống')
    await dbx.notes.put(updated)
    op.payload = updated
    await persistOp(op)
  })
  requestFlush()
}

export async function toggleNoteDone(id: string): Promise<void> {
  await dbx.transaction('rw', [dbx.notes, dbx.syncQueue, dbx.appliedOps], async () => {
    const n = await dbx.notes.get(id)
    if (!n || n.deleted) return
    const op = makeOp('note.upsert', null)
    const updated = { ...n, done: !n.done, hlc: op.hlc }
    await dbx.notes.put(updated)
    op.payload = updated
    await persistOp(op)
  })
  requestFlush()
}

export async function toggleNotePin(id: string): Promise<void> {
  await dbx.transaction('rw', [dbx.notes, dbx.syncQueue, dbx.appliedOps], async () => {
    const n = await dbx.notes.get(id)
    if (!n || n.deleted) return
    const op = makeOp('note.upsert', null)
    const updated = { ...n, pinned: !n.pinned, hlc: op.hlc }
    await dbx.notes.put(updated)
    op.payload = updated
    await persistOp(op)
  })
  requestFlush()
}

export async function deleteNote(id: string): Promise<void> {
  await dbx.transaction('rw', [dbx.notes, dbx.syncQueue, dbx.appliedOps], async () => {
    const n = await dbx.notes.get(id)
    if (!n) return
    const op = makeOp('note.delete', { noteId: id })
    await dbx.notes.put({ ...n, deleted: true, deletedHlc: op.hlc, hlc: op.hlc })
    await persistOp(op)
  })
  requestFlush()
}

/** Sắp xếp: chưa xong trước, rồi ghim, rồi mới nhất. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.date.localeCompare(a.date)
  })
}

export type NoteFilterSeg = 'all' | 'open' | 'done' | 'pinned'

export function filterNotes(
  notes: Note[],
  opts: { query?: string; seg?: NoteFilterSeg } = {},
): Note[] {
  const q = (opts.query || '').trim()
  const seg = opts.seg || 'all'
  return notes.filter((n) => {
    if (n.deleted) return false
    if (seg === 'open' && n.done) return false
    if (seg === 'done' && !n.done) return false
    if (seg === 'pinned' && !n.pinned) return false
    if (q && !matchesSearch(n.text, q)) return false
    return true
  })
}

/** Nhóm sau khi đã sort: đã ghim (kể cả xong) / đang làm / đã xong chưa ghim. */
export function groupNotes(notes: Note[]): {
  pinned: Note[]
  open: Note[]
  done: Note[]
} {
  const pinned: Note[] = []
  const open: Note[] = []
  const done: Note[] = []
  for (const n of notes) {
    if (n.pinned) pinned.push(n)
    else if (n.done) done.push(n)
    else open.push(n)
  }
  return { pinned, open, done }
}

export const NOTE_TYPE_LABELS: Record<NoteType, string> = {
  todo: 'Việc cần làm',
  idea: 'Ý tưởng',
  note: 'Ghi chú',
}
