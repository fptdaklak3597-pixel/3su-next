# Correctness Bugfix Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the verified correctness bugs (Dexie meta-in-txn, wholesale price, PWA auto-reload, type-scale, barcode camera leak, deleteNote race, canonical replay gaps, restore authoritative tables, GR cost dedupe, note search accents) with TDD.

**Architecture:** Small, isolated root-cause fixes. Authoritative flag is RAM-cached and warmed at sync init so `enqueueOp` never touches `dbx.meta` inside domain transactions. Processor wholesale + event replay stay pure TS. PWA exposes update state + idle auto-apply (banner always; auto after 30s idle). UI/CSS/camera are local surgical edits.

**Tech Stack:** TypeScript, Dexie, Vitest, React, Service Worker (`SKIP_WAITING`).

## Global Constraints

- Spec: `3su-next/docs/superpowers/specs/2026-08-21-correctness-bugfix-design.md`
- Prefer `3su-next/` paths; mirror wholesale stub in `3su-cloud/src/commands/processor.ts` when identical.
- Identifier English; comments Vietnamese where the file already uses Vietnamese.
- No broad authoritative rewrite; no POS checkout redesign beyond update banner.
- Do not commit unless the user asks.
- Every task: RED test → GREEN minimal fix → verify.

## File map

| File | Role |
|------|------|
| `3su-next/src/core/authoritative/flag.ts` | RAM cache + warm/set for authoritative flag |
| `3su-next/src/core/sync/engine.ts` | Warm flag cache in `initSyncEngine`; `enqueueOp` uses cache-only read |
| `3su-next/src/core/authoritative/processor.ts` | Wholesale price, GR cost, `applyCanonicalEvent` |
| `3su-cloud/src/commands/processor.ts` | Same wholesale + GR cost stub if present |
| `3su-next/src/core/db-core.ts` | Clear authoritative tables on `restoreLocalBackup` |
| `3su-next/src/core/domain/notes.ts` | `deleteNote` get-in-txn; `filterNotes` + `matchesSearch` |
| `3su-next/src/web/theme.css` | `.web-note-badge` → 11px |
| `3su-next/src/web/pages/ProductDetailPage.tsx` | Cancel flag for barcode scan |
| `3su-next/src/shared/pwa.ts` | Update available API + idle auto-apply + leak-safe listeners |
| `3su-next/src/shared/components.tsx` | `SwUpdateBanner` |
| `3su-next/src/web/App.tsx`, `3su-next/src/mobile/App.tsx` | Mount banner; wire idle signals |
| Tests under `3su-next/tests/` | One focused suite / cases per task |

---

### Task 1: Authoritative flag RAM cache

**Files:**
- Modify: `3su-next/src/core/authoritative/flag.ts`
- Modify: `3su-next/src/core/sync/engine.ts` (`initSyncEngine`, `enqueueOp`)
- Test: `3su-next/tests/authoritative-flag-cache.test.ts` (create)

**Interfaces:**
- Produces:
  - `warmAuthoritativeMoneyStockCache(): Promise<boolean>`
  - `getAuthoritativeMoneyStockCached(): boolean` (sync, no Dexie)
  - `isAuthoritativeMoneyStockEnabled(): Promise<boolean>` (uses/fills cache)
  - `setAuthoritativeMoneyStockEnabled(on: boolean): Promise<void>` (writes meta + cache)
  - `resetAuthoritativeMoneyStockCacheForTests(): void`
- Consumes: `getMeta` / `setMeta` from `../db` only outside domain txns

- [ ] **Step 1: Write the failing test**

```typescript
import { beforeEach, describe, expect, it } from 'vitest'
import { dbx, setMeta } from '@/core/db'
import {
  getAuthoritativeMoneyStockCached,
  resetAuthoritativeMoneyStockCacheForTests,
  setAuthoritativeMoneyStockEnabled,
  warmAuthoritativeMoneyStockCache,
} from '@/core/authoritative/flag'
import { enqueueOp, initSyncEngine } from '@/core/sync/engine'

describe('authoritative flag cache', () => {
  beforeEach(async () => {
    resetAuthoritativeMoneyStockCacheForTests()
    await dbx.meta.clear()
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
    await dbx.products.clear()
    await initSyncEngine({ deviceId: 'test-dev' })
  })

  it('enqueueOp trong txn không có meta vẫn OK khi flag đã warm', async () => {
    await setAuthoritativeMoneyStockEnabled(false)
    await warmAuthoritativeMoneyStockCache()
    expect(getAuthoritativeMoneyStockCached()).toBe(false)

    await dbx.transaction('rw', [dbx.products, dbx.syncQueue, dbx.appliedOps], async () => {
      await enqueueOp('product.upsert', { product: { id: 'p1' } })
    })
    expect(await dbx.syncQueue.count()).toBe(1)
  })

  it('set flag cập nhật cache sync', async () => {
    await setAuthoritativeMoneyStockEnabled(true)
    expect(getAuthoritativeMoneyStockCached()).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `3su-next`:

```bash
npm test -- tests/authoritative-flag-cache.test.ts
```

Expected: FAIL (exports / cache behavior missing, or Dexie NotFoundError on meta).

- [ ] **Step 3: Minimal implementation**

In `flag.ts`: module-level `cached: boolean | null = null`; implement warm/get/set/reset as above.  
In `enqueueOp`: call `getAuthoritativeMoneyStockCached()` (never `await isAuthoritativeMoneyStockEnabled()`).  
In `initSyncEngine`: `await warmAuthoritativeMoneyStockCache()`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/authoritative-flag-cache.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit only if user asks**

---

### Task 2: Wholesale unit price in processor

**Files:**
- Modify: `3su-next/src/core/authoritative/processor.ts` (`ProcessorProduct`, `processSaleCreate` unit price)
- Modify: `3su-cloud/src/commands/processor.ts` (same stub line if identical)
- Test: `3su-next/tests/authoritative/processor.test.ts` (extend)

**Interfaces:**
- Consumes: `processCommand`, `emptyShopState`, `ProcessorProduct`
- Produces: `ProcessorProduct.wholesalePrice?: number`

- [ ] **Step 1: Write the failing test**

Add to `processor.test.ts`:

```typescript
it('wholesale: true dùng wholesalePrice khi > 0', async () => {
  let state = seed(5)
  state.products.p1.price = 10000
  state.products.p1.wholesalePrice = 8000
  const out = await processCommand(
    state,
    saleCmd('cmd_ws', 1, { wholesale: true }),
  )
  expect(out.result.status).toBe('accepted')
  const sale = Object.values(out.state.sales)[0]
  expect(sale.items[0].price).toBe(8000)
  expect(sale.total).toBe(8000)
})

it('wholesale: true nhưng wholesalePrice=0 → giá lẻ', async () => {
  let state = seed(5)
  state.products.p1.price = 10000
  state.products.p1.wholesalePrice = 0
  const out = await processCommand(
    state,
    saleCmd('cmd_ws0', 1, { wholesale: true }),
  )
  expect(out.result.status).toBe('accepted')
  expect(Object.values(out.state.sales)[0].items[0].price).toBe(10000)
})
```

Update `baseProduct` helper to allow `wholesalePrice` on the type.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/authoritative/processor.test.ts
```

Expected: FAIL — item price still 10000 when wholesalePrice is 8000.

- [ ] **Step 3: Minimal implementation**

```typescript
// ProcessorProduct
wholesalePrice?: number

// processSaleCreate
const base =
  payload.wholesale && (p.wholesalePrice ?? 0) > 0
    ? p.wholesalePrice!
    : p.price
const unitPrice = base * ratio
```

Mirror in `3su-cloud/src/commands/processor.ts`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/authoritative/processor.test.ts
```

Expected: PASS

---

### Task 3: Goods receipt single weighted-average cost

**Files:**
- Modify: `3su-next/src/core/authoritative/processor.ts` (`processGoodsReceipt`)
- Modify: `3su-cloud/src/commands/processor.ts` if duplicate
- Test: `3su-next/tests/authoritative/processor.test.ts` (extend)

**Interfaces:**
- Consumes: `processCommand` with `goodsReceipt.create` (check contracts for exact type string)

- [ ] **Step 1: Discover exact command type + write failing test**

Grep `goodsReceipt` / `gr.create` in `contracts.ts` and existing tests. Then add:

```typescript
it('GR cập nhật cost bình quân gia quyền một lần', async () => {
  let state = seed(0)
  state.products.p1.stock = 10
  state.products.p1.cost = 1000
  // build valid goodsReceipt command with qty 10 unit chai, purchasePrice 2000
  const out = await processCommand(state, grCmd)
  expect(out.result.status).toBe('accepted')
  expect(state.products.p1 /* use out.state */.cost).toBe(1500)
})
```

Use the same payload shape as `processGoodsReceipt` expects. Expected cost: `(10*1000 + 10*2000) / 20 = 1500` when `ratio === 1`.

- [ ] **Step 2: Run — expect fail or pass with messy code still giving 1500**

If current second assignment already yields 1500, assert via source contract or keep behavioral test and still delete dead first assignment in Step 3.

- [ ] **Step 3: Keep only**

```typescript
const purchasePerBase = row.purchasePrice / ratio
p.cost =
  oldStock + baseQty > 0
    ? (oldStock * oldCost + baseQty * purchasePerBase) / (oldStock + baseQty)
    : purchasePerBase
```

Remove first `p.cost = ...`, remove `lineCost` / `baseUnitCost` / `void` lines.

- [ ] **Step 4: Re-run test — PASS**

---

### Task 4: `applyCanonicalEvent` full replay

**Files:**
- Modify: `3su-next/src/core/authoritative/processor.ts` (`applyCanonicalEvent`)
- Test: `3su-next/tests/authoritative/processor-replay.test.ts` (create)

**Interfaces:**
- Consumes: `applyCanonicalEvent`, `CanonicalEvent`, `emptyShopState`
- Produces: updated stock/balances/sales/receipts for void / GR / payment

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import {
  applyCanonicalEvent,
  emptyShopState,
  type CanonicalEvent,
  type ProcessorSale,
  type ProcessorGoodsReceipt,
} from '@/core/authoritative/processor'

function ev(partial: Partial<CanonicalEvent> & Pick<CanonicalEvent, 'type' | 'payload'>): CanonicalEvent {
  return {
    id: partial.id ?? `ev_${partial.type}`,
    shopId: 'shop_1',
    seq: partial.seq ?? 1,
    commandId: partial.commandId ?? 'cmd_1',
    type: partial.type,
    occurredAt: '2026-08-20T10:00:00.000Z',
    committedAt: '2026-08-20T10:00:01.000Z',
    payload: partial.payload,
  }
}

describe('applyCanonicalEvent replay', () => {
  it('SaleVoided hoàn kho và giảm balance nợ', () => {
    const state = emptyShopState('shop_1')
    state.products.p1 = {
      id: 'p1', name: 'SP', price: 10, cost: 4, stock: 0, unit: 'cái', units: [],
    }
    state.customers.c1 = { id: 'c1', name: 'K', balance: 5000 }
    const sale: ProcessorSale = {
      id: 's1', commandId: 'cmd_s', items: [
        { productId: 'p1', name: 'SP', qty: 1, unitName: 'cái', unitRatio: 1, price: 5000, cost: 4 },
      ],
      total: 5000, profit: 0, discount: 0, payMethod: 'debt', debtAmount: 5000,
      customerId: 'c1', occurredAt: '2026-08-20T10:00:00.000Z',
    }
    state.sales.s1 = sale
    const next = applyCanonicalEvent(state, ev({
      type: 'SaleVoided', seq: 2, payload: { saleId: 's1' },
    }))
    expect(next.sales.s1.voided).toBe(true)
    expect(next.products.p1.stock).toBe(1)
    expect(next.customers.c1.balance).toBe(0)
  })

  it('GoodsReceiptCommitted tăng stock khi receipt chưa có', () => {
    const state = emptyShopState('shop_1')
    state.products.p1 = {
      id: 'p1', name: 'SP', price: 10, cost: 0, stock: 0, unit: 'cái', units: [],
    }
    const gr: ProcessorGoodsReceipt = {
      id: 'gr1', commandId: 'cmd_g', rows: [
        { productId: 'p1', name: 'SP', qty: 5, unitName: 'cái', unitRatio: 1, purchasePrice: 1000 },
      ],
      paid: 5000, payMethod: 'cash', occurredAt: '2026-08-20T10:00:00.000Z',
    }
    const next = applyCanonicalEvent(state, ev({
      type: 'GoodsReceiptCommitted', seq: 1, payload: gr,
    }))
    expect(next.receipts.gr1).toBeTruthy()
    expect(next.products.p1.stock).toBe(5)
    expect(next.products.p1.cost).toBe(1000)
  })

  it('CustomerPaymentRecorded giảm balance', () => {
    const state = emptyShopState('shop_1')
    state.customers.c1 = { id: 'c1', name: 'K', balance: 9000 }
    const next = applyCanonicalEvent(state, ev({
      type: 'CustomerPaymentRecorded',
      seq: 1,
      payload: { customerId: 'c1', amount: 3000 },
    }))
    expect(next.customers.c1.balance).toBe(6000)
  })
})
```

Adjust `CanonicalEvent` / `ProcessorSale` fields to match real types in `contracts.ts` / `processor.ts` if the stubs above miss required fields.

- [ ] **Step 2: Run — FAIL** (void/GR/payment no-ops today)

```bash
npm test -- tests/authoritative/processor-replay.test.ts
```

- [ ] **Step 3: Implement branches in `applyCanonicalEvent`**

Mirror `processSaleVoid` / `processGoodsReceipt` / `processCustomerPayment` effects, idempotent:

- `SaleVoided`: if sale exists and not voided → void, restore stock, reduce customer balance by `debtAmount`
- `GoodsReceiptCommitted`: if `!draft.receipts[gr.id]` → apply stock/cost/supplier like process path, store receipt
- `CustomerPaymentRecorded`: subtract `amount` from customer balance (skip if already applied via event id)

Keep existing `SaleCommitted` behavior. Advance `seq`, push event, mark `appliedEventIds`.

- [ ] **Step 4: Run — PASS**

Also re-run `tests/authoritative/processor.test.ts`.

---

### Task 5: Clear authoritative tables on local restore

**Files:**
- Modify: `3su-next/src/core/db-core.ts` (`restoreLocalBackup`)
- Test: `3su-next/tests/backup-credential-safety.test.ts` (extend) or create `tests/restore-authoritative-clear.test.ts`

**Interfaces:**
- Consumes: `restoreLocalBackup`, `dbx.commandQueue` / `commandResults` / `canonicalEvents` / `syncConflicts`

- [ ] **Step 1: Write failing test**

```typescript
it('restoreLocalBackup xóa commandQueue / results / events / syncConflicts', async () => {
  await dbx.commandQueue.put({
    id: 'q1', type: 'sale.create', createdAt: 1, status: 'pending',
    // fill required QueuedCommand fields from type
  } as any)
  await dbx.commandResults.put({ commandId: 'q1', status: 'accepted', events: [] } as any)
  await dbx.canonicalEvents.put({
    id: 'e1', shopId: 's', seq: 1, commandId: 'q1', type: 'SaleCommitted',
    occurredAt: '', committedAt: '', payload: {},
  } as any)
  await dbx.syncConflicts.put({ id: 'c1', commandId: 'q1', createdAt: 1 } as any)

  await restoreLocalBackup(backup({ products: [product()] }))

  expect(await dbx.commandQueue.count()).toBe(0)
  expect(await dbx.commandResults.count()).toBe(0)
  expect(await dbx.canonicalEvents.count()).toBe(0)
  expect(await dbx.syncConflicts.count()).toBe(0)
})
```

Use real `QueuedCommand` / `SyncConflictRow` shapes from imports (no `as any` if avoidable).

- [ ] **Step 2: Run — FAIL** (rows still present)

- [ ] **Step 3: In `restoreLocalBackup` transaction**, add the four tables to the Dexie store list and `.clear()` each.

- [ ] **Step 4: Run — PASS**

---

### Task 6: Type-scale badge floor

**Files:**
- Modify: `3su-next/src/web/theme.css` (`.web-note-badge` ~line 2301)
- Test: `3su-next/tests/type-scale.test.ts` (existing)

- [ ] **Step 1: Run existing test to confirm RED**

```bash
npm test -- tests/type-scale.test.ts
```

Expected: FAIL mentioning size `< 11` or half-pixel (`10.5`).

- [ ] **Step 2: Change** `font-size: 10.5px` → `font-size: 11px`

- [ ] **Step 3: Run — PASS**

---

### Task 7: Note search via `matchesSearch`

**Files:**
- Modify: `3su-next/src/core/domain/notes.ts` (`filterNotes`)
- Test: `3su-next/tests/notes.test.ts`

**Interfaces:**
- Consumes: `matchesSearch` from `@/core/format`

- [ ] **Step 1: Extend failing assertion**

In `filterNotes theo seg và query`:

```typescript
expect(filterNotes(list, { query: 'gao' }).map((n) => n.id)).toEqual(['a'])
```

(`a` text is `Mua gạo`)

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3:**

```typescript
import { matchesSearch } from '@/core/format'
// ...
if (q && !matchesSearch(n.text, q)) return false
```

Keep `const q = (opts.query || '').trim().toLowerCase()` or pass raw trim — `matchesSearch` trims/normalizes internally; empty query must still mean “no text filter”. Prefer:

```typescript
const q = (opts.query || '').trim()
// ...
if (q && !matchesSearch(n.text, q)) return false
```

- [ ] **Step 4: Run `npm test -- tests/notes.test.ts` — PASS**

---

### Task 8: `deleteNote` read inside transaction

**Files:**
- Modify: `3su-next/src/core/domain/notes.ts` (`deleteNote`)
- Test: `3su-next/tests/notes.test.ts` (extend with Dexie case)

- [ ] **Step 1: Failing behavioral test**

```typescript
import { deleteNote, addNote } from '@/core/domain/notes'

it('deleteNote soft-delete trong txn (đọc lại bản mới nhất)', async () => {
  initSyncEngine({ deviceId: 'test-dev' })
  await dbx.notes.clear()
  await dbx.syncQueue.clear()
  await dbx.appliedOps.clear()
  const n = await addNote('Xóa tôi', 'note')
  await dbx.notes.update(n.id, { pinned: true })
  await deleteNote(n.id)
  const got = await dbx.notes.get(n.id)
  expect(got?.deleted).toBe(true)
  expect(got?.pinned).toBe(true) // must not wipe concurrent field from stale outer snapshot
})
```

Today outer `get` then put `{...n, deleted}` can drop `pinned` if `n` was stale — this test locks “read latest inside txn”.

- [ ] **Step 2: Run — may FAIL if outer snapshot loses pinned**

If current race doesn’t fail in single-threaded test, still move `get` inside txn in Step 3 (structural fix); keep test as regression.

- [ ] **Step 3:**

```typescript
export async function deleteNote(id: string): Promise<void> {
  await dbx.transaction('rw', [dbx.notes, dbx.syncQueue, dbx.appliedOps], async () => {
    const n = await dbx.notes.get(id)
    if (!n) return
    const op = makeOp('note.delete', { noteId: id })
    await dbx.notes.put({ ...n, deleted: true, deletedHlc: op.hlc, hlc: op.hlc })
    await persistOp(op)
  })
  requestFlush()
}
```

- [ ] **Step 4: PASS**

---

### Task 9: Barcode scan cancel before open

**Files:**
- Modify: `3su-next/src/web/pages/ProductDetailPage.tsx` (`handleScanBarcode` + close handlers)
- Optional extract for test: `3su-next/src/core/browser/barcodeSession.ts` + `tests/barcode-session.test.ts`

**Interfaces:**
- Produces (if extracted):

```typescript
export type ScanSession = {
  cancelled: boolean
  cancel: () => void
  adopt: (handle: { cancel: () => void }) => void
}
export function createScanSession(): ScanSession
```

- [ ] **Step 1: Prefer extract + unit test**

```typescript
it('cancel trước adopt → adopt gọi handle.cancel', () => {
  const s = createScanSession()
  s.cancel()
  let cancelled = false
  s.adopt({ cancel: () => { cancelled = true } })
  expect(cancelled).toBe(true)
})
```

- [ ] **Step 2: RED then implement `createScanSession`**

- [ ] **Step 3: Wire ProductDetailPage**

```typescript
const sessionRef = useRef(createScanSession())
// on open: sessionRef.current = createScanSession(); setScanOpen(true)
// on close: sessionRef.current.cancel(); scanRef.current?.cancel(); setScanOpen(false)
// after createBarcodeScan: sessionRef.current.adopt(handle); if session cancelled return
```

- [ ] **Step 4: PASS unit test**

---

### Task 10: PWA update banner + 30s idle auto-apply

**Files:**
- Modify: `3su-next/src/shared/pwa.ts`
- Modify: `3su-next/src/shared/components.tsx` (banner)
- Modify: `3su-next/src/web/App.tsx`, `3su-next/src/mobile/App.tsx`
- Test: `3su-next/tests/pwa-update-idle.test.ts` (create)

**Interfaces:**
- Produces:

```typescript
export type SwUpdateIdleInput = {
  pathname: string
  cartCount: number
  scanOpen: boolean
}

export function isSwUpdateIdle(input: SwUpdateIdleInput): boolean
// true when pathname !== '/ban-hang' && cartCount === 0 && !scanOpen

export function useServiceWorkerUpdate(options?: {
  isIdle?: () => boolean
  idleMs?: number // default 30_000
}): {
  updateAvailable: boolean
  applyUpdate: () => void
}
```

- [ ] **Step 1: Pure idle tests**

```typescript
import { describe, expect, it } from 'vitest'
import { isSwUpdateIdle } from '@/shared/pwa'

describe('isSwUpdateIdle', () => {
  it('false trên /ban-hang', () => {
    expect(isSwUpdateIdle({ pathname: '/ban-hang', cartCount: 0, scanOpen: false })).toBe(false)
  })
  it('false khi còn giỏ', () => {
    expect(isSwUpdateIdle({ pathname: '/kho', cartCount: 2, scanOpen: false })).toBe(false)
  })
  it('false khi đang quét mã', () => {
    expect(isSwUpdateIdle({ pathname: '/kho', cartCount: 0, scanOpen: true })).toBe(false)
  })
  it('true khi ngoài bán hàng, giỏ trống, không scan', () => {
    expect(isSwUpdateIdle({ pathname: '/kho', cartCount: 0, scanOpen: false })).toBe(true)
  })
})
```

- [ ] **Step 2: RED then implement `isSwUpdateIdle`**

- [ ] **Step 3: Refactor `useServiceWorkerUpdate`**

Behavior:
1. Register SW; on `updatefound` / `waiting` → set `updateAvailable=true` — **do not** `SKIP_WAITING` yet (except first load with no `controller`).
2. `applyUpdate()` → `SKIP_WAITING` + reload on `controllerchange`.
3. While `updateAvailable`, if `isIdle()` stays true for `idleMs` (default 30000), call `applyUpdate()`.
4. Fix leak: keep `cancelled` flag; in `.then`, if cancelled skip adding listeners; cleanup clears interval + removes whatever was added.

- [ ] **Step 4: `SwUpdateBanner`**

In `components.tsx`: when `updateAvailable`, show bar “Có bản mới” + button “Cập nhật” calling `applyUpdate`. Mount in web + mobile `App` next to `OfflineBar`.

Wire idle:

```typescript
const cart = useApp(s => s.cart)
const loc = useLocation()
useServiceWorkerUpdate({
  isIdle: () => isSwUpdateIdle({
    pathname: loc.pathname,
    cartCount: cart.length,
    scanOpen: false, // ProductDetail can set a tiny module flag later if needed; default false OK for v1
  }),
})
```

Optional v1: export `setBarcodeScanBusy(boolean)` from `pwa.ts` for ProductDetailPage to flip during scan — include if Task 9 is done.

- [ ] **Step 5: Run idle tests + smoke typecheck**

```bash
npm test -- tests/pwa-update-idle.test.ts
npm run typecheck
```

---

### Task 11: Final verification

- [ ] **Step 1: Run focused suites**

```bash
npm test -- tests/authoritative-flag-cache.test.ts tests/authoritative/processor.test.ts tests/authoritative/processor-replay.test.ts tests/notes.test.ts tests/type-scale.test.ts tests/pwa-update-idle.test.ts tests/backup-credential-safety.test.ts
```

(Include restore test path if separate file.)

- [ ] **Step 2: Full suite**

```bash
npm test
```

Expected: all PASS.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| Flag cache / no meta in txn | 1 |
| Wholesale price | 2 |
| GR single cost formula | 3 |
| applyCanonicalEvent void/GR/payment | 4 |
| restore clears authoritative tables | 5 |
| type-scale 11px | 6 |
| matchesSearch notes | 7 |
| deleteNote get in txn | 8 |
| barcode cancel | 9 |
| PWA banner + 30s idle | 10 |
| Final verify | 11 |

## Self-review notes

- No TBD placeholders in task steps.
- Cloud wholesale/GR mirror only when stub matches.
- Commit steps deferred to user request (repo rule).
