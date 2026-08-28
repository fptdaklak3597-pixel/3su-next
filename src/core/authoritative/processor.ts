/**
 * In-memory authoritative command processor (Phase 2).
 * Pure TS — no Dexie, no network. Mirror: 3su-cloud/src/commands/processor.ts
 */
import {
  type CanonicalEvent,
  type CommandEnvelope,
  type CommandResult,
  ContractError,
  parseCommandEnvelope,
} from './contracts'

export type { CanonicalEvent } from './contracts'

export interface CatalogUnit { n: string; r: number }

export interface ProcessorProduct {
  id: string
  name: string
  price: number
  cost: number
  stock: number
  unit: string
  units: CatalogUnit[]
  wholesalePrice?: number
  deleted?: boolean
}

export interface ProcessorCustomer {
  id: string
  name: string
  /** Projection: sum of signed ledger */
  balance: number
  deleted?: boolean
}

export interface ProcessorSupplier {
  id: string
  name: string
  balance: number
  deleted?: boolean
}

export interface InventoryLedgerEntry {
  id: string
  productId: string
  delta: number
  reason: string
  commandId: string
  saleId?: string
  at: string
}

export interface DebtLedgerEntry {
  id: string
  party: 'customer' | 'supplier'
  partyId: string
  delta: number
  reason: string
  commandId: string
  at: string
}

export interface ProcessorSale {
  id: string
  commandId: string
  items: Array<{
    productId: string
    name: string
    qty: number
    unitName: string
    unitRatio: number
    price: number
    cost: number
  }>
  total: number
  profit: number
  discount: number
  payMethod: string
  debtAmount: number
  customerId?: string
  voided?: boolean
  occurredAt: string
}

export interface ProcessorGoodsReceipt {
  id: string
  commandId: string
  rows: Array<{
    productId: string
    name: string
    qty: number
    unitName: string
    unitRatio: number
    purchasePrice: number
  }>
  supplierId?: string
  paid: number
  payMethod: string
  occurredAt: string
}

export interface ShopState {
  shopId: string
  seq: number
  products: Record<string, ProcessorProduct>
  customers: Record<string, ProcessorCustomer>
  suppliers: Record<string, ProcessorSupplier>
  sales: Record<string, ProcessorSale>
  receipts: Record<string, ProcessorGoodsReceipt>
  inventoryLedger: InventoryLedgerEntry[]
  customerLedger: DebtLedgerEntry[]
  supplierLedger: DebtLedgerEntry[]
  events: CanonicalEvent[]
  /** commandId → result (idempotency) */
  commandResults: Record<string, CommandResult>
  /** commandId → accepted|... for dependsOn */
  commandStatus: Record<string, CommandResult['status']>
  appliedEventIds: Set<string>
}

export type CommitFn = (next: ShopState) => void | Promise<void>

export interface ProcessOptions {
  /** If throws / rejects, RAM must not keep next state */
  commit?: CommitFn
  now?: () => string
}

export interface ProcessOutcome {
  result: CommandResult
  state: ShopState
  bumped: boolean
}

export function emptyShopState(shopId: string): ShopState {
  return {
    shopId,
    seq: 0,
    products: {},
    customers: {},
    suppliers: {},
    sales: {},
    receipts: {},
    inventoryLedger: [],
    customerLedger: [],
    supplierLedger: [],
    events: [],
    commandResults: {},
    commandStatus: {},
    appliedEventIds: new Set(),
  }
}

export function cloneState(s: ShopState): ShopState {
  return {
    shopId: s.shopId,
    seq: s.seq,
    products: structuredClone(s.products),
    customers: structuredClone(s.customers),
    suppliers: structuredClone(s.suppliers),
    sales: structuredClone(s.sales),
    receipts: structuredClone(s.receipts),
    inventoryLedger: structuredClone(s.inventoryLedger),
    customerLedger: structuredClone(s.customerLedger),
    supplierLedger: structuredClone(s.supplierLedger),
    events: structuredClone(s.events),
    commandResults: structuredClone(s.commandResults),
    commandStatus: { ...s.commandStatus },
    appliedEventIds: new Set(s.appliedEventIds),
  }
}

function resolveUnitRatio(p: ProcessorProduct, unitName: string): number | null {
  const base = (p.unit || 'cái').trim()
  if (unitName.trim() === base || unitName.trim() === '') return 1
  const hit = p.units.find((u) => u.n === unitName)
  if (!hit || !(hit.r > 0) || !Number.isFinite(hit.r)) return null
  // Ambiguous duplicate names
  if (p.units.filter((u) => u.n === unitName).length > 1) return null
  return hit.r
}

function nextEvent(
  draft: ShopState,
  commandId: string,
  type: string,
  occurredAt: string,
  committedAt: string,
  payload: unknown,
): CanonicalEvent {
  draft.seq += 1
  const ev: CanonicalEvent = {
    id: `evt_${draft.seq}_${commandId}`,
    seq: draft.seq,
    shopId: draft.shopId,
    commandId,
    type,
    occurredAt,
    committedAt,
    schemaVersion: 1,
    payload,
  }
  draft.events.push(ev)
  draft.appliedEventIds.add(ev.id)
  return ev
}

/** Apply a canonical event onto state (idempotent by event id). Used for replay tests. */
export function applyCanonicalEvent(state: ShopState, ev: CanonicalEvent): ShopState {
  if (state.appliedEventIds.has(ev.id)) return state
  if (ev.seq <= state.seq && state.events.some((e) => e.id === ev.id)) return state
  const draft = cloneState(state)
  if (ev.seq < draft.seq) {
    // out-of-order older — ignore for projection but mark seen
    draft.appliedEventIds.add(ev.id)
    return draft
  }
  // For harness: re-apply only markers; business already in state when produced.
  // Replay of SaleCommitted adjusts stock only if sale not present (rebuild path).
  if (ev.type === 'SaleCommitted') {
    const p = ev.payload as ProcessorSale
    if (p?.id && !draft.sales[p.id]) {
      draft.sales[p.id] = p
      for (const it of p.items) {
        const prod = draft.products[it.productId]
        if (prod) prod.stock -= it.qty * it.unitRatio
      }
      if (p.customerId && p.debtAmount > 0) {
        const c = draft.customers[p.customerId]
        if (c) c.balance += p.debtAmount
      }
    }
  }
  if (ev.type === 'SaleVoided') {
    const saleId = (ev.payload as { saleId?: string })?.saleId
    const sale = saleId ? draft.sales[saleId] : undefined
    if (sale && !sale.voided) {
      sale.voided = true
      for (const [index, it] of sale.items.entries()) {
        const product = draft.products[it.productId]
        if (!product) continue
        const restored = it.qty * it.unitRatio
        product.stock += restored
        draft.inventoryLedger.push({
          id: `inv_void_${ev.commandId}_${it.productId}_${index}`,
          productId: it.productId,
          delta: restored,
          reason: 'sale.void',
          commandId: ev.commandId,
          saleId,
          at: ev.committedAt,
        })
      }
      if (sale.customerId && sale.debtAmount > 0) {
        const customer = draft.customers[sale.customerId]
        if (customer) {
          customer.balance -= sale.debtAmount
          draft.customerLedger.push({
            id: `cust_void_${ev.commandId}`,
            party: 'customer',
            partyId: sale.customerId,
            delta: -sale.debtAmount,
            reason: 'SALE_VOID',
            commandId: ev.commandId,
            at: ev.committedAt,
          })
        }
      }
    }
  }
  if (ev.type === 'GoodsReceiptCommitted') {
    const receipt = ev.payload as ProcessorGoodsReceipt
    if (receipt?.id && !draft.receipts[receipt.id]) {
      let receiptTotal = 0
      for (const row of receipt.rows) {
        const product = draft.products[row.productId]
        if (!product) continue
        const received = row.qty * row.unitRatio
        const oldStock = product.stock
        const purchasePerBase = row.purchasePrice / row.unitRatio
        product.cost = Math.round(
          oldStock + received > 0
            ? (oldStock * product.cost + received * purchasePerBase) / (oldStock + received)
            : purchasePerBase,
        )
        product.stock += received
        receiptTotal += row.purchasePrice * row.qty
        draft.inventoryLedger.push({
          id: `inv_gr_${ev.commandId}_${product.id}`,
          productId: product.id,
          delta: received,
          reason: 'goodsReceipt',
          commandId: ev.commandId,
          at: ev.committedAt,
        })
      }
      const owed = Math.max(0, receiptTotal - receipt.paid)
      if (owed > 0 && receipt.supplierId) {
        const supplier = draft.suppliers[receipt.supplierId]
        if (supplier) {
          supplier.balance += owed
          draft.supplierLedger.push({
            id: `sup_${ev.commandId}`,
            party: 'supplier',
            partyId: receipt.supplierId,
            delta: owed,
            reason: 'GOODS_RECEIPT',
            commandId: ev.commandId,
            at: ev.committedAt,
          })
        }
      }
      draft.receipts[receipt.id] = receipt
    }
  }
  if (ev.type === 'CustomerPaymentRecorded') {
    const payment = ev.payload as { customerId?: string; amount?: number }
    if (payment?.customerId && typeof payment.amount === 'number') {
      const customer = draft.customers[payment.customerId]
      if (customer) {
        customer.balance -= payment.amount
        draft.customerLedger.push({
          id: `pay_${ev.commandId}`,
          party: 'customer',
          partyId: payment.customerId,
          delta: -payment.amount,
          reason: 'PAYMENT',
          commandId: ev.commandId,
          at: ev.committedAt,
        })
      }
    }
  }
  if (ev.type === 'SupplierPaymentRecorded') {
    const payment = ev.payload as { supplierId?: string; amount?: number }
    if (payment?.supplierId && typeof payment.amount === 'number') {
      const s = draft.suppliers[payment.supplierId]
      if (s) {
        s.balance -= payment.amount
        draft.supplierLedger.push({
          id: `spay_${ev.commandId}`,
          party: 'supplier',
          partyId: payment.supplierId,
          delta: -payment.amount,
          reason: 'PAYMENT',
          commandId: ev.commandId,
          at: ev.committedAt,
        })
      }
    }
  }
  if (ev.seq > draft.seq) draft.seq = ev.seq
  draft.events.push(ev)
  draft.appliedEventIds.add(ev.id)
  return draft
}

function reject(commandId: string, code: string, message: string): CommandResult {
  return { commandId, status: 'rejected', events: [], error: { code, message } }
}

function conflict(commandId: string, code: string, message: string): CommandResult {
  return { commandId, status: 'conflict', events: [], error: { code, message } }
}

function checkDepends(draft: ShopState, cmd: CommandEnvelope): CommandResult | null {
  if (!cmd.dependsOn?.length) return null
  for (const dep of cmd.dependsOn) {
    const st = draft.commandStatus[dep]
    if (st !== 'accepted') {
      return reject(cmd.id, 'DEPENDENCY_PENDING', `dependsOn ${dep} chưa accepted`)
    }
  }
  return null
}

function processSaleCreate(draft: ShopState, cmd: CommandEnvelope, committedAt: string): CommandResult {
  const payload = cmd.payload as {
    items: Array<{ productId: string; qty: number; unitName: string }>
    discountRequest?: number
    payMethod?: string
    tendered?: number
    customerId?: string
    wholesale?: boolean
  }
  const saleItems: ProcessorSale['items'] = []
  const needByProduct = new Map<string, number>()

  for (const row of payload.items) {
    const p = draft.products[row.productId]
    if (!p || p.deleted) return reject(cmd.id, 'PRODUCT_MISSING', `SP không tồn tại: ${row.productId}`)
    const ratio = resolveUnitRatio(p, row.unitName)
    if (ratio == null) return reject(cmd.id, 'UNIT_INVALID', `Đơn vị không hợp lệ: ${row.unitName}`)
    const baseQty = row.qty * ratio
    needByProduct.set(p.id, (needByProduct.get(p.id) ?? 0) + baseQty)
    const base =
      payload.wholesale && (p.wholesalePrice ?? 0) > 0
        ? p.wholesalePrice!
        : p.price
    const unitPrice = base * ratio
    // Always server catalog — ignore any client money fields (already forbidden by parse)
    saleItems.push({
      productId: p.id,
      name: p.name,
      qty: row.qty,
      unitName: row.unitName,
      unitRatio: ratio,
      price: unitPrice,
      cost: p.cost * ratio,
    })
  }

  for (const [productId, need] of needByProduct) {
    const p = draft.products[productId]!
    if (p.stock < need) {
      return conflict(cmd.id, 'INSUFFICIENT_STOCK', `${p.name} không đủ tồn (còn ${p.stock}, cần ${need})`)
    }
  }

  const subtotal = saleItems.reduce((a, it) => a + it.price * it.qty, 0)
  const rawDiscount = Number.isFinite(payload.discountRequest) ? Math.round(payload.discountRequest!) : 0
  const discount = Math.max(0, Math.min(rawDiscount, subtotal))
  const total = Math.max(0, subtotal - discount)
  const profit = saleItems.reduce((a, it) => a + (it.price - it.cost) * it.qty, 0) - discount
  const payMethod = payload.payMethod || 'cash'
  // Tiền mặt trả thiếu (tendered < total) → phần còn lại ghi nợ KH, giống legacy
  // confirmSale. Thiếu tendered = trả đủ (client luôn gửi tendered>=total).
  let debtAmount = 0
  if (payMethod === 'debt') {
    debtAmount = total
  } else if (payMethod === 'cash') {
    const tendered = Number.isFinite(payload.tendered) ? Math.max(0, Math.round(payload.tendered!)) : total
    debtAmount = Math.max(0, total - tendered)
  }
  if (debtAmount > 0) {
    if (!payload.customerId) return reject(cmd.id, 'CUSTOMER_REQUIRED', 'Chọn khách để ghi nợ')
    const c = draft.customers[payload.customerId]
    if (!c || c.deleted) return reject(cmd.id, 'CUSTOMER_MISSING', 'Không tìm thấy khách')
  }

  const saleId = `sale_${cmd.id}`
  const sale: ProcessorSale = {
    id: saleId,
    commandId: cmd.id,
    items: saleItems,
    total,
    profit,
    discount,
    payMethod,
    debtAmount,
    customerId: payload.customerId,
    occurredAt: cmd.occurredAt,
  }
  draft.sales[saleId] = sale

  for (const [index, it] of saleItems.entries()) {
    const p = draft.products[it.productId]!
    const deducted = it.qty * it.unitRatio
    p.stock -= deducted
    draft.inventoryLedger.push({
      id: `inv_${cmd.id}_${it.productId}_${index}`,
      productId: it.productId,
      delta: -deducted,
      reason: 'sale',
      commandId: cmd.id,
      saleId,
      at: committedAt,
    })
  }

  if (debtAmount > 0 && payload.customerId) {
    const c = draft.customers[payload.customerId]!
    c.balance += debtAmount
    draft.customerLedger.push({
      id: `cust_${cmd.id}`,
      party: 'customer',
      partyId: payload.customerId,
      delta: debtAmount,
      reason: 'SALE_DEBT',
      commandId: cmd.id,
      at: committedAt,
    })
  }

  const events = [
    nextEvent(draft, cmd.id, 'SaleCommitted', cmd.occurredAt, committedAt, sale),
    nextEvent(draft, cmd.id, 'InventorySold', cmd.occurredAt, committedAt, {
      saleId,
      lines: saleItems.map((it) => ({ productId: it.productId, delta: -(it.qty * it.unitRatio) })),
    }),
  ]
  if (debtAmount > 0) {
    events.push(
      nextEvent(draft, cmd.id, 'CustomerCharged', cmd.occurredAt, committedAt, {
        customerId: payload.customerId,
        amount: debtAmount,
      }),
    )
  }

  return { commandId: cmd.id, status: 'accepted', events }
}

function processSaleVoid(draft: ShopState, cmd: CommandEnvelope, committedAt: string): CommandResult {
  const saleId = (cmd.payload as { saleId: string }).saleId
  const sale = draft.sales[saleId]
  if (!sale) return reject(cmd.id, 'SALE_MISSING', `Không có đơn ${saleId}`)
  if (sale.voided) {
    // idempotent void — return prior accept if any command voided it
    const prior = Object.values(draft.commandResults).find(
      (r) => r.status === 'accepted' && r.events.some((e) => e.type === 'SaleVoided' && (e.payload as { saleId?: string })?.saleId === saleId),
    )
    if (prior) return { ...prior, commandId: cmd.id, events: [] }
    return reject(cmd.id, 'ALREADY_VOIDED', 'Đơn đã hủy')
  }
  sale.voided = true
  for (const [index, it] of sale.items.entries()) {
    const p = draft.products[it.productId]
    if (!p) return reject(cmd.id, 'PRODUCT_MISSING', it.productId)
    const add = it.qty * it.unitRatio
    p.stock += add
    draft.inventoryLedger.push({
      id: `inv_void_${cmd.id}_${it.productId}_${index}`,
      productId: it.productId,
      delta: add,
      reason: 'sale.void',
      commandId: cmd.id,
      saleId,
      at: committedAt,
    })
  }
  if (sale.debtAmount > 0 && sale.customerId) {
    const c = draft.customers[sale.customerId]
    if (c) {
      const remaining = Math.min(sale.debtAmount, Math.max(0, c.balance))
      c.balance -= remaining
      draft.customerLedger.push({
        id: `cust_void_${cmd.id}`,
        party: 'customer',
        partyId: sale.customerId,
        delta: -remaining,
        reason: 'SALE_VOID',
        commandId: cmd.id,
        at: committedAt,
      })
    }
  }
  const events = [
    nextEvent(draft, cmd.id, 'SaleVoided', cmd.occurredAt, committedAt, { saleId }),
    nextEvent(draft, cmd.id, 'InventoryRestored', cmd.occurredAt, committedAt, { saleId }),
  ]
  return { commandId: cmd.id, status: 'accepted', events }
}

function processGoodsReceipt(draft: ShopState, cmd: CommandEnvelope, committedAt: string): CommandResult {
  const payload = cmd.payload as {
    supplierId?: string
    rows: Array<{ productId: string; qty: number; unitName: string; purchasePrice: number; expiry?: string }>
    paid?: number
    payMethod?: string
  }
  const payMethod = payload.payMethod || 'cash'
  if (payMethod === 'debt' && !payload.supplierId) {
    return reject(cmd.id, 'SUPPLIER_REQUIRED', 'Nợ NCC cần chọn nhà cung cấp')
  }
  const receiptId = `gr_${cmd.id}`
  const rows: ProcessorGoodsReceipt['rows'] = []
  let receiptTotal = 0

  for (const row of payload.rows) {
    const p = draft.products[row.productId]
    if (!p || p.deleted) return reject(cmd.id, 'PRODUCT_MISSING', row.productId)
    const ratio = resolveUnitRatio(p, row.unitName)
    if (ratio == null) return reject(cmd.id, 'UNIT_INVALID', row.unitName)
    const baseQty = row.qty * ratio
    const oldStock = p.stock
    const oldCost = p.cost
    const newStock = oldStock + baseQty
    const purchasePerBase = row.purchasePrice / ratio
    p.cost = Math.round(
      oldStock + baseQty > 0
        ? (oldStock * oldCost + baseQty * purchasePerBase) / (oldStock + baseQty)
        : purchasePerBase,
    )
    p.stock = newStock
    receiptTotal += row.purchasePrice * row.qty
    rows.push({
      productId: p.id,
      name: p.name,
      qty: row.qty,
      unitName: row.unitName,
      unitRatio: ratio,
      purchasePrice: row.purchasePrice,
    })
    draft.inventoryLedger.push({
      id: `inv_gr_${cmd.id}_${p.id}`,
      productId: p.id,
      delta: baseQty,
      reason: 'goodsReceipt',
      commandId: cmd.id,
      at: committedAt,
    })
  }

  const paidRaw = payload.paid
  if (paidRaw !== undefined && paidRaw !== null) {
    if (!Number.isFinite(paidRaw) || paidRaw < 0) {
      return reject(cmd.id, 'PAID_INVALID', 'Số tiền đã trả không hợp lệ')
    }
    if (paidRaw > receiptTotal) {
      return reject(cmd.id, 'PAID_EXCEEDS_TOTAL', 'Số tiền đã trả vượt tổng phiếu nhập')
    }
  }
  const paid = payMethod === 'debt' ? 0 : (Number.isFinite(paidRaw) ? Math.round(paidRaw!) : 0)
  const owed = Math.max(0, receiptTotal - paid)
  if (owed > 0) {
    if (!payload.supplierId) {
      return reject(cmd.id, 'SUPPLIER_REQUIRED', 'Còn nợ NCC cần chọn nhà cung cấp')
    }
    const s = draft.suppliers[payload.supplierId]
    if (!s || s.deleted) return reject(cmd.id, 'SUPPLIER_MISSING', 'NCC không tồn tại')
    s.balance += owed
    draft.supplierLedger.push({
      id: `sup_${cmd.id}`,
      party: 'supplier',
      partyId: payload.supplierId,
      delta: owed,
      reason: 'GOODS_RECEIPT',
      commandId: cmd.id,
      at: committedAt,
    })
  }

  const gr: ProcessorGoodsReceipt = {
    id: receiptId,
    commandId: cmd.id,
    rows,
    supplierId: payload.supplierId,
    paid,
    payMethod,
    occurredAt: cmd.occurredAt,
  }
  draft.receipts[receiptId] = gr
  const events = [
    nextEvent(draft, cmd.id, 'GoodsReceiptCommitted', cmd.occurredAt, committedAt, gr),
    nextEvent(draft, cmd.id, 'InventoryReceived', cmd.occurredAt, committedAt, { receiptId }),
  ]
  return { commandId: cmd.id, status: 'accepted', events }
}

function processCustomerPayment(draft: ShopState, cmd: CommandEnvelope, committedAt: string): CommandResult {
  const payload = cmd.payload as { customerId?: string; amount: number; method?: string }
  const customerId = payload.customerId || (payload as { partyId?: string }).partyId
  if (!customerId) return reject(cmd.id, 'CUSTOMER_REQUIRED', 'Thiếu customerId')
  const c = draft.customers[customerId]
  if (!c || c.deleted) return reject(cmd.id, 'CUSTOMER_MISSING', 'Không tìm thấy khách')
  if (!(payload.amount > 0) || !Number.isFinite(payload.amount)) {
    return reject(cmd.id, 'INVALID_AMOUNT', 'amount không hợp lệ')
  }
  if (payload.amount > c.balance) {
    return reject(cmd.id, 'OVERPAY', 'Số thu vượt công nợ — reject cả lệnh')
  }
  c.balance -= payload.amount
  draft.customerLedger.push({
    id: `pay_${cmd.id}`,
    party: 'customer',
    partyId: customerId,
    delta: -payload.amount,
    reason: 'PAYMENT',
    commandId: cmd.id,
    at: committedAt,
  })
  const events = [
    nextEvent(draft, cmd.id, 'CustomerPaymentRecorded', cmd.occurredAt, committedAt, {
      customerId,
      amount: payload.amount,
    }),
  ]
  return { commandId: cmd.id, status: 'accepted', events }
}

function processSupplierPayment(draft: ShopState, cmd: CommandEnvelope, committedAt: string): CommandResult {
  const payload = cmd.payload as { supplierId?: string; amount: number }
  const supplierId = payload.supplierId
  if (!supplierId) return reject(cmd.id, 'SUPPLIER_REQUIRED', 'Thiếu supplierId')
  const s = draft.suppliers[supplierId]
  if (!s || s.deleted) return reject(cmd.id, 'SUPPLIER_MISSING', 'Không tìm thấy NCC')
  if (!(payload.amount > 0) || !Number.isFinite(payload.amount)) {
    return reject(cmd.id, 'INVALID_AMOUNT', 'amount không hợp lệ')
  }
  if (payload.amount > s.balance) {
    return reject(cmd.id, 'OVERPAY', 'Số trả vượt công nợ NCC')
  }
  s.balance -= payload.amount
  draft.supplierLedger.push({
    id: `spay_${cmd.id}`,
    party: 'supplier',
    partyId: supplierId,
    delta: -payload.amount,
    reason: 'PAYMENT',
    commandId: cmd.id,
    at: committedAt,
  })
  const events = [
    nextEvent(draft, cmd.id, 'SupplierPaymentRecorded', cmd.occurredAt, committedAt, {
      supplierId,
      amount: payload.amount,
    }),
  ]
  return { commandId: cmd.id, status: 'accepted', events }
}

/**
 * Xử lý một command trên bản sao state; chỉ gán state mới sau commit() thành công.
 */
export async function processCommand(
  state: ShopState,
  raw: unknown,
  opts: ProcessOptions = {},
): Promise<ProcessOutcome> {
  let envelope: CommandEnvelope
  try {
    envelope = parseCommandEnvelope(raw)
  } catch (e) {
    const err = e instanceof ContractError ? e : new ContractError('INVALID', String(e))
    const result = reject(
      typeof raw === 'object' && raw && 'id' in raw ? String((raw as { id: unknown }).id) : 'unknown',
      err.code,
      err.message,
    )
    return { result, state, bumped: false }
  }

  if (envelope.shopId !== state.shopId) {
    const result = reject(envelope.id, 'SHOP_MISMATCH', 'shopId không khớp')
    return { result, state, bumped: false }
  }

  const prior = state.commandResults[envelope.id]
  if (prior) {
    return { result: prior, state, bumped: false }
  }

  const draft = cloneState(state)
  const depErr = checkDepends(draft, envelope)
  if (depErr) {
    draft.commandResults[envelope.id] = depErr
    draft.commandStatus[envelope.id] = depErr.status
    // dependency pending is reject without mutating business — still record idempotency? Spec: don't accept.
    // Do not persist reject for DEPENDENCY_PENDING so retry works — skip storing
    return { result: depErr, state, bumped: false }
  }

  const committedAt = (opts.now ?? (() => new Date().toISOString()))()
  let result: CommandResult
  switch (envelope.type) {
    case 'sale.create':
      result = processSaleCreate(draft, envelope, committedAt)
      break
    case 'sale.void':
      result = processSaleVoid(draft, envelope, committedAt)
      break
    case 'goodsReceipt.create':
      result = processGoodsReceipt(draft, envelope, committedAt)
      break
    case 'customerPayment.create':
      result = processCustomerPayment(draft, envelope, committedAt)
      break
    case 'supplierPayment.create':
      result = processSupplierPayment(draft, envelope, committedAt)
      break
  }

  draft.commandResults[envelope.id] = result
  draft.commandStatus[envelope.id] = result.status

  if (result.status !== 'accepted') {
    // conflict/reject: keep idempotency record but revert business mutations
    const idle = cloneState(state)
    idle.commandResults[envelope.id] = result
    idle.commandStatus[envelope.id] = result.status
    try {
      if (opts.commit) await opts.commit(idle)
    } catch (err) {
      console.error('[authoritative] commit failed (reject path)', err)
      return {
        result: reject(envelope.id, 'COMMIT_FAILED', err instanceof Error ? err.message : 'Commit thất bại'),
        state,
        bumped: false,
      }
    }
    return { result, state: idle, bumped: false }
  }

  try {
    if (opts.commit) await opts.commit(draft)
  } catch (err) {
    console.error('[authoritative] commit failed (accept path)', err)
    return {
      result: reject(envelope.id, 'COMMIT_FAILED', err instanceof Error ? err.message : 'Commit thất bại'),
      state,
      bumped: false,
    }
  }

  return { result, state: draft, bumped: true }
}

export function inventoryStockFromLedger(state: ShopState, productId: string, opening: number): number {
  return state.inventoryLedger
    .filter((e) => e.productId === productId)
    .reduce((a, e) => a + e.delta, opening)
}
