import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine } from '@/core/sync/engine'
import {
  addNote,
  deleteNote,
  filterNotes,
  groupNotes,
  sortNotes,
  toggleNoteDone,
  toggleNotePin,
  updateNote,
} from '@/core/domain/notes'
import type { Note } from '@/core/types'

function mk(over: Partial<Note> = {}): Note {
  return {
    id: over.id || 'nt1',
    text: over.text ?? 'Hello',
    date: over.date ?? '2026-08-20T10:00:00.000Z',
    type: over.type ?? 'note',
    done: over.done ?? false,
    pinned: over.pinned ?? false,
    ...over,
  }
}

describe('notes helpers', () => {
  it('filterNotes theo seg và query', () => {
    const list = [
      mk({ id: 'a', text: 'Mua gạo', done: false, pinned: true }),
      mk({ id: 'b', text: 'Ý tưởng menu', type: 'idea', done: false }),
      mk({ id: 'c', text: 'Đã gọi NCC', done: true }),
      mk({ id: 'd', text: 'Xóa rồi', deleted: true }),
    ]
    expect(filterNotes(list, { seg: 'all' }).map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(filterNotes(list, { seg: 'open' }).map((n) => n.id)).toEqual(['a', 'b'])
    expect(filterNotes(list, { seg: 'done' }).map((n) => n.id)).toEqual(['c'])
    expect(filterNotes(list, { seg: 'pinned' }).map((n) => n.id)).toEqual(['a'])
    expect(filterNotes(list, { query: 'gạo' }).map((n) => n.id)).toEqual(['a'])
    expect(filterNotes(list, { query: 'gao' }).map((n) => n.id)).toEqual(['a'])
  })

  it('sortNotes: chưa xong → ghim → mới nhất (đã xong+ghim không đè việc mở)', () => {
    const list = [
      mk({ id: 'old', date: '2026-08-01T00:00:00.000Z', done: false }),
      mk({ id: 'new', date: '2026-08-20T00:00:00.000Z', done: false }),
      mk({ id: 'pin', date: '2026-08-10T00:00:00.000Z', pinned: true }),
      mk({ id: 'done', date: '2026-08-21T00:00:00.000Z', done: true }),
      mk({ id: 'pinDone', date: '2026-08-22T00:00:00.000Z', pinned: true, done: true }),
    ]
    expect(sortNotes(list).map((n) => n.id)).toEqual(['pin', 'new', 'old', 'pinDone', 'done'])
  })

  it('groupNotes ưu tiên ghim trước đã xong', () => {
    const g = groupNotes([
      mk({ id: 'p', pinned: true, done: false }),
      mk({ id: 'o', pinned: false, done: false }),
      mk({ id: 'd', pinned: true, done: true }),
      mk({ id: 'doneOnly', pinned: false, done: true }),
    ])
    expect(g.pinned.map((n) => n.id)).toEqual(['p', 'd'])
    expect(g.open.map((n) => n.id)).toEqual(['o'])
    expect(g.done.map((n) => n.id)).toEqual(['doneOnly'])
  })
})

describe('updateNote', () => {
  beforeEach(async () => {
    initSyncEngine({ deviceId: 'test-dev' })
    await dbx.notes.clear()
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
  })

  it('sửa text và type qua upsert', async () => {
    const n = await addNote('Cũ', 'todo')
    await updateNote(n.id, { text: 'Mới hơn', type: 'idea' })
    const got = await dbx.notes.get(n.id)
    expect(got?.text).toBe('Mới hơn')
    expect(got?.type).toBe('idea')
    expect(got?.hlc).toBeTruthy()
  })

  it('từ chối text rỗng', async () => {
    const n = await addNote('Giữ nguyên', 'note')
    await expect(updateNote(n.id, { text: '   ' })).rejects.toThrow(/trống/)
    const got = await dbx.notes.get(n.id)
    expect(got?.text).toBe('Giữ nguyên')
  })
})

describe('deleteNote', () => {
  beforeEach(async () => {
    initSyncEngine({ deviceId: 'test-dev' })
    await dbx.notes.clear()
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
  })

  it('deleteNote soft-delete trong txn (đọc lại bản mới nhất)', async () => {
    const n = await addNote('Xóa tôi', 'note')
    await dbx.notes.update(n.id, { pinned: true })
    await deleteNote(n.id)
    const got = await dbx.notes.get(n.id)
    expect(got?.deleted).toBe(true)
    expect(got?.pinned).toBe(true)
  })

  it('toggle done/pin không hồi sinh note đã xóa', async () => {
    const n = await addNote('Sắp xóa', 'todo')
    await deleteNote(n.id)
    const beforeQueue = await dbx.syncQueue.count()
    await toggleNoteDone(n.id)
    await toggleNotePin(n.id)
    const got = await dbx.notes.get(n.id)
    expect(got?.deleted).toBe(true)
    expect(got?.done).toBe(false)
    expect(got?.pinned).toBe(false)
    expect(await dbx.syncQueue.count()).toBe(beforeQueue)
  })
})
