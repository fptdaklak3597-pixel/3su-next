/**
 * 3SU Next — Cài đặt + thông tin shop (có outbox).
 * Port từ 19a-settings: lưu settings/shop kèm op settings.set để đồng bộ.
 */
import { dbx, setMeta } from '../db'
import type { Settings, ShopInfo } from '../types'
import { enqueueOp, requestFlush } from '../sync/engine'

export async function saveSettingsSynced(s: Settings): Promise<void> {
  await dbx.transaction('rw', [dbx.meta, dbx.syncQueue, dbx.appliedOps], async () => {
    await setMeta('settings', s)
    const op = await enqueueOp('settings.set', { key: 'settings', value: s })
    await setMeta('hlc:settings', op.hlc)
  })
  requestFlush()
}

export async function saveShopSynced(shop: ShopInfo): Promise<void> {
  await dbx.transaction('rw', [dbx.meta, dbx.syncQueue, dbx.appliedOps], async () => {
    await setMeta('shop', shop)
    const op = await enqueueOp('settings.set', { key: 'shop', value: shop })
    await setMeta('hlc:shop', op.hlc)
  })
  requestFlush()
}
