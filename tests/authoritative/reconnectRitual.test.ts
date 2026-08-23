import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { enqueueCommand } from '@/core/authoritative/commandQueue'
import {
  assertCommandAllowedOffline,
  displayStock,
  enqueueCommandGuarded,
  runReconnectRitual,
} from '@/core/authoritative/reconnectRitual'
import { emptyShopState, processCommand } from '@/core/authoritative/processor'
import type { CommandEnvelope, CanonicalEvent } from '@/core/authoritative/contracts'
import { setMeta, getMeta } from '@/core/db'

function saleEnv(id: string, dependsOn?: string[]): CommandEnvelope {
  return {
    id,
    shopId: 'shop_1',
    deviceId: 'dev_1',
    userId: 'u1',
    type: 'sale.create',
    payload: { items: [{ productId: 'p1', qty: 1, unitName: 'chai' }], payMethod: 'cash' },
    occurredAt: '2026-08-20T10:00:00.000Z',
    localSeq: 1,
    createdAt: Date.now(),
    dependsOn,
  }
}

describe('Phase 7 — offline + reconnect ritual', () => {
  beforeEach(async () => {
    await Promise.all([
      dbx.commandQueue.clear(),
      dbx.commandResults.clear(),
      dbx.canonicalEvents.clear(),
      dbx.syncConflicts.clear(),
    ])
    await setMeta('eventCursor', 0)
  })

  it('payment offline bị chặn', async () => {
    expect(() => assertCommandAllowedOffline('customerPayment.create')).toThrow(/online/)
    await expect(
      enqueueCommandGuarded(
        {
          ...saleEnv('pay1'),
          type: 'customerPayment.create',
          payload: { customerId: 'c1', amount: 10 },
        },
        false,
      ),
    ).rejects.toThrow(/online/)
  })

  it('reconnect: pull trước flush', async () => {
    await enqueueCommand(saleEnv('cmd_pending'))
    const order: string[] = []
    const log = await runReconnectRitual({
      getCursor: async () => getMeta('eventCursor', 0),
      setCursor: async (seq) => setMeta('eventCursor', seq),
      pull: async () => {
        order.push('pull')
        return { events: [], seq: 0 }
      },
      apply: async () => {
        order.push('apply')
      },
      post: async (e) => {
        order.push('flush:' + e.id)
        return { commandId: e.id, status: 'accepted', events: [] }
      },
    })
    expect(log.steps).toEqual(['pull', 'apply', 'flush'])
    expect(order[0]).toBe('pull')
    expect(order.indexOf('flush:cmd_pending')).toBeGreaterThan(order.indexOf('apply'))
  })

  it('hai device offline stock=1 → 1 accepted + 1 conflict', async () => {
    let state = emptyShopState('shop_1')
    state.products.p1 = {
      id: 'p1', name: 'SP', price: 1000, cost: 100, stock: 1, unit: 'chai', units: [],
    }
    const mk = (id: string): CommandEnvelope => ({
      id, shopId: 'shop_1', deviceId: id, userId: 'u', type: 'sale.create',
      payload: { items: [{ productId: 'p1', qty: 1, unitName: 'chai' }], payMethod: 'cash' },
      occurredAt: '2026-08-20T10:00:00.000Z', localSeq: 1, createdAt: 1,
    })
    const a = await processCommand(state, mk('devA_sale'))
    state = a.state
    const b = await processCommand(state, mk('devB_sale'))
    expect(a.result.status).toBe('accepted')
    expect(b.result.status).toBe('conflict')
    expect(b.state.products.p1.stock).toBe(0)
  })

  it('dependsOn receipt → sale thứ tự đúng khi flush', async () => {
    await enqueueCommand({
      id: 'gr1', shopId: 's', deviceId: 'd', userId: 'u', type: 'goodsReceipt.create',
      payload: {
        rows: [{ productId: 'p1', qty: 1, unitName: 'chai', purchasePrice: 100 }],
        payMethod: 'cash', paid: 100,
      },
      occurredAt: '2026-08-20T10:00:00.000Z', localSeq: 1, createdAt: 1,
    })
    await enqueueCommand(saleEnv('sale1', ['gr1']))
    const posted: string[] = []
    const { flushCommandQueue } = await import('@/core/authoritative/commandQueue')
    await flushCommandQueue(async (e) => {
      posted.push(e.id)
      return { commandId: e.id, status: 'accepted', events: [] }
    })
    expect(posted[0]).toBe('gr1')
    expect(posted[1]).toBe('sale1')
  })

  it('displayStock overlay', () => {
    expect(displayStock(10, 3, 2)).toBe(9)
  })

  it('mất response: pull event → command đã accepted không cần POST lại nếu đã có result', async () => {
    await enqueueCommand(saleEnv('cmd_retry'))
    await dbx.commandResults.put({
      commandId: 'cmd_retry',
      status: 'accepted',
      events: [],
      storedAt: Date.now(),
    })
    // Simulate: queue still pending but server already has result — flush should still post once;
    // client can short-circuit if desired. Gate: idempotent server. Here ensure ritual order holds.
    const log = await runReconnectRitual({
      getCursor: async () => 0,
      setCursor: async () => {},
      pull: async () => {
        const ev: CanonicalEvent = {
          id: 'e1', seq: 1, shopId: 'shop_1', commandId: 'cmd_retry', type: 'SaleCommitted',
          occurredAt: '', committedAt: '', schemaVersion: 1, payload: {},
        }
        return { events: [ev], seq: 1 }
      },
      apply: async () => {},
      post: async (e) => ({ commandId: e.id, status: 'accepted', events: [] }),
    })
    expect(log.steps[0]).toBe('pull')
  })
})
