/**
 * Client command queue — Phase 4.
 * Enqueue / flush stub với dependsOn; chưa thay confirmSale.
 */
import { dbx } from '../db'
import { withExclusiveLock } from '../offline'
import type { CommandEnvelope, CommandResult, CommandResultStatus } from './contracts'

export type CommandQueueStatus = 'pending' | 'sending' | CommandResultStatus | 'cancelled'

export interface QueuedCommand {
  id: string
  type: string
  createdAt: number
  status: CommandQueueStatus
  envelope: CommandEnvelope
  lastError?: string
  result?: CommandResult
}

export interface SyncConflictRow {
  id: string
  commandId: string
  createdAt: number
  reason: string
  payload?: unknown
  resolvedAt?: number
}

export type PostCommandFn = (envelope: CommandEnvelope) => Promise<CommandResult>

export async function enqueueCommand(envelope: CommandEnvelope): Promise<QueuedCommand> {
  const existing = await dbx.commandQueue.get(envelope.id)
  if (existing) return existing
  const row: QueuedCommand = {
    id: envelope.id,
    type: envelope.type,
    createdAt: envelope.createdAt || Date.now(),
    status: 'pending',
    envelope,
  }
  await dbx.commandQueue.put(row)
  return row
}

export async function listPendingCommands(): Promise<QueuedCommand[]> {
  const all = await dbx.commandQueue.toArray()
  return all
    .filter((c) => c.status === 'pending' || c.status === 'sending')
    .sort((a, b) => a.createdAt - b.createdAt || a.envelope.localSeq - b.envelope.localSeq)
}

/** Serialize same-tab flushes; Web Lock giảm race đa tab. */
let flushTail: Promise<unknown> = Promise.resolve()

/** Con không flush nếu dependsOn chưa accepted. */
export function flushCommandQueue(post: PostCommandFn): Promise<QueuedCommand[]> {
  const run = flushTail.then(() =>
    withExclusiveLock('command-flush', () => flushCommandQueueBody(post)),
  )
  flushTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function flushCommandQueueBody(post: PostCommandFn): Promise<QueuedCommand[]> {
  const pending = await listPendingCommands()
  const done: QueuedCommand[] = []
  for (const row of pending) {
    const deps = row.envelope.dependsOn || []
    let blocked = false
    for (const depId of deps) {
      const parent = await dbx.commandQueue.get(depId)
      const parentResult = await dbx.commandResults.get(depId)
      const parentStatus = parent?.status ?? parentResult?.status
      if (parentStatus === 'rejected' || parentStatus === 'conflict') {
        row.status = 'rejected'
        row.result = {
          commandId: row.id,
          status: 'rejected',
          events: [],
          error: {
            code: 'DEPENDENCY_FAILED',
            message: `dependsOn ${depId} ${parentStatus}`,
          },
        }
        await dbx.commandQueue.put(row)
        await dbx.commandResults.put({ ...row.result, storedAt: Date.now() })
        blocked = true
        break
      }
      if (parentStatus !== 'accepted') {
        blocked = true
        break
      }
    }
    if (blocked) continue

    row.status = 'sending'
    await dbx.commandQueue.put(row)
    try {
      const result = await post(row.envelope)
      row.result = result
      row.status = result.status
      await dbx.commandQueue.put(row)
      await dbx.commandResults.put({ ...result, storedAt: Date.now() })
      if (result.status === 'conflict') {
        await dbx.syncConflicts.put({
          id: `cf_${row.id}`,
          commandId: row.id,
          createdAt: Date.now(),
          reason: result.error?.message || 'conflict',
          payload: result.error,
        })
      }
      done.push(row)
    } catch (e) {
      row.status = 'pending'
      row.lastError = e instanceof Error ? e.message : String(e)
      await dbx.commandQueue.put(row)
    }
  }
  return done
}
