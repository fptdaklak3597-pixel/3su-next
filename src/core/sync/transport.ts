/**
 * Giao diện SyncTransport cho op-log v2.
 * Plan 3 sẽ implement HttpTransport theo đúng interface này (server 3su-cloud).
 * `nullTransport` cho chạy offline thuần.
 */
import type { SyncOp } from '../types'
import type { SnapshotFile } from './snapshot'

export interface PushResult { acked: string[]; seq: number }
export interface PullResult { ops: SyncOp[]; seq: number }

export type ServerMsg =
  | { t: 'bump'; seq: number }
  | { t: 'mode'; mode: 'solo' | 'sync'; peers: number }
  | { t: 'print'; jobId?: string; job?: unknown }
  | { t: 'print-agent'; online: boolean; agents: number }

export interface SyncTransport {
  pushOps(ops: SyncOp[]): Promise<PushResult>
  pullOps(sinceSeq: number, limit?: number): Promise<PullResult>
  pushSnapshot(s: SnapshotFile, upToSeq: number): Promise<void>
  pullSnapshot(): Promise<{ snapshot: SnapshotFile; upToSeq: number } | null>
  connect(onMsg: (m: ServerMsg) => void): void
  disconnect(): void
}

export const nullTransport: SyncTransport = {
  async pushOps() { return { acked: [], seq: 0 } },
  async pullOps() { return { ops: [], seq: 0 } },
  async pushSnapshot() { /* no-op */ },
  async pullSnapshot() { return null },
  connect() { /* no-op */ },
  disconnect() { /* no-op */ },
}
