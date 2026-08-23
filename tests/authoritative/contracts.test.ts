/**
 * Phase 1 gate — Command/Event contracts (spec 2026-08-20).
 */
import { describe, it, expect } from 'vitest'
import {
  ContractError,
  parseCommandEnvelope,
  parseCommandResult,
  parseCanonicalEvent,
} from '@/core/authoritative/contracts'

function validSaleCommand(over: Record<string, unknown> = {}) {
  return {
    id: 'cmd_1',
    shopId: 'shop_1',
    deviceId: 'dev_1',
    userId: 'user_1',
    type: 'sale.create',
    payload: {
      items: [{ productId: 'p1', qty: 2, unitName: 'chai' }],
      payMethod: 'cash',
      tendered: 0,
    },
    occurredAt: '2026-08-20T10:00:00.000Z',
    localSeq: 1,
    createdAt: 1_755_150_000_000,
    ...over,
  }
}

function validEvent(over: Record<string, unknown> = {}) {
  return {
    id: 'evt_1',
    seq: 1,
    shopId: 'shop_1',
    commandId: 'cmd_1',
    type: 'SaleCommitted',
    occurredAt: '2026-08-20T10:00:00.000Z',
    committedAt: '2026-08-20T10:00:01.000Z',
    schemaVersion: 1,
    payload: { saleId: 's1' },
    ...over,
  }
}

describe('authoritative contracts — Phase 1 gate', () => {
  it('parse command sale.create hợp lệ', () => {
    const cmd = parseCommandEnvelope(validSaleCommand())
    expect(cmd.id).toBe('cmd_1')
    expect(cmd.type).toBe('sale.create')
    expect((cmd.payload as { items: unknown[] }).items).toHaveLength(1)
  })

  it('thiếu id / shopId / type → ContractError', () => {
    expect(() => parseCommandEnvelope(validSaleCommand({ id: '' }))).toThrow(ContractError)
    expect(() => parseCommandEnvelope(validSaleCommand({ shopId: '' }))).toThrow(ContractError)
    expect(() => parseCommandEnvelope(validSaleCommand({ type: '' }))).toThrow(ContractError)
    try {
      parseCommandEnvelope(validSaleCommand({ id: '' }))
    } catch (e) {
      expect(e).toBeInstanceOf(ContractError)
      expect((e as ContractError).code).toBe('MISSING_FIELD')
    }
  })

  it('payload sale có field canonical bị cấm → FORBIDDEN_FIELD', () => {
    const forbiddenRoots = ['total', 'profit', 'cost', 'stockAfter', 'debtAfter', 'unitRatio']
    for (const key of forbiddenRoots) {
      expect(() =>
        parseCommandEnvelope(
          validSaleCommand({
            payload: {
              items: [{ productId: 'p1', qty: 1, unitName: 'chai' }],
              [key]: 1,
            },
          }),
        ),
      ).toThrow(ContractError)
    }
    expect(() =>
      parseCommandEnvelope(
        validSaleCommand({
          payload: {
            items: [{ productId: 'p1', qty: 1, unitName: 'chai', price: 1000 }],
          },
        }),
      ),
    ).toThrow(ContractError)
    expect(() =>
      parseCommandEnvelope(
        validSaleCommand({
          payload: {
            items: [{ productId: 'p1', qty: 1, unitName: 'chai', unitRatio: 24 }],
          },
        }),
      ),
    ).toThrow(ContractError)
  })

  it('CommandResult status chỉ accepted|rejected|conflict', () => {
    const ok = parseCommandResult({
      commandId: 'cmd_1',
      status: 'accepted',
      events: [validEvent()],
    })
    expect(ok.status).toBe('accepted')
    expect(() =>
      parseCommandResult({ commandId: 'cmd_1', status: 'pending', events: [] }),
    ).toThrow(ContractError)
    try {
      parseCommandResult({ commandId: 'cmd_1', status: 'ok', events: [] })
    } catch (e) {
      expect((e as ContractError).code).toBe('INVALID_STATUS')
    }
  })

  it('CanonicalEvent bắt buộc seq, commandId, schemaVersion', () => {
    expect(parseCanonicalEvent(validEvent()).seq).toBe(1)
    expect(() => parseCanonicalEvent(validEvent({ seq: undefined }))).toThrow(ContractError)
    expect(() => parseCanonicalEvent(validEvent({ commandId: '' }))).toThrow(ContractError)
    expect(() => parseCanonicalEvent(validEvent({ schemaVersion: undefined }))).toThrow(ContractError)
    try {
      parseCanonicalEvent(validEvent({ seq: 0 }))
    } catch (e) {
      expect((e as ContractError).code).toBe('INVALID_SEQ')
    }
  })
})
