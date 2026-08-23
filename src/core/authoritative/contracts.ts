/**
 * Hợp đồng Command / CommandResult / CanonicalEvent (spec 2026-08-20).
 * Module thuần — không Dexie, không mạng. Mirror rule với 3su-cloud/src/commands/contracts.ts.
 */

export type CommandType =
  | 'sale.create'
  | 'sale.void'
  | 'goodsReceipt.create'
  | 'customerPayment.create'
  | 'supplierPayment.create'

export const COMMAND_TYPES: ReadonlySet<CommandType> = new Set([
  'sale.create',
  'sale.void',
  'goodsReceipt.create',
  'customerPayment.create',
  'supplierPayment.create',
])

export type CommandResultStatus = 'accepted' | 'rejected' | 'conflict'

export const COMMAND_RESULT_STATUSES: ReadonlySet<CommandResultStatus> = new Set([
  'accepted',
  'rejected',
  'conflict',
])

export interface CommandEnvelope {
  id: string
  shopId: string
  deviceId: string
  userId: string
  type: CommandType
  payload: unknown
  occurredAt: string
  localSeq: number
  dependsOn?: string[]
  createdAt: number
}

export interface CommandResult {
  commandId: string
  status: CommandResultStatus
  events: CanonicalEvent[]
  error?: { code: string; message: string }
}

export interface CanonicalEvent {
  id: string
  seq: number
  shopId: string
  commandId: string
  type: string
  occurredAt: string
  committedAt: string
  schemaVersion: number
  payload: unknown
}

export class ContractError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ContractError'
    this.code = code
  }
}

/** Field canonical / tin client — không được nằm trên payload sale.create */
const SALE_FORBIDDEN_ROOT = new Set([
  'total',
  'profit',
  'cost',
  'stockAfter',
  'debtAfter',
  'newCost',
  'unitRatio',
])

const SALE_FORBIDDEN_ITEM = new Set(['price', 'cost', 'unitRatio', 'total', 'profit'])

function asRecord(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ContractError('INVALID_SHAPE', `${label} phải là object`)
  }
  return raw as Record<string, unknown>
}

function reqString(obj: Record<string, unknown>, key: string, label: string): string {
  const v = obj[key]
  if (typeof v !== 'string' || !v.trim()) {
    throw new ContractError('MISSING_FIELD', `${label} thiếu hoặc rỗng: ${key}`)
  }
  return v
}

function reqFiniteNumber(obj: Record<string, unknown>, key: string, label: string): number {
  const v = obj[key]
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ContractError('INVALID_NUMBER', `${label}.${key} phải là số hữu hạn`)
  }
  return v
}

function assertNoForbidden(obj: Record<string, unknown>, forbidden: Set<string>, where: string): void {
  for (const key of Object.keys(obj)) {
    if (forbidden.has(key)) {
      throw new ContractError('FORBIDDEN_FIELD', `${where} không được gửi field canonical: ${key}`)
    }
  }
}

function parseSaleCreatePayload(payload: unknown): unknown {
  const p = asRecord(payload, 'sale.create payload')
  assertNoForbidden(p, SALE_FORBIDDEN_ROOT, 'sale.create')
  if (!Array.isArray(p.items) || p.items.length === 0) {
    throw new ContractError('INVALID_PAYLOAD', 'sale.create cần items[] không rỗng')
  }
  for (let i = 0; i < p.items.length; i++) {
    const row = asRecord(p.items[i], `sale.create items[${i}]`)
    assertNoForbidden(row, SALE_FORBIDDEN_ITEM, `sale.create items[${i}]`)
    reqString(row, 'productId', `items[${i}]`)
    const qty = reqFiniteNumber(row, 'qty', `items[${i}]`)
    if (!(qty > 0)) throw new ContractError('INVALID_QTY', `items[${i}].qty phải > 0`)
    reqString(row, 'unitName', `items[${i}]`)
  }
  return payload
}

function parseSaleVoidPayload(payload: unknown): unknown {
  const p = asRecord(payload, 'sale.void payload')
  reqString(p, 'saleId', 'sale.void')
  return payload
}

function parseGoodsReceiptPayload(payload: unknown): unknown {
  const p = asRecord(payload, 'goodsReceipt.create payload')
  assertNoForbidden(p, new Set(['newCost', 'stockAfter', 'weightedCost']), 'goodsReceipt.create')
  if (!Array.isArray(p.rows) || p.rows.length === 0) {
    throw new ContractError('INVALID_PAYLOAD', 'goodsReceipt.create cần rows[] không rỗng')
  }
  for (let i = 0; i < p.rows.length; i++) {
    const row = asRecord(p.rows[i], `goodsReceipt rows[${i}]`)
    assertNoForbidden(row, new Set(['unitRatio', 'newCost', 'stockAfter']), `goodsReceipt rows[${i}]`)
    reqString(row, 'productId', `rows[${i}]`)
    const qty = reqFiniteNumber(row, 'qty', `rows[${i}]`)
    if (!(qty > 0)) throw new ContractError('INVALID_QTY', `rows[${i}].qty phải > 0`)
    reqString(row, 'unitName', `rows[${i}]`)
    const purchasePrice = reqFiniteNumber(row, 'purchasePrice', `rows[${i}]`)
    if (purchasePrice < 0) throw new ContractError('INVALID_PRICE', `rows[${i}].purchasePrice không âm`)
  }
  return payload
}

function parsePaymentPayload(payload: unknown, label: string): unknown {
  const p = asRecord(payload, `${label} payload`)
  assertNoForbidden(p, new Set(['balanceAfter', 'debtAfter']), label)
  const amount = reqFiniteNumber(p, 'amount', label)
  if (!(amount > 0)) throw new ContractError('INVALID_AMOUNT', `${label}.amount phải > 0`)
  return payload
}

function parsePayload(type: CommandType, payload: unknown): unknown {
  switch (type) {
    case 'sale.create':
      return parseSaleCreatePayload(payload)
    case 'sale.void':
      return parseSaleVoidPayload(payload)
    case 'goodsReceipt.create':
      return parseGoodsReceiptPayload(payload)
    case 'customerPayment.create':
      return parsePaymentPayload(payload, 'customerPayment.create')
    case 'supplierPayment.create':
      return parsePaymentPayload(payload, 'supplierPayment.create')
  }
}

export function parseCommandEnvelope(raw: unknown): CommandEnvelope {
  const o = asRecord(raw, 'CommandEnvelope')
  const id = reqString(o, 'id', 'CommandEnvelope')
  const shopId = reqString(o, 'shopId', 'CommandEnvelope')
  const deviceId = reqString(o, 'deviceId', 'CommandEnvelope')
  const userId = reqString(o, 'userId', 'CommandEnvelope')
  const typeRaw = reqString(o, 'type', 'CommandEnvelope')
  if (!COMMAND_TYPES.has(typeRaw as CommandType)) {
    throw new ContractError('UNKNOWN_TYPE', `type không hỗ trợ: ${typeRaw}`)
  }
  const type = typeRaw as CommandType
  const occurredAt = reqString(o, 'occurredAt', 'CommandEnvelope')
  const localSeq = reqFiniteNumber(o, 'localSeq', 'CommandEnvelope')
  if (!Number.isInteger(localSeq) || localSeq < 0) {
    throw new ContractError('INVALID_NUMBER', 'localSeq phải là số nguyên ≥ 0')
  }
  const createdAt = reqFiniteNumber(o, 'createdAt', 'CommandEnvelope')
  let dependsOn: string[] | undefined
  if (o.dependsOn !== undefined) {
    if (!Array.isArray(o.dependsOn) || !o.dependsOn.every((x) => typeof x === 'string' && x.trim())) {
      throw new ContractError('INVALID_DEPENDS', 'dependsOn phải là string[]')
    }
    dependsOn = o.dependsOn as string[]
  }
  const payload = parsePayload(type, o.payload)
  return {
    id,
    shopId,
    deviceId,
    userId,
    type,
    payload,
    occurredAt,
    localSeq,
    dependsOn,
    createdAt,
  }
}

export function parseCanonicalEvent(raw: unknown): CanonicalEvent {
  const o = asRecord(raw, 'CanonicalEvent')
  const id = reqString(o, 'id', 'CanonicalEvent')
  const seq = reqFiniteNumber(o, 'seq', 'CanonicalEvent')
  if (!Number.isInteger(seq) || seq < 1) {
    throw new ContractError('INVALID_SEQ', 'seq phải là số nguyên ≥ 1')
  }
  const shopId = reqString(o, 'shopId', 'CanonicalEvent')
  const commandId = reqString(o, 'commandId', 'CanonicalEvent')
  const type = reqString(o, 'type', 'CanonicalEvent')
  const occurredAt = reqString(o, 'occurredAt', 'CanonicalEvent')
  const committedAt = reqString(o, 'committedAt', 'CanonicalEvent')
  const schemaVersion = reqFiniteNumber(o, 'schemaVersion', 'CanonicalEvent')
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new ContractError('INVALID_SCHEMA', 'schemaVersion phải là số nguyên ≥ 1')
  }
  return {
    id,
    seq,
    shopId,
    commandId,
    type,
    occurredAt,
    committedAt,
    schemaVersion,
    payload: o.payload ?? null,
  }
}

export function parseCommandResult(raw: unknown): CommandResult {
  const o = asRecord(raw, 'CommandResult')
  const commandId = reqString(o, 'commandId', 'CommandResult')
  const statusRaw = reqString(o, 'status', 'CommandResult')
  if (!COMMAND_RESULT_STATUSES.has(statusRaw as CommandResultStatus)) {
    throw new ContractError(
      'INVALID_STATUS',
      `status phải là accepted|rejected|conflict, nhận: ${statusRaw}`,
    )
  }
  const status = statusRaw as CommandResultStatus
  if (!Array.isArray(o.events)) {
    throw new ContractError('INVALID_EVENTS', 'events phải là mảng')
  }
  const events = o.events.map((e, i) => {
    try {
      return parseCanonicalEvent(e)
    } catch (err) {
      if (err instanceof ContractError) {
        throw new ContractError(err.code, `events[${i}]: ${err.message}`)
      }
      throw err
    }
  })
  let error: CommandResult['error']
  if (o.error !== undefined) {
    const er = asRecord(o.error, 'CommandResult.error')
    error = {
      code: reqString(er, 'code', 'error'),
      message: reqString(er, 'message', 'error'),
    }
  }
  return { commandId, status, events, error }
}
