/**
 * Public reducer facade.
 *
 * The historical reducer lives in `apply-core.ts`. This facade intercepts the
 * credential-redaction form of `user.password` without duplicating the large
 * business reducer, then delegates all other operations unchanged.
 */
import { dbx } from '../db'
import type { SyncOp, User } from '../types'
import { compareHlc } from './hlc'
import { observeRemoteHlc } from './engine'
import {
  applyOps as applyCoreOps,
  recordBlockedOp,
  recordPoisonedOp,
  SyncDependencyError,
  SyncPayloadError,
} from './apply-core'

export * from './apply-core'

interface ClearVerifierPayload {
  userId?: string
  clearVerifier?: boolean
  passwordNeedsReset?: boolean
  updatedAt?: number
}

function isClearVerifierOp(op: SyncOp): boolean {
  if (op.type !== 'user.password' || !op.payload || typeof op.payload !== 'object') return false
  return (op.payload as ClearVerifierPayload).clearVerifier === true
}

async function clearBlockedDiagnostic(opId: string): Promise<void> {
  const row = await dbx.meta.get('sync:blocked')
  if (!Array.isArray(row?.value)) return
  const next = (row.value as Array<{ id?: string }>).filter((entry) => entry?.id !== opId)
  if (next.length !== row.value.length) await dbx.meta.put({ key: 'sync:blocked', value: next })
}

async function applyClearVerifier(op: SyncOp): Promise<number> {
  if (await dbx.appliedOps.get(op.id)) {
    await clearBlockedDiagnostic(op.id)
    observeRemoteHlc(op.hlc)
    return 0
  }

  const payload = op.payload as ClearVerifierPayload
  try {
    await dbx.transaction('rw', [dbx.users, dbx.appliedOps], async () => {
      if (await dbx.appliedOps.get(op.id)) return
      if (!payload.userId || payload.clearVerifier !== true) {
        throw new SyncPayloadError('user.password clearVerifier thiếu dữ liệu')
      }
      const current = await dbx.users.get(payload.userId)
      if (!current) throw new SyncDependencyError('user.password thiếu user ' + payload.userId)
      if (current.role !== 'owner' && current.role !== 'admin') {
        throw new SyncPayloadError('clearVerifier chỉ hợp lệ cho owner/admin')
      }
      if (!current.hlc || compareHlc(op.hlc, current.hlc) > 0) {
        const next: User = {
          ...current,
          passwordHash: '',
          salt: '',
          passwordNeedsReset: payload.passwordNeedsReset ?? true,
          updatedAt: Number.isFinite(payload.updatedAt) ? payload.updatedAt! : Date.now(),
          hlc: op.hlc,
        }
        await dbx.users.put(next)
      }
      await dbx.appliedOps.add({ id: op.id })
    })
    await clearBlockedDiagnostic(op.id)
    observeRemoteHlc(op.hlc)
    return 1
  } catch (error) {
    if (error instanceof SyncDependencyError) {
      await recordBlockedOp(op, error)
      observeRemoteHlc(op.hlc)
      throw error
    }
    if (error instanceof SyncPayloadError) {
      if (!(await dbx.appliedOps.get(op.id))) await dbx.appliedOps.add({ id: op.id })
      await recordPoisonedOp(op, error)
      await clearBlockedDiagnostic(op.id)
      observeRemoteHlc(op.hlc)
      return 0
    }
    throw error
  }
}

/**
 * Apply ordinary operations with the established reducer first so a user
 * profile arriving later in the same page can satisfy a verifier-clear op.
 * HLC comparison preserves the intended ordering even though clear operations
 * are applied after the ordinary page contents.
 */
export async function applyOps(ops: SyncOp[]): Promise<number> {
  const ordinary = ops.filter((op) => !isClearVerifierOp(op))
  const clearOps = ops.filter(isClearVerifierOp)
  let applied = ordinary.length > 0 ? await applyCoreOps(ordinary) : 0
  for (const op of clearOps) applied += await applyClearVerifier(op)
  return applied
}
