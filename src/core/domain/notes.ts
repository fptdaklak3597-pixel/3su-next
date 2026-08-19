/**
 * 3SU Next — Ghi chú nhanh
 * Port từ 30-tools-units.js: todo / ý tưởng / ghi chú, ghim, đánh dấu xong.
 */
import { dbx } from '../db'
import type { Note, NoteType } from '../types'
import { uid } from '../format'
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

export async function toggleNoteDone(id: string): Promise<void> {
  await dbx.transaction('rw', [dbx.notes, dbx.syncQueue, dbx.appliedOps], async () => {
    const n = await dbx.notes.get(id)
    if (!n) return
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
    if (!n) return
    const op = makeOp('note.upsert', null)
    const updated = { ...n, pinned: !n.pinned, hlc: op.hlc }
    await dbx.notes.put(updated)
    op.payload = updated
    await persistOp(op)
  })
  requestFlush()
}

export async function deleteNote(id: string): Promise<void> {
  const n = await dbx.notes.get(id)
  if (!n) return
  await dbx.transaction('rw', [dbx.notes, dbx.syncQueue, dbx.appliedOps], async () => {
    const op = makeOp('note.delete', { noteId: id })
    await dbx.notes.put({ ...n, deleted: true, deletedHlc: op.hlc, hlc: op.hlc })
    await persistOp(op)
  })
  requestFlush()
}

/** Sắp xếp: ghim trước, chưa xong trước, mới nhất trước. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (a.done !== b.done) return a.done ? 1 : -1
    return b.date.localeCompare(a.date)
  })
}
