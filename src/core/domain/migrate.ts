/**
 * Chuyển một lần từ JSON xuất của 3SU v2.7.4 → Dexie 3su-next.
 * Không sync 2 chiều với Firestore cũ.
 */
import { DEFAULT_SETTINGS, restoreLocalBackup, type BackupData } from '../db'
import type { GoodsReceipt, Product, Sale, Settings } from '../types'
import { validateBackupSchema } from './trial'

export interface LegacyChecksum {
  products: number
  sales: number
  customers: number
  stockSum: number
  debtSum: number
}

export function previewLegacy(raw: unknown): { data: BackupData; checksum: LegacyChecksum } {
  validateBackupSchema(raw)
  const d = raw as Record<string, unknown>
  const products = asArr<Record<string, unknown>>(d.products).map(normProduct)
  const sales = asArr<Record<string, unknown>>(d.sales).map(normSale)
  const customers = asArr(d.customers)
  const data = {
    version: 5,
    exportedAt: new Date().toISOString(),
    shop: (d.shop as BackupData['shop']) ?? { name: 'Cửa hàng', phone: '', address: '' },
    settings: mergeLegacySettings(d.settings),
    products,
    sales,
    customers,
    debtPayments: asArr(d.debtPayments ?? d.payments),
    goodsReceipts: asArr<Record<string, unknown>>(d.goodsReceipts ?? d.receipts ?? d.grLogs).map(normGr),
    stockMoves: asArr(d.stockMoves),
    stocktakes: asArr(d.stocktakes),
    suppliers: asArr(d.suppliers),
    supplierPayments: asArr(d.supplierPayments),
    users: asArr(d.users),
    purchaseOrders: asArr(d.purchaseOrders),
    invoices: asArr(d.invoices),
    batches: asArr(d.batches),
    priceLog: asArr(d.priceLog),
    notes: asArr(d.notes),
    pricingRules: asArr(d.pricingRules),
    quickAnswers: asArr(d.quickAnswers),
    devices: asArr(d.devices),
  } as BackupData
  return { data, checksum: checksumOf(data) }
}

export function checksumOf(data: BackupData): LegacyChecksum {
  return {
    products: data.products.length,
    sales: data.sales.length,
    customers: data.customers.length,
    stockSum: data.products.reduce((a, p) => a + (Number(p.stock) || 0), 0),
    debtSum: data.customers.reduce((a, c) => a + (Number(c.debt) || 0), 0),
  }
}

export async function importLegacy(data: BackupData): Promise<LegacyChecksum> {
  // Nhập dữ liệu 3SU cũ là một nhánh dữ liệu mới: xóa hàng đợi/sự kiện sync + con
  // trỏ cursor và tạm dừng cloud, tránh mis-sync với op-log của shop trước đó.
  await restoreLocalBackup(data)
  return checksumOf(data)
}

function mergeLegacySettings(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {}
  const receipt = (s.receipt && typeof s.receipt === 'object') ? s.receipt as Record<string, unknown> : {}
  const printer = (s.printer && typeof s.printer === 'object') ? s.printer as Record<string, unknown> : {}
  return {
    ...DEFAULT_SETTINGS,
    ...(s as Partial<Settings>),
    transferQr: String(s.transferQr ?? receipt.transferQr ?? ''),
    transferQrNote: String(s.transferQrNote ?? receipt.transferQrNote ?? ''),
    bankBin: String(s.bankBin ?? ''),
    bankAccount: String(s.bankAccount ?? ''),
    bankAccountName: String(s.bankAccountName ?? ''),
    printer: {
      ...DEFAULT_SETTINGS.printer,
      width: printer.width === 80 ? 80 : 58,
      fontSize: Number(printer.fontSize) || DEFAULT_SETTINGS.printer.fontSize,
      autoPrintAfterSale: Boolean(printer.autoPrintAfterSale),
      cloudRelay: Boolean(printer.cloudRelay),
      lanAgentUrl: String(printer.lanAgentUrl ?? ''),
      templateHeader: String(receipt.headerText ?? DEFAULT_SETTINGS.printer.templateHeader),
      templateFooter: String(s.receiptFooter ?? receipt.thankYou ?? DEFAULT_SETTINGS.printer.templateFooter),
      showLogo: receipt.showLogo !== false,
    },
  }
}

function normProduct(p: Record<string, unknown>): Product {
  return {
    id: String(p.id ?? ''),
    name: String(p.name ?? ''),
    cat: String(p.cat ?? 'Khác'),
    price: Number(p.price) || 0,
    cost: Number(p.cost) || 0,
    stock: Number(p.stock) || 0,
    unit: String(p.unit ?? 'cái'),
    barcode: String(p.barcode ?? ''),
    expiry: String(p.expiry ?? ''),
    units: Array.isArray(p.units) ? p.units as Product['units'] : [],
    wholesalePrice: Number(p.wholesalePrice) || 0,
    batches: Array.isArray(p.batches) ? p.batches as Product['batches'] : [],
    emoji: typeof p.emoji === 'string' ? p.emoji : undefined,
    createdAt: Number(p.createdAt) || Date.now(),
    updatedAt: Number(p.updatedAt) || Date.now(),
    deleted: Boolean(p.deleted),
  }
}

function normSale(s: Record<string, unknown>): Sale {
  const items = asArr<Record<string, unknown>>(s.items).map((it) => ({
    productId: String(it.productId ?? ''),
    name: String(it.name ?? ''),
    qty: Number(it.qty) || 0,
    price: Number(it.price) || 0,
    cost: Number(it.cost) || 0,
    unit: String(it.unit ?? 'cái'),
    unitRatio: Number(it.unitRatio) || 1,
  }))
  return {
    id: String(s.id ?? ''),
    items,
    total: Number(s.total) || 0,
    profit: Number(s.profit) || 0,
    discount: Number(s.discount) || 0,
    payMethod: (s.payMethod === 'transfer' || s.payMethod === 'debt') ? s.payMethod : 'cash',
    tendered: Number(s.tendered) || 0,
    change: Number(s.change) || 0,
    debtAmount: Number(s.debtAmount) || 0,
    customerId: (s.customerId as string | null) ?? null,
    date: String(s.date ?? ''),
    voided: Boolean(s.voided),
    synced: false,
  }
}

function normGr(g: Record<string, unknown>): GoodsReceipt {
  const rows = asArr<Record<string, unknown>>(g.rows).map((r) => ({
    productId: String(r.productId ?? ''),
    name: String(r.name ?? ''),
    unit: String(r.unit ?? 'cái'),
    unitRatio: Number(r.unitRatio) || 1,
    qty: Number(r.qty) || 0,
    cost: Number(r.cost) || 0,
    expiry: String(r.expiry ?? r.exp ?? ''),
  }))
  return {
    id: String(g.id ?? g.code ?? ''),
    code: String(g.code ?? ''),
    supplier: String(g.supplier ?? g.sup ?? ''),
    supplierId: g.supplierId || g.supId ? String(g.supplierId ?? g.supId) : undefined,
    date: String(g.date ?? ''),
    expiry: String(g.expiry ?? g.exp ?? ''),
    note: String(g.note ?? ''),
    rows,
    total: Number(g.total) || 0,
    paid: Number(g.paid) || 0,
    payMethod: (g.payMethod === 'transfer' || g.payMethod === 'debt' || g.payMethod === 'cash')
      ? g.payMethod
      : undefined,
    ts: Number(g.ts) || 0,
  }
}

function asArr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}
