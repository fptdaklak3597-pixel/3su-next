# Correctness bugfix batch — Design

Date: 2026-08-21  
Scope: `3su-next` (+ cloud processor mirror where the same wholesale stub exists)  
Approach: Option 1 — fix each verified root cause with TDD; PWA update UX = banner + auto after 30s idle (option C).

## Goals

- Stop Dexie transaction rollbacks when `enqueueOp` reads the authoritative flag.
- Charge wholesale sales at wholesale price in the authoritative processor.
- Stop unconditional SW reload from wiping in-progress POS carts; allow confirm + idle auto-update.
- Pass type-scale floor (≥ 11px, no half-pixels) for `.web-note-badge`.
- Release barcode camera if the modal closes before scan starts.
- Soft-delete notes from a consistent in-transaction read.
- Replay `SaleVoided`, `GoodsReceiptCommitted`, and `CustomerPaymentRecorded` in `applyCanonicalEvent`.
- Clear authoritative queue/event tables on local backup restore.
- One weighted-average cost formula on goods receipt; Vietnamese accent-insensitive note search.

## Non-goals

- Broad authoritative-mode rewrite or new sync architecture.
- POS checkout UX changes beyond the update banner.
- Changing legacy `confirmSale` pricing (already correct via `cartUnitPrice`).

## Fixes

### 1. Authoritative flag outside Dexie txn scope

**Root cause:** `enqueueOp` → `isAuthoritativeMoneyStockEnabled()` → `getMeta` → `dbx.meta`. Callers like `voidSale` / `payDebt` open transactions without `dbx.meta` → Dexie `NotFoundError` → full rollback.

**Fix:** Keep an in-memory cache of the flag in `flag.ts`. `isAuthoritativeMoneyStockEnabled()` returns the cache after first load; `setAuthoritativeMoneyStockEnabled` updates cache + meta. No meta table access from inside unrelated domain transactions.

### 2. Wholesale unit price

**Root cause:** Both ternary branches use `p.price * ratio`.

**Fix:** Add `wholesalePrice?: number` to `ProcessorProduct`.  
`unitPrice = (payload.wholesale && (p.wholesalePrice ?? 0) > 0 ? p.wholesalePrice! : p.price) * ratio`  
(same rule as legacy `cartUnitPrice`). Mirror the same change in `3su-cloud/src/commands/processor.ts` if the stub is identical.

### 3. PWA update (option C)

**Root cause:** `useServiceWorkerUpdate` always `SKIP_WAITING` + `location.reload()`; listeners registered in `.then()` after unmount can leak.

**Fix:**
- Detect waiting worker → set `updateAvailable` (do not activate yet).
- UI banner: “Có bản mới” + button “Cập nhật” → `applyUpdate()` (`SKIP_WAITING` + reload on `controllerchange`).
- Idle auto-apply after **30s** when all hold: pathname is not `/ban-hang` (web) / mobile sale equivalent; `useApp` cart length is 0; no barcode-scan modal open (local page state or a tiny shared “busy” flag if needed).
- Register/remove listeners safely relative to mount lifecycle (abort or sync registration so cleanup always removes what was added).
- First install / no controller may still activate once so the app can load offline.

### 4. Type-scale

`.web-note-badge { font-size: 11px; }` (was `10.5px`).

### 5. Barcode camera race

In `handleScanBarcode`, use a local `cancelled` flag (or Abort pattern). On modal close, set cancelled and call `scanRef.current?.cancel()`. After `createBarcodeScan` resolves, if cancelled then `handle.cancel()` and do not attach video.

### 6. `deleteNote` race

Move `dbx.notes.get(id)` inside the existing write transaction before soft-delete put.

### 7. Canonical event replay

Extend `applyCanonicalEvent` for rebuild/reconnect paths (idempotent by event id / sale-or-receipt already applied):

| Event | Effect when entity not yet applied |
|-------|--------------------------------------|
| `SaleCommitted` | (existing) add sale, −stock, +customer debt |
| `SaleVoided` | mark sale voided, +stock from items, −customer balance if debt |
| `GoodsReceiptCommitted` | store receipt, +stock, weighted cost, +supplier balance if owed |
| `CustomerPaymentRecorded` | −customer balance by payment amount |

Ignore unknown types after marking seen / advancing seq as today.

### 8. Local backup restore

In `restoreLocalBackup`, after existing sync clears, also:

- `dbx.commandQueue.clear()`
- `dbx.commandResults.clear()`
- `dbx.canonicalEvents.clear()`
- `dbx.syncConflicts.clear()`

so offline authoritative commands cannot overwrite restored data.

### 9. Goods receipt cost

Single assignment:

`p.cost = (oldStock * oldCost + baseQty * (row.purchasePrice / ratio)) / newStock` when `newStock > 0`.

Remove dead first formula and unused `lineCost` / `baseUnitCost`.

### 10. Note search

In `filterNotes`, replace `n.text.toLowerCase().includes(q)` with `matchesSearch(n.text, q)`.

## Testing

TDD: failing test (or existing failing assertion) before each production change.

| Area | Proof |
|------|--------|
| Flag cache | `enqueueOp` inside txn without `meta` succeeds when flag on |
| Wholesale | `sale.create` with `wholesale: true` prices from `wholesalePrice` |
| Replay | void / GR / payment events adjust stock & balances idempotently |
| Restore | authoritative tables empty after restore |
| Type-scale | `tests/type-scale.test.ts` |
| Notes | `filterNotes` matches accent-folded query |
| GR cost | one weighted-average result |
| PWA / camera / deleteNote | focused unit tests or small harnesses for cancel + idle policy |

## Success criteria

- Listed bugs fixed at root cause; related tests green.
- No unconditional reload on SW update while user may have cart data.
- Restore does not re-enqueue stale authoritative commands.
