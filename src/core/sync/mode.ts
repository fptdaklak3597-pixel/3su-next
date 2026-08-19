/**
 * Mode machine cho flush — thuần, không IO.
 *  - local: chưa ghép cửa hàng → không đẩy gì.
 *  - sync:  nhiều máy → đẩy op liên tục (delta).
 *  - solo:  1 máy → chỉ đẩy snapshot dạng backup (20h / hoặc outbox quá 500 op).
 */
export type SyncMode = 'local' | 'solo' | 'sync'

export interface FlushDecision { pushOps: boolean; pushSnapshot: boolean }

const SOLO_SNAPSHOT_INTERVAL = 20 * 3600 * 1000 // 20 giờ
const SOLO_SNAPSHOT_THRESHOLD = 500

export function decideFlush(
  mode: SyncMode,
  outboxCount: number,
  lastSnapshotAt: number,
  now: number,
  lastSeq = 0,
  lastSnapshotSeq = 0,
): FlushDecision {
  if (mode === 'local') return { pushOps: false, pushSnapshot: false }
  // sync + solo: đẩy op ngay — máy 2 kéo được dù chỉ 1 máy đang online
  const pushOps = outboxCount > 0
  if (mode === 'sync') {
    return { pushOps, pushSnapshot: lastSeq - lastSnapshotSeq >= 20 }
  }
  const stale = outboxCount > 0 && now - lastSnapshotAt > SOLO_SNAPSHOT_INTERVAL
  const large = outboxCount > SOLO_SNAPSHOT_THRESHOLD
  return { pushOps, pushSnapshot: stale || large }
}
