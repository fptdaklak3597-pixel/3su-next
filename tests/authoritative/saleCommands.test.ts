import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { buildCreateSaleCommand, confirmSaleAuthoritative } from '@/core/authoritative/saleCommands'
import { canFinalizeSaleUi, setAuthoritativeMoneyStockEnabled } from '@/core/authoritative/flag'
import type { CommandResult } from '@/core/authoritative/contracts'

describe('Phase 6 — sale online + UI policy', () => {
  beforeEach(async () => {
    await Promise.all([dbx.commandQueue.clear(), dbx.commandResults.clear(), dbx.syncConflicts.clear()])
    await setAuthoritativeMoneyStockEnabled(true)
  })

  it('buildCreateSaleCommand không gửi total/price/cost/unitRatio', async () => {
    const cmd = await buildCreateSaleCommand({
      shopId: 's1',
      userId: 'u1',
      commandId: 'cmd_x',
      items: [{ productId: 'p1', qty: 2, unitName: 'chai' }],
      payMethod: 'cash',
    })
    const p = cmd.payload as Record<string, unknown>
    expect(p.total).toBeUndefined()
    expect(JSON.stringify(p)).not.toMatch(/"unitRatio"/)
    expect(JSON.stringify(p)).not.toMatch(/"price"/)
  })

  it('online accepted → canFinalizeUi true; pending → false', async () => {
    const ok = await confirmSaleAuthoritative(
      {
        shopId: 's1',
        userId: 'u1',
        commandId: 'cmd_ok',
        items: [{ productId: 'p1', qty: 1, unitName: 'chai' }],
        payMethod: 'cash',
      },
      async (e) =>
        ({
          commandId: e.id,
          status: 'accepted',
          events: [{
            id: 'e1', seq: 1, shopId: 's1', commandId: e.id, type: 'SaleCommitted',
            occurredAt: '', committedAt: '', schemaVersion: 1, payload: {},
          }],
        }) satisfies CommandResult,
    )
    expect(ok.outcome).toBe('confirmed')
    expect(ok.canFinalizeUi).toBe(true)

    const pending = await confirmSaleAuthoritative(
      {
        shopId: 's1',
        userId: 'u1',
        commandId: 'cmd_off',
        items: [{ productId: 'p1', qty: 1, unitName: 'chai' }],
        payMethod: 'cash',
      },
      async () => ({ commandId: 'x', status: 'accepted', events: [] }),
      { online: false },
    )
    expect(pending.outcome).toBe('pending')
    expect(pending.canFinalizeUi).toBe(false)
    expect(canFinalizeSaleUi('pending')).toBe(false)
    expect(canFinalizeSaleUi('conflict')).toBe(false)
    expect(canFinalizeSaleUi('confirmed')).toBe(true)
  })

  it('conflict → không finalize UI', async () => {
    const r = await confirmSaleAuthoritative(
      {
        shopId: 's1',
        userId: 'u1',
        commandId: 'cmd_cf',
        items: [{ productId: 'p1', qty: 1, unitName: 'chai' }],
        payMethod: 'cash',
      },
      async (e) => ({
        commandId: e.id,
        status: 'conflict',
        events: [],
        error: { code: 'INSUFFICIENT_STOCK', message: 'hết' },
      }),
    )
    expect(r.outcome).toBe('conflict')
    expect(r.canFinalizeUi).toBe(false)
  })
})
