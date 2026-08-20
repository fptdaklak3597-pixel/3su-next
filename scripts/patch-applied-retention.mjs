import fs from 'node:fs'

const enginePath = 'src/core/sync/engine.ts'
let engine = fs.readFileSync(enginePath, 'utf8')
const marker = '/** Xóa appliedOps cũ hơn 30 ngày'
const start = engine.indexOf(marker)
if (start < 0) throw new Error('Không tìm thấy legacy appliedOps GC block')

const replacement = `const APPLIED_GC_WATERMARK_KEY = 'sync:appliedGcBeforeMs'

/** Chỉ parse đúng HLC ID; ID legacy/khác định dạng được giữ để tránh xóa nhầm. */
export function appliedOpTimestamp(id: string): number | null {
  const match = /^(\\d{13})-\\d{4}-.+/.exec(String(id))
  if (!match) return null
  const timestamp = Number(match[1])
  return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : null
}

/** Watermark do backend xác nhận: op có timestamp nhỏ hơn mốc này không thể replay. */
export async function getAppliedOpsGcWatermark(): Promise<number> {
  const value = await getMeta<unknown>(APPLIED_GC_WATERMARK_KEY, 0)
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : 0
}

/**
 * Watermark chỉ được tiến, không được lùi. Backend hiện chưa gửi mốc thì client
 * giữ marker vô hạn — ưu tiên idempotency hơn dung lượng.
 */
export async function setAppliedOpsGcWatermark(beforeMs: number): Promise<number> {
  if (!Number.isSafeInteger(beforeMs) || beforeMs <= 0) {
    throw new Error('Applied-op watermark không hợp lệ')
  }
  if (beforeMs > Date.now()) throw new Error('Applied-op watermark không được ở tương lai')
  const current = await getAppliedOpsGcWatermark()
  const next = Math.max(current, beforeMs)
  if (next > current) await setMeta(APPLIED_GC_WATERMARK_KEY, next)
  return next
}

/**
 * Không còn xóa theo tuổi cục bộ. Chỉ xóa marker HLC nhỏ hơn watermark server
 * đã xác nhận; boundary và ID legacy luôn được giữ.
 */
export async function gcAppliedOps(): Promise<number> {
  const watermark = await getAppliedOpsGcWatermark()
  if (watermark <= 0) return 0
  const all = await dbx.appliedOps.toArray()
  const stale = all.filter((row) => {
    const timestamp = appliedOpTimestamp(row.id)
    return timestamp !== null && timestamp < watermark
  })
  if (stale.length > 0) await dbx.appliedOps.bulkDelete(stale.map((row) => row.id))
  return stale.length
}
`
engine = engine.slice(0, start) + replacement
fs.writeFileSync(enginePath, engine)

const dbPath = 'src/core/db.ts'
let db = fs.readFileSync(dbPath, 'utf8')
const oldKeys = "  'sync:blocked',\n  'device:cloudAt',"
const newKeys = "  'sync:blocked',\n  'sync:appliedGcBeforeMs',\n  'device:cloudAt',"
if (!db.includes(oldKeys)) throw new Error('Không tìm thấy local restore reset keys')
db = db.replace(oldKeys, newKeys)
fs.writeFileSync(dbPath, db)
