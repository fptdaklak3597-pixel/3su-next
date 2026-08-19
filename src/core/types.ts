/**
 * 3SU Next — Kiểu dữ liệu trung tâm
 * Phản ánh đầy đủ data model của 3su-v2.7.4 (db object) dưới dạng typed.
 */

/* ─── Sản phẩm ─── */
export interface ProductUnit {
  /** Tên đơn vị, vd: 'thùng', 'lốc' */
  n: string
  /** Hệ số quy đổi ra đơn vị gốc, vd: thùng = 24 chai */
  r: number
}

export interface ProductBatch {
  id: string
  qty: number
  /** Số lượng còn lại (theo đơn vị gốc) — phục vụ FEFO */
  remain: number
  cost: number
  expiry: string // YYYY-MM-DD hoặc ''
  date: string   // ngày nhập
  supId?: string
  supName?: string
}

/** Nhật ký giá nhập theo NCC/sản phẩm (port 22-gr2-ext priceLog) */
export interface PriceLogEntry {
  id: string
  productId: string
  supId: string
  supName: string
  cost: number
  ts: number
}

export interface Product {
  id: string
  name: string
  cat: string
  price: number
  cost: number
  stock: number
  unit: string
  barcode: string
  expiry: string // HSD gần nhất (YYYY-MM-DD)
  units: ProductUnit[]
  wholesalePrice: number // 0 = chưa có giá sỉ
  batches: ProductBatch[]
  emoji?: string
  createdAt: number
  updatedAt: number
  /** Đã xóa mềm */
  deleted?: boolean
  /** HLC lần xóa mềm — upsert cũ hơn không sống lại */
  deletedHlc?: string
  /** LWW — hồ sơ sản phẩm, so sánh bằng HLC (spec 3.2) */
  hlc?: string
  /** HLC từng field hồ sơ — tên/giá sửa song song không đè nhau */
  fieldHlc?: Record<string, string>
  /** LWW — lần set tồn kho cuối qua kiểm kê (spec 3.4) */
  stockSetHlc?: string
  /** LWW — lần nhập kho cuối đổi cost/price/HSD (spec 3.3) */
  grHlc?: string
}

/* ─── Đơn bán ─── */
export type PayMethod = 'cash' | 'transfer' | 'debt'

export interface SaleItem {
  productId: string
  name: string
  qty: number
  price: number
  cost: number
  unit: string
  unitRatio: number
}

export interface Sale {
  id: string
  items: SaleItem[]
  total: number
  profit: number
  discount: number
  payMethod: PayMethod
  tendered: number
  change: number
  debtAmount: number
  customerId: string | null
  date: string // ISO
  voided?: boolean
  voidedAt?: string
  voidReason?: string
  /** Đánh dấu đã đồng bộ lên cloud */
  synced?: boolean
  syncVersion?: number
}

/* ─── Khách hàng ─── */
export interface Customer {
  id: string
  name: string
  phone: string
  note: string
  debt: number // >0: khách nợ; <0: khách dư
  totalSpent: number
  orderCount: number
  createdAt: number
  updatedAt: number
  /** Khách mua giá sỉ */
  wholesale?: boolean
  deleted?: boolean
  /** HLC lần xóa mềm — upsert cũ hơn không sống lại */
  deletedHlc?: string
  /** LWW — hồ sơ khách hàng (spec 3.2) */
  hlc?: string
  /** HLC từng field hồ sơ — tên/SĐT sửa song song không đè nhau */
  fieldHlc?: Record<string, string>
}

export interface DebtPayment {
  id: string
  customerId: string
  amount: number
  date: string
  note: string
}

/* ─── Nhập kho ─── */
export interface GoodsReceiptRow {
  productId: string
  name: string
  unit: string
  /** Hệ số quy đổi ra đơn vị gốc (vd thùng=24) */
  unitRatio: number
  qty: number
  cost: number
  /** HSD riêng của dòng này (YYYY-MM-DD hoặc '') */
  expiry: string
}

export interface GoodsReceipt {
  id: string
  code: string
  supplier: string
  /** Liên kết nhà cung cấp (để tính công nợ) */
  supplierId?: string
  date: string
  expiry: string
  note: string
  rows: GoodsReceiptRow[]
  total: number
  /** Số tiền đã thanh toán cho phiếu nhập này */
  paid?: number
  payMethod?: PayMethod
  ts: number
}

/* ─── Biến động kho ─── */
export type StockMoveType = 'sale' | 'purchase' | 'adjust' | 'stocktake' | 'void_restore'

export interface StockMove {
  id: string
  productId: string
  type: StockMoveType
  qty: number // dương = nhập, âm = xuất
  cost: number
  note: string
  refId: string // id đơn bán / phiếu nhập
  date: string
  ts: number
}

/* ─── Kiểm kê ─── */
export interface StocktakeRecord {
  id: string
  date: string
  rows: { productId: string; name: string; system: number; actual: number; diff: number }[]
  note: string
  ts: number
}

/* ─── Cài đặt ─── */
export interface PrinterSettings {
  width: 58 | 80
  fontSize: number
  autoPrintAfterSale: boolean
  /** Gửi phiếu JSON lên Worker cho tab máy in trên PC. */
  cloudRelay: boolean
  /** Agent LAN, vd http://192.168.1.10:9101 — thử trước cloud. */
  lanAgentUrl: string
  templateHeader: string
  templateFooter: string
  showLogo: boolean
}

export interface Settings {
  lowStock: number
  hsdWarnDays: number
  showCostInCart: boolean
  compactRows: boolean
  soundOn: boolean
  celebrateOnSale: boolean
  /** false = từ chối đơn làm âm kho. Mặc định true (cảnh báo, vẫn bán). */
  allowNegativeStock: boolean
  theme: 'light' | 'dark' | 'system'
  /** true = phóng to giao diện ~12.5% (người lớn tuổi / màn nhỏ). */
  largeText: boolean
  transferQr: string // data:image/... hoặc ''
  transferQrNote: string
  /** Mã ngân hàng VietQR (BIN hoặc mnemonic, vd 970436 / VCB) */
  bankBin: string
  bankAccount: string
  bankAccountName: string
  printer: PrinterSettings
}

export interface ShopInfo {
  name: string
  phone: string
  address: string
}

/* ─── Người dùng / Auth ─── */
export type UserRole = 'owner' | 'admin' | 'staff'

/** Quyền chi tiết theo tính năng (staff được bật/tắt từng quyền) */
export interface UserPerms {
  all?: boolean
  sell?: boolean
  inventory?: boolean
  reports?: boolean
  settings?: boolean
  suppliers?: boolean
  invoices?: boolean
  users?: boolean
}

export interface User {
  id: string
  username: string
  name: string
  email: string
  role: UserRole
  /** Hash mật khẩu (SHA-256 salted). Không lưu plain text. */
  passwordHash: string
  salt: string
  passwordNeedsReset?: boolean
  perms: UserPerms
  active: boolean
  createdAt: number
  updatedAt: number
  deleted?: boolean
  /** LWW — hồ sơ nhân viên / PIN */
  hlc?: string
}

/* ─── Nhà cung cấp ─── */
export interface Supplier {
  id: string
  name: string
  phone: string
  address: string
  note: string
  /** Thời gian giao hàng dự kiến (ngày) */
  leadDays: number
  /** >0: ta nợ NCC; <0: ta trả dư */
  debt: number
  totalPurchased: number
  orderCount: number
  createdAt: number
  updatedAt: number
  deleted?: boolean
  /** HLC lần xóa mềm — upsert cũ hơn không sống lại */
  deletedHlc?: string
  /** LWW — hồ sơ nhà cung cấp */
  hlc?: string
  /** HLC từng field hồ sơ — tên/SĐT sửa song song không đè nhau */
  fieldHlc?: Record<string, string>
}

export interface SupplierPayment {
  id: string
  supplierId: string
  amount: number
  date: string
  note: string
}

/* ─── Đơn mua hàng (Purchase Order) ─── */
export type PurchaseOrderStatus = 'draft' | 'ordered' | 'received' | 'cancelled'

export interface PurchaseOrderRow {
  productId: string
  name: string
  unit: string
  qty: number
  cost: number
  receivedQty: number
}

export interface PurchaseOrder {
  id: string
  code: string
  supplierId: string
  supplierName: string
  rows: PurchaseOrderRow[]
  total: number
  status: PurchaseOrderStatus
  note: string
  date: string
  ts: number
  hlc?: string
}

/* ─── Lưu trữ (Archive) ─── */
export type ArchiveKind = 'sale' | 'product' | 'customer' | 'supplier' | 'gr'

export interface ArchiveRecord {
  id: string
  kind: ArchiveKind
  refId: string
  label: string
  data: unknown
  archivedAt: number
  archivedBy: string
}

/* ─── Quy tắc giá (Pricing rules) ─── */
export interface PricingRule {
  id: string
  name: string
  /** Áp dụng cho danh mục ('' = tất cả) */
  cat: string
  /** Biên lợi nhuận mục tiêu (%) */
  marginPct: number
  /** Làm tròn đến bước giá (vd 1000) */
  roundTo: number
  active: boolean
  /** Đã xóa mềm (tombstone) */
  deleted?: boolean
  /** HLC lần xóa — upsert cũ hơn không sống lại */
  deletedHlc?: string
  hlc?: string
}

/* ─── Câu trả lời nhanh / lệnh nhanh ─── */
export interface QuickAnswer {
  id: string
  q: string
  a: string
}

/* ─── Ghép đôi thiết bị ─── */
export interface PairedDevice {
  id: string
  deviceId: string
  name: string
  platform: string
  pairedAt: number
  lastSeen: number
  isThis?: boolean
  /** Máy để tab /may-in chạy nền */
  role?: 'print-agent' | ''
}

/* ─── Trial ─── */
export interface TrialInfo {
  startedAt: number
  days: number
  active: boolean
}

/* ─── DB tổng (local-first, lưu IndexedDB) ─── */
export interface LocalDB {
  shop: ShopInfo
  settings: Settings
  products: Product[]
  sales: Sale[]
  customers: Customer[]
  debtPayments: DebtPayment[]
  grLogs: GoodsReceipt[]
  stockMoves: StockMove[]
  stocktakes: StocktakeRecord[]
  freqIds: string[]
  trial: TrialInfo | null
  version: number
  lastModified: number
}

/* ─── Sync ─── */
export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error' | 'offline'

export interface SyncState {
  status: SyncStatus
  lastSyncAt: number | null
  pendingOps: number
  error: string | null
}

/** Loại op trong op-log v2 — mỗi mutation nghiệp vụ = 1 op (spec 3.1) */
export type OpType =
  | 'sale.commit' | 'sale.void'
  | 'product.upsert' | 'product.delete' | 'stock.adjust' | 'stocktake.commit'
  | 'customer.upsert' | 'customer.delete' | 'debt.pay'
  | 'gr.commit' | 'supplier.upsert' | 'supplier.pay'
  | 'po.upsert'
  | 'invoice.upsert' | 'invoice.delete'
  | 'pricing.upsert' | 'pricing.delete'
  | 'settings.set' | 'note.upsert' | 'note.delete'
  | 'user.upsert' | 'user.password' | 'user.delete'
  | 'device.upsert' | 'device.remove'

/** Op envelope v2 — id = chuỗi HLC (duy nhất toàn cục, kiêm idempotency key) */
export interface SyncOp {
  id: string
  hlc: string
  deviceId: string
  type: OpType
  payload: unknown
  createdAt: number
  attempts: number
  lastError?: string
}

/** Bảng đánh dấu op đã áp — chống áp trùng (spec 3.2) */
export interface AppliedOp { id: string }

export interface StockAdjustPayload { productId: string; delta: number; reason: string; refId?: string }

/** Kết quả nhập kho đã tính sẵn ở máy tạo phiếu — máy nhận chèn y nguyên (spec 3.3) */
export interface GrPatch {
  productId: string
  addQty: number
  newCost: number
  newPrice?: number
  expiry?: string
  batches: ProductBatch[]
  priceLogRows: PriceLogEntry[]
}
export interface GrCommitPayload {
  gr: GoodsReceipt
  patches: GrPatch[]
  supplierDelta?: { supplierId: string; debtDelta: number; purchasedDelta: number }
}
export interface SettingsSetPayload { key: 'settings' | 'shop'; value: unknown }

/* ─── Thống kê ─── */
export interface DayStats {
  date: string
  revenue: number
  profit: number
  orders: number
  items: number
}

/* ─── Hóa đơn / GDT ─── */
export interface InvoiceRecord {
  id: string
  code: string
  type: 'gdt' | 'import'
  date: string
  amount: number
  tax: number
  status: 'draft' | 'issued' | 'cancelled'
  data: Record<string, unknown>
  ts: number
  /** Đơn bán gắn tay (sổ hóa đơn), không bắt buộc */
  saleId?: string
  /** Đã xóa mềm (tombstone) */
  deleted?: boolean
  /** HLC lần xóa — upsert cũ hơn không sống lại */
  deletedHlc?: string
  hlc?: string
}

/* ─── Dự báo tồn kho ─── */
export interface StockForecast {
  productId: string
  name: string
  avgPerDay: number
  daysLeft: number
  suggestedQty: number
}

/* ─── Thông báo admin ─── */
export interface AdminNotice {
  id: string
  title: string
  body: string
  level: 'info' | 'warn' | 'urgent'
  active: boolean
  createdAt: string
}

/* ─── Ghi chú (port 30-tools-units.js) ─── */
export type NoteType = 'todo' | 'idea' | 'note'
export interface Note {
  id: string
  text: string
  date: string // ISO
  type: NoteType
  done: boolean
  pinned: boolean
  /** Đã xóa mềm (tombstone) */
  deleted?: boolean
  /** HLC lần xóa — upsert cũ hơn không sống lại */
  deletedHlc?: string
  /** LWW — ghi chú */
  hlc?: string
}
