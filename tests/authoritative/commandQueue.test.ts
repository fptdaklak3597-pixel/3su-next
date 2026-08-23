/**
 * Phase 4 gate — commandQueue Dexie
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { enqueueCommand, flushCommandQueue } from '@/core/authoritative/commandQueue'
import type { CommandEnvelope, CommandResult } from '@/core/authoritative/contracts'

function env(id: string, over: Partial<CommandEnvelope> = {}): CommandEnvelope {
  return {
    id,
    shopId: 'shop_1',
    deviceId: 'dev_1',
    userId: 'u1',
    type: 'sale.create',
    payload: { items: [{ productId: 'p1', qty: 1, unitName: 'chai' }], payMethod: 'cash' },
    occurredAt: '2026-08-20T10:00:00.000Z',
    localSeq: over.localSeq ?? 1,
    createdAt: over.createdAt ?? Date.now(),
    dependsOn: over.dependsOn,
    ...over,
  }
}

describe('commandQueue — Phase 4 gate', () => {
  beforeEach(async () => {
    await Promise.all([
      dbx.commandQueue.clear(),
      dbx.commandResults.clear(),
      dbx.syncConflicts.clear(),
      dbx.canonicalEvents.clear(),
    ])
  })

  it('enqueue trùng commandId không nhân bản', async () => {
    await enqueueCommand(env('cmd_1'))
    await enqueueCommand(env('cmd_1', { localSeq: 99 }))
    expect(await dbx.commandQueue.count()).toBe(1)
    const row = await dbx.commandQueue.get('cmd_1')
    expect(row?.envelope.localSeq).toBe(1)
  })

  it('reload vẫn còn command pending', async () => {
    await enqueueCommand(env('cmd_persist'))
    // fake reopen: đọc lại từ cùng IndexedDB
    const again = await dbx.commandQueue.get('cmd_persist')
    expect(again?.status).toBe('pending')
    expect(again?.type).toBe('sale.create')
  })

  it('dependsOn: con không flush trước cha', async () => {
    await enqueueCommand(env('parent', { localSeq: 1, createdAt: 1 }))
    await enqueueCommand(env('child', { localSeq: 2, createdAt: 2, dependsOn: ['parent'] }))
    const posted: string[] = []
    await flushCommandQueue(async (e) => {
      posted.push(e.id)
      // chỉ accept parent lần này
      if (e.id === 'parent') {
        return { commandId: e.id, status: 'accepted', events: [] } satisfies CommandResult
      }
      return { commandId: e.id, status: 'accepted', events: [] }
    })
    // First flush: parent goes; child may go after parent accepted in same loop
    expect(posted[0]).toBe('parent')
    expect(posted).toContain('parent')
    // Reset child to pending-only scenario
    await dbx.commandQueue.clear()
    await dbx.commandResults.clear()
    await enqueueCommand(env('child_only', { dependsOn: ['missing_parent'], createdAt: 1 }))
    const posted2: string[] = []
    await flushCommandQueue(async (e) => {
      posted2.push(e.id)
      return { commandId: e.id, status: 'accepted', events: [] }
    })
    expect(posted2).toEqual([])
    const child = await dbx.commandQueue.get('child_only')
    expect(child?.status).toBe('pending')
  })

  it('dependsOn: cha rejected → con rejected, không pending mãi', async () => {
    await enqueueCommand(env('parent', { localSeq: 1, createdAt: 1 }))
    await enqueueCommand(env('child', { localSeq: 2, createdAt: 2, dependsOn: ['parent'] }))
    await flushCommandQueue(async (e) => {
      if (e.id === 'parent') {
        return {
          commandId: e.id,
          status: 'rejected',
          events: [],
          error: { code: 'X', message: 'no' },
        } satisfies CommandResult
      }
      throw new Error('child must not post')
    })
    await flushCommandQueue(async () => {
      throw new Error('should not post')
    })
    const child = await dbx.commandQueue.get('child')
    expect(child?.status).toBe('rejected')
    const cr = await dbx.commandResults.get('child')
    expect(cr?.status).toBe('rejected')
  })

  it('status transition pending → sending → accepted|conflict', async () => {
    await enqueueCommand(env('cmd_ok'))
    await enqueueCommand(env('cmd_cf'))
    let n = 0
    await flushCommandQueue(async (e) => {
      n++
      if (e.id === 'cmd_cf') {
        return { commandId: e.id, status: 'conflict', events: [], error: { code: 'INSUFFICIENT_STOCK', message: 'hết' } }
      }
      return { commandId: e.id, status: 'accepted', events: [] }
    })
    expect((await dbx.commandQueue.get('cmd_ok'))?.status).toBe('accepted')
    expect((await dbx.commandQueue.get('cmd_cf'))?.status).toBe('conflict')
    expect(await dbx.syncConflicts.where('commandId').equals('cmd_cf').count()).toBe(1)
    expect(n).toBe(2)
  })

  it('hai flush song song không post trùng cùng command', async () => {
    await enqueueCommand(env('cmd_once', { createdAt: 1 }))
    const posted: string[] = []
    const slowPost = async (e: CommandEnvelope): Promise<CommandResult> => {
      posted.push(e.id)
      await new Promise((r) => setTimeout(r, 40))
      return { commandId: e.id, status: 'accepted', events: [] }
    }
    await Promise.all([flushCommandQueue(slowPost), flushCommandQueue(slowPost)])
    expect(posted.filter((id) => id === 'cmd_once')).toHaveLength(1)
    expect((await dbx.commandQueue.get('cmd_once'))?.status).toBe('accepted')
  })
})
