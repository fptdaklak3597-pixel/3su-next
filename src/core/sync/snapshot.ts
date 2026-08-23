/**
 * Snapshot = toàn bộ state để (a) backup cloud hằng ngày (mode SOLO),
 * (b) máy mới join lấy nền rồi replay op sau đó.
 *
 * Snapshot khác file backup local: staff verifier được giữ cho luồng đăng nhập
 * offline đã thiết kế, còn owner/admin verifier luôn bị redaction.
 */
import { dbx, exportBackup, restoreBackup, type BackupData } from '../db'
import { getThisDeviceId } from '../domain/devices'
import { applyOps } from './apply'
import { observeRemoteHlc } from './engine'

export interface SnapshotFile { backup: BackupData; hlc: string; deviceId: string; at: number }
export interface SnapshotExport { snapshot: SnapshotFile; pendingOpIds: string[] }

/** Xuất state + danh sách op chờ NGUYÊN TỬ — op nào nằm trong pendingOpIds là ĐÃ gói vào snapshot. */
export async function exportSnapshot(): Promise<SnapshotExport> {
  const deviceId = await getThisDeviceId()
  return dbx.transaction('r', [dbx.products, dbx.sales, dbx.customers, dbx.debtPayments,
    dbx.goodsReceipts, dbx.stockMoves, dbx.stocktakes, dbx.suppliers, dbx.supplierPayments,
    dbx.users, dbx.purchaseOrders, dbx.invoices, dbx.batches, dbx.priceLog, dbx.notes,
    dbx.pricingRules, dbx.quickAnswers, dbx.devices, dbx.archive, dbx.meta, dbx.syncQueue], async () => {
    const backup = await exportBackup({ credentialPolicy: 'staff-only' })
    const hlc = ((await dbx.meta.get('hlc:last'))?.value as string) ?? ''
    const pendingOpIds = (await dbx.syncQueue.toArray()).map((o) => o.id)
    return { snapshot: { backup, hlc, deviceId, at: Date.now() }, pendingOpIds }
  })
}

export async function importSnapshot(s: SnapshotFile): Promise<void> {
  const pending = await dbx.syncQueue.orderBy('createdAt').toArray()
  await restoreBackup(s.backup, { userMode: 'snapshot' })
  // Xóa SẠCH appliedOps: dấu "đã áp" cũ thuộc về state cũ. Nếu giữ lại, op remote
  // mới hơn mốc snapshot sẽ bị bỏ qua khi pull lại → mất dữ liệu.
  await dbx.appliedOps.clear()
  // Áp lại op pending của chính máy này lên nền snapshot qua reducer chung —
  // reducer tự bỏ qua record đã nằm sẵn trong snapshot và ghi lại appliedOps.
  await applyOps(pending)
  if (s.hlc) observeRemoteHlc(s.hlc)
}
