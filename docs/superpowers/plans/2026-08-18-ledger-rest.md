# Ledger remaining waves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa nốt backlog sau đợt 1 — shop không kẹt op độc, seed/restore không phá sync, kiểm kê/lô đúng, snapshot không nhảy seq, LWW xóa không nuốt, báo cáo mua/MTD/đơn vị đúng.

**Architecture:** Đợt 2–3/5–6 chỉ `3su-next`. Đợt 4 thêm `3su-cloud` (`gcOldOps` thôi xóa ops). Từng đợt có file test riêng, ship độc lập. Spec: `docs/superpowers/specs/2026-08-18-ledger-rest-design.md`.

**Tech Stack:** TypeScript, Dexie 4, Vitest, fake-indexeddb; đợt 4 thêm Worker D1 hiện có.

## Global Constraints

- Identifier English, comment Vietnamese.
- TDD: test đỏ trước, rồi vá tối thiểu.
- Không commit trừ khi user hỏi. Bỏ qua mọi bước Commit nếu chưa được hỏi.
- Không bật `/loop` trừ khi user hỏi.
- Impact GitNexus trước khi sửa symbol public domain/sync/db/auth (bỏ qua CSS/copy/test/config).
- `confirmSale` vẫn atomic + lock `sale-commit`.
- `restoreBackup` không xóa `syncQueue` — chỉ `restoreLocalBackup` xóa.
- `importSnapshot` tiếp tục gọi `restoreBackup`, không gọi `restoreLocalBackup`.
- Không thêm `OpType` / không migration Dexie.
- Verify mỗi task: trong `3su-next` chạy đúng lệnh `npx vitest run …` ghi ở bước; cuối đợt: `npm test` + `npm run typecheck`.

## File map

| File | Trách nhiệm |
|---|---|
| `3su-next/src/core/sync/apply.ts` | `applyOps` quarantine; `recordPoisonedOp` / `getPoisonedOps`; stocktake moves; stock.adjust idempotent; LWW delete |
| `3su-next/src/core/domain/seed.ts` | `seedCatalog` + `seed500` persist ops |
| `3su-next/src/core/db.ts` | `restoreLocalBackup` |
| `3su-next/src/core/domain/trial.ts` | `parseRestoreFile` |
| `3su-next/src/web/pages/SettingsPage.tsx` | parse + restore local |
| `3su-next/src/mobile/pages/SettingsPage.tsx` | parse + restore local |
| `3su-next/src/core/domain/inventory.ts` | kiểm kê / sửa tồn chỉnh lô |
| `3su-next/src/core/sync/engine.ts` | `pullCloudSnapshot` lastSeq |
| `3su-cloud/src/d1.ts` | `gcOldOps` không xóa ops |
| `3su-next/src/core/domain/purchase.ts` | `aggregatePurchases` ẩn PO received |
| `3su-next/src/core/domain/reports.ts` | MTD local |
| `3su-next/src/core/domain/suppliers.ts` | `compareSupplierPrices` `unitRatio` |
| `3su-next/tests/sync-rest.test.ts` | đợt 2 |
| `3su-next/tests/stocktake-rest.test.ts` | đợt 3 |
| `3su-next/tests/snapshot-seq.test.ts` | đợt 4 client |
| `3su-next/tests/lww-rest.test.ts` | đợt 5 |
| `3su-next/tests/reports-rest.test.ts` | đợt 6 |
| `3su-next/tests/apply.test.ts` | cập nhật case poison cũ |

---

# Đợt 2 — S3 + M12 + M8 + L8

Làm đợt này trước. Shop cloud đang live: một `sale.commit` thiếu SP làm `applyOps` throw → `lastSeq` không tiến.

### Task 1: S3 — applyOps không kẹt op độc

**Files:**
- Create: `3su-next/tests/sync-rest.test.ts`
- Modify: `3su-next/src/core/sync/apply.ts` (`applyOps` ~26–42)
- Modify: `3su-next/tests/apply.test.ts` (case ~362–367)

**Interfaces:**
- Consumes: `applyOps(ops: SyncOp[]): Promise<number>` — số op **áp thành công** (poison không đếm)
- Produces:
  - `export interface PoisonedOp { id: string; type: string; message: string; at: number }`
  - `export async function getPoisonedOps(): Promise<PoisonedOp[]>`
  - `export async function recordPoisonedOp(op: SyncOp, err: unknown): Promise<void>`
  - Meta key: `'sync:poisoned'`

- [ ] **Step 1: Write the failing tests**

Thêm vào `tests/sync-rest.test.ts`:

```ts
/**
 * Đợt 2 — S3 poison / M12 seed / M8+L8 restore file.
 * Chạy: npx vitest run tests/sync-rest.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { dbx, restoreBackup, restoreLocalBackup, type BackupData } from '@/core/db'
import { initSyncEngine, makeOp } from '@/core/sync/engine'
import { applyOps, getPoisonedOps } from '@/core/sync/apply'
import { seedCatalog } from '@/core/domain/seed'
import { parseRestoreFile } from '@/core/domain/trial'
import type { Product, Sale, SyncOp } from '@/core/types'

function mkProduct(over: Partial<Product> = {}): Product {
  return {
    id: 'p1', name: 'Mì', cat: 'Khô', price: 100, cost: 60, stock: 10,
    unit: 'gói', barcode: '', expiry: '', units: [], wholesalePrice: 0,
    batches: [], createdAt: 1, updatedAt: 1, ...over,
  }
}

function remoteOp(type: SyncOp['type'], payload: unknown): SyncOp {
  const op = makeOp(type, payload)
  return { ...op, deviceId: 'dev_remote' }
}

beforeEach(async () => {
  await Promise.all([
    dbx.products.clear(), dbx.sales.clear(), dbx.customers.clear(),
    dbx.stockMoves.clear(), dbx.goodsReceipts.clear(), dbx.syncQueue.clear(),
    dbx.appliedOps.clear(), dbx.meta.clear(),
  ])
  await initSyncEngine()
})

describe('S3 — op độc không chặn op sau', () => {
  it('sale.commit thiếu SP rồi stock.adjust → adjust vẫn áp, poisoned ghi meta', async () => {
    await dbx.products.add(mkProduct({ id: 'p1', stock: 10 }))
    const badSale: Sale = {
      id: 's_bad',
      items: [{ productId: 'p-missing', name: 'x', qty: 1, price: 100, cost: 60, unit: 'gói', unitRatio: 1 }],
      total: 100, profit: 40, discount: 0, payMethod: 'cash',
      tendered: 100, change: 0, debtAmount: 0, customerId: null,
      date: '2026-08-18',
    }
    const bad = remoteOp('sale.commit', badSale)
    const good = remoteOp('stock.adjust', { productId: 'p1', delta: -3, reason: 'sau độc' })
    await expect(applyOps([bad, good])).resolves.toBe(1)
    expect(await dbx.sales.count()).toBe(0)
    expect((await dbx.products.get('p1'))!.stock).toBe(7)
    expect(await dbx.appliedOps.get(bad.id)).toBeTruthy()
    expect(await dbx.appliedOps.get(good.id)).toBeTruthy()
    const poisoned = await getPoisonedOps()
    expect(poisoned).toHaveLength(1)
    expect(poisoned[0]!.id).toBe(bad.id)
    expect(poisoned[0]!.type).toBe('sale.commit')
    expect(poisoned[0]!.message).toMatch(/thiếu SP/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sync-rest.test.ts` (cwd `3su-next`)

Expected: FAIL — `applyOps` reject `/thiếu SP/` hoặc `getPoisonedOps` is not a function.

- [ ] **Step 3: Write minimal implementation**

Trong `apply.ts`, thêm (comment Vietnamese):

```ts
const POISON_META = 'sync:poisoned'

export interface PoisonedOp {
  id: string
  type: string
  message: string
  at: number
}

export async function getPoisonedOps(): Promise<PoisonedOp[]> {
  const row = await dbx.meta.get(POISON_META)
  return Array.isArray(row?.value) ? (row!.value as PoisonedOp[]) : []
}

export async function recordPoisonedOp(op: SyncOp, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err)
  const prev = await getPoisonedOps()
  const next = [...prev.filter((p) => p.id !== op.id), {
    id: op.id, type: op.type, message, at: Date.now(),
  }]
  await dbx.meta.put({ key: POISON_META, value: next })
}
```

Đổi `applyOps`:

```ts
export async function applyOps(ops: SyncOp[]): Promise<number> {
  let applied = 0
  for (const op of ops) {
    if (await dbx.appliedOps.get(op.id)) {
      observeRemoteHlc(op.hlc)
      continue
    }
    try {
      await dbx.transaction('rw', TABLES(), async () => {
        if (await dbx.appliedOps.get(op.id)) return
        await applyOne(op)
        await dbx.appliedOps.add({ id: op.id })
      })
      observeRemoteHlc(op.hlc)
      applied += 1
    } catch (err) {
      if (!(await dbx.appliedOps.get(op.id))) await dbx.appliedOps.add({ id: op.id })
      await recordPoisonedOp(op, err)
      observeRemoteHlc(op.hlc)
    }
  }
  return applied
}
```

Đổi `tests/apply.test.ts` case cũ:

```ts
it('sale.commit thiếu SP → đánh applied + poison, không ném ra applyOps', async () => {
  const sale = mkSale('p-missing', 1)
  await expect(applyOps([remoteOp('sale.commit', sale)])).resolves.toBe(0)
  expect(await dbx.appliedOps.count()).toBe(1)
  expect(await dbx.sales.count()).toBe(0)
})
```

Impact trước khi sửa: `applyOps` (sync, public) — hướng `upstream`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/sync-rest.test.ts tests/apply.test.ts`

Expected: PASS (các file khác chưa đụng).

- [ ] **Step 5: Commit** — bỏ qua trừ khi user hỏi.

---

### Task 2: M12 — seed ghi op

**Files:**
- Modify: `3su-next/src/core/domain/seed.ts`
- Modify: `3su-next/tests/sync-rest.test.ts`

**Interfaces:**
- Consumes: `makeOp`, `persistOp`, `enqueueOp` từ `engine.ts`; `SeedItem` từ `seed-data.ts`
- Produces: `export async function seedCatalog(items: SeedItem[], stock?: number): Promise<SeedResult>`
- `seed500(stock = 0)` = `seedCatalog(SEED_500, stock)` — UI không đổi

- [ ] **Step 1: Write the failing test** (thêm vào `sync-rest.test.ts`)

```ts
describe('M12 — seed phát op', () => {
  it('2 mặt hàng mới stock 4 → 2 upsert + 2 adjust; tên trùng bỏ qua', async () => {
    await dbx.products.add(mkProduct({ id: 'old', name: 'Mì sẵn' }))
    const res = await seedCatalog([
      { name: 'Mì sẵn', price: 1, cost: 1, unit: 'gói', cat: 'Khô', emoji: '🍜' },
      { name: 'Sting', price: 10, cost: 7, unit: 'lon', cat: 'Nước', emoji: '🥤' },
      { name: 'Lavie', price: 5, cost: 3, unit: 'chai', cat: 'Nước', emoji: '💧' },
    ], 4)
    expect(res).toEqual({ added: 2, skipped: 1 })
    const ops = await dbx.syncQueue.toArray()
    expect(ops.filter((o) => o.type === 'product.upsert')).toHaveLength(2)
    expect(ops.filter((o) => o.type === 'stock.adjust')).toHaveLength(2)
    const sting = (await dbx.products.toArray()).find((p) => p.name === 'Sting')!
    expect(sting.stock).toBe(4)
    const upsert = ops.find((o) => o.type === 'product.upsert' && (o.payload as { product: { id: string } }).product.id === sting.id)!
    expect((upsert.payload as { product: { stock?: number } }).product.stock).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sync-rest.test.ts`

Expected: FAIL — `seedCatalog` is not a function, hoặc `syncQueue` rỗng.

- [ ] **Step 3: Write minimal implementation**

Trong `seed.ts`: import `makeOp`, `persistOp`, `enqueueOp`, `requestFlush`; type `SeedItem`. Rút vòng lặp hiện tại thành `seedCatalog`. Trong **một** `dbx.transaction('rw', [dbx.products, dbx.stockMoves, dbx.syncQueue, dbx.appliedOps])`:

Với mỗi item chưa trùng tên (trim + toLowerCase):

1. Tạo `Product` như `seed500` cũ (`id: uid('p')`, `stock` theo tham số).
2. `const upsertOp = makeOp('product.upsert', null)`; `p.hlc = upsertOp.hlc`; `products.add(p)`.
3. `const { stock: _s, batches: _b, ...rest } = p`; `upsertOp.payload = { product: rest }`; `persistOp(upsertOp)`.
4. Nếu `stock > 0`: `stockMoves.add` type `adjust` note `'Tồn kho ban đầu'` + `enqueueOp('stock.adjust', { productId: p.id, delta: stock, reason: 'init' })`.

Sau tx: `requestFlush()`. `seed500` chỉ `return seedCatalog(SEED_500, stock)`.

Impact: `seed500` (domain, public).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sync-rest.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit** — bỏ qua trừ khi user hỏi.

---

### Task 3: M8 + L8 — restore file

**Files:**
- Modify: `3su-next/src/core/db.ts` (thêm `restoreLocalBackup` sau `restoreBackup`)
- Modify: `3su-next/src/core/domain/trial.ts` (thêm `parseRestoreFile`)
- Modify: `3su-next/src/web/pages/SettingsPage.tsx` (`handleFile`, confirm restore)
- Modify: `3su-next/src/mobile/pages/SettingsPage.tsx` (cùng chỗ)
- Modify: `3su-next/tests/sync-rest.test.ts`

**Interfaces:**
- Consumes: `restoreBackup(data: BackupData): Promise<void>` — không đổi
- Produces:
  - `export async function restoreLocalBackup(data: BackupData): Promise<void>`
  - `export function parseRestoreFile(raw: string): BackupData`

- [ ] **Step 1: Write the failing tests**

```ts
function emptyBackup(over: Partial<BackupData> = {}): BackupData {
  return {
    version: 5, exportedAt: '2026-08-18T00:00:00.000Z',
    products: [], sales: [], customers: [], ...over,
  }
}

describe('L8 — parseRestoreFile', () => {
  it('thiếu products → throw', () => {
    expect(() => parseRestoreFile('{"sales":[],"customers":[]}')).toThrow(/products/)
  })
  it('JSON đủ mảng bắt buộc → trả BackupData', () => {
    const d = parseRestoreFile('{"products":[],"sales":[],"customers":[]}')
    expect(d.products).toEqual([])
  })
})

describe('M8 — restoreLocalBackup xóa outbox, restoreBackup thì không', () => {
  it('file restore xóa syncQueue, giữ lastSeq', async () => {
    await dbx.products.add(mkProduct())
    await dbx.syncQueue.add(remoteOp('stock.adjust', { productId: 'p1', delta: 1, reason: 'cũ' }))
    await dbx.meta.put({ key: 'sync:lastSeq', value: 40 })
    await restoreLocalBackup(emptyBackup({
      products: [mkProduct({ id: 'p9', name: 'Từ file', stock: 1 })],
    }))
    expect(await dbx.syncQueue.count()).toBe(0)
    expect((await dbx.meta.get('sync:lastSeq'))!.value).toBe(40)
    expect(await dbx.products.get('p9')).toBeTruthy()
    expect(await dbx.products.get('p1')).toBeUndefined()
  })

  it('restoreBackup (snapshot cloud) không xóa syncQueue', async () => {
    await dbx.syncQueue.add(remoteOp('stock.adjust', { productId: 'p1', delta: 1, reason: 'pending' }))
    await restoreBackup(emptyBackup())
    expect(await dbx.syncQueue.count()).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sync-rest.test.ts`

Expected: FAIL — `restoreLocalBackup` / `parseRestoreFile` chưa có.

- [ ] **Step 3: Write minimal implementation**

`trial.ts`:

```ts
export function parseRestoreFile(raw: string): BackupData {
  let data: unknown
  try { data = JSON.parse(raw) } catch { throw new Error('File sao lưu không hợp lệ') }
  validateBackupSchema(data)
  return data as BackupData
}
```

`db.ts` — **không** thêm `syncQueue` vào tx của `restoreBackup`:

```ts
export async function restoreLocalBackup(data: BackupData): Promise<void> {
  await restoreBackup(data)
  await dbx.syncQueue.clear()
}
```

Web + mobile `handleFile`: `setConfirmRestore(parseRestoreFile(String(reader.result)))`. Confirm: `await restoreLocalBackup(confirmRestore)`.

Impact: `restoreLocalBackup` (mới, db); không sửa thân `restoreBackup`.

- [ ] **Step 4: Run tests + typecheck**

Run:

```
npx vitest run tests/sync-rest.test.ts tests/apply.test.ts tests/ledger-regress.test.ts
npm run typecheck
```

Expected: PASS, `tsc` sạch.

- [ ] **Step 5: Commit** — bỏ qua trừ khi user hỏi.

**Cổng đợt 2:** `npm test` + `npm run typecheck` trong `3su-next`. Không bật loop.

---

# Đợt 3 — M11 + M1

Chỉ làm sau đợt 2 xanh. Kiểm kê remote hiện không ghi `stockMoves`; local set `p.stock = actual` không chỉnh lô.

### Task 4: M11 — apply stocktake ghi stockMoves

**Files:**
- Create: `3su-next/tests/stocktake-rest.test.ts`
- Modify: `3su-next/src/core/sync/apply.ts` (`case 'stocktake.commit'` ~193–211)

**Interfaces:**
- Consumes: `StocktakeRecord.rows[].productId`, `diff | actual - system`
- Produces: move id `mv_${op.id}_${row.productId}`, `type: 'stocktake'`, `qty: diff`, `refId: rec.id`
- Nếu `stockMoves.get(id)` đã có → `continue` dòng (không `p.stock += diff`)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine, makeOp } from '@/core/sync/engine'
import { applyOps } from '@/core/sync/apply'
import { saveStocktake, consumeBatchesFefo } from '@/core/domain/inventory'
import type { Product, ProductBatch, SyncOp } from '@/core/types'

function mkProduct(over: Partial<Product> = {}): Product {
  return {
    id: 'p1', name: 'Mì', cat: 'Khô', price: 100, cost: 60, stock: 10,
    unit: 'gói', barcode: '', expiry: '', units: [], wholesalePrice: 0,
    batches: [], createdAt: 1, updatedAt: 1, ...over,
  }
}

function remoteOp(type: SyncOp['type'], payload: unknown): SyncOp {
  return { ...makeOp(type, payload), deviceId: 'dev_remote' }
}

beforeEach(async () => {
  await Promise.all([
    dbx.products.clear(), dbx.stockMoves.clear(), dbx.stocktakes.clear(),
    dbx.batches.clear(), dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear(),
  ])
  await initSyncEngine()
})

describe('M11 — stocktake remote ghi move', () => {
  it('diff +3 → stock 13 + 1 move id ổn định; apply lần 2 (xóa appliedOps) không cộng đôi', async () => {
    await dbx.products.add(mkProduct({ stock: 10 }))
    const op = remoteOp('stocktake.commit', {
      id: 'st1', date: '2026-08-18',
      rows: [{ productId: 'p1', name: 'Mì', system: 10, actual: 13, diff: 3 }],
      note: '', ts: 1,
    })
    await applyOps([op])
    expect((await dbx.products.get('p1'))!.stock).toBe(13)
    const mvId = `mv_${op.id}_p1`
    expect((await dbx.stockMoves.get(mvId))!.qty).toBe(3)
    await dbx.appliedOps.clear()
    await applyOps([op])
    expect((await dbx.products.get('p1'))!.stock).toBe(13)
    expect(await dbx.stockMoves.count()).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stocktake-rest.test.ts`

Expected: FAIL — `stockMoves.get` undefined.

- [ ] **Step 3: Write minimal implementation**

Trong `case 'stocktake.commit'`, sau khi tính `diff`, nếu `diff === 0` thì chỉ cập nhật `stockSetHlc` nếu cần rồi `continue`. Nếu `diff !== 0`:

```ts
const mvId = 'mv_' + op.id + '_' + row.productId
if (await dbx.stockMoves.get(mvId)) continue
p.stock += diff
p.stockSetHlc = op.hlc
p.updatedAt = Date.now()
await dbx.products.put(p)
await dbx.stockMoves.add({
  id: mvId, productId: row.productId, type: 'stocktake', qty: diff,
  cost: p.cost, note: 'Kiểm kê: ' + (diff > 0 ? 'thừa' : 'thiếu') + ' ' + Math.abs(diff),
  refId: rec.id, date: rec.date, ts: rec.ts,
})
```

Giữ quy tắc `stockSetHlc` (op cũ hơn → skip cả stock lẫn move).

Impact: `applyOne` nhánh `stocktake.commit` (sync).

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/stocktake-rest.test.ts tests/apply.test.ts`

Expected: PASS. Hai case stocktake sẵn trong `apply.test.ts` (stock 17 và 98) vẫn đúng — `diff === 0` không ghi move; `diff === 90` ghi 1 move.

- [ ] **Step 5: Commit** — bỏ qua trừ khi user hỏi.

---

### Task 5: M1 — kiểm kê / sửa tồn chỉnh lô

**Files:**
- Modify: `3su-next/src/core/domain/inventory.ts` (`saveStocktake`, `updateProduct`)
- Modify: `3su-next/src/core/sync/apply.ts` (`stocktake.commit` — chỉnh lô cùng lúc)
- Modify: `3su-next/tests/stocktake-rest.test.ts`

**Interfaces:**
- Consumes: `consumeBatchesFefo(batches, qty)` đã export
- Produces: helper nội bộ `function applyStockDeltaToBatches(p: Product, delta: number): ProductBatch[]`
  - `delta < 0`: `consumeBatchesFefo(p.batches, -delta).batches`
  - `delta > 0`: push `{ id: uid('bt'), qty: delta, remain: delta, cost: p.cost, expiry: '', date: localDay(new Date()), supName: 'Kiểm kê' }`
  - Ghi `p.batches` + `dbx.batches` (xóa lô `remain===0` cũ của SP nếu đang mirror — tối thiểu: `put` từng lô còn `remain > 0`)

- [ ] **Step 1: Write the failing tests**

```ts
describe('M1 — kiểm kê khớp lô', () => {
  it('local thiếu 4 → trừ FEFO; thừa 2 → thêm lô kiểm kê', async () => {
    const b1: ProductBatch = { id: 'b1', qty: 6, remain: 6, cost: 60, expiry: '2026-09-01', date: '2026-08-01' }
    const b2: ProductBatch = { id: 'b2', qty: 4, remain: 4, cost: 60, expiry: '2026-12-01', date: '2026-08-10' }
    await dbx.products.add(mkProduct({ stock: 10, batches: [b1, b2] }))
    await dbx.batches.bulkAdd([b1, b2])
    await saveStocktake([{ productId: 'p1', name: 'Mì', system: 10, actual: 6 }], 'thiếu')
    const after = (await dbx.products.get('p1'))!
    expect(after.stock).toBe(6)
    expect(after.batches.find((b) => b.id === 'b1')!.remain).toBe(2)
    expect(after.batches.find((b) => b.id === 'b2')!.remain).toBe(4)

    await saveStocktake([{ productId: 'p1', name: 'Mì', system: 6, actual: 8 }], 'thừa')
    const plus = (await dbx.products.get('p1'))!
    expect(plus.stock).toBe(8)
    expect(plus.batches.reduce((s, b) => s + b.remain, 0)).toBe(8)
  })
})
```

`ProductBatch` không có `productId` trên type — `dbx.batches` chỉ mirror cùng object. Helper M1 cập nhật `p.batches` rồi `put` từng lô, giống `sales.ts` / `apply.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stocktake-rest.test.ts`

Expected: FAIL — `batches[].remain` vẫn 6+4 sau khi tồn 6.

- [ ] **Step 3: Write minimal implementation**

Trong `saveStocktake`, khi `r.diff !== 0` sau `p.stock = r.actual`: gọi helper lô, `p.batches = next`, `p.expiry = liveBatchExpiry(next)`.

Trong `updateProduct` khi `stockChanged`: `applyStockDeltaToBatches(p, delta)` trước khi put.

Trong apply `stocktake.commit`: cùng helper trên `p` (cần `uid` — import từ `format`).

Impact: `saveStocktake`, `updateProduct`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/stocktake-rest.test.ts tests/domain.test.ts tests/outbox.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit** — bỏ qua trừ khi user hỏi.

**Cổng đợt 3:** `npm test` + `npm run typecheck`.

---

# Đợt 4 — M2 rồi S5

M2 trước S5: force-pull / xóa `appliedOps` rồi replay `stock.adjust` hiện cộng đôi (id move đã là `mv_${op.id}` nhưng `add` trùng sẽ throw — sau S3 bị poison hoặc nuốt). Phải `get` rồi return.

### Task 6: M2 — stock.adjust idempotent

**Files:**
- Create: `3su-next/tests/snapshot-seq.test.ts`
- Modify: `3su-next/src/core/sync/apply.ts` (`case 'stock.adjust'` ~180–192)

**Interfaces:**
- Consumes: move id hiện có `'mv_' + op.id`
- Produces: nếu `stockMoves.get('mv_' + op.id)` → `return` (không đổi `p.stock`)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine, makeOp } from '@/core/sync/engine'
import { applyOps } from '@/core/sync/apply'
import { pullCloudSnapshot } from '@/core/sync/engine'
import { setMeta } from '@/core/db'
import type { Product, SyncOp } from '@/core/types'

function mkProduct(over: Partial<Product> = {}): Product {
  return {
    id: 'p1', name: 'Mì', cat: 'Khô', price: 100, cost: 60, stock: 10,
    unit: 'gói', barcode: '', expiry: '', units: [], wholesalePrice: 0,
    batches: [], createdAt: 1, updatedAt: 1, ...over,
  }
}

beforeEach(async () => {
  await Promise.all([dbx.products.clear(), dbx.stockMoves.clear(), dbx.appliedOps.clear(), dbx.meta.clear(), dbx.syncQueue.clear()])
  await initSyncEngine()
})

describe('M2 — stock.adjust replay', () => {
  it('xóa appliedOps rồi apply lại cùng op → stock không đổi lần 2', async () => {
    await dbx.products.add(mkProduct({ stock: 10 }))
    const op: SyncOp = { ...makeOp('stock.adjust', { productId: 'p1', delta: 5, reason: 'x' }), deviceId: 'dev_remote' }
    await applyOps([op])
    expect((await dbx.products.get('p1'))!.stock).toBe(15)
    await dbx.appliedOps.clear()
    await applyOps([op])
    expect((await dbx.products.get('p1'))!.stock).toBe(15)
    expect(await dbx.stockMoves.count()).toBe(1)
  })
})
```

Hôm nay: lần 2 `stockMoves.add` trùng id → throw. Sau S3: poison + stock vẫn 15 **hoặc** nếu add nuốt thì stock 20. Test khóa hành vi: stock 15, 1 move, `applyOps` lần 2 returns 1 (applyOne no-op, vẫn đánh applied).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/snapshot-seq.test.ts`

Expected: FAIL (stock 20, hoặc poisoned, hoặc throw nếu chạy trước khi có S3 trên nhánh lệch).

- [ ] **Step 3: Write minimal implementation**

```ts
case 'stock.adjust': {
  const pl = op.payload as StockAdjustPayload
  const mvId = 'mv_' + op.id
  if (await dbx.stockMoves.get(mvId)) return
  const p = await dbx.products.get(pl.productId)
  if (!p) throw new Error('stock.adjust thiếu SP ' + pl.productId)
  p.stock += pl.delta
  p.updatedAt = Date.now()
  await dbx.products.put(p)
  await dbx.stockMoves.add({
    id: mvId, productId: pl.productId, type: 'adjust', qty: pl.delta,
    cost: p.cost, note: pl.reason, refId: pl.refId ?? '', date: new Date().toISOString(), ts: Date.now(),
  })
  return
}
```

Impact: `applyOne` nhánh `stock.adjust`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/snapshot-seq.test.ts tests/apply.test.ts tests/engine.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit** — bỏ qua trừ khi user hỏi.

---

### Task 7: S5 — lastSeq sau snapshot + ngừng GC ops

**Files:**
- Modify: `3su-next/src/core/sync/engine.ts` (`pullCloudSnapshot` ~192–206)
- Modify: `3su-cloud/src/d1.ts` (`gcOldOps` ~127–138)
- Modify: `3su-next/tests/snapshot-seq.test.ts`
- Modify: `3su-cloud/test/api.test.ts` nếu đã assert GC xóa ops — đổi thành "ops vẫn còn"

**Interfaces:**
- Consumes: `getMeta<number>('sync:lastSeq', 0)`, `got.upToSeq`
- Produces: sau import: `lastSeq = oldLastSeq > 0 ? oldLastSeq : got.upToSeq`; luôn `setMeta('sync:lastSnapshotSeq', got.upToSeq)`
- `gcOldOps`: xóa `pair_codes` hết hạn; **không** `DELETE FROM ops`

- [ ] **Step 1: Write the failing client test**

Không gọi mạng. Tách logic ra hàm thuần (thêm cạnh `pulledUpTo`):

```ts
export function lastSeqAfterSnapshot(oldLastSeq: number, upToSeq: number): number {
  return oldLastSeq > 0 ? oldLastSeq : upToSeq
}
```

`pullCloudSnapshot` dùng hàm này.

Test:

```ts
import { lastSeqAfterSnapshot } from '@/core/sync/engine'

describe('S5 — lastSeq sau snapshot', () => {
  it('máy đã sync không nhảy lên upToSeq của snapshot người khác', () => {
    expect(lastSeqAfterSnapshot(40, 200)).toBe(40)
  })
  it('máy mới lastSeq 0 nhận mốc snapshot', () => {
    expect(lastSeqAfterSnapshot(0, 200)).toBe(200)
  })
})
```

Test cloud: đọc `3su-cloud/test/api.test.ts` — nếu có case GC, assert `SELECT COUNT(*) FROM ops` không giảm vì `up_to_seq`. Nếu chưa có, thêm test gọi `gcOldOps` với 1 snapshot `up_to_seq = 5` và 5 ops → count ops vẫn 5.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/snapshot-seq.test.ts` (cwd `3su-next`)

Expected: FAIL — `lastSeqAfterSnapshot` is not exported. `pullCloudSnapshot` hiện `setMeta('sync:lastSeq', got.upToSeq)`.

- [ ] **Step 3: Write minimal implementation**

`engine.ts`: export `lastSeqAfterSnapshot`; trong `pullCloudSnapshot` đọc `oldLastSeq` **trước** import; sau import `setMeta('sync:lastSeq', lastSeqAfterSnapshot(oldLastSeq, got.upToSeq))`.

`d1.ts` `gcOldOps`: xóa khối `DELETE FROM ops`. Giữ xóa `pair_codes`.

Impact: `pullCloudSnapshot`, `gcOldOps`.

- [ ] **Step 4: Run tests**

`3su-next`: `npx vitest run tests/snapshot-seq.test.ts tests/engine.test.ts` + `npm run typecheck`

`3su-cloud`: `npx vitest run` (hoặc script trong `package.json`)

Expected: PASS.

- [ ] **Step 5: Commit** — bỏ qua trừ khi user hỏi.

**Cổng đợt 4:** test + typecheck cả hai package.

---

# Đợt 5 — S4 + M9 + L5

Hội tụ đa máy. Không chặn bán một máy.

### Task 8: S4 tombstone + M9 fieldHlc KH + NCC + L5 delete HLC

**Files:**
- Create: `3su-next/tests/lww-rest.test.ts`
- Modify: `3su-next/src/core/types.ts` — thêm `deletedHlc?: string` trên `Product`, `Customer`, `Supplier`, `Note`, `InvoiceRecord`, `PricingRule`
- Modify: `3su-next/src/core/sync/apply.ts` — `product.delete`, `customer.delete`, `supplier.delete` (nếu chưa có supplier.delete thì chỉ product/customer), `product.upsert` / `customer.upsert` / `supplier.upsert`, `invoice.delete`, `pricing.delete`, `note.delete`
- Modify domain delete tương ứng (`deleteProduct` đã mềm; invoice/pricing/note local delete phải `persistOp` tombstone chứ không hard-delete nếu đang hard-delete)

**Interfaces:**
- Consumes: `compareHlc(op.hlc, rec.deletedHlc)`
- Produces: delete set `{ deleted: true, deletedHlc: op.hlc, hlc: op.hlc }`. Upsert bỏ qua toàn bộ nếu `cur.deletedHlc && compareHlc(op.hlc, cur.deletedHlc) <= 0`. `customer.upsert` / `supplier.upsert` merge từng field như `product.upsert` (bỏ `debt` / `totalSpent` / `orderCount` / `totalPurchased` khỏi patch).

- [ ] **Step 1: Write the failing tests**

```ts
describe('S4 — xóa thắng upsert cũ hơn', () => {
  it('product.delete HLC mới hơn rồi upsert HLC cũ → vẫn deleted', async () => {
    await dbx.products.add(mkProduct({ id: 'p1' }))
    await applyOps([remoteOp('product.delete', { productId: 'p1' }, hlcString(3000, 0, 'dev_a'))])
    await applyOps([remoteOp('product.upsert', { product: { id: 'p1', name: 'Sống lại' } }, hlcString(1000, 0, 'dev_b'))])
    const p = (await dbx.products.get('p1'))!
    expect(p.deleted).toBe(true)
    expect(p.name).not.toBe('Sống lại')
  })
})

describe('M9 — customer fieldHlc', () => {
  it('máy A sửa tên, máy B sửa SĐT — cả hai giữ', async () => {
    await dbx.customers.add(mkCustomer({ id: 'c1', name: 'An', phone: '1' }))
    await applyOps([remoteOp('customer.upsert', { customer: { id: 'c1', name: 'An B' } }, hlcString(2000, 0, 'dev_a'))])
    await applyOps([remoteOp('customer.upsert', { customer: { id: 'c1', phone: '0909' } }, hlcString(3000, 0, 'dev_b'))])
    const c = (await dbx.customers.get('c1'))!
    expect(c.name).toBe('An B')
    expect(c.phone).toBe('0909')
  })
})

describe('L5 — note.delete tombstone', () => {
  it('delete rồi upsert cũ hơn → note vẫn deleted, không mất hàng', async () => {
    await applyOps([remoteOp('note.upsert', { id: 'n1', text: 'a', color: 'y', pinned: false, ts: 1 }, hlcString(1000, 0, 'dev_a'))])
    await applyOps([remoteOp('note.delete', { noteId: 'n1' }, hlcString(3000, 0, 'dev_a'))])
    await applyOps([remoteOp('note.upsert', { id: 'n1', text: 'cũ', color: 'y', pinned: false, ts: 1 }, hlcString(2000, 0, 'dev_b'))])
    const n = await dbx.notes.get('n1')
    expect(n).toBeTruthy()
    expect(n!.deleted).toBe(true)
  })
})
```

Chỉnh factory/`Note` cho khớp `types.ts` (đủ field bắt buộc). `hlcString` + `remoteOp` 3 args như `apply.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lww-rest.test.ts`

Expected: FAIL — upsert sống lại / phone đè mất tên / `notes.get` undefined.

- [ ] **Step 3: Write minimal implementation**

`product.upsert`: ngay sau load `cur`, nếu `cur.deletedHlc && compareHlc(op.hlc, cur.deletedHlc) <= 0` return.

`product.delete`: `put({ ...cur, deleted: true, deletedHlc: op.hlc, hlc: op.hlc })` chỉ khi `!cur.deletedHlc || compareHlc(op.hlc, cur.deletedHlc) > 0`.

`customer.upsert` / `supplier.upsert`: copy vòng `fieldHlc` từ `product.upsert` (omit id, aggregates, fieldHlc, hlc, debt).

`note.delete` / `invoice.delete` / `pricing.delete`: `put` tombstone, không `delete()`.

Local `deleteProduct` đã mềm — set thêm `deletedHlc`. Tìm `invoice.delete` / `note.delete` domain và đổi cùng kiểu.

Impact: các hàm delete/upsert public + `applyOne`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/lww-rest.test.ts tests/apply.test.ts tests/convergence.test.ts`

Expected: PASS. Case `invoice.delete` trong `apply.test.ts` đang `toBeUndefined()` — **đổi** thành `deleted === true` trong cùng task (không để test cũ khóa hard-delete).

- [ ] **Step 5: Commit** — bỏ qua trừ khi user hỏi.

**Cổng đợt 5:** `npm test` + `npm run typecheck`.

---

# Đợt 6 — M5 + M6 + M7

Báo cáo. Không mất tiền.

### Task 9: aggregatePurchases / MTD / unitRatio

**Files:**
- Create: `3su-next/tests/reports-rest.test.ts`
- Modify: `3su-next/src/core/domain/purchase.ts` (`aggregatePurchases` ~178–211)
- Modify: `3su-next/src/core/domain/reports.ts` (`resolveRange` ~37–45)
- Modify: `3su-next/src/core/domain/suppliers.ts` (`compareSupplierPrices` ~215–231)

**Interfaces:**
- `aggregatePurchases`: `if (po.status === 'received') continue`
- `resolveRange` mtd: `from: today().slice(0, 8) + '01'` (`today` đã import từ `format`)
- `compareSupplierPrices`: `const base = row.qty * (row.unitRatio || 1)`; `cur.cost += row.cost * base`; `cur.qty += base`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { aggregatePurchases } from '@/core/domain/purchase'
import { resolveRange } from '@/core/domain/reports'
import { compareSupplierPrices } from '@/core/domain/suppliers'
import { today } from '@/core/format'
import type { GoodsReceipt, PurchaseOrder, Supplier } from '@/core/types'

describe('M5 — PO received không đứng cạnh GR', () => {
  it('một GR + PO received cùng tiền → một dòng gr', () => {
    const gr = {
      id: 'g1', code: 'NK-1', supplier: 'A', date: '2026-08-18', ts: 1,
      total: 100, paid: 0, note: '', rows: [1],
    }
    const po = {
      id: 'po1', code: 'PO-1', supplierName: 'A', date: '2026-08-18', ts: 1,
      rows: [], total: 100, status: 'received', note: '',
    } as unknown as PurchaseOrder
    const rows = aggregatePurchases([gr], [po])
    expect(rows.map((r) => r.kind)).toEqual(['gr'])
  })
})

describe('M6 — MTD local', () => {
  it('from = ngày 1 tháng local của today()', () => {
    const { from, to } = resolveRange({
      preset: 'mtd', from: '', to: '', metric: 'revenue',
      cat: '', pay: '', customerId: null, compare: false,
    })
    expect(from).toBe(today().slice(0, 8) + '01')
    expect(to).toBe(today())
  })
})

describe('M7 — so giá theo đơn vị gốc', () => {
  it('thùng 24 × cost 24000 rẻ hơn lẻ cost 1200', () => {
    const receipts: GoodsReceipt[] = [
      {
        id: 'a', code: '1', supplier: 'A', supplierId: 'sa', date: '2026-08-01',
        expiry: '', note: '', total: 24000, ts: 1, rows: [{
          productId: 'p1', name: 'Sting', unit: 'thùng', unitRatio: 24, qty: 1, cost: 24000, expiry: '',
        }],
      },
      {
        id: 'b', code: '2', supplier: 'B', supplierId: 'sb', date: '2026-08-02',
        expiry: '', note: '', total: 1200, ts: 2, rows: [{
          productId: 'p1', name: 'Sting', unit: 'lon', unitRatio: 1, qty: 1, cost: 1200, expiry: '',
        }],
      },
    ]
    const suppliers: Supplier[] = [
      { id: 'sa', name: 'A', phone: '', address: '', note: '', leadDays: 0, debt: 0, totalPurchased: 0, orderCount: 0, createdAt: 1, updatedAt: 1 },
      { id: 'sb', name: 'B', phone: '', address: '', note: '', leadDays: 0, debt: 0, totalPurchased: 0, orderCount: 0, createdAt: 1, updatedAt: 1 },
    ]
    const out = compareSupplierPrices(receipts, suppliers)
    expect(out[0]!.bestSupplierId).toBe('sa')
    expect(out[0]!.bestCost).toBe(1000) // 24000/24
    expect(out[0]!.currentCost).toBe(1200)
  })
})
```

Đủ field `PurchaseOrder` / `Supplier` nếu typecheck kêu — copy từ factory test hiện có (`grep PurchaseOrder` trong `tests/`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reports-rest.test.ts`

Expected: FAIL — 2 dòng (gr+po); MTD có thể lệch UTC; `bestSupplierId === 'sb'` (so 24000 vs 1200).

- [ ] **Step 3: Write minimal implementation**

`aggregatePurchases`: trong vòng PO, `if (po.status === 'received') continue`.

`resolveRange`: `if (f.preset === 'mtd') return { from: today().slice(0, 8) + '01', to: t }`.

`compareSupplierPrices`:

```ts
const base = row.qty * (row.unitRatio || 1)
if (!base) continue
cur.cost += row.cost * base
cur.qty += base
```

Impact: `aggregatePurchases`, `resolveRange`, `compareSupplierPrices`.

- [ ] **Step 4: Run full suite**

Run (cwd `3su-next`): `npm test` + `npm run typecheck`

Expected: PASS, 26+ files.

- [ ] **Step 5: Commit** — bỏ qua trừ khi user hỏi.

**Cổng đợt 6:** `npm test` + `npm run typecheck`. Xong backlog review (trừ L4/L6/L7 đã loại).

---

## Self-review

1. **Spec coverage:** S3 T1; M12 T2; M8+L8 T3; M11 T4; M1 T5; M2 T6; S5 T7; S4+M9+L5 T8; M5–M7 T9. L2/L4/L6/L7 cố ý bỏ. Đợt 1 không đụng.
2. **Placeholder scan:** không TBD/TODO. Mỗi bước có code hoặc lệnh chạy cụ thể.
3. **Type consistency:** `seedCatalog(items, stock)`, `restoreLocalBackup`, `parseRestoreFile`, `getPoisonedOps`, `lastSeqAfterSnapshot(old, upTo)`, move id `mv_${op.id}` / `mv_${op.id}_${productId}`, meta `sync:poisoned`.
4. **Rủi ro đã biết:** S3 mất dữ liệu op độc (đúng — shop không kẹt). Restore file giữ `lastSeq` → máy không tự kéo lại op cũ (đúng). Tắt GC ops → bảng D1 lớn dần (chấp nhận đến khi có GC theo ngày). M7 giả định `row.cost` là giá / đơn vị dòng — khớp GR hiện tại.
