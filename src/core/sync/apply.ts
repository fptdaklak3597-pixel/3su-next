/**
 * Public reducer facade.
 *
 * The historical reducer lives in `apply-core.ts`. This facade adds narrowly
 * scoped reducers that must share newer security/inventory invariants, then
 * delegates all other operations unchanged.
 */
import { dbx } from '../db'
import type { GrCommitPayload, Sale, StocktakeRecord, SyncOp, User } from '../types'
import {
  applyStockDeltaToCanonicalBatchesInTx,
  reconcileProductBatchProjections,
  syncProductBatchProjectionInTx,
} from '../domain/batchProjection'
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

interface StockAdjustPayload {
  productId?: string
  delta?: number
  reason?: string
  refId?: string
}

function isClearVerifierOp(op: SyncOp): boolean {
  if (op.type !== 'user.password' || !op.payload || typeof op.payload !== 'object') return false
  return (op.payload as ClearVerifierPayload).clearVerifier === true
}

function isCanonicalStockAdjustOp(op: SyncOp): boolean {
  return op.type === 'stock.adjust'
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

async function applyCanonicalStockAdjust(op: SyncOp): Promise<number> {
  if (await dbx.appliedOps.get(op.id)) {
    await clearBlockedDiagnostic(op.id)
    observeRemoteHlc(op.hlc)
    return 0
  }

  const payload = op.payload as StockAdjustPayload | null
  try {
    await dbx.transaction(
      'rw',
      [dbx.products, dbx.batches, dbx.stockMoves, dbx.appliedOps],
      async () => {
        if (await dbx.appliedOps.get(op.id)) return
        if (!payload?.productId || !Number.isFinite(payload.delta)) {
          throw new SyncPayloadError('stock.adjust thiếu productId hoặc delta')
        }
        const delta = payload.delta as number
        const product = await dbx.products.get(payload.productId)
        if (!product) throw new SyncDependencyError('stock.adjust thiếu SP ' + payload.productId)

        const moveId = 'mv_' + op.id
        if (await dbx.stockMoves.get(moveId)) {
          const projection = await syncProductBatchProjectionInTx(product)
          if (projection.changed) await dbx.products.put(product)
          await dbx.appliedOps.add({ id: op.id })
          return
        }

        const nextStock = product.stock + delta
        if (!Number.isFinite(nextStock)) throw new SyncPayloadError('stock.adjust làm tồn kho không hợp lệ')
        product.stock = nextStock
        product.updatedAt = Date.now()
        await applyStockDeltaToCanonicalBatchesInTx(product, delta)
        await dbx.products.put(product)
        await dbx.stockMoves.add({
          id: moveId,
          productId: payload.productId,
          type: 'adjust',
          qty: delta,
          cost: product.cost,
          note: payload.reason ?? '',
          refId: payload.refId ?? '',
          date: new Date().toISOString(),
          ts: Date.now(),
        })
        await dbx.appliedOps.add({ id: op.id })
      },
    )
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

function payloadProductIds(op: SyncOp): string[] {
  if (op.type === 'sale.commit') {
    const sale = op.payload as Partial<Sale> | null
    return Array.isArray(sale?.items)
      ? sale.items.map((item) => item?.productId).filter((id): id is string => typeof id === 'string' && !!id)
      : []
  }
  if (op.type === 'stocktake.commit') {
    const record = op.payload as Partial<StocktakeRecord> | null
    return Array.isArray(record?.rows)
      ? record.rows.map((row) => row?.productId).filter((id): id is string => typeof id === 'string' && !!id)
      : []
  }
  if (op.type === 'gr.commit') {
    const commit = op.payload as Partial<GrCommitPayload> | null
    return Array.isArray(commit?.patches)
      ? commit.patches.map((patch) => patch?.productId).filter((id): id is string => typeof id === 'string' && !!id)
      : []
  }
  return []
}

async function reconcileAffectedProjection(op: SyncOp): Promise<void> {
  const ids = payloadProductIds(op)
  if (op.type === 'sale.void' && op.payload && typeof op.payload === 'object') {
    const saleId = (op.payload as { saleId?: unknown }).saleId
    if (typeof saleId === 'string') {
      const sale = await dbx.sales.get(saleId)
      if (sale) ids.push(...sale.items.map((item) => item.productId))
    }
  }
  if (ids.length > 0) await reconcileProductBatchProjections(ids)
}

/**
 * Apply each op in page order and retry dependencies after later ops have had
 * a chance to create them. This keeps batch mutations ordered while retaining
 * the original dependency/poison behavior.
 */
export async function applyOps(ops: SyncOp[]): Promise<number> {
  let applied = 0
  let pending = [...ops]

  while (pending.length > 0) {
    let progressed = false
    const deferred: Array<{ op: SyncOp; error: SyncDependencyError }> = []

    for (const op of pending) {
      if (await dbx.appliedOps.get(op.id)) {
        await reconcileAffectedProjection(op)
        await clearBlockedDiagnostic(op.id)
        observeRemoteHlc(op.hlc)
        progressed = true
        continue
      }

      try {
        if (isClearVerifierOp(op)) applied += await applyClearVerifier(op)
        else if (isCanonicalStockAdjustOp(op)) applied += await applyCanonicalStockAdjust(op)
        else {
          applied += await applyCoreOps([op])
          await reconcileAffectedProjection(op)
        }
        progressed = true
      } catch (error) {
        if (error instanceof SyncDependencyError) {
          deferred.push({ op, error })
          continue
        }
        throw error
      }
    }

    if (deferred.length === 0) break
    if (!progressed) {
      const first = deferred[0]!
      throw new SyncDependencyError(
        `Đồng bộ đang chờ dependency cho ${first.op.type} (${first.op.id}): ${first.error.message}`,
      )
    }
    pending = deferred.map((entry) => entry.op)
  }

  return applied
}
