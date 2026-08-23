/**
 * Reconnect ritual: pull events → apply → flush commands (Phase 7).
 * Payment commands bị chặn khi offline.
 */
import { dbx } from '../db'
import type { CanonicalEvent, CommandEnvelope, CommandResult, CommandType } from './contracts'
import { enqueueCommand, flushCommandQueue, listPendingCommands } from './commandQueue'

const PAYMENT_TYPES: CommandType[] = ['customerPayment.create', 'supplierPayment.create']

export function assertCommandAllowedOffline(type: CommandType): void {
  if (PAYMENT_TYPES.includes(type)) {
    throw new Error('Thu nợ / trả NCC yêu cầu online')
  }
}

export async function enqueueCommandGuarded(envelope: CommandEnvelope, online: boolean): Promise<void> {
  if (!online) assertCommandAllowedOffline(envelope.type)
  await enqueueCommand(envelope)
}

export type PullEventsFn = (since: number) => Promise<{ events: CanonicalEvent[]; seq: number }>
export type ApplyEventsFn = (events: CanonicalEvent[]) => Promise<void>
export type PostCommandFn = (envelope: CommandEnvelope) => Promise<CommandResult>

export interface RitualLog {
  steps: string[]
  flushed: string[]
}

/**
 * Thứ tự bắt buộc: pull → apply → flush. Không flush trước pull.
 */
export async function runReconnectRitual(opts: {
  pull: PullEventsFn
  apply: ApplyEventsFn
  post: PostCommandFn
  getCursor: () => Promise<number>
  setCursor: (seq: number) => Promise<void>
}): Promise<RitualLog> {
  const log: RitualLog = { steps: [], flushed: [] }
  const since = await opts.getCursor()
  log.steps.push('pull')
  const { events, seq } = await opts.pull(since)
  log.steps.push('apply')
  await opts.apply(events)
  for (const ev of events) {
    await dbx.canonicalEvents.put(ev)
  }
  await opts.setCursor(seq)
  log.steps.push('flush')
  const done = await flushCommandQueue(opts.post)
  log.flushed = done.map((d) => d.id)
  return log
}

/** Pending overlay tồn — UX only */
export function displayStock(
  canonicalStock: number,
  pendingSaleBaseQty: number,
  pendingReceiptBaseQty: number,
): number {
  return canonicalStock - pendingSaleBaseQty + pendingReceiptBaseQty
}

export async function dualDeviceOfflineRaceDemo(
  processA: () => Promise<CommandResult>,
  processB: () => Promise<CommandResult>,
): Promise<{ a: CommandResult; b: CommandResult }> {
  const a = await processA()
  const b = await processB()
  return { a, b }
}
