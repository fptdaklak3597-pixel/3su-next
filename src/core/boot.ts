/**
 * Khởi động chung web/mobile: sync engine, persist IDB, nối cloud nếu đã ghép.
 */
import { requestPersistentStorage } from './offline'
import { connectCloud, loadApiBaseOverride } from './sync/cloud'
import { initSyncEngine } from './sync/engine'
import { registerThisDevice } from './domain/devices'
import { scheduleAutoBackup } from './domain/trial'
import { clampNegativeCustomerDebts } from './domain/customers'
import { reconcileAllBatchProjections } from './domain/batchProjection'

export async function bootApp(): Promise<void> {
  await initSyncEngine()
  // Product.batches là canonical. Rebuild mirror trước khi bất kỳ pull/push cloud nào chạy.
  await reconcileAllBatchProjections()
  void clampNegativeCustomerDebts().catch((e) => console.error('clampNegDebt', e))
  void registerThisDevice().catch((e) => console.error('registerThisDevice', e))
  await loadApiBaseOverride()
  void requestPersistentStorage()
  void scheduleAutoBackup().catch((e) => console.error('autoBackup', e))
  void connectCloud().catch((e) => console.error('connectCloud', e))
}
