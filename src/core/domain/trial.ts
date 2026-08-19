/**
 * 3SU Next — Trial / License + Sao lưu tự động
 * Port từ 19b-trial.js. Bản gốc đã chuyển MIỄN PHÍ TRỌN ĐỜI nên trial chỉ còn
 * là cờ license; phần giá trị giữ lại: validate backup + sao lưu tự động hằng ngày.
 */
import { getMeta, setMeta, exportBackup, type BackupData } from '../db'
import { today } from '../format'

/** App MIỄN PHÍ TRỌN ĐỜI — mọi shop coi như đã cấp phép (giống getTrialInfo gốc). */
export function getTrialInfo(): { licensed: boolean; expired: boolean; daysLeft: number } {
  return { licensed: true, expired: false, daysLeft: 99999 }
}

export function isTrialUser(): boolean {
  return !getTrialInfo().licensed
}

/** Xác thực cấu trúc file backup trước khi khôi phục (port validateBackupSchema). */
export function validateBackupSchema(data: unknown): void {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Backup phải là object')
  }
  const d = data as Record<string, unknown>
  const requiredArrays = ['products', 'sales', 'customers']
  for (const key of requiredArrays) {
    if (!Array.isArray(d[key])) throw new Error('Thiếu hoặc sai kiểu: ' + key)
  }
  const optionalArrays = [
    'suppliers', 'supplierPayments', 'goodsReceipts', 'stockMoves', 'purchaseOrders',
    'users', 'stocktakes', 'debtPayments', 'invoices', 'batches', 'priceLog', 'notes',
    'pricingRules', 'quickAnswers', 'devices',
  ]
  for (const key of optionalArrays) {
    if (d[key] != null && !Array.isArray(d[key])) throw new Error('Sai kiểu: ' + key)
  }
  if (d.sourceShopId != null && typeof d.sourceShopId !== 'string') {
    throw new Error('sourceShopId phải là string')
  }
  if (d.settings != null && (typeof d.settings !== 'object' || Array.isArray(d.settings))) {
    throw new Error('settings phải là object')
  }
  if (d.shop != null && (typeof d.shop !== 'object' || Array.isArray(d.shop))) {
    throw new Error('shop phải là object')
  }
  const sampleProduct = (d.products as Record<string, unknown>[]).find(Boolean)
  if (sampleProduct && typeof sampleProduct.name !== 'string') throw new Error('products[].name phải là string')
  const sampleSale = (d.sales as Record<string, unknown>[]).find(Boolean)
  if (sampleSale && typeof sampleSale.total !== 'number') throw new Error('sales[].total phải là number')
}

/** Parse + xác thực file sao lưu local trước khi hỏi confirm khôi phục. */
export function parseRestoreFile(raw: string): BackupData {
  let data: unknown
  try { data = JSON.parse(raw) } catch { throw new Error('File sao lưu không hợp lệ') }
  validateBackupSchema(data)
  return data as BackupData
}

/* ─── Sao lưu tự động (giữ 3 bản gần nhất, mỗi ngày 1 bản) ─── */
export interface AutoBackup {
  date: string
  data: BackupData
}

export async function getAutoBackups(): Promise<AutoBackup[]> {
  return getMeta<AutoBackup[]>('backups', [])
}

/** Tạo bản sao tự động (bỏ qua nếu đã có bản trong hôm nay, trừ khi force). */
export async function scheduleAutoBackup(force = false): Promise<void> {
  const backups = await getAutoBackups()
  const lastDate = backups[0]?.date?.slice(0, 10)
  if (!force && lastDate === today()) return
  const data = await exportBackup()
  backups.unshift({ date: new Date().toISOString(), data })
  while (backups.length > 3) backups.pop()
  await setMeta('backups', backups)
}

export async function deleteAutoBackups(): Promise<void> {
  await setMeta('backups', [])
}
