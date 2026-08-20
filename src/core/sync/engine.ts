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

const RETRY_INTERVAL = 30_000
const PULL_PAGE = 500
const MAX_PULL_PAGES = 200

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
let onlineHandler: (() => void) | null = null
let flushPromise: Promise<void> | null = null
let flushAgain = false

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

/** Cho reducer đẩy đồng hồ theo op remote. */
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

/** Thay transport phải đóng kết nối cũ để không giữ nhiều WebSocket song song. */
export function setTransport(t: SyncTransport): void {
  if (transport === t) return
  try { transport.disconnect() } catch { /* transport cũ không được làm hỏng app */ }
  transport = t
}

export function setSyncMode(m: SyncMode): void { mode = m }

/** Đóng transport thật (WS), về offline local. */
export function disconnectTransport(): void {
  cloudPaused = true
  flushAgain = false
  try { transport.disconnect() } catch { /* */ }
  transport = nullTransport
  mode = 'local'
  setState({ status: 'offline' })
}

/**
 * Single-flight cho toàn bộ chu trình push → snapshot → pull.
 * Caller đến trong lúc đang chạy chỉ yêu cầu thêm một vòng, không tạo request chồng nhau.
 */
export function flushQueue(): Promise<void> {
  if (flushPromise) {
    flushAgain = true
    return flushPromise
  }
  flushPromise = runFlushLoop().finally(() => {
    flushPromise = null
  })
  return flushPromise
}

async function runFlushLoop(): Promise<void> {
  do {
    flushAgain = false
    await runFlushOnce()
  } while (flushAgain)
}

async function runFlushOnce(): Promise<void> {
  if (await flushBlocked()) { setState({ status: 'offline' }); return }
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
        // ghi vào đây rồi pull sẽ bỏ op máy kia nằm giữa.
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

function pulledUpTo(since: number, ops: SyncOp[], cloudSeq: number): number {
  let max = since
  let sequenced = 0
  for (const op of ops) {
    const seq = (op as SyncOp & { seq?: number }).seq
    if (seq === undefined) continue
    if (!Number.isSafeInteger(seq) || seq < 0) throw new Error('Op có seq không hợp lệ')
    sequenced += 1
    if (seq > max) max = seq
  }
  if (sequenced > 0 && sequenced !== ops.length) {
    throw new Error('Trang pull trộn op có seq và không có seq')
  }
  if (sequenced === ops.length && sequenced > 0) return max
  if (ops.length > 0 && ops.length < PULL_PAGE) return Math.max(since, cloudSeq)
  if (ops.length >= PULL_PAGE) return since + ops.length
  return since
}

function pageFingerprint(ops: SyncOp[]): string {
  if (!ops.length) return ''
  return `${ops[0]?.id ?? ''}|${ops[ops.length - 1]?.id ?? ''}|${ops.length}`
}

async function pullSince(): Promise<void> {
  let pages = 0
  let previousFullPage = ''

  for (;;) {
    pages += 1
    if (pages > MAX_PULL_PAGES) {
      throw new Error(`Đồng bộ vượt quá ${MAX_PULL_PAGES} trang trong một lượt`)
    }

    const since = await getMeta<number>('sync:lastSeq', 0)
    const res = await transport.pullOps(since, PULL_PAGE)
    if (!res || !Array.isArray(res.ops) || !Number.isSafeInteger(res.seq) || res.seq < 0) {
      throw new Error('Phản hồi pull không hợp lệ')
    }
    if (res.ops.length > PULL_PAGE) {
      throw new Error(`Máy chủ trả quá giới hạn ${PULL_PAGE} op`)
    }

    const fullPage = res.ops.length === PULL_PAGE
    const fingerprint = fullPage ? pageFingerprint(res.ops) : ''
    if (fullPage && fingerprint === previousFullPage) {
      throw new Error('Máy chủ trả lặp cùng một trang đồng bộ')
    }

    if (res.ops.length > 0) await applyOps(res.ops)
    const upTo = pulledUpTo(since, res.ops, res.seq)
    if (fullPage && upTo <= since) {
      throw new Error('Đồng bộ không tiến cursor; đã dừng để tránh vòng lặp vô hạn')
    }
    if (upTo > since) await setMeta('sync:lastSeq', upTo)
    if (!fullPage) break

    previousFullPage = fingerprint
  }
}

export function handleServerMsg(m: ServerMsg): void {
  if (cloudPaused) return
  if (m.t === 'bump') void flushQueue()
  else if (m.t === 'mode') { setSyncMode(m.mode); void flushQueue() }
  else if (m.t === 'print-agent') setPrintAgentOnline(!!m.online)
}

/* ─── Vòng lặp retry nền ─── */
export function startSyncLoop(): void {
  if (!timer) {
    timer = setInterval(() => {
      void flushQueue()
    }, RETRY_INTERVAL)
  }

  if (typeof window !== 'undefined' && !onlineHandler) {
    onlineHandler = () => { void flushQueue() }
    window.addEventListener('online', onlineHandler)
  }
}

export function stopSyncLoop(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (typeof window !== 'undefined' && onlineHandler) {
    window.removeEventListener('online', onlineHandler)
    onlineHandler = null
  }
}

const APPLIED_GC_WATERMARK_KEY = 'sync:appliedGcBeforeMs'

/** Chỉ parse đúng HLC ID; ID legacy/khác định dạng được giữ để tránh xóa nhầm. */
export function appliedOpTimestamp(id: string): number | null {
  const match = /^(\d{13})-\d{4}-.+/.exec(String(id))
  if (!match) return null
  const timestamp = Number(match[1])
  return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : null
}

/** Watermark do backend xác nhận: op có timestamp nhỏ hơn mốc này không thể replay. */
export async function getAppliedOpsGcWatermark(): Promise<number> {
  const value = await getMeta<unknown>(APPLIED_GC_WATERMARK_KEY, 0)
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : 0
}

/**
 * Watermark chỉ được tiến, không được lùi. Backend hiện chưa gửi mốc thì client
 * giữ marker vô hạn — ưu tiên idempotency hơn dung lượng.
 */
export async function setAppliedOpsGcWatermark(beforeMs: number): Promise<number> {
  if (!Number.isSafeInteger(beforeMs) || beforeMs <= 0) {
    throw new Error('Applied-op watermark không hợp lệ')
  }
  if (beforeMs > Date.now()) throw new Error('Applied-op watermark không được ở tương lai')
  const current = await getAppliedOpsGcWatermark()
  const next = Math.max(current, beforeMs)
  if (next > current) await setMeta(APPLIED_GC_WATERMARK_KEY, next)
  return next
}

/**
 * Không còn xóa theo tuổi cục bộ. Chỉ xóa marker HLC nhỏ hơn watermark server
 * đã xác nhận; boundary và ID legacy luôn được giữ.
 */
export async function gcAppliedOps(): Promise<number> {
  const watermark = await getAppliedOpsGcWatermark()
  if (watermark <= 0) return 0
  const all = await dbx.appliedOps.toArray()
  const stale = all.filter((row) => {
    const timestamp = appliedOpTimestamp(row.id)
    return timestamp !== null && timestamp < watermark
  })
  if (stale.length > 0) await dbx.appliedOps.bulkDelete(stale.map((row) => row.id))
  return stale.length
}
