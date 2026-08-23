# UX + authoritative follow-up bugfix — Design

Date: 2026-08-21  
Scope: `3su-next` (+ `3su-cloud` processor mirror where the same stubs exist)  
Approach: Option 1 — fix each verified root cause with TDD; PWA update = **A** (banner + confirm only; no idle auto-reload).

## Goals

- Stop Service Worker updates from wiping in-progress forms (product create/edit, notes, etc.).
- Replay `SupplierPaymentRecorded` so supplier debt converges after reconnect.
- Unique inventory ledger ids when one sale has multiple lines for the same product (different units).
- Trim barcode and unit on product save so scanner lookup matches.
- Reject dependent commands when their parent is rejected/conflicted (no forever-pending children).
- Always dismiss the mobile note-delete confirm dialog, even when delete fails.

## Non-goals

- Form dirty-tracking bus / per-field “unsaved” detection (PWA A makes this unnecessary).
- Full authoritative reconnect wiring beyond `applyCanonicalEvent` gaps.
- Changing POS cart idle rules beyond removing auto-apply.

## Fixes

### 1. PWA — confirm-only updates (option A)

**Root cause:** After the previous batch, idle auto-apply still runs when `isSwUpdateIdle` is true (not `/ban-hang`, empty cart). Product/notes forms are “idle” under that definition → reload after 30s wipes typed input.

**Fix:**
- Remove the 30s idle auto-apply effect from `useServiceWorkerUpdate`.
- Keep banner + `applyUpdate()` (SKIP_WAITING + reload only when user confirms).
- Keep first-install path (no controller → activate without forced form-wiping reload policy already gated by `applying`).
- `isSwUpdateIdle` may remain unused or be deleted if nothing calls it after removing auto-apply; prefer delete dead API + its tests if unused, or keep pure helper only if still referenced.

### 2. Replay `SupplierPaymentRecorded`

**Root cause:** `applyCanonicalEvent` handles customer payment but not supplier payment, so supplier balances drift on rebuild/replay.

**Fix:** Mirror `processSupplierPayment` effects when applying `SupplierPaymentRecorded`:
- payload `{ supplierId, amount }`
- `suppliers[supplierId].balance -= amount` (if supplier present)
- append `supplierLedger` entry (same shape as process path: negative delta, reason `PAYMENT`)
- Idempotency: event-id via existing `appliedEventIds` (same as customer payment)

Mirror the same branch in `3su-cloud/src/commands/processor.ts` if that file’s `applyCanonicalEvent` is still SaleCommitted-only / missing supplier payment.

### 3. Unique sale inventory ledger ids

**Root cause:** `processSaleCreate` uses `inv_${cmd.id}_${it.productId}` per item loop; two lines for the same product (e.g. lon + thùng) collide.

**Fix:** Include line index: `inv_${cmd.id}_${it.productId}_${index}` in the `for (const it of saleItems)` inventory push (and any identical pattern in the same function if present).

Check void / replay inventory ids for the same collision class; only change if they also key solely on `productId` without index/line discriminator when multiple lines can share a product.

### 4. Trim barcode and unit on product save

**Root cause:** `ProductDetailPage` passes `form.barcode` / `form.unit` without trim on add and update; display-only trim does not persist.

**Fix:** Before `addProduct` / `updateProduct`:
- `barcode: form.barcode.trim()`
- `unit: form.unit.trim()` (empty → keep existing domain default behavior if any; do not invent a new default beyond current empty-string handling)

Prefer trimming at the page call site (both branches). Optional hardening inside domain `addProduct`/`updateProduct` is out of scope unless a one-line shared trim already exists.

### 5. Dependent commands when parent fails

**Root cause:** `flushCommandQueue` sets `blocked = true` and `continue` when any `dependsOn` is not accepted — including when parent is `rejected`/`conflict` — leaving the child `pending` forever.

**Fix:** When a parent is found with status `rejected` or `conflict` (from queue row and/or `commandResults`):
- Mark child `status: 'rejected'`
- Attach a clear error (e.g. dependency rejected / parent id)
- Persist queue + `commandResults`
- Do not leave the child pending

If parent is still missing / still pending / sending → keep current block behavior (skip this flush cycle).

### 6. Mobile note delete dialog

**Root cause:** `ToolsPage.handleDelete` awaits `deleteNote` without try/catch; on throw, `setDelTarget(null)` never runs → confirm UI stuck.

**Fix:**
```ts
try {
  await deleteNote(...)
  // clear edit if needed, success toast
} catch {
  // error toast
} finally {
  setDelTarget(null)
}
```

## Testing

TDD: failing test (or existing assertion) before each production change.

| Area | Proof |
|------|--------|
| PWA | No idle auto-apply timer; banner/apply path unchanged; remove or update idle-only tests that assumed auto-apply |
| Supplier payment replay | `applyCanonicalEvent(SupplierPaymentRecorded)` reduces balance; duplicate event id no-ops |
| Inventory ids | Sale with two lines same product → two distinct ledger ids ending in `_0` / `_1` (or index) |
| Trim | Unit/page-level assertion that saved barcode has no leading/trailing spaces (prefer domain call mock or thin extract if page hard to test) |
| Command queue | Child with rejected parent becomes rejected; child with pending parent stays skipped |
| Mobile delete | Prefer extracting tiny helper or asserting finally pattern; if UI-only, minimal change + manual note in plan |

## Success criteria

- User must confirm SW update; typing on product/notes cannot be wiped by idle timer.
- Supplier payment events replay correctly.
- Multi-unit same-product sales do not collide on inventory ledger ids.
- Saved barcodes/units are trimmed.
- Dependent commands fail closed when parents fail.
- Delete confirm always closes on mobile.
