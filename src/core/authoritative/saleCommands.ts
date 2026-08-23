/**
 * Build sale.create command + online confirm path (Phase 6).
 */
import { getThisDeviceId } from '../domain/devices'
import { getMeta } from '../db'
import type { CommandEnvelope, CommandResult } from './contracts'
import { enqueueCommand, flushCommandQueue } from './commandQueue'
import { canFinalizeSaleUi, mapResultToUiOutcome, saleUiBanner, type SaleUiOutcome } from './flag'

export interface SaleCommandInput {
  items: Array<{ productId: string; qty: number; unitName: string }>
  discountRequest?: number
  payMethod: 'cash' | 'transfer' | 'debt'
  tendered?: number
  customerId?: string
  wholesale?: boolean
  shopId: string
  userId: string
  commandId?: string
}

export async function buildCreateSaleCommand(input: SaleCommandInput): Promise<CommandEnvelope> {
  const id = input.commandId || `cmd_sale_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const deviceId = await getThisDeviceId()
  return {
    id,
    shopId: input.shopId,
    deviceId,
    userId: input.userId,
    type: 'sale.create',
    payload: {
      items: input.items.map((it) => ({
        productId: it.productId,
        qty: it.qty,
        unitName: it.unitName,
      })),
      discountRequest: input.discountRequest,
      payMethod: input.payMethod,
      tendered: input.tendered,
      customerId: input.customerId,
      wholesale: input.wholesale,
    },
    occurredAt: new Date().toISOString(),
    localSeq: Date.now(),
    createdAt: Date.now(),
  }
}

export interface AuthoritativeSaleResult {
  outcome: SaleUiOutcome
  commandId: string
  result?: CommandResult
  canFinalizeUi: boolean
  banner: string
}

export type PostCommandFn = (envelope: CommandEnvelope) => Promise<CommandResult>

export async function confirmSaleAuthoritative(
  input: SaleCommandInput,
  post: PostCommandFn,
  opts?: { online?: boolean },
): Promise<AuthoritativeSaleResult> {
  const online = opts?.online !== false
  const envelope = await buildCreateSaleCommand(input)
  await enqueueCommand(envelope)

  if (!online) {
    const outcome: SaleUiOutcome = 'pending'
    return {
      outcome,
      commandId: envelope.id,
      canFinalizeUi: canFinalizeSaleUi(outcome),
      banner: saleUiBanner(outcome),
    }
  }

  const flushed = await flushCommandQueue(post)
  const row = flushed.find((r) => r.id === envelope.id)
  if (!row?.result) {
    const outcome: SaleUiOutcome = 'pending'
    return {
      outcome,
      commandId: envelope.id,
      canFinalizeUi: false,
      banner: saleUiBanner(outcome),
    }
  }
  const outcome = mapResultToUiOutcome(row.result.status)
  return {
    outcome,
    commandId: envelope.id,
    result: row.result,
    canFinalizeUi: canFinalizeSaleUi(outcome),
    banner: saleUiBanner(outcome),
  }
}

export async function getShopIdForCommands(): Promise<string> {
  return getMeta<string>('cloudShopId', 'shop_local')
}
