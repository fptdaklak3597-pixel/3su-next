/**
 * 3SU Next — Sync engine v2 (op-log local-first)
 *
 * Plan 1: outbox atomic. Mọi mutation nghiệp vụ ghi op vào syncQueue + appliedOps
 * TRONG CÙNG Dexie transaction với dữ liệu (outbox pattern). App chạy offline thuần
 * với NullTransport; SyncTransport (push/pull thật) cắm ở Plan 3.
 *
 * - `makeOp`: tạo op envelope v2 (id = HLC, kiêm idempotency key).
 * - `persistOp`: ghi op vào outbox + đánh dấu đã áp local (gọi trong transaction).
 * - `enqueueOp`: makeOp + persistOp.
 * - `initSyncEngine`: nạp deviceId + HLC persisted khi khởi động app.
 */
import Dexie from 'dexie'
import { dbx, getMeta, setMeta } from '../db'
import type { SyncOp, OpType, SyncState } from '../types'
import { createHlcClock, type HlcClock } from './hlc'
import { getThisDeviceId } from '../domain/devices'
import { applyOps } from './apply'
import { exportSnapshot, importSnapshot } from './snapshot'
import { decideFlush, type SyncMode } from './mode'
import { nullTransport, type SyncTransport, type ServerMsg } from './transport'
import { logError } from '../errorLogger'
import { setPrintAgentOnline } from '../browser/printPresence'

const RETRY_INTERVAL = 30_000 // 30s

let deviceId = ''
let clock: HlcClock | null = null

let syncState: SyncState = {
  status: 'idle',
  lastSyncAt: null,
  pendingOps: 0,
  error: null,
}
let listeners: ((s: SyncState) => void)[] = []
let timer: ReturnType<typeof setInterval> | null = null

export function getSyncState(): SyncState {
  return syncState
}

export function onSyncState(fn: (s: SyncState) => void): () => void {
  listeners.push(fn)
  return () => { listeners = listeners.filter((l) => l !== fn) }
}

function emit(): void {
  listeners.forEach((fn) => { try { fn(syncState) } catch { /* */ } })
}

function setState(patch: Partial<SyncState>): void {
  syncState = { ...syncState, ...patch }
  emit()
}

/** Gọi 1 lần khi khởi động app (trước render). */
export async function initSyncEngine(): Promise<void> {
  deviceId = await getThisDeviceId()
  const persisted = await getMeta<string | null>('hlc:last', null)
  clock = createHlcClock(deviceId, persisted, (s) => {
    // Ghi ngoài transaction hiện hành để không bắt caller khai báo bảng meta
    void Dexie.ignoreTransaction(() => setMeta('hlc:last', s))
  })
  const paused = await getMeta<unknown>('cloud:paused', false)
  cloudPaused = paused === true || paused === 'true' || paused === 1
}

/** Tạo op envelope v2 — sync, throw nếu chưa init. */
export function makeOp(type: OpType, payload: unknown): SyncOp {
  if (!clock) throw new Error('Sync engine chưa init — gọi initSyncEngine() khi khởi động app')
  const hlc = clock.next()
  return { id: hlc, hlc, deviceId, type, payload, createdAt: Date.now(), attempts: 0 }
}

/** Ghi op vào outbox + đánh dấu đã áp local. Gọi trong transaction có syncQueue + appliedOps. */
export async function persistOp(op: SyncOp): Promise<void> {
  await dbx.syncQueue.add(op)
  await dbx.appliedOps.add({ id: op.id })
}

export async function enqueueOp(type: OpType, payload: unknown): Promise<SyncOp> {
  const op = makeOp(type, payload)
  await persistOp(op)
  return op
}

let flushScheduled = false

/**
 * Đẩy outbox ngay sau khi transaction local commit.
 * Không gọi trong transaction Dexie. Mode `local` (chưa ghép cloud) bỏ qua.
 */
export function requestFlush(): void {
  if (mode === 'local' || cloudPaused) return
  if (flushScheduled) return
  flushScheduled = true
  setTimeout(() => {
    flushScheduled = false
    void flushQueue()
  }, 0)
}

/** Cho reducer đẩy đồng hồ theo op remote (Task 3). */
export function observeRemoteHlc(remoteHlc: string): void {
  clock?.observe(remoteHlc)
}

let transport: SyncTransport = nullTransport
let mode: SyncMode = 'local'
let cloudPaused = false

export function setCloudPaused(v: boolean): void { cloudPaused = v }
export function isCloudPausedMem(): boolean { return cloudPaused }

async function flushBlocked(): Promise<boolean> {
  if (cloudPaused || mode === 'local') return true
  const paused = await getMeta<unknown>('cloud:paused', false)
  return paused === true || paused === 'true' || paused === 1
}

export function setTransport(t: SyncTransport): void { transport = t }
export function setSyncMode(m: SyncMode): void { mode = m }

/** Đóng transport thật (WS), về offline local. */
export function disconnectTransport(): void {
  cloudPaused = true
  transport.disconnect()
  transport = nullTransport
  mode = 'local'
  setState({ status: 'offline' })
}

export async function flushQueue(): Promise<void> {
  if (await flushBlocked()) { setState({ status: 'offline' }); return }
  if (syncState.status === 'syncing') return
  if (!navigator.onLine) { setState({ status: 'offline' }); return }
  setState({ status: 'syncing', error: null })
  try {
    const outbox = await dbx.syncQueue.orderBy('createdAt').toArray()
    const lastSnapshotAt = await getMeta<number>('sync:lastSnapshotAt', 0)
    const lastSeq = await getMeta<number>('sync:lastSeq', 0)
    const lastSnapshotSeq = await getMeta<number>('sync:lastSnapshotSeq', 0)
    const d = decideFlush(mode, outbox.length, lastSnapshotAt, Date.now(), lastSeq, lastSnapshotSeq)

    if (d.pushOps) {
      for (let i = 0; i < outbox.length; i += 100) {
        const batch = outbox.slice(i, i + 100)
        const res = await transport.pushOps(batch)
        await dbx.syncQueue.bulkDelete(res.acked)
        // lastSeq = mốc đã ÁP, không phải MAX cloud. push trả seq toàn shop —
        // ghi vào đây rồi pullSince sẽ bỏ op máy kia nằm giữa.
      }
    }
    await catchUpSnapshot()
    await pullSince()
    // Snapshot sau pull — upToSeq khớp sổ đã áp, không gói đơn mới rồi ghi mốc cũ.
    if (d.pushSnapshot) {
      const exp = await exportSnapshot()
      const seq = await getMeta<number>('sync:lastSeq', 0)
      await transport.pushSnapshot(exp.snapshot, seq)
      // Mode sync: giữ outbox — máy kia cần op, không được xóa vì đã gói snapshot.
      // Solo: backup xong thì xóa op đã gói (op chen sau export vẫn còn).
      if (mode !== 'sync') await dbx.syncQueue.bulkDelete(exp.pendingOpIds)
      await setMeta('sync:lastSnapshotAt', Date.now())
      await setMeta('sync:lastSnapshotSeq', seq)
    }
    await gcAppliedOps()
    const remaining = await dbx.syncQueue.count()
    setState({ status: 'ok', lastSyncAt: Date.now(), pendingOps: remaining, error: null })
  } catch (e) {
    logError(e, 'sync.flush')
    setState({ status: 'error', error: e instanceof Error ? e.message : 'Lỗi đồng bộ' })
  }
}

/** Máy mới (chưa có lastSeq): lấy snapshot nền; cloud trống thì đẩy bản local nếu có hàng. */
async function catchUpSnapshot(): Promise<void> {
  const lastSeq = await getMeta<number>('sync:lastSeq', 0)
  if (lastSeq > 0) return
  const pulled = await pullCloudSnapshot(false)
  if (pulled) return
  const [products, sales] = await Promise.all([dbx.products.count(), dbx.sales.count()])
  if (products + sales === 0) return
  const exp = await exportSnapshot()
  await transport.pushSnapshot(exp.snapshot, 0)
  await setMeta('sync:lastSnapshotAt', Date.now())
  await setMeta('sync:lastSnapshotSeq', 0)
}

/** Sau import, cursor phải đúng watermark của snapshot để replay mọi op phía sau. */
export function lastSeqAfterSnapshot(_oldLastSeq: number, upToSeq: number): number {
  if (!Number.isSafeInteger(upToSeq) || upToSeq < 0) throw new Error('Mốc snapshot không hợp lệ')
  return upToSeq
}

/** Kéo snapshot cloud. force=true ghi đè máy này (hỏi trước ở UI). */
export async function pullCloudSnapshot(force = false): Promise<boolean> {
  if (!force) {
    const lastSeq = await getMeta<number>('sync:lastSeq', 0)
    if (lastSeq > 0) return false
  }
  const got = await transport.pullSnapshot()
  if (!got?.snapshot) {
    if (force) throw new Error('Cloud chưa có bản sao để kéo')
    return false
  }
  const snapshotSeq = lastSeqAfterSnapshot(
    await getMeta<number>('sync:lastSeq', 0),
    got.upToSeq,
  )
  await importSnapshot(got.snapshot)
  await setMeta('sync:lastSeq', snapshotSeq)
  await setMeta('sync:lastSnapshotSeq', snapshotSeq)
  return true
}

/** Đẩy bản sao máy này lên cloud (nút Thiết bị). */
export async function pushLocalSnapshot(): Promise<void> {
  const exp = await exportSnapshot()
  const lastSeq = await getMeta<number>('sync:lastSeq', 0)
  await transport.pushSnapshot(exp.snapshot, lastSeq)
  await setMeta('sync:lastSnapshotAt', Date.now())
  await setMeta('sync:lastSnapshotSeq', lastSeq)
}

const PULL_PAGE = 500

function pulledUpTo(since: number, ops: SyncOp[], cloudSeq: number): number {
  let max = since
  let sawSeq = false
  for (const op of ops) {
    const s = (op as SyncOp & { seq?: number }).seq
    if (typeof s === 'number') {
      sawSeq = true
      if (s > max) max = s
    }
  }
  if (sawSeq) return max
  if (ops.length > 0 && ops.length < PULL_PAGE) return Math.max(since, cloudSeq)
  if (ops.length >= PULL_PAGE) return since + ops.length
  return since
}

async function pullSince(): Promise<void> {
  for (;;) {
    const since = await getMeta<number>('sync:lastSeq', 0)
    const res = await transport.pullOps(since, PULL_PAGE)
    if (res.ops.length > 0) await applyOps(res.ops)
    const upTo = pulledUpTo(since, res.ops, res.seq)
    if (upTo > since) await setMeta('sync:lastSeq', upTo)
    if (res.ops.length < PULL_PAGE) break
  }
}

export function handleServerMsg(m: ServerMsg): void {
  if (cloudPaused) return
  if (m.t === 'bump') void pullSince()
  else if (m.t === 'mode') { setSyncMode(m.mode); void flushQueue() }
  else if (m.t === 'print-agent') setPrintAgentOnline(!!m.online)
}

/* ─── Vòng lặp retry nền ─── */
export function startSyncLoop(): void {
  if (timer) return
  timer = setInterval(() => {
    void flushQueue().catch(() => { /* đã log bên trong */ })
  }, RETRY_INTERVAL)

  // Sync lại khi có mạng
  window.addEventListener('online', () => { void flushQueue() })
}

export function stopSyncLoop(): void {
  if (timer) { clearInterval(timer); timer = null }
}

/** Xóa appliedOps cũ hơn 30 ngày (id = HLC, 13 số đầu là ms). */
export async function gcAppliedOps(now = Date.now(), maxAgeMs = 30 * 86_400_000): Promise<number> {
  const cutoff = now - maxAgeMs
  const all = await dbx.appliedOps.toArray()
  const stale = all.filter((r) => {
    const ms = Number(String(r.id).slice(0, 13))
    return Number.isFinite(ms) && ms < cutoff
  })
  if (stale.length) await dbx.appliedOps.bulkDelete(stale.map((r) => r.id))
  return stale.length
}
