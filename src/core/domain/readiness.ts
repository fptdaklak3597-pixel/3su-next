/**
 * 3SU Next — Kiểm tra sẵn sàng (readiness check)
 * Port từ 90-product-hardening.js: đánh giá mức độ sẵn sàng cho bản dùng thật.
 */
import { dbx } from '../db'
import { getSyncState } from '../sync/engine'
import { getAutoBackups } from './trial'
import type { ShopInfo, Settings } from '../types'

export interface ReadinessRow {
  ok: boolean
  title: string
  detail: string
}

export interface ReadinessResult {
  rows: ReadinessRow[]
  okCount: number
  total: number
}

function fmtBytes(n: number): string {
  n = Number(n) || 0
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

/** Ước lượng dung lượng dữ liệu local (IndexedDB) — an toàn dưới ~900KB cloud. */
async function estimateDataSize(): Promise<number> {
  try {
    const dump: Record<string, unknown> = {}
    const tables = ['products', 'sales', 'customers', 'suppliers', 'goodsReceipts', 'stockMoves'] as const
    for (const t of tables) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dump[t] = await (dbx as any)[t].toArray()
    }
    return new Blob([JSON.stringify(dump)]).size
  } catch {
    return 0
  }
}

export async function runReadinessCheck(shop: ShopInfo, settings: Settings): Promise<ReadinessResult> {
  const [productCount, autoBackups, dataSize] = await Promise.all([
    dbx.products.filter((p) => !p.deleted).count(),
    getAutoBackups().catch(() => []),
    estimateDataSize(),
  ])
  const backupCount = autoBackups.length

  const sync = getSyncState()
  const rows: ReadinessRow[] = [
    {
      ok: productCount >= 3,
      title: 'Kho hàng',
      detail: productCount + ' sản phẩm',
    },
    {
      ok: !!shop.phone,
      title: 'Thông tin cửa hàng',
      detail: shop.phone || 'Chưa có số điện thoại',
    },
    {
      ok: backupCount > 0,
      title: 'Backup máy này',
      detail: backupCount + ' bản',
    },
    {
      ok: dataSize > 0 && dataSize < 850000,
      title: 'Dung lượng dữ liệu',
      detail: fmtBytes(dataSize) + ' / khoảng 900 KB an toàn',
    },
    {
      ok: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
      title: 'PWA offline',
      detail: typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? 'Trình duyệt hỗ trợ'
        : 'Trình duyệt không hỗ trợ',
    },
  ]

  if (sync.lastSyncAt) {
    rows.push({
      ok: sync.status !== 'error',
      title: 'Lần sync gần nhất',
      detail: sync.status === 'error'
        ? (sync.error || 'Đang lỗi')
        : new Date(sync.lastSyncAt).toLocaleString('vi-VN'),
    })
  }

  void settings // dành cho các kiểm tra mở rộng (autoBackup…)
  const okCount = rows.filter((r) => r.ok).length
  return { rows, okCount, total: rows.length }
}
