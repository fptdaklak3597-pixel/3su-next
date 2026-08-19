# Ledger wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline — user said bắt đầu sửa).

**Goal:** Sửa S1/S2/M10/M3/M4 + clamp nợ âm cũ; file `tests/ledger-regress.test.ts` xanh; loop 2 phút sau đó.

**Architecture:** GR.paid là nguồn trả lúc nhập; debt khách sàn 0 (ghi + boot); PO+GR một Dexie tx 10 bảng.

**Tech Stack:** TypeScript, Dexie 4, Vitest, fake-indexeddb.

## Global Constraints

- Chỉ `3su-next`. Identifier English, comment Vietnamese.
- TDD: test đỏ trước. Không commit trừ khi được hỏi.
- Impact trước khi sửa symbol public domain/sync đã liệt kê trong spec.

---

### Task 1: ledger-regress (đỏ)

**Files:** Create `3su-next/tests/ledger-regress.test.ts`

- [ ] Viết 8 case theo spec (S1×3, S2, M10, M4, M3 lần 2, clamp âm).
- [ ] `npx vitest run tests/ledger-regress.test.ts` — FAIL đúng hành vi cũ.
- [ ] Implement tối thiểu đến khi file xanh.

### Task 2: Domain + apply + UI + boot

**Files:** `inventory.ts`, `suppliers.ts`, `customers.ts`, `sales.ts`, `purchase.ts`, `apply.ts`, `boot.ts`, CustomersPage ×2, OrdersPage ×2 nếu thiếu toast.

- [ ] Impact các symbol rồi vá theo spec.
- [ ] `npm test` + `npm run typecheck` trong `3su-next`.

### Task 3: Loop

- [ ] `/loop` 2m `vitest run tests/ledger-regress.test.ts`.
