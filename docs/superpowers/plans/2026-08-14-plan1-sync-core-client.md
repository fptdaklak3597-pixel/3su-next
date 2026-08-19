# Plan 1 — Sync Core Client (op-log v2, HLC, reducer, snapshot)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Đọc trước:** `docs/superpowers/specs/2026-08-14-3su-cloud-sync-design.md` (spec đã duyệt — mục 3 là nền của plan này).

**Goal:** Thay lõi đồng bộ của `3su-next` bằng op-log v2 (HLC + delta + LWW + idempotent reducer + snapshot), chạy hoàn toàn offline với NullTransport, sẵn giao diện `SyncTransport` để Plan 3 cắm server thật.

**Architecture:** Mọi mutation nghiệp vụ ghi op vào outbox (`syncQueue`) NGAY TRONG cùng Dexie transaction với dữ liệu. Reducer `applyOps` áp op remote idempotent nhờ bảng `appliedOps`. Tồn kho/công nợ chỉ đổi qua delta; hồ sơ qua LWW theo HLC; chứng từ là immutable append. Firestore adapter cũ bị gỡ hẳn.

**Tech Stack:** TypeScript strict, Dexie 4, Vitest 4 + fake-indexeddb (đã cấu hình sẵn trong `vitest.config.ts` + `tests/setup.ts`), React 18 (chỉ sửa wiring, không sửa UI).

## Global Constraints

- Thư mục làm việc: `D:\claude\3su\3su-next`. Làm trên nhánh mới `feat/sync-core-v2` (tạo từ nhánh hiện tại).
- KHÔNG thêm dependency mới. KHÔNG đổi UI/UX (ngoại lệ duy nhất: vô hiệu hoá khối "cloud key" trong `DevicesPage` — Task 2).
- Sau MỖI task: `npm run typecheck` và `npm test` phải xanh rồi mới commit. App phải chạy offline thuần đầy đủ chức năng sau mỗi task.
- Trong `dbx.transaction(...)` CHỈ ĐƯỢC await thao tác Dexie. Await promise ngoài Dexie (fetch, setTimeout…) sẽ giết transaction — đây là bẫy Dexie kinh điển.
- Mọi bảng mà transaction đụng tới (kể cả `syncQueue`, `appliedOps`, `meta`) phải nằm trong danh sách tables của transaction đó.
- Test đặt tại `tests/*.test.ts`, dùng factory + `beforeEach` xoá bảng theo phong cách `tests/domain.test.ts` có sẵn.
- Comment code bằng tiếng Việt (theo phong cách repo), identifier tiếng Anh.
- `3su-next` chưa có người dùng thật → được phép wipe `syncQueue` cũ trong migration Dexie v5, không cần chuyển đổi op format cũ.

---

### Task 1: HLC — đồng hồ logic lai

**Files:**
- Create: `src/core/sync/hlc.ts`
- Test: `tests/hlc.test.ts`

**Interfaces:**
- Consumes: không gì (module thuần, không import Dexie).
- Produces: `hlcString(ms, c, d): string`, `parseHlc(s): {ms, c, d}`, `compareHlc(a, b): -1|0|1`, `createHlcClock(deviceId, persisted, persist, now?): HlcClock` với `HlcClock = { next(): string; observe(remote: string): void; last(): string }`. Task 2, 3, 5 dùng đúng các tên này.

- [ ] **Step 1: Viết test fail trước**

```ts
// tests/hlc.test.ts
import { describe, it, expect } from 'vitest'
import { hlcString, parseHlc, compareHlc, createHlcClock } from '@/core/sync/hlc'

describe('hlc', () => {
  it('format cố định 13 số ms + 4 hex counter + deviceId, so sánh chuỗi = so sánh thời gian', () => {
    const a = hlcString(1_755_150_000_000, 3, 'dev_a')
    expect(a).toBe('1755150000000-0003-dev_a')
    expect(parseHlc(a)).toEqual({ ms: 1_755_150_000_000, c: 3, d: 'dev_a' })
    expect(compareHlc(hlcString(1000, 0, 'x'), hlcString(1001, 0, 'x'))).toBe(-1)
    expect(compareHlc(hlcString(1000, 2, 'x'), hlcString(1000, 1, 'x'))).toBe(1)
  })

  it('next() luôn tăng nghiêm ngặt, kể cả khi đồng hồ máy đứng yên hoặc LÙI', () => {
    let t = 5000
    const clock = createHlcClock('dev_a', null, () => {}, () => t)
    const h1 = clock.next()
    t = 4000 // đồng hồ lùi 1 giây
    const h2 = clock.next()
    const h3 = clock.next()
    expect(compareHlc(h2, h1)).toBe(1)
    expect(compareHlc(h3, h2)).toBe(1)
  })

  it('observe(remote) đẩy đồng hồ vượt op remote — op sau đó phải mới hơn remote', () => {
    let t = 1000
    const clock = createHlcClock('dev_a', null, () => {}, () => t)
    const remote = hlcString(999_999, 10, 'dev_b')
    clock.observe(remote)
    expect(compareHlc(clock.next(), remote)).toBe(1)
  })

  it('khôi phục từ persisted vẫn monotonic', () => {
    const persisted = hlcString(9000, 5, 'dev_a')
    const clock = createHlcClock('dev_a', persisted, () => {}, () => 1000)
    expect(compareHlc(clock.next(), persisted)).toBe(1)
  })

  it('gọi persist mỗi lần next', () => {
    const saved: string[] = []
    const clock = createHlcClock('dev_a', null, (s) => saved.push(s))
    const h = clock.next()
    expect(saved).toEqual([h])
  })
})
```

- [ ] **Step 2: Chạy để chắc chắn fail** — `npx vitest run tests/hlc.test.ts` → FAIL (module chưa tồn tại).

- [ ] **Step 3: Cài đặt tối thiểu**

```ts
// src/core/sync/hlc.ts
/**
 * HLC — Hybrid Logical Clock cho op-log.
 * Chuỗi "<ms 13 số>-<counter 4 hex>-<deviceId>" so sánh chuỗi = so sánh thời gian.
 * Chịu được đồng hồ máy sai/lùi: next() luôn tăng nghiêm ngặt.
 */
export interface HlcParts { ms: number; c: number; d: string }

export function hlcString(ms: number, c: number, d: string): string {
  return String(ms).padStart(13, '0') + '-' + c.toString(16).padStart(4, '0') + '-' + d
}

export function parseHlc(s: string): HlcParts {
  const i = s.indexOf('-')
  const j = s.indexOf('-', i + 1)
  return { ms: Number(s.slice(0, i)), c: parseInt(s.slice(i + 1, j), 16), d: s.slice(j + 1) }
}

export function compareHlc(a: string, b: string): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0
}

export interface HlcClock {
  next(): string
  observe(remote: string): void
  last(): string
}

export function createHlcClock(
  deviceId: string,
  persisted: string | null,
  persist: (s: string) => void,
  now: () => number = Date.now,
): HlcClock {
  let ms = 0
  let c = 0
  if (persisted) {
    const p = parseHlc(persisted)
    ms = p.ms
    c = p.c
  }
  function bump(t: number): void {
    if (t > ms) { ms = t; c = 0 } else { c += 1; if (c > 0xffff) { ms += 1; c = 0 } }
  }
  return {
    next() {
      bump(now())
      const s = hlcString(ms, c, deviceId)
      persist(s)
      return s
    },
    observe(remote) {
      const p = parseHlc(remote)
      if (p.ms > ms || (p.ms === ms && p.c > c)) { ms = p.ms; c = p.c }
    },
    last() { return hlcString(ms, c, deviceId) },
  }
}
```

- [ ] **Step 4: Chạy test** — `npx vitest run tests/hlc.test.ts` → PASS. Chạy cả `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/sync-core-v2
git add src/core/sync/hlc.ts tests/hlc.test.ts
git commit -m "feat(sync): HLC clock — nền tảng op-log v2"
```

---

### Task 2: Op schema v2 + engine mới + gỡ Firestore adapter

Mục tiêu: toàn hệ chuyển sang envelope op mới; các call site `enqueueSync` cũ bị XÓA (đưa vào domain lại ở Task 4 — trong lúc đó app vẫn offline thuần nên không mất chức năng); Firestore adapter/cloud-key bị gỡ hẳn theo spec mục 2.

**Files:**
- Modify: `src/core/types.ts` (interface `SyncOp` tại dòng ~358)
- Modify: `src/core/db.ts` (schema v5)
- Modify: `src/core/sync/engine.ts` (viết lại phần enqueue)
- Delete: `src/core/sync/firestoreAdapter.ts`, `src/core/sync/cloudKey.ts`
- Modify: `src/mobile/App.tsx` (dòng ~80: bỏ `initCloudSync`), `src/mobile/pages/DevicesPage.tsx` (bỏ khối cloud key), `src/mobile/main.tsx`, `src/web/main.tsx` (gọi `initSyncEngine`)
- Modify (xóa dòng `enqueueSync`, giữ nguyên phần còn lại): `CheckoutPage.tsx:85`, `OrderDetailPage.tsx:43`, `ProductDetailPage.tsx:53,57`, `CustomersPage.tsx:72,101`, `GoodsReceiptPage.tsx:153`, `InvoiceImportPage.tsx:162`, `StocktakePage.tsx:64`, `SettingsPage.tsx:45` (đường dẫn gốc `src/mobile/pages/`)
- Test: `tests/engine.test.ts`

**Interfaces:**
- Consumes: `createHlcClock`, `hlcString` (Task 1); `getThisDeviceId()` từ `src/core/domain/devices.ts`; `getMeta/setMeta` từ `src/core/db.ts`.
- Produces (Task 3-6 dùng đúng tên này):
  - `initSyncEngine(): Promise<void>` — nạp deviceId + HLC persisted vào bộ nhớ.
  - `makeOp(type: OpType, payload: unknown): SyncOp` — sync, throw nếu chưa init.
  - `persistOp(op: SyncOp): Promise<void>` — ghi `syncQueue` + `appliedOps` (gọi trong transaction).
  - `enqueueOp(type, payload): Promise<SyncOp>` — makeOp + persistOp.
  - Types: `OpType`, `SyncOp` (id = hlc), `AppliedOp`, `StockAdjustPayload`, `GrPatch`, `GrCommitPayload`, `SettingsSetPayload`.

- [ ] **Step 1: Types mới trong `src/core/types.ts`** — thay interface `SyncOp` cũ (dòng ~358) bằng:

```ts
export type OpType =
  | 'sale.commit' | 'sale.void'
  | 'product.upsert' | 'product.delete' | 'stock.adjust' | 'stocktake.commit'
  | 'customer.upsert' | 'customer.delete' | 'debt.pay'
  | 'gr.commit' | 'supplier.upsert'
  | 'settings.set' | 'note.upsert' | 'note.delete'

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
```

Thêm các trường LWW vào interface có sẵn (spec 3.2/3.4): `Product` thêm `hlc?: string`, `stockSetHlc?: string`, `grHlc?: string`; `Customer` thêm `hlc?: string`; `Supplier` thêm `hlc?: string`; `Note` thêm `hlc?: string`.

- [ ] **Step 2: Dexie v5 trong `src/core/db.ts`** — thêm khai báo bảng + version 5 (copy nguyên stores của version 4, thêm `appliedOps`, và wipe queue cũ vì đổi format):

```ts
appliedOps!: Table<AppliedOp, string>
```

```ts
/* v5: op-log v2 — appliedOps chống áp trùng; wipe queue format cũ */
this.version(5).stores({
  /* ... copy toàn bộ stores của version 4 ... */
  appliedOps: 'id',
}).upgrade(async (tx) => {
  await tx.table('syncQueue').clear()
})
```

(Nhớ import type `AppliedOp` ở đầu file.)

- [ ] **Step 3: Viết test fail cho engine mới**

```ts
// tests/engine.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine, enqueueOp, makeOp } from '@/core/sync/engine'
import { compareHlc } from '@/core/sync/hlc'

describe('engine v2 — outbox', () => {
  beforeEach(async () => {
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
    await initSyncEngine()
  })

  it('enqueueOp ghi CẢ syncQueue lẫn appliedOps, id = hlc, có deviceId', async () => {
    const op = await enqueueOp('stock.adjust', { productId: 'p1', delta: 5, reason: 'init' })
    expect(op.id).toBe(op.hlc)
    expect(op.deviceId).toBeTruthy()
    expect(await dbx.syncQueue.get(op.id)).toBeTruthy()
    expect(await dbx.appliedOps.get(op.id)).toBeTruthy()
  })

  it('hlc các op tăng nghiêm ngặt', async () => {
    const a = makeOp('note.delete', { noteId: 'n1' })
    const b = makeOp('note.delete', { noteId: 'n2' })
    expect(compareHlc(b.hlc, a.hlc)).toBe(1)
  })

  it('enqueueOp hoạt động BÊN TRONG transaction của caller (outbox pattern)', async () => {
    await dbx.transaction('rw', [dbx.products, dbx.syncQueue, dbx.appliedOps], async () => {
      await dbx.products.put({ id: 'p9', name: 'X', cat: 'Khác', price: 1, cost: 1, stock: 0, unit: 'cái', barcode: '', expiry: '', units: [], wholesalePrice: 0, batches: [], createdAt: 1, updatedAt: 1 })
      await enqueueOp('product.upsert', { product: { id: 'p9' } })
    })
    expect(await dbx.syncQueue.count()).toBe(1)
  })
})
```

- [ ] **Step 4: Chạy fail** — `npx vitest run tests/engine.test.ts` → FAIL.

- [ ] **Step 5: Viết lại phần enqueue của `src/core/sync/engine.ts`** — GIỮ `getSyncState/onSyncState/startSyncLoop/stopSyncLoop` và kiểu `SyncState`, THAY `enqueueSync` + type `SyncAdapter` cũ:

```ts
import Dexie from 'dexie'
import { dbx, getMeta, setMeta } from '../db'
import type { SyncOp, OpType, SyncState } from '../types'
import { createHlcClock, type HlcClock } from './hlc'
import { getThisDeviceId } from '../domain/devices'

let deviceId = ''
let clock: HlcClock | null = null

/** Gọi 1 lần khi khởi động app (trước render). */
export async function initSyncEngine(): Promise<void> {
  deviceId = await getThisDeviceId()
  const persisted = await getMeta<string | null>('hlc:last', null)
  clock = createHlcClock(deviceId, persisted, (s) => {
    // Ghi ngoài transaction hiện hành để không bắt caller khai báo bảng meta
    void Dexie.ignoreTransaction(() => setMeta('hlc:last', s))
  })
}

export function makeOp(type: OpType, payload: unknown): SyncOp {
  if (!clock) throw new Error('Sync engine chưa init — gọi initSyncEngine() khi khởi động app')
  const hlc = clock.next()
  return { id: hlc, hlc, deviceId, type, payload, createdAt: Date.now(), attempts: 0 }
}

/** Ghi op vào outbox + đánh dấu đã áp local. Gọi trong transaction có syncQueue + appliedOps. */
export async function persistOp(op: SyncOp): Promise<void> {
  await dbx.syncQueue.add(op)
  await dbx.appliedOps.add({ id: op.id })
}

export async function enqueueOp(type: OpType, payload: unknown): Promise<SyncOp> {
  const op = makeOp(type, payload)
  await persistOp(op)
  return op
}

/** Cho reducer đẩy đồng hồ theo op remote (Task 3). */
export function observeRemoteHlc(remoteHlc: string): void {
  clock?.observe(remoteHlc)
}
```

`flushQueue` tạm thời rút thành no-op có chữ ký cũ (Task 6 viết lại): `export async function flushQueue(): Promise<void> { /* Task 6 */ }`. Xoá `setSyncAdapter` + type `SyncAdapter`.

- [ ] **Step 6: Gỡ Firestore adapter + cloud key**
  - Xóa file `src/core/sync/firestoreAdapter.ts` và `src/core/sync/cloudKey.ts`.
  - `src/mobile/App.tsx` (~dòng 78-86): bỏ block dynamic-import `initCloudSync`; thay bằng không làm gì (sync khởi động lại ở Plan 3).
  - `src/mobile/main.tsx` và `src/web/main.tsx`: thêm `import { initSyncEngine } from '@/core/sync/engine'` (điều chỉnh alias theo file) và gọi `void initSyncEngine()` TRƯỚC `createRoot(...).render(...)`.
  - `src/mobile/pages/DevicesPage.tsx`: bỏ import + 2 handler dùng `generateCloudKey/activateCloudKey`; thay khối UI cloud key bằng đoạn thông báo tĩnh: `"Đồng bộ cloud thế hệ mới đang được nâng cấp — sắp tới sẽ ghép máy bằng mã QR."` Chạy typecheck để bắt hết chỗ đứt import còn sót.
  - Xóa 10 dòng `await enqueueSync(...)` ở 8 file pages liệt kê trong **Files** (chỉ xóa dòng gọi + import thừa; logic còn lại giữ nguyên).

- [ ] **Step 7: Chạy toàn bộ** — `npm run typecheck && npm test` → PASS (test engine mới + toàn bộ test cũ).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(sync): op schema v2 + outbox engine moi, go Firestore adapter/cloud key"
```

---

### Task 3: Reducer `applyOps` — áp op idempotent

**Files:**
- Create: `src/core/sync/apply.ts`
- Test: `tests/apply.test.ts`

**Interfaces:**
- Consumes: `compareHlc` (Task 1); `observeRemoteHlc` (Task 2); types Task 2; `dbx`.
- Produces: `applyOps(ops: SyncOp[]): Promise<number>` (trả số op áp mới), `pendingStockDelta(productId: string): Promise<number>`. Task 5/6 gọi đúng các tên này.

- [ ] **Step 1: Viết test fail** — các case bắt buộc (spec 3.2-3.4). Factory `mkProduct/mkCustomer` copy phong cách `tests/domain.test.ts`; helper `mkOp(type, payload)` dùng `makeOp` của engine rồi TỰ đổi `deviceId: 'dev_remote'` và giữ hlc (giả op máy khác, KHÔNG persistOp — vì op remote không nằm trong appliedOps):

```ts
// tests/apply.test.ts — khung + case chính (viết đủ, đây là hợp đồng chuẩn)
import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine, makeOp, enqueueOp } from '@/core/sync/engine'
import { applyOps, pendingStockDelta } from '@/core/sync/apply'
import { hlcString } from '@/core/sync/hlc'
import type { Sale, SyncOp } from '@/core/types'

function remoteOp(type: SyncOp['type'], payload: unknown, hlc?: string): SyncOp {
  const op = makeOp(type, payload)
  return { ...op, deviceId: 'dev_remote', ...(hlc ? { hlc, id: hlc } : {}) }
}

beforeEach(async () => {
  await Promise.all([dbx.products.clear(), dbx.sales.clear(), dbx.customers.clear(),
    dbx.debtPayments.clear(), dbx.goodsReceipts.clear(), dbx.stockMoves.clear(),
    dbx.stocktakes.clear(), dbx.notes.clear(), dbx.batches.clear(), dbx.priceLog.clear(),
    dbx.syncQueue.clear(), dbx.appliedOps.clear(), dbx.meta.clear()])
  await initSyncEngine()
})

describe('applyOps — idempotent + delta + LWW', () => {
  it('áp op 2 lần chỉ có tác dụng 1 lần (appliedOps)', async () => {
    await dbx.products.put(/* mkProduct id p1, stock 10 */)
    const op = remoteOp('stock.adjust', { productId: 'p1', delta: -3, reason: 'test' })
    expect(await applyOps([op])).toBe(1)
    expect(await applyOps([op])).toBe(0)
    expect((await dbx.products.get('p1'))!.stock).toBe(7)
  })

  it('sale.commit remote: thêm đơn + trừ kho theo items + cộng nợ/totalSpent khách', async () => {
    await dbx.products.put(/* mkProduct id p1, stock 10 */)
    await dbx.customers.put(/* mkCustomer id c1, debt 0, totalSpent 0, orderCount 0 */)
    const sale: Sale = {
      id: 's_remote_1', total: 20000, profit: 8000, discount: 0, payMethod: 'cash',
      tendered: 5000, change: 0, debtAmount: 15000, customerId: 'c1',
      date: new Date().toISOString(), synced: false,
      items: [{ productId: 'p1', name: 'SP', qty: 2, price: 10000, cost: 6000, unit: 'cái', unitRatio: 1 }],
    }
    await applyOps([remoteOp('sale.commit', sale)])
    expect((await dbx.products.get('p1'))!.stock).toBe(8)
    const c = (await dbx.customers.get('c1'))!
    expect(c.debt).toBe(15000)
    expect(c.totalSpent).toBe(20000)
    expect(c.orderCount).toBe(1)
    expect(await dbx.sales.get('s_remote_1')).toBeTruthy()
  })

  it('sale.commit remote đã có sale id local → bỏ qua hoàn toàn (không trừ kho đúp)', async () => {
    // seed p1 stock 8 + sale s_remote_1 ĐÃ tồn tại local (giả lập đã áp trước đó)
    // applyOps op sale.commit cùng id nhưng id op KHÁC (op mới, chưa có trong appliedOps)
    // → stock giữ 8, customers giữ nguyên
  })

  it('sale.void remote: hoàn kho, hoàn nợ, đánh dấu voided; đơn đã voided thì bỏ qua', async () => {
    // seed p1 stock 8, c1 debt 15000 totalSpent 20000, sale s1 (như case trên, chưa voided)
    await applyOps([remoteOp('sale.void', { saleId: 's_remote_1', reason: 'test' })])
    expect((await dbx.products.get('p1'))!.stock).toBe(10)
    expect((await dbx.customers.get('c1'))!.debt).toBe(0)
    expect((await dbx.sales.get('s_remote_1'))!.voided).toBe(true)
    // áp lần 2 với op id khác → không hoàn kho đúp (guard s.voided)
    await applyOps([remoteOp('sale.void', { saleId: 's_remote_1', reason: 'test2' })])
    expect((await dbx.products.get('p1'))!.stock).toBe(10)
  })

  it('stock.adjust giao hoán: [-3, +5] và [+5, -3] cho cùng kết quả', async () => { /* 2 op, áp 2 thứ tự trên 2 seed giống nhau, cùng ra stock 12 */ })

  it('product.upsert LWW: op hlc mới hơn thắng; KHÔNG đè stock/batches local', async () => {
    await dbx.products.put(/* p1 stock 10, hlc = hlcString(1000, 0, 'dev_a') */)
    const newer = remoteOp('product.upsert',
      { product: { id: 'p1', name: 'Tên mới', price: 9000 /* KHÔNG có stock */ } },
      hlcString(9_999_999_999_999, 0, 'dev_remote'))
    await applyOps([newer])
    const p = (await dbx.products.get('p1'))!
    expect(p.name).toBe('Tên mới')
    expect(p.stock).toBe(10) // stock local bất khả xâm phạm
    const older = remoteOp('product.upsert', { product: { id: 'p1', name: 'Tên cũ' } }, hlcString(1, 0, 'dev_z'))
    await applyOps([older])
    expect((await dbx.products.get('p1'))!.name).toBe('Tên mới') // op cũ hơn thua
  })

  it('stocktake.commit remote KHÔNG nuốt delta local chưa đẩy (quy tắc delta treo, spec 3.4)', async () => {
    await dbx.products.put(/* p1 stock 8 (đã bán 2 từ 10, op còn trong outbox) */)
    const sale: Sale = /* đơn bán 2 cái p1, dùng factory */
    await enqueueOp('sale.commit', sale) // outbox local có op trừ 2
    const st = remoteOp('stocktake.commit', {
      id: 'st1', date: '2026-08-14',
      rows: [{ productId: 'p1', name: 'SP', system: 10, actual: 100, diff: 90 }],
      note: '', ts: Date.now(),
    })
    await applyOps([st])
    // Máy kia đếm được 100 lúc CHƯA thấy đơn -2 của mình → local phải ra 98
    expect((await dbx.products.get('p1'))!.stock).toBe(98)
    expect(await dbx.stocktakes.get('st1')).toBeTruthy()
  })

  it('debt.pay remote: thêm phiếu thu + trừ nợ; trùng id phiếu → bỏ qua', async () => { /* ... */ })
  it('gr.commit remote: cộng kho theo patches, chèn batch/priceLog GIỮ NGUYÊN id, đè cost theo grHlc LWW', async () => { /* ... */ })
  it('settings.set LWW theo meta hlc:settings', async () => { /* ... */ })
  it('note.upsert LWW + note.delete', async () => { /* ... */ })
})
```

Các case đánh dấu `/* ... */` phải viết ĐỦ khi thực thi — assert số cụ thể (stock, debt, totalSpent, orderCount) tính tay như case mẫu.

- [ ] **Step 2: Chạy fail** — `npx vitest run tests/apply.test.ts` → FAIL.

- [ ] **Step 3: Cài đặt `src/core/sync/apply.ts`**

```ts
/**
 * Reducer op-log v2 — áp op (remote hoặc replay) vào IndexedDB, idempotent.
 * Quy tắc trộn: spec 2026-08-14 mục 3.2-3.4.
 */
import { dbx } from '../db'
import { compareHlc } from './hlc'
import { observeRemoteHlc } from './engine'
import type {
  SyncOp, Sale, Product, Customer, DebtPayment, StocktakeRecord, Note,
  StockAdjustPayload, GrCommitPayload, SettingsSetPayload,
} from '../types'

const TABLES = () => [dbx.products, dbx.sales, dbx.customers, dbx.debtPayments,
  dbx.goodsReceipts, dbx.stockMoves, dbx.stocktakes, dbx.suppliers, dbx.batches,
  dbx.priceLog, dbx.notes, dbx.meta, dbx.appliedOps, dbx.syncQueue]

export async function applyOps(ops: SyncOp[]): Promise<number> {
  let applied = 0
  await dbx.transaction('rw', TABLES(), async () => {
    for (const op of ops) {
      if (await dbx.appliedOps.get(op.id)) continue
      await applyOne(op)
      await dbx.appliedOps.add({ id: op.id })
      applied += 1
    }
  })
  for (const op of ops) observeRemoteHlc(op.hlc)
  return applied
}

/** Tổng delta tồn của các op CÒN TRONG OUTBOX local cho 1 SP (quy tắc delta treo). */
export async function pendingStockDelta(productId: string): Promise<number> {
  const pending = await dbx.syncQueue.toArray()
  let d = 0
  for (const op of pending) {
    if (op.type === 'sale.commit') {
      const s = op.payload as Sale
      for (const it of s.items) if (it.productId === productId) d -= it.qty * it.unitRatio
    } else if (op.type === 'sale.void') {
      const { saleId } = op.payload as { saleId: string }
      const s = await dbx.sales.get(saleId)
      if (s) for (const it of s.items) if (it.productId === productId) d += it.qty * it.unitRatio
    } else if (op.type === 'stock.adjust') {
      const p = op.payload as StockAdjustPayload
      if (p.productId === productId) d += p.delta
    } else if (op.type === 'gr.commit') {
      const g = op.payload as GrCommitPayload
      for (const pt of g.patches) if (pt.productId === productId) d += pt.addQty
    }
  }
  return d
}

```

(Nợ khách KHÔNG cần hàm pending riêng: nhập snapshot replay op pending qua chính `applyOps` — Task 5 — nên delta nợ tự đúng.)

`applyOne(op)` — switch theo `op.type`, cài đủ 14 case theo spec 3.3. Code chuẩn cho các case chính (các case còn lại cùng khuôn):

```ts
async function applyOne(op: SyncOp): Promise<void> {
  switch (op.type) {
    case 'sale.commit': {
      const sale = op.payload as Sale
      if (await dbx.sales.get(sale.id)) return
      await dbx.sales.add(sale)
      for (const it of sale.items) {
        const p = await dbx.products.get(it.productId)
        if (!p) continue
        p.stock -= it.qty * it.unitRatio
        p.updatedAt = Date.now()
        await dbx.products.put(p)
        await dbx.stockMoves.add({
          id: 'mv_' + op.id + '_' + it.productId, productId: it.productId, type: 'sale',
          qty: -(it.qty * it.unitRatio), cost: it.cost, note: 'Bán: ' + it.name,
          refId: sale.id, date: sale.date, ts: Date.now(),
        })
      }
      if (sale.customerId) {
        const c = await dbx.customers.get(sale.customerId)
        if (c) {
          c.debt += sale.debtAmount || 0
          c.totalSpent += sale.total
          c.orderCount += 1
          c.updatedAt = Date.now()
          await dbx.customers.put(c)
        }
      }
      return
    }
    case 'sale.void': {
      // Sao logic voidSale (src/core/domain/sales.ts:156) — hoàn kho, stockMoves 'void_restore',
      // hoàn nợ + totalSpent/orderCount, đánh dấu voided. Đối chiếu tên trường thật khi cài.
      /* cài đầy đủ */
      return
    }
    case 'product.upsert': {
      const { product } = op.payload as { product: Omit<Product, 'stock' | 'batches'> }
      const cur = await dbx.products.get(product.id)
      if (cur?.hlc && compareHlc(op.hlc, cur.hlc) <= 0) return
      if (cur) await dbx.products.put({ ...cur, ...product, stock: cur.stock, batches: cur.batches, hlc: op.hlc })
      else await dbx.products.put({ ...(product as Product), stock: 0, batches: [], hlc: op.hlc })
      return
    }
    case 'stock.adjust': {
      const pl = op.payload as StockAdjustPayload
      const p = await dbx.products.get(pl.productId)
      if (!p) return
      p.stock += pl.delta
      p.updatedAt = Date.now()
      await dbx.products.put(p)
      await dbx.stockMoves.add({
        id: 'mv_' + op.id, productId: pl.productId, type: 'adjust', qty: pl.delta,
        cost: p.cost, note: pl.reason, refId: pl.refId ?? '', date: new Date().toISOString(), ts: Date.now(),
      })
      return
    }
    case 'stocktake.commit': {
      const rec = op.payload as StocktakeRecord
      if (!(await dbx.stocktakes.get(rec.id))) await dbx.stocktakes.add(rec)
      for (const row of rec.rows) {
        const p = await dbx.products.get(row.productId)
        if (!p) continue
        if (p.stockSetHlc && compareHlc(op.hlc, p.stockSetHlc) <= 0) continue
        const pending = await pendingStockDelta(row.productId)
        p.stock = row.actual + pending // set-then-delta: không nuốt op local chưa đẩy
        p.stockSetHlc = op.hlc
        p.updatedAt = Date.now()
        await dbx.products.put(p)
      }
      return
    }
    case 'debt.pay': {
      const dp = op.payload as DebtPayment
      if (await dbx.debtPayments.get(dp.id)) return
      await dbx.debtPayments.add(dp)
      const c = await dbx.customers.get(dp.customerId)
      if (c) { c.debt -= dp.amount; c.updatedAt = Date.now(); await dbx.customers.put(c) }
      return
    }
    case 'gr.commit': {
      const { gr, patches, supplierDelta } = op.payload as GrCommitPayload
      if (await dbx.goodsReceipts.get(gr.id)) return
      await dbx.goodsReceipts.add(gr)
      for (const pt of patches) {
        const p = await dbx.products.get(pt.productId)
        if (!p) continue
        p.stock += pt.addQty
        if (!p.grHlc || compareHlc(op.hlc, p.grHlc) > 0) {
          p.cost = pt.newCost
          if (pt.newPrice) p.price = pt.newPrice
          if (pt.expiry) p.expiry = pt.expiry
          p.grHlc = op.hlc
        }
        for (const b of pt.batches) {
          if (!(await dbx.batches.get(b.id))) {
            await dbx.batches.add(b)
            p.batches = [...(p.batches || []), b]
          }
        }
        p.updatedAt = Date.now()
        await dbx.products.put(p)
        for (const pl of pt.priceLogRows) if (!(await dbx.priceLog.get(pl.id))) await dbx.priceLog.add(pl)
        await dbx.stockMoves.add({
          id: 'mv_' + op.id + '_' + pt.productId, productId: pt.productId, type: 'purchase',
          qty: pt.addQty, cost: pt.newCost, note: 'Nhập: ' + gr.code, refId: gr.id, date: gr.date, ts: Date.now(),
        })
      }
      if (supplierDelta) {
        const sup = await dbx.suppliers.get(supplierDelta.supplierId)
        if (sup) {
          sup.debt += supplierDelta.debtDelta
          sup.totalPurchased += supplierDelta.purchasedDelta
          sup.orderCount += 1
          sup.updatedAt = Date.now()
          await dbx.suppliers.put(sup)
        }
      }
      return
    }
    case 'settings.set': {
      const { key, value } = op.payload as SettingsSetPayload
      const hlcKey = 'hlc:' + key
      const cur = await dbx.meta.get(hlcKey)
      if (cur && compareHlc(op.hlc, cur.value as string) <= 0) return
      await dbx.meta.put({ key, value })
      await dbx.meta.put({ key: hlcKey, value: op.hlc })
      return
    }
    case 'customer.upsert': {
      const { customer } = op.payload as { customer: Omit<Customer, 'debt' | 'totalSpent' | 'orderCount'> }
      const cur = await dbx.customers.get(customer.id)
      if (cur?.hlc && compareHlc(op.hlc, cur.hlc) <= 0) return
      if (cur) await dbx.customers.put({ ...cur, ...customer, debt: cur.debt, totalSpent: cur.totalSpent, orderCount: cur.orderCount, hlc: op.hlc })
      else await dbx.customers.put({ ...(customer as Customer), debt: 0, totalSpent: 0, orderCount: 0, hlc: op.hlc })
      return
    }
    case 'customer.delete': {
      const { customerId } = op.payload as { customerId: string }
      const cur = await dbx.customers.get(customerId)
      if (cur && (!cur.hlc || compareHlc(op.hlc, cur.hlc) > 0)) await dbx.customers.put({ ...cur, deleted: true, hlc: op.hlc })
      return
    }
    case 'product.delete': {
      const { productId } = op.payload as { productId: string }
      const cur = await dbx.products.get(productId)
      if (cur && (!cur.hlc || compareHlc(op.hlc, cur.hlc) > 0)) await dbx.products.put({ ...cur, deleted: true, hlc: op.hlc })
      return
    }
    case 'supplier.upsert': {
      // Cùng khuôn customer.upsert — strip debt/totalPurchased/orderCount, LWW theo hlc
      /* cài như customer.upsert với 3 trường delta của Supplier */
      return
    }
    case 'note.upsert': {
      const note = op.payload as Note
      const cur = await dbx.notes.get(note.id)
      if (cur?.hlc && compareHlc(op.hlc, cur.hlc) <= 0) return
      await dbx.notes.put({ ...note, hlc: op.hlc })
      return
    }
    case 'note.delete': {
      // Hard delete — notes là dữ liệu phụ, chấp nhận edge "op upsert cũ hồi sinh note" (spec ghi nhận)
      const { noteId } = op.payload as { noteId: string }
      await dbx.notes.delete(noteId)
      return
    }
  }
}
```

- [ ] **Step 4: Chạy test** — `npx vitest run tests/apply.test.ts` rồi `npm test` toàn bộ → PASS. `npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/sync/apply.ts tests/apply.test.ts
git commit -m "feat(sync): reducer applyOps idempotent — delta/LWW/immutable + quy tac delta treo"
```

---

### Task 4: Dời outbox vào domain layer (transaction-safe)

Nguyên tắc: op được ghi TRONG CÙNG transaction với mutation → không bao giờ có dữ liệu mà thiếu op hay ngược lại. Pages không gọi engine trực tiếp nữa.

**Files:**
- Modify: `src/core/domain/sales.ts` (`confirmSale` dòng ~107, `voidSale` dòng ~156)
- Modify: `src/core/domain/inventory.ts` (`addProduct` ~11, `updateProduct` ~56, `saveGoodsReceipt` ~119, `saveStocktake`; thêm `addSupplier`)
- Modify: `src/core/domain/customers.ts` (thêm `addCustomer`, `updateCustomer`, `payDebt`)
- Modify: `src/core/domain/notes.ts` (enqueue trong `addNote/toggleNoteDone/toggleNotePin/deleteNote`)
- Create: `src/core/domain/settings.ts` (`saveSettingsSynced`, `saveShopSynced`)
- Modify pages chuyển sang domain mới: `src/mobile/pages/CustomersPage.tsx` (handleAdd/handlePay), `src/mobile/pages/GoodsReceiptPage.tsx` (addSupplier ~109), `src/mobile/pages/SettingsPage.tsx` (~44)
- Test: `tests/outbox.test.ts`

**Interfaces:**
- Consumes: `makeOp/persistOp/enqueueOp` (Task 2).
- Produces:
  - `addCustomer(input: { name: string; phone: string; note: string; wholesale: boolean }): Promise<Customer>`
  - `updateCustomer(id: string, patch: Partial<Customer>): Promise<void>`
  - `payDebt(customerId: string, amount: number, note?: string): Promise<void>`
  - `addSupplier(input: { name: string; phone: string }): Promise<Supplier>`
  - `saveSettingsSynced(s: Settings): Promise<void>`, `saveShopSynced(shop: ShopInfo): Promise<void>`
  - Chữ ký các hàm sẵn có KHÔNG đổi.

- [ ] **Step 1: Viết test fail**

```ts
// tests/outbox.test.ts — case chính (viết đủ khi thực thi, cùng factory với tests/domain.test.ts)
it('confirmSale phát op sale.commit trong cùng transaction', async () => {
  /* seed product p1 vào dbx.products như tests/domain.test.ts */
  const result = await confirmSale({ items: [/* cart item p1 qty 2 */], products: [p1], discount: 0, payMethod: 'cash', tendered: 100000, wholesale: false })
  const ops = await dbx.syncQueue.toArray()
  expect(ops.map(o => o.type)).toContain('sale.commit')
  const op = ops.find(o => o.type === 'sale.commit')!
  expect((op.payload as Sale).id).toBe(result.sale.id)
  expect(await dbx.appliedOps.get(op.id)).toBeTruthy()
})

it('voidSale phát op sale.void', async () => { /* ... */ })

it('addProduct có tồn ban đầu → 2 op: product.upsert (KHÔNG stock) + stock.adjust init', async () => {
  await addProduct({ name: 'SP mới', cat: 'Khác', price: 5000, /* ... stock: 20 ... */ })
  const types = (await dbx.syncQueue.toArray()).map(o => o.type).sort()
  expect(types).toEqual(['product.upsert', 'stock.adjust'])
  const up = (await dbx.syncQueue.toArray()).find(o => o.type === 'product.upsert')!
  expect((up.payload as { product: Record<string, unknown> }).product.stock).toBeUndefined()
})

it('updateProduct đổi tồn → tách stock.adjust delta; record nhận hlc = op.hlc', async () => { /* ... */ })
it('payDebt: trừ nợ + phiếu thu + op debt.pay, atomic', async () => { /* ... */ })
it('saveGoodsReceipt phát gr.commit với patches mang batch id THẬT đã tạo', async () => { /* ... */ })
it('saveStocktake phát stocktake.commit + set stockSetHlc trên product', async () => { /* ... */ })
```

- [ ] **Step 2: Chạy fail** — `npx vitest run tests/outbox.test.ts` → FAIL.

- [ ] **Step 3: Sửa domain sales** — `confirmSale`: thêm `dbx.syncQueue, dbx.appliedOps` vào danh sách tables của transaction (dòng ~107), cuối callback thêm `await enqueueOp('sale.commit', sale)`. `voidSale`: tương tự với `enqueueOp('sale.void', { saleId, reason })`.

- [ ] **Step 4: Sửa domain inventory**
  - `addProduct`: bọc transaction `[dbx.products, dbx.syncQueue, dbx.appliedOps]`; tạo op TRƯỚC khi put để gán `p.hlc = op.hlc`:

```ts
const upsertOp = makeOp('product.upsert', null)
p.hlc = upsertOp.hlc
await dbx.products.add(p)
const { stock: _s, batches: _b, ...rest } = p
upsertOp.payload = { product: rest }
await persistOp(upsertOp)
if (p.stock > 0) await enqueueOp('stock.adjust', { productId: p.id, delta: p.stock, reason: 'init' })
```

  - `updateProduct(id, patch)`: tách `stock` khỏi patch; nếu stock đổi → `enqueueOp('stock.adjust', { productId: id, delta: newStock - p.stock, reason: 'edit' })`; phần còn lại upsert với `hlc = op.hlc` (khuôn như addProduct).
  - `saveGoodsReceipt`: trong transaction sẵn có (dòng ~148) — thêm `dbx.syncQueue, dbx.appliedOps` vào tables; tạo `const grOp = makeOp('gr.commit', null)` TRƯỚC vòng for; trong vòng for, sau khi tính xong mỗi SP, push vào mảng `patches` một `GrPatch` (`addQty`, `newCost: p.cost`, `newPrice`, `expiry: rowExp`, `batches: [batch]` nếu có, `priceLogRows: [row]`) và gán `p.grHlc = grOp.hlc` trước `put`; sau vòng for (vẫn trong tx): tính `supplierDelta` đúng theo logic nợ NCC hiện có trong hàm, rồi `grOp.payload = { gr, patches, supplierDelta }; await persistOp(grOp)`.
  - `saveStocktake`: khuôn như trên — `makeOp('stocktake.commit', record)` trước khi điều chỉnh tồn, gán `p.stockSetHlc = op.hlc` cho từng SP thay đổi, `persistOp` cuối tx.
  - Thêm `addSupplier(input)`: tạo Supplier (copy shape từ `GoodsReceiptPage.tsx:113-125`), transaction put + `enqueueOp('supplier.upsert', { supplier: rest })` (strip `debt/totalPurchased/orderCount`).

- [ ] **Step 5: Domain customers + settings + notes**
  - `customers.ts`: `addCustomer` (shape từ `CustomersPage.tsx:60-70`, gán `hlc = op.hlc`, strip 3 trường delta khi làm payload), `updateCustomer` (khuôn updateProduct), `payDebt` (chuyển nguyên logic `handlePay` `CustomersPage.tsx:82-100` vào transaction + `enqueueOp('debt.pay', dp)`).
  - `settings.ts` mới:

```ts
import { dbx, setMeta } from '../db'
import type { Settings, ShopInfo } from '../types'
import { enqueueOp } from '../sync/engine'

export async function saveSettingsSynced(s: Settings): Promise<void> {
  await dbx.transaction('rw', [dbx.meta, dbx.syncQueue, dbx.appliedOps], async () => {
    await setMeta('settings', s)
    const op = await enqueueOp('settings.set', { key: 'settings', value: s })
    await setMeta('hlc:settings', op.hlc)
  })
}
export async function saveShopSynced(shop: ShopInfo): Promise<void> {
  await dbx.transaction('rw', [dbx.meta, dbx.syncQueue, dbx.appliedOps], async () => {
    await setMeta('shop', shop)
    const op = await enqueueOp('settings.set', { key: 'shop', value: shop })
    await setMeta('hlc:shop', op.hlc)
  })
}
```

  - `notes.ts`: mỗi hàm mutate bọc transaction `[dbx.notes, dbx.syncQueue, dbx.appliedOps]` + `enqueueOp('note.upsert', noteSauMutate)` (gán `note.hlc = op.hlc`) hoặc `note.delete`.

- [ ] **Step 6: Pages gọi domain** — `CustomersPage` dùng `addCustomer/payDebt`; `GoodsReceiptPage.addSupplier` gọi domain `addSupplier`; `SettingsPage` đổi `saveSettings + enqueueSync` (đã xóa enqueue ở Task 2) thành `saveSettingsSynced`. Tìm nơi gọi `saveShop` (grep `saveShop(`) đổi sang `saveShopSynced`.

- [ ] **Step 7: Chạy toàn bộ** — `npm run typecheck && npm test` → PASS (chú ý test cũ của confirmSale/saveGoodsReceipt vẫn phải xanh — nếu test cũ đếm bảng thì cập nhật cho khớp hành vi mới là SAI, hành vi cũ không được đổi; chỉ THÊM op).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(sync): outbox chuyen vao domain transaction — moi mutation phat op atomic"
```

---

### Task 5: Snapshot — xuất/nhập toàn bộ state + delta treo

**Files:**
- Modify: `src/core/db.ts` (`BackupData` + `exportBackup` + `restoreBackup` dòng ~206-281)
- Create: `src/core/sync/snapshot.ts`
- Test: `tests/snapshot.test.ts`

**Interfaces:**
- Consumes: `exportBackup/restoreBackup` (db.ts), `applyOps` (Task 3), `observeRemoteHlc` (Task 2).
- Produces (Task 6 và Plan 3 dùng đúng tên này):
  - `interface SnapshotFile { backup: BackupData; hlc: string; deviceId: string; at: number }`
  - `interface SnapshotExport { snapshot: SnapshotFile; pendingOpIds: string[] }`
  - `exportSnapshot(): Promise<SnapshotExport>` — đọc state + danh sách op đang chờ trong MỘT transaction đọc (chống race: op chen giữa export và xoá outbox sẽ bị mất nếu không nguyên tử).
  - `importSnapshot(s: SnapshotFile): Promise<void>`

- [ ] **Step 1: Test fail**

```ts
// tests/snapshot.test.ts — case chính
it('exportSnapshot → wipe → importSnapshot khôi phục đủ bảng kể cả batches/priceLog/notes', async () => { /* seed đủ bảng, so sánh count + vài record */ })

it('importSnapshot KHÔNG nuốt op local chưa đẩy: op pending được áp lại lên snapshot', async () => {
  // 1. Seed p1 stock 10, snapshot tại đây (máy A đẩy snapshot lúc stock 10)
  // 2. Bán 2 (op sale.commit vào outbox, stock local 8)
  // 3. importSnapshot(snapshotCũ) — mô phỏng khôi phục máy
  // 4. stock phải là 8 (10 từ snapshot - 2 từ op pending replay), sale vẫn tồn tại, outbox vẫn còn op
})
```

- [ ] **Step 2: Chạy fail.**

- [ ] **Step 3: Mở rộng backup v5 trong db.ts** — `BackupData` thêm `batches?: ProductBatch[]`, `priceLog?: PriceLogEntry[]`, `notes?: Note[]`, `pricingRules?: PricingRule[]`, `quickAnswers?: QuickAnswer[]`; `version: 5`; `exportBackup` + `restoreBackup` thêm 5 bảng này vào đọc/clear/bulkPut (khuôn y hệt các bảng hiện có). `restoreBackup` KHÔNG đụng `syncQueue`/`appliedOps`/`meta.hlc:last` (giữ nguyên hành vi — chỉ thêm bảng mới).

- [ ] **Step 4: Cài `src/core/sync/snapshot.ts`**

```ts
/**
 * Snapshot = toàn bộ state để (a) backup cloud hằng ngày (mode SOLO),
 * (b) máy mới join lấy nền rồi replay op sau đó.
 * importSnapshot áp lại op pending trong outbox qua CHÍNH reducer applyOps
 * → mọi quy tắc idempotent/delta dùng chung một đường code.
 */
import { dbx, exportBackup, restoreBackup, type BackupData } from '../db'
import { getThisDeviceId } from '../domain/devices'
import { applyOps } from './apply'
import { observeRemoteHlc } from './engine'

export interface SnapshotFile { backup: BackupData; hlc: string; deviceId: string; at: number }
export interface SnapshotExport { snapshot: SnapshotFile; pendingOpIds: string[] }

/** Xuất state + danh sách op chờ NGUYÊN TỬ — op nào nằm trong pendingOpIds là ĐÃ gói vào snapshot. */
export async function exportSnapshot(): Promise<SnapshotExport> {
  const deviceId = await getThisDeviceId()
  return dbx.transaction('r', [dbx.products, dbx.sales, dbx.customers, dbx.debtPayments,
    dbx.goodsReceipts, dbx.stockMoves, dbx.stocktakes, dbx.suppliers, dbx.supplierPayments,
    dbx.users, dbx.purchaseOrders, dbx.invoices, dbx.batches, dbx.priceLog, dbx.notes,
    dbx.pricingRules, dbx.quickAnswers, dbx.meta, dbx.syncQueue], async () => {
    const backup = await exportBackup()
    const hlc = ((await dbx.meta.get('hlc:last'))?.value as string) ?? ''
    const pendingOpIds = (await dbx.syncQueue.toArray()).map((o) => o.id)
    return { snapshot: { backup, hlc, deviceId, at: Date.now() }, pendingOpIds }
  })
}

export async function importSnapshot(s: SnapshotFile): Promise<void> {
  const pending = await dbx.syncQueue.orderBy('createdAt').toArray()
  await restoreBackup(s.backup)
  // Xóa SẠCH appliedOps: dấu "đã áp" cũ thuộc về state cũ. Nếu giữ lại, op remote
  // mới hơn mốc snapshot sẽ bị bỏ qua khi pull lại → mất dữ liệu.
  await dbx.appliedOps.clear()
  // Áp lại op pending của chính máy này lên nền snapshot qua reducer chung —
  // applyOne tự bỏ qua record đã nằm sẵn trong snapshot (idempotent), và ghi lại appliedOps.
  await applyOps(pending)
  if (s.hlc) observeRemoteHlc(s.hlc)
}
```

Người gọi (Plan 3 — luồng join máy mới) chịu trách nhiệm set `meta 'sync:lastSeq' = upToSeq` của snapshot ngay sau `importSnapshot` rồi mới pull tiếp.

- [ ] **Step 5: Chạy toàn bộ** — `npm run typecheck && npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(sync): snapshot xuat/nhap + replay op pending qua reducer chung"
```

---

### Task 6: SyncTransport + mode machine + flush v2 + test hội tụ 2 máy

**Files:**
- Create: `src/core/sync/transport.ts`, `src/core/sync/mode.ts`
- Modify: `src/core/sync/engine.ts` (flushQueue v2 + handleServerMsg + setTransport)
- Test: `tests/mode.test.ts`, `tests/convergence.test.ts`

**Interfaces:**
- Consumes: `applyOps` (Task 3), `exportSnapshot/importSnapshot` (Task 5).
- Produces (Plan 3 sẽ implement `HttpTransport` theo đúng interface này):

```ts
// transport.ts
export interface PushResult { acked: string[]; seq: number }
export interface PullResult { ops: SyncOp[]; seq: number }
export type ServerMsg =
  | { t: 'bump'; seq: number }
  | { t: 'mode'; mode: 'solo' | 'sync'; peers: number }
  | { t: 'print'; job: unknown }
export interface SyncTransport {
  pushOps(ops: SyncOp[]): Promise<PushResult>
  pullOps(sinceSeq: number, limit?: number): Promise<PullResult>
  pushSnapshot(s: SnapshotFile, upToSeq: number): Promise<void>
  pullSnapshot(): Promise<{ snapshot: SnapshotFile; upToSeq: number } | null>
  connect(onMsg: (m: ServerMsg) => void): void
  disconnect(): void
}
export const nullTransport: SyncTransport = { /* mọi hàm no-op; pullOps trả { ops: [], seq: 0 } */ }
```

```ts
// mode.ts — thuần, không IO
export type SyncMode = 'local' | 'solo' | 'sync'
export interface FlushDecision { pushOps: boolean; pushSnapshot: boolean }
export function decideFlush(mode: SyncMode, outboxCount: number, lastSnapshotAt: number, now: number): FlushDecision
// local  → không đẩy gì
// sync   → pushOps khi outbox > 0
// solo   → pushSnapshot khi (outbox > 0 && now - lastSnapshotAt > 20h) hoặc outbox > 500
```

```ts
// engine.ts bổ sung
export function setTransport(t: SyncTransport): void
export function setSyncMode(m: SyncMode): void
export async function flushQueue(): Promise<void>
export function handleServerMsg(m: ServerMsg): void   // bump → pullSince; mode → setSyncMode + flush
```

- [ ] **Step 1: Test mode machine (fail trước)** — `tests/mode.test.ts`: bảng case cho `decideFlush` (local/sync/solo × outbox 0/1/501 × snapshot mới/cũ) — 8 assert cụ thể.

- [ ] **Step 2: Cài `mode.ts` + `transport.ts`** như interface trên → test mode PASS.

- [ ] **Step 3: flushQueue v2 trong engine.ts**

```ts
let transport: SyncTransport = nullTransport
let mode: SyncMode = 'local'

export function setTransport(t: SyncTransport): void { transport = t }
export function setSyncMode(m: SyncMode): void { mode = m }

export async function flushQueue(): Promise<void> {
  if (syncState.status === 'syncing') return
  if (!navigator.onLine) { setState({ status: 'offline' }); return }
  setState({ status: 'syncing', error: null })
  try {
    const outbox = await dbx.syncQueue.orderBy('createdAt').toArray()
    const lastSnapshotAt = await getMeta<number>('sync:lastSnapshotAt', 0)
    const d = decideFlush(mode, outbox.length, lastSnapshotAt, Date.now())

    if (d.pushOps) {
      for (let i = 0; i < outbox.length; i += 100) {
        const batch = outbox.slice(i, i + 100)
        const res = await transport.pushOps(batch)
        await dbx.syncQueue.bulkDelete(res.acked)
        await setMeta('sync:lastSeq', res.seq)
      }
    }
    if (d.pushSnapshot) {
      const exp = await exportSnapshot()
      const lastSeq = await getMeta<number>('sync:lastSeq', 0)
      await transport.pushSnapshot(exp.snapshot, lastSeq)
      // CHỈ xoá op đã gói trong snapshot (bắt nguyên tử lúc export) —
      // op chen vào sau đó ở lại queue, chờ snapshot sau. Chống mất dữ liệu.
      await dbx.syncQueue.bulkDelete(exp.pendingOpIds)
      await setMeta('sync:lastSnapshotAt', Date.now())
    }
    await pullSince()
    const remaining = await dbx.syncQueue.count()
    setState({ status: 'ok', lastSyncAt: Date.now(), pendingOps: remaining, error: null })
  } catch (e) {
    logError(e, 'sync.flush')
    setState({ status: 'error', error: e instanceof Error ? e.message : 'Lỗi đồng bộ' })
  }
}

async function pullSince(): Promise<void> {
  const since = await getMeta<number>('sync:lastSeq', 0)
  const res = await transport.pullOps(since, 500)
  if (res.ops.length > 0) await applyOps(res.ops)
  if (res.seq > since) await setMeta('sync:lastSeq', res.seq)
}

export function handleServerMsg(m: ServerMsg): void {
  if (m.t === 'bump') void pullSince()
  else if (m.t === 'mode') { setSyncMode(m.mode); void flushQueue() }
}
```

(Lưu ý import vòng: `apply.ts` import `observeRemoteHlc` từ engine, engine import `applyOps` từ apply — TS cho phép nếu chỉ dùng lúc runtime; nếu lint cấm, tách `observeRemoteHlc` sang `hlcRuntime.ts` nhỏ. Quyết định khi chạy lint.)

- [ ] **Step 4: Test hội tụ 2 máy (viết fail trước, đây là test VÀNG của Plan 1)**

```ts
// tests/convergence.test.ts — mô phỏng 2 máy tuần tự trên 1 process bằng wipe + snapshot
import { describe, it, expect, beforeEach } from 'vitest'
import { dbx } from '@/core/db'
import { initSyncEngine } from '@/core/sync/engine'
import { applyOps } from '@/core/sync/apply'
import { exportSnapshot, importSnapshot } from '@/core/sync/snapshot'
import type { SyncOp } from '@/core/types'

/** FakeTransport tối giản: log op dùng chung như DO + D1 */
function makeFakeLog() {
  const log: SyncOp[] = []
  return {
    push(ops: SyncOp[]) {
      for (const op of ops) if (!log.some((o) => o.id === op.id)) log.push(op)
      return log.length
    },
    since(seq: number) { return log.slice(seq) },
  }
}

/** Helper: clear MỌI bảng (kể cả syncQueue/appliedOps/meta) để mô phỏng máy khác */
async function wipeAllTables(): Promise<void> {
  await Promise.all(dbx.tables.map((t) => t.clear()))
}

it('máy A bán + nhập kho, máy B thu nợ — hai chiều hội tụ chính xác', async () => {
  const cloud = makeFakeLog()
  // ── Máy A ──
  /* seed p1 stock 10 + khách c1 nợ 0 QUA DOMAIN (addProduct/addCustomer) để sinh op */
  /* confirmSale bán 2 p1, tendered thiếu → ghi nợ 15000 cho c1 */
  const seqAtSnap = cloud.push(await dbx.syncQueue.toArray()) // A đẩy op, server ở seq này
  const snapA = (await exportSnapshot()).snapshot             // snapshot của A tương ứng upToSeq = seqAtSnap
  const expectedStock = (await dbx.products.get('p1'))!.stock // = 8
  const expectedDebt = (await dbx.customers.get('c1'))!.debt  // = 15000

  // ── Máy B (join mới, không snapshot: replay toàn bộ log từ 0 trên DB trống) ──
  await wipeAllTables()
  await initSyncEngine()
  await applyOps(cloud.since(0))
  expect((await dbx.products.get('p1'))!.stock).toBe(expectedStock)
  expect((await dbx.customers.get('c1'))!.debt).toBe(expectedDebt)

  // B thu nợ 10000 (qua payDebt) → đẩy op lên log
  /* payDebt('c1', 10000) */
  cloud.push(await dbx.syncQueue.toArray())

  // ── Máy A quay lại: khôi phục snapshot của MÌNH rồi pull từ upToSeq (KHÔNG từ 0 —
  // vì hiệu ứng các op ≤ seqAtSnap đã nằm trong snapshot; replay lại sẽ trừ kho đúp) ──
  await wipeAllTables()
  await initSyncEngine()
  await importSnapshot(snapA)
  await applyOps(cloud.since(seqAtSnap)) // chỉ op của B
  expect((await dbx.customers.get('c1'))!.debt).toBe(expectedDebt - 10000)
  expect((await dbx.products.get('p1'))!.stock).toBe(expectedStock)
})
```

Thêm case 2: kiểm kê ở "máy B" + đơn bán pending ở "máy A" → delta treo giữ đúng (tái dùng kịch bản test Task 3 nhưng qua đường flush/pull đầy đủ).

- [ ] **Step 5: Chạy toàn bộ** — `npm run typecheck && npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(sync): SyncTransport + mode SOLO/SYNC + flush v2, test hoi tu 2 may"
```

---

### Task 7: Hồi quy toàn cục + tài liệu

**Files:**
- Modify: `README.md` (mục kiến trúc sync — mô tả op-log v2, trỏ tới spec)
- Không code mới.

- [ ] **Step 1:** `npm run typecheck && npm test && npm run lint` → tất cả PASS, sửa nốt lint nếu có.
- [ ] **Step 2:** `npm run build:all` → build web + mobile thành công.
- [ ] **Step 3:** Smoke thủ công bằng `npm run dev`: bán 1 đơn, nhập 1 phiếu, thu nợ, kiểm kê — DevTools → IndexedDB thấy `syncQueue` có op tương ứng, `appliedOps` có id; app offline (DevTools Network offline) vẫn bán bình thường.
- [ ] **Step 4:** Cập nhật README.md: 5-10 dòng mô tả op-log v2 + link `docs/superpowers/specs/2026-08-14-3su-cloud-sync-design.md`.
- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: kien truc sync op-log v2 + tro toi spec"
```

**Định nghĩa hoàn thành Plan 1:** toàn bộ test xanh; app chạy offline thuần y như trước; mọi mutation nghiệp vụ sinh op trong outbox atomic; `applyOps` + `importSnapshot` sẵn sàng cho Plan 2/3; Firestore adapter không còn trong codebase.

**Sau Plan 1:** dùng skill `writing-plans` viết Plan 2 (server `3su-cloud`) theo spec mục 4-5.
