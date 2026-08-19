/**
 * 3SU Next — Lớp lưu trữ local-first (IndexedDB qua Dexie)
 *
 * Toàn bộ dữ liệu bán hàng nằm trên máy trước tiên (local-first),
 * đồng bộ lên cloud khi có mạng. Giống mô hình 3su-v2.7.4 nhưng
 * dùng IndexedDB trực tiếp thay vì localStorage → chịu được data lớn.
 */
import Dexie, { type Table } from 'dexie'
import type {
  Product, Sale, Customer, DebtPayment, GoodsReceipt,
  StockMove, StocktakeRecord, Settings, ShopInfo, User,
  SyncOp, InvoiceRecord, TrialInfo, Supplier, SupplierPayment,
  PurchaseOrder, ArchiveRecord, PairedDevice, QuickAnswer, PricingRule,
  ProductBatch, PriceLogEntry, Note, AppliedOp,
} from './types'
import { getThisDeviceId } from './domain/devices'

/* ─── Schema ─── */
class SuNextDB extends Dexie {
  products!: Table<Product, string>
  sales!: Table<Sale, string>
  customers!: Table<Customer, string>
  debtPayments!: Table<DebtPayment, string>
  goodsReceipts!: Table<GoodsReceipt, string>
  stockMoves!: Table<StockMove, string>
  stocktakes!: Table<StocktakeRecord, string>
  invoices!: Table<InvoiceRecord, string>
  syncQueue!: Table<SyncOp, string>
  meta!: Table<{ key: string; value: unknown }, string>
  /* v2 — tính năng mở rộng */
  suppliers!: Table<Supplier, string>
  supplierPayments!: Table<SupplierPayment, string>
  users!: Table<User, string>
  purchaseOrders!: Table<PurchaseOrder, string>
  archive!: Table<ArchiveRecord, string>
  devices!: Table<PairedDevice, string>
  quickAnswers!: Table<QuickAnswer, string>
  pricingRules!: Table<PricingRule, string>
  /* v3 — lô hàng FEFO + nhật ký giá nhập */
  batches!: Table<ProductBatch, string>
  priceLog!: Table<PriceLogEntry, string>
  /* v4 — ghi chú */
  notes!: Table<Note, string>
  /* v5 — op-log v2: đánh dấu op đã áp */
  appliedOps!: Table<AppliedOp, string>

  constructor() {
    super('3su_next_v4')
    this.version(1).stores({
      products: 'id, name, cat, barcode, deleted, updatedAt',
      sales: 'id, date, voided, customerId, synced, [date+voided]',
      customers: 'id, name, phone, deleted',
      debtPayments: 'id, customerId, date',
      goodsReceipts: 'id, code, ts',
      stockMoves: 'id, productId, type, ts, date',
      stocktakes: 'id, ts',
      invoices: 'id, code, type, ts',
      syncQueue: 'id, type, createdAt',
      meta: 'key',
    })
    /* v2: thêm bảng mới (giữ nguyên bảng cũ) */
    this.version(2).stores({
      products: 'id, name, cat, barcode, deleted, updatedAt',
      sales: 'id, date, voided, customerId, synced, [date+voided]',
      customers: 'id, name, phone, deleted',
      debtPayments: 'id, customerId, date',
      goodsReceipts: 'id, code, ts',
      stockMoves: 'id, productId, type, ts, date',
      stocktakes: 'id, ts',
      invoices: 'id, code, type, ts',
      syncQueue: 'id, type, createdAt',
      meta: 'key',
      suppliers: 'id, name, phone, deleted',
      supplierPayments: 'id, supplierId, date',
      users: 'id, username, role, deleted',
      purchaseOrders: 'id, code, supplierId, status, ts, date',
      archive: 'id, kind, refId, archivedAt',
      devices: 'id, deviceId, pairedAt',
      quickAnswers: 'id',
      pricingRules: 'id',
    })
    /* v3: lô hàng FEFO + nhật ký giá (giữ nguyên các bảng cũ) */
    this.version(3).stores({
      products: 'id, name, cat, barcode, deleted, updatedAt',
      sales: 'id, date, voided, customerId, synced, [date+voided]',
      customers: 'id, name, phone, deleted',
      debtPayments: 'id, customerId, date',
      goodsReceipts: 'id, code, ts',
      stockMoves: 'id, productId, type, ts, date',
      stocktakes: 'id, ts',
      invoices: 'id, code, type, ts',
      syncQueue: 'id, type, createdAt',
      meta: 'key',
      suppliers: 'id, name, phone, deleted',
      supplierPayments: 'id, supplierId, date',
      users: 'id, username, role, deleted',
      purchaseOrders: 'id, code, supplierId, status, ts, date',
      archive: 'id, kind, refId, archivedAt',
      devices: 'id, deviceId, pairedAt',
      quickAnswers: 'id',
      pricingRules: 'id',
      batches: 'id, productId, expiry',
      priceLog: 'id, productId, supId, ts',
    })
    /* v4: ghi chú (giữ nguyên các bảng cũ) */
    this.version(4).stores({
      products: 'id, name, cat, barcode, deleted, updatedAt',
      sales: 'id, date, voided, customerId, synced, [date+voided]',
      customers: 'id, name, phone, deleted',
      debtPayments: 'id, customerId, date',
      goodsReceipts: 'id, code, ts',
      stockMoves: 'id, productId, type, ts, date',
      stocktakes: 'id, ts',
      invoices: 'id, code, type, ts',
      syncQueue: 'id, type, createdAt',
      meta: 'key',
      suppliers: 'id, name, phone, deleted',
      supplierPayments: 'id, supplierId, date',
      users: 'id, username, role, deleted',
      purchaseOrders: 'id, code, supplierId, status, ts, date',
      archive: 'id, kind, refId, archivedAt',
      devices: 'id, deviceId, pairedAt',
      quickAnswers: 'id',
      pricingRules: 'id',
      batches: 'id, productId, expiry',
      priceLog: 'id, productId, supId, ts',
      notes: 'id, type, done, date',
    })
    /* v5: op-log v2 — appliedOps chống áp trùng; wipe queue format cũ */
    this.version(5).stores({
      products: 'id, name, cat, barcode, deleted, updatedAt',
      sales: 'id, date, voided, customerId, synced, [date+voided]',
      customers: 'id, name, phone, deleted',
      debtPayments: 'id, customerId, date',
      goodsReceipts: 'id, code, ts',
      stockMoves: 'id, productId, type, ts, date',
      stocktakes: 'id, ts',
      invoices: 'id, code, type, ts',
      syncQueue: 'id, type, createdAt',
      meta: 'key',
      suppliers: 'id, name, phone, deleted',
      supplierPayments: 'id, supplierId, date',
      users: 'id, username, role, deleted',
      purchaseOrders: 'id, code, supplierId, status, ts, date',
      archive: 'id, kind, refId, archivedAt',
      devices: 'id, deviceId, pairedAt',
      quickAnswers: 'id',
      pricingRules: 'id',
      batches: 'id, productId, expiry',
      priceLog: 'id, productId, supId, ts',
      notes: 'id, type, done, date',
      appliedOps: 'id',
    }).upgrade(async (tx) => {
      await tx.table('syncQueue').clear()
    })
  }
}

export const dbx = new SuNextDB()

/* ─── Defaults ─── */
export const DEFAULT_SETTINGS: Settings = {
  lowStock: 5,
  hsdWarnDays: 14,
  showCostInCart: false,
  compactRows: false,
  soundOn: true,
  celebrateOnSale: true,
  allowNegativeStock: true,
  theme: 'light',
  largeText: false,
  transferQr: '',
  transferQrNote: '',
  bankBin: '',
  bankAccount: '',
  bankAccountName: '',
  printer: {
    width: 58,
    fontSize: 12,
    autoPrintAfterSale: false,
    cloudRelay: false,
    lanAgentUrl: '',
    templateHeader: '',
    templateFooter: 'Cảm ơn quý khách!',
    showLogo: true,
  },
}

export const DEFAULT_SHOP: ShopInfo = {
  name: 'Cửa hàng của tôi',
  phone: '',
  address: '',
}

/* ─── Meta helpers ─── */
export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await dbx.meta.get(key)
  return row ? (row.value as T) : fallback
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await dbx.meta.put({ key, value })
}

/** Chỉ đọc + merge default — không ghi. Dùng trong snapshot/backup (transaction `r`). */
export async function readSettings(): Promise<Settings> {
  const s = await getMeta<Partial<Settings>>('settings', {})
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    printer: { ...DEFAULT_SETTINGS.printer, ...(s.printer ?? {}) },
  }
}

export async function getSettings(): Promise<Settings> {
  const merged = await readSettings()
  // Web luôn ưu tiên light — dark theme chỉ dùng khi user chủ động chọn trong Cài đặt sau mốc này.
  // Máy cũ bị ép dark (ui:claude-dark) sẽ được kéo về light một lần.
  const lightMigrated = await getMeta('ui:web-light-v2', false)
  if (!lightMigrated) {
    if (merged.theme !== 'light') {
      merged.theme = 'light'
      await setMeta('settings', merged)
    }
    try { localStorage.setItem('3su_theme', 'light') } catch { /* */ }
    await setMeta('ui:web-light-v2', true)
  }
  return merged
}

export async function saveSettings(s: Settings): Promise<void> {
  await setMeta('settings', s)
}

export async function getShop(): Promise<ShopInfo> {
  return getMeta<ShopInfo>('shop', DEFAULT_SHOP)
}

export async function saveShop(shop: ShopInfo): Promise<void> {
  await setMeta('shop', shop)
}

export async function getCurrentUser(): Promise<User | null> {
  return getMeta<User | null>('currentUser', null)
}

export async function setCurrentUser(u: User | null): Promise<void> {
  await setMeta('currentUser', u)
}

export async function getTrial(): Promise<TrialInfo | null> {
  return getMeta<TrialInfo | null>('trial', null)
}

export async function saveTrial(t: TrialInfo | null): Promise<void> {
  await setMeta('trial', t)
}

/* ─── Backup / Restore ─── */
export interface BackupData {
  version: number
  exportedAt: string
  shop: ShopInfo
  settings: Settings
  products: Product[]
  sales: Sale[]
  customers: Customer[]
  debtPayments: DebtPayment[]
  goodsReceipts: GoodsReceipt[]
  stockMoves: StockMove[]
  stocktakes: StocktakeRecord[]
  suppliers?: Supplier[]
  supplierPayments?: SupplierPayment[]
  users?: User[]
  purchaseOrders?: PurchaseOrder[]
  invoices?: InvoiceRecord[]
  batches?: ProductBatch[]
  priceLog?: PriceLogEntry[]
  notes?: Note[]
  pricingRules?: PricingRule[]
  quickAnswers?: QuickAnswer[]
  devices?: PairedDevice[]
}

export async function exportBackup(): Promise<BackupData> {
  const [products, sales, customers, debtPayments, goodsReceipts, stockMoves, stocktakes,
    suppliers, supplierPayments, users, purchaseOrders, invoices, batches, priceLog, notes,
    pricingRules, quickAnswers, devices] =
    await Promise.all([
      dbx.products.toArray(),
      dbx.sales.toArray(),
      dbx.customers.toArray(),
      dbx.debtPayments.toArray(),
      dbx.goodsReceipts.toArray(),
      dbx.stockMoves.toArray(),
      dbx.stocktakes.toArray(),
      dbx.suppliers.toArray(),
      dbx.supplierPayments.toArray(),
      dbx.users.toArray(),
      dbx.purchaseOrders.toArray(),
      dbx.invoices.toArray(),
      dbx.batches.toArray(),
      dbx.priceLog.toArray(),
      dbx.notes.toArray(),
      dbx.pricingRules.toArray(),
      dbx.quickAnswers.toArray(),
      dbx.devices.toArray(),
    ])
  return {
    version: 5,
    exportedAt: new Date().toISOString(),
    shop: await getShop(),
    settings: await readSettings(),
    products, sales, customers, debtPayments, goodsReceipts, stockMoves, stocktakes,
    suppliers, supplierPayments, users, purchaseOrders, invoices, batches, priceLog, notes,
    pricingRules, quickAnswers, devices,
  }
}

export async function restoreBackup(data: BackupData): Promise<void> {
  await dbx.transaction(
    'rw',
    [dbx.products, dbx.sales, dbx.customers, dbx.debtPayments, dbx.goodsReceipts, dbx.stockMoves,
      dbx.stocktakes, dbx.meta, dbx.suppliers, dbx.supplierPayments, dbx.users, dbx.purchaseOrders, dbx.invoices,
      dbx.batches, dbx.priceLog, dbx.notes, dbx.pricingRules, dbx.quickAnswers, dbx.devices],
    async () => {
      await Promise.all([
        dbx.products.clear(), dbx.sales.clear(), dbx.customers.clear(),
        dbx.debtPayments.clear(), dbx.goodsReceipts.clear(), dbx.stockMoves.clear(),
        dbx.stocktakes.clear(), dbx.suppliers.clear(), dbx.supplierPayments.clear(),
        dbx.users.clear(), dbx.purchaseOrders.clear(), dbx.invoices.clear(), dbx.batches.clear(),
        dbx.priceLog.clear(), dbx.notes.clear(), dbx.pricingRules.clear(), dbx.quickAnswers.clear(),
        dbx.devices.clear(),
      ])
      await dbx.products.bulkPut(data.products ?? [])
      await dbx.sales.bulkPut(data.sales ?? [])
      await dbx.customers.bulkPut(data.customers ?? [])
      await dbx.debtPayments.bulkPut(data.debtPayments ?? [])
      await dbx.goodsReceipts.bulkPut(data.goodsReceipts ?? [])
      await dbx.stockMoves.bulkPut(data.stockMoves ?? [])
      await dbx.stocktakes.bulkPut(data.stocktakes ?? [])
      await dbx.suppliers.bulkPut(data.suppliers ?? [])
      await dbx.supplierPayments.bulkPut(data.supplierPayments ?? [])
      await dbx.users.bulkPut(data.users ?? [])
      await dbx.purchaseOrders.bulkPut(data.purchaseOrders ?? [])
      await dbx.invoices.bulkPut(data.invoices ?? [])
      await dbx.batches.bulkPut(data.batches ?? [])
      await dbx.priceLog.bulkPut(data.priceLog ?? [])
      await dbx.notes.bulkPut(data.notes ?? [])
      await dbx.pricingRules.bulkPut(data.pricingRules ?? [])
      await dbx.quickAnswers.bulkPut(data.quickAnswers ?? [])
      const localId = await getThisDeviceId()
      await dbx.devices.bulkPut((data.devices ?? []).map((d) => ({
        ...d,
        isThis: d.deviceId === localId,
      })))
      if (data.shop) await saveShop(data.shop)
      if (data.settings) {
        await saveSettings({
          ...DEFAULT_SETTINGS,
          ...data.settings,
          printer: { ...DEFAULT_SETTINGS.printer, ...data.settings.printer },
        })
      }
    },
  )
}

/** Khôi phục từ file local: restore data rồi xóa outbox (giữ lastSeq / appliedOps). */
export async function restoreLocalBackup(data: BackupData): Promise<void> {
  await restoreBackup(data)
  await dbx.syncQueue.clear()
}

/** Xóa toàn bộ dữ liệu (chủ shop mới được phép — kiểm tra ở UI) */
export async function wipeAll(): Promise<void> {
  await dbx.delete()
  dbx.close()
  await dbx.open()
}
