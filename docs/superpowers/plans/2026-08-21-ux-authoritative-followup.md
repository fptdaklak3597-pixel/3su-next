# UX + Authoritative Follow-up Bugfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six verified UX/authoritative follow-up bugs: confirm-only PWA updates, supplier payment replay, unique multi-line inventory ledger ids, trimmed barcode/unit on product save, reject dependent commands when parents fail, and always dismiss mobile note-delete dialogs.

**Architecture:** Small root-cause edits. PWA drops idle auto-apply entirely (banner + user confirm only). Processor replay and sale ledger ids stay pure TS. Command queue fail-closes children. Mobile ToolsPage wraps delete in try/finally. Prefer tests adjacent to existing suites.

**Tech Stack:** TypeScript, Dexie, Vitest, React, Service Worker.

## Global Constraints

- Spec: `3su-next/docs/superpowers/specs/2026-08-21-ux-authoritative-followup-design.md`
- PWA option **A**: no idle auto-reload; only `applyUpdate()` after user confirm.
- Prefer `3su-next/`; mirror `3su-cloud/src/commands/processor.ts` for supplier payment replay + inventory id pattern if stubs match.
- English identifiers; Vietnamese comments only where the file already uses them.
- Do not commit unless the user asks.
- Every task: RED → GREEN → verify.

## File map

| File | Role |
|------|------|
| `3su-next/src/shared/pwa.ts` | Remove idle auto-apply effect; simplify hook options if unused |
| `3su-next/src/shared/components.tsx` | `SwUpdateBanner` — stop passing `isIdle` if hook no longer needs it |
| `3su-next/tests/pwa-update-idle.test.ts` | Delete or replace with “no auto-apply” contract if helper removed |
| `3su-next/src/core/authoritative/processor.ts` | SupplierPayment replay; sale inventory ids with index |
| `3su-cloud/src/commands/processor.ts` | Mirror applyCanonicalEvent + inventory id if identical stubs |
| `3su-next/tests/authoritative/processor-replay.test.ts` | Supplier payment replay cases |
| `3su-next/tests/authoritative/processor.test.ts` | Multi-unit same-product ledger ids |
| `3su-next/src/core/domain/inventory-core.ts` | Trim barcode/unit in `updateProduct` (and unit on add if missing) |
| `3su-next/src/web/pages/ProductDetailPage.tsx` | Trim at call site for add/update |
| `3su-next/src/core/authoritative/commandQueue.ts` | Reject children when parent rejected/conflict |
| `3su-next/tests/authoritative/commandQueue.test.ts` | Dependent-reject case |
| `3su-next/src/mobile/pages/ToolsPage.tsx` | try/catch/finally on `handleDelete` |

---

### Task 1: PWA confirm-only (remove idle auto-apply)

**Files:**
- Modify: `3su-next/src/shared/pwa.ts`
- Modify: `3su-next/src/shared/components.tsx` (`SwUpdateBanner`)
- Modify or delete: `3su-next/tests/pwa-update-idle.test.ts`

**Interfaces:**
- Produces: `useServiceWorkerUpdate(): { updateAvailable: boolean; applyUpdate: () => void }` (no required `isIdle` / `idleMs` for auto-apply)
- Consumes: existing `SwUpdateBanner` / `applyUpdate`

- [ ] **Step 1: Write / adjust failing contract**

Add to `tests/pwa-update-idle.test.ts` (or rename to `pwa-update.test.ts`):

```typescript
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('PWA update policy', () => {
  it('pwa.ts không còn setTimeout(applyUpdate, idleMs) auto-apply', () => {
    const src = readFileSync(resolve('src/shared/pwa.ts'), 'utf8')
    expect(src).not.toMatch(/setTimeout\(\s*applyUpdate/)
    expect(src).not.toMatch(/idleMs\s*\?\?/)
  })
})
```

Keep `isSwUpdateIdle` tests only if the helper remains; if deleted, remove those tests.

- [ ] **Step 2: Run — expect FAIL** while auto-apply still present

```bash
npm test -- tests/pwa-update-idle.test.ts
```

- [ ] **Step 3: Implement**

In `pwa.ts`:
- Delete the `useEffect` that does `setTimeout(applyUpdate, idleMs)` when `updateAvailable && isIdle`.
- Remove `isIdle` / `idleMs` options from the hook if unused.
- Delete `isSwUpdateIdle` + types if nothing imports them after banner change.

In `components.tsx` `SwUpdateBanner`:
- Call `useServiceWorkerUpdate()` with no idle options.
- Remove `isSwUpdateIdle` import/usage.

Keep banner UI and `applyUpdate` on button click.

- [ ] **Step 4: Run tests — PASS**

```bash
npm test -- tests/pwa-update-idle.test.ts
```

(or new filename)

- [ ] **Step 5: Commit only if user asks**

---

### Task 2: Replay `SupplierPaymentRecorded`

**Files:**
- Modify: `3su-next/src/core/authoritative/processor.ts` (`applyCanonicalEvent`)
- Modify: `3su-cloud/src/commands/processor.ts` (`applyCanonicalEvent` — currently SaleCommitted-only; add supplier payment at minimum; prefer also porting prior void/GR/customer branches if cloud is still bare, but **required** for this task is SupplierPaymentRecorded)
- Test: `3su-next/tests/authoritative/processor-replay.test.ts`

**Interfaces:**
- Consumes: `applyCanonicalEvent`, `emptyShopState`
- Produces: supplier balance + ledger on `SupplierPaymentRecorded`

- [ ] **Step 1: Failing test**

```typescript
it('SupplierPaymentRecorded giảm balance NCC', () => {
  const state = emptyShopState('shop_1')
  state.suppliers.s1 = { id: 's1', name: 'NCC', balance: 9000 }
  const next = applyCanonicalEvent(state, ev({
    type: 'SupplierPaymentRecorded',
    seq: 1,
    payload: { supplierId: 's1', amount: 3000 },
  }))
  expect(next.suppliers.s1.balance).toBe(6000)
})

it('SupplierPaymentRecorded trùng event id → no-op', () => {
  // apply twice same ev.id; balance once
})
```

Reuse existing `ev()` helper from the replay test file; match `CanonicalEvent` fields.

- [ ] **Step 2: Run — FAIL**

```bash
npm test -- tests/authoritative/processor-replay.test.ts
```

- [ ] **Step 3: Implement branch** (mirror `processSupplierPayment`):

```typescript
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
```

Mirror in cloud `applyCanonicalEvent`.

- [ ] **Step 4: PASS** focused replay + processor suites

---

### Task 3: Unique inventory ledger ids on multi-unit sale

**Files:**
- Modify: `3su-next/src/core/authoritative/processor.ts` (`processSaleCreate` inventory push ~line 434)
- Modify: `3su-cloud/src/commands/processor.ts` if same id pattern
- Test: `3su-next/tests/authoritative/processor.test.ts`

**Interfaces:**
- Consumes: `processCommand` / `sale.create` with two lines same `productId`, different `unitName`

- [ ] **Step 1: Failing test**

```typescript
it('hai dòng cùng SP khác đơn vị → ledger id khác nhau', async () => {
  let state = seed(100)
  state.products.p1.units = [{ n: 'thùng', r: 24 }]
  const out = await processCommand(state, {
    id: 'cmd_multi',
    shopId: 'shop_1',
    deviceId: 'dev_1',
    userId: 'user_1',
    type: 'sale.create',
    payload: {
      items: [
        { productId: 'p1', qty: 2, unitName: 'chai' },
        { productId: 'p1', qty: 1, unitName: 'thùng' },
      ],
      payMethod: 'cash',
    },
    occurredAt: '2026-08-20T10:00:00.000Z',
    localSeq: 1,
    createdAt: 1,
  })
  expect(out.result.status).toBe('accepted')
  const ids = out.state.inventoryLedger
    .filter((e) => e.commandId === 'cmd_multi' && e.reason === 'sale')
    .map((e) => e.id)
  expect(ids).toEqual([
    'inv_cmd_multi_p1_0',
    'inv_cmd_multi_p1_1',
  ])
  expect(new Set(ids).size).toBe(2)
})
```

Adjust `unitName` / seed product `unit` to match `resolveUnitRatio` (base unit name may be `chai` from `baseProduct`).

- [ ] **Step 2: Run — FAIL** (duplicate ids or missing `_0`)

- [ ] **Step 3:**

```typescript
saleItems.forEach((it, index) => {
  // stock update +
  draft.inventoryLedger.push({
    id: `inv_${cmd.id}_${it.productId}_${index}`,
    // ...
  })
})
```

Or `for (let index = 0; ...)`. Mirror cloud.

Scan void/replay for same `inv_${id}_${productId}` collision on multi-line voids; only change if the same product can appear twice in one void payload without a discriminator.

- [ ] **Step 4: PASS**

---

### Task 4: Trim barcode and unit on product save

**Files:**
- Modify: `3su-next/src/core/domain/inventory-core.ts` (`updateProduct`; harden `addProduct` unit trim)
- Modify: `3su-next/src/web/pages/ProductDetailPage.tsx` (both save branches)
- Test: extend an existing inventory/domain product test, or create `tests/product-trim.test.ts`

**Interfaces:**
- Note: `addProduct` already does `barcode: input.barcode?.trim() || ''` but `unit: input.unit || 'cái'` without trim; `updateProduct` applies patch as-is.

- [ ] **Step 1: Failing test against domain**

```typescript
it('updateProduct trim barcode và unit', async () => {
  // setup db + initSyncEngine like other domain tests
  const id = (await addProduct({ name: 'SP', cat: 'Khác', price: 1, cost: 1, stock: 0, unit: 'chai' })).id
  await updateProduct(id, { barcode: '  893  ', unit: '  lon  ' })
  const p = await dbx.products.get(id)
  expect(p?.barcode).toBe('893')
  expect(p?.unit).toBe('lon')
})
```

Discover exact `addProduct` return shape from `inventory-core.ts` / wrappers in `domain/inventory.ts`.

- [ ] **Step 2: FAIL on update path**

- [ ] **Step 3:**

In `updateProduct`, when applying patch:
- if `patch.barcode != null` → trimmed string
- if `patch.unit != null` → `trim()`; empty may fall back to existing unit or `'cái'` consistent with add

In `addProduct`: `unit: (input.unit || 'cái').trim() || 'cái'`

In `ProductDetailPage` save:
```typescript
barcode: form.barcode.trim(),
unit: form.unit.trim(),
```
for both add and update.

- [ ] **Step 4: PASS**

---

### Task 5: Reject dependent commands when parent failed

**Files:**
- Modify: `3su-next/src/core/authoritative/commandQueue.ts` (`flushCommandQueue`)
- Test: `3su-next/tests/authoritative/commandQueue.test.ts`

**Interfaces:**
- Consumes: `enqueueCommand`, `flushCommandQueue`, `CommandResult`

- [ ] **Step 1: Failing test**

```typescript
it('dependsOn: cha rejected → con rejected, không pending mãi', async () => {
  await enqueueCommand(env('parent', { localSeq: 1, createdAt: 1 }))
  await enqueueCommand(env('child', { localSeq: 2, createdAt: 2, dependsOn: ['parent'] }))
  await flushCommandQueue(async (e) => {
    if (e.id === 'parent') {
      return {
        commandId: e.id,
        status: 'rejected',
        events: [],
        error: { code: 'X', message: 'no' },
      } satisfies CommandResult
    }
    throw new Error('child must not post')
  })
  // Second flush should mark child without posting
  await flushCommandQueue(async () => {
    throw new Error('should not post')
  })
  const child = await dbx.commandQueue.get('child')
  expect(child?.status).toBe('rejected')
  const cr = await dbx.commandResults.get('child')
  expect(cr?.status).toBe('rejected')
})
```

Also keep existing “missing parent stays pending” behavior.

- [ ] **Step 2: FAIL**

- [ ] **Step 3: In dependency loop**

```typescript
const parentStatus = parent?.status ?? parentResult?.status
if (parentStatus === 'rejected' || parentStatus === 'conflict') {
  row.status = 'rejected'
  row.result = {
    commandId: row.id,
    status: 'rejected',
    events: [],
    error: {
      code: 'DEPENDENCY_FAILED',
      message: `dependsOn ${depId} ${parentStatus}`,
    },
  }
  await dbx.commandQueue.put(row)
  await dbx.commandResults.put({ ...row.result, storedAt: Date.now() })
  blocked = true // or continue after marking — do not post
  break
}
if (parentStatus !== 'accepted') {
  blocked = true
  break
}
```

Ensure child is not left `sending`. Prefer mark-then-`continue` outer loop.

- [ ] **Step 4: PASS** entire `commandQueue.test.ts`

---

### Task 6: Mobile note delete dialog finally

**Files:**
- Modify: `3su-next/src/mobile/pages/ToolsPage.tsx` (`handleDelete` ~265)
- Test: optional thin extract; if no easy test, implement + note verification via typecheck + visual inspection checklist

**Interfaces:**
- Consumes: `deleteNote`, `showToast`, `setDelTarget`

- [ ] **Step 1:** Prefer a tiny pure helper for testability (optional):

```typescript
// notesDeleteUi.ts or inline
export async function runDeleteNoteAction(
  run: () => Promise<void>,
): Promise<'ok' | 'err'> {
  try {
    await run()
    return 'ok'
  } catch {
    return 'err'
  }
}
```

Or simply wrap in page without helper:

```typescript
async function handleDelete() {
  if (!delTarget) return
  try {
    await deleteNote(delTarget.id)
    if (editId === delTarget.id) setEditId(null)
    showToast('Đã xóa ghi chú', 'ok')
  } catch (e) {
    logError(e, 'notes.delete')
    showToast('Không xóa được', 'bad')
  } finally {
    setDelTarget(null)
  }
}
```

If using helper, test helper returns ok/err and document that page always clears target in finally.

- [ ] **Step 2–4:** Implement page change; run `npm run typecheck`; if helper tested, run that test.

---

### Task 7: Final verification

- [ ] **Step 1: Focused suites**

```bash
npm test -- tests/pwa-update-idle.test.ts tests/authoritative/processor-replay.test.ts tests/authoritative/processor.test.ts tests/authoritative/commandQueue.test.ts
```

Include product-trim test path if created.

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
| PWA confirm-only / no idle auto F5 | 1 |
| SupplierPaymentRecorded replay | 2 |
| Unique inv ledger ids | 3 |
| Trim barcode/unit | 4 |
| Dependent command reject | 5 |
| Mobile delete dialog finally | 6 |
| Final verify | 7 |

## Self-review notes

- No TBD placeholders.
- Cloud mirror required for Task 2 (and Task 3 if identical id stub); cloud `applyCanonicalEvent` may still lack void/GR/customer — out of scope except supplier payment unless implementer finds zero-cost parity while editing the same function (YAGNI: only add SupplierPaymentRecorded unless already adding a shared helper).
- Commit steps deferred to user request.
