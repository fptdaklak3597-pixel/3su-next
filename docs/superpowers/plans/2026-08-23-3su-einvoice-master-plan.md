# 3SU E-Invoice — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` per phase plan file.

**Goal:** Ship HKD MTT sales e-invoice via MISA for 3SU Next — provider-agnostic core, cloud worker, POS integration.

**Architecture:** `@3su/einvoice` package (pure TS) + `3su-cloud` worker (D1/DO/R2) + `3su-next` SDK/UI. Authoritative `SaleCommitted` triggers atomic invoice outbox.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers, D1, Durable Objects, R2, MISA meInvoice Open API.

## Global Constraints

- V1: HKD sales invoice MTT only — no VAT, no USB token at POS, no 3SU legal delegation.
- Integer VND for all fiscal amounts — no IEEE float in calculations.
- Stable `providerRefId` per fiscal document version — retries never mint new RefID.
- Credentials/tokens never in browser, IndexedDB, logs, or backups.
- `core` must not import MISA, React, Dexie, or Cloudflare runtime.
- Issued invoices immutable — corrections via linked documents only.
- Policy thresholds versioned (`hk-2026-v1`) — not hard-coded in services.

---

## Phase 0 — MISA and legal gate (parallel, mostly external)

**Owner:** Jake + MISA sales. **No code required to start Phase 2.**

| Task ID | Deliverable | Done when |
|---------|-------------|-----------|
| P0-01 | Email MISA: app_id sandbox, MST test, MTT template, Postman NĐ254/TT91 | Reply received |
| P0-02 | `COMPLIANCE-BASELINE.md` reviewed | File exists, open questions listed |
| P0-03 | CQT written reply on voluntary per-order + offline MTT | Document stored |
| P0-04 | Sandbox: auth, template, preview, issue, status, duplicate RefID | Checklist signed |
| P0-05 | Confirm multi-tenant app_id, SignType 5/6, replace/adjust API | Written MISA confirmation |

**Exit gate:** P0-04 + P0-05 before Phase 5 production adapter.

---

## Phase 1 — Foundation ✅ COMPLETE

Merged PR #27. Package `packages/3su-einvoice` contracts only.

---

## Phase 1b — Authoritative sale (3su-next + 3su-cloud)

**Plan file:** `docs/3su-einvoice/PHASE-1B-PLAN.md` (create when starting)

| Task ID | Files | Deliverable |
|---------|-------|-------------|
| P1b-01 | `SalePage.tsx`, `CheckoutPage.tsx` | Feature-flag path to `confirmSaleAuthoritative` |
| P1b-02 | `saleCommands.ts`, cloud commands API | Online flush + `SaleCommitted` in UI |
| P1b-03 | `flag.ts`, settings | Dev/staging enable authoritative |
| P1b-04 | Tests | E2E authoritative sale test green |
| P1b-05 | Doc | Sale snapshot JSON schema for invoice module |

**Exit gate:** Sale cannot show "confirmed" bill without cloud accept in authoritative mode.

---

## Phase 2 — Domain + compliance engine

**Plan file:** `docs/3su-einvoice/PHASE-2-PLAN.md` — **execute now**

| Task ID | Deliverable |
|---------|-------------|
| P2-01 | Package restructure `core/`, `compliance/`, `provider/` |
| P2-02 | `legal_exempt` compliance result + types |
| P2-03 | Policy `hk-2026-v1` + `evaluateCompliance()` |
| P2-04 | Invoice state machine transitions |
| P2-05 | Threshold + transition + exempt tests |

**Exit gate:** `npm test` in package; zero MISA imports.

---

## Phase 3 — D1 persistence + outbox (3su-cloud)

| Task ID | Files | Deliverable |
|---------|-------|-------------|
| P3-01 | `migrations/0008_einvoice.sql` | All tables + unique constraints |
| P3-02 | `src/einvoice/store.ts` | CRUD with shopId tenant guard |
| P3-03 | `src/einvoice/outbox.ts` | Atomic snapshot + job + event |
| P3-04 | `wrangler.toml` | R2 binding `EINVOICE_ARCHIVE` |
| P3-05 | Tests | Replay/idempotency/cross-tenant fail |

**Exit gate:** Duplicate `(shop_id, sale_id, document_kind)` rejected; job survives crash simulation.

---

## Phase 4 — Mock provider + worker engine

| Task ID | Deliverable |
|---------|-------------|
| P4-01 | `packages/3su-einvoice/src/provider/mock-misa.ts` |
| P4-02 | Scenario suite: success, timeout, duplicate, 429, reject |
| P4-03 | `InvoiceSeriesCoordinator` (in-memory then DO) |
| P4-04 | `application/issue-invoice.ts` orchestration |
| P4-05 | Reconcile-after-timeout flow |

**Exit gate:** All mock scenarios pass; series concurrency test passes.

---

## Phase 5 — MISA sandbox adapter

| Task ID | Deliverable |
|---------|-------------|
| P5-01 | `packages/3su-einvoice/src/provider/misa/` HTTP client |
| P5-02 | Token cache (14d, refresh ~7d) |
| P5-03 | templates, unpublishview, issue, status, download |
| P5-04 | Contract tests shared with mock |
| P5-05 | Sandbox E2E checklist |

**Exit gate:** Phase 0 sandbox checklist green on real MISA.

---

## Phase 6 — Onboarding + readiness UX

| Task ID | Deliverable |
|---------|-------------|
| P6-01 | `EInvoiceOnboardingPage` wizard steps |
| P6-02 | `GET /readiness` UI mapping |
| P6-03 | Connect flow (credentials → cloud only) |
| P6-04 | Template/series picker |
| P6-05 | Preview + activation |

**Exit gate:** Shop owner reaches `ready` without dev help (given MISA account exists).

---

## Phase 7 — Replacement, return, refund

| Task ID | Deliverable |
|---------|-------------|
| P7-01 | `replaceInvoice` command + chain |
| P7-02 | Return/refund adjustment flow |
| P7-03 | `einvoice_corrections` linkage |
| P7-04 | MISA replace/adjust API (confirmed wire) |

**Exit gate:** Original immutable; chain queryable; XML/PDF archived.

---

## Phase 8 — SDK + 3SU integration

| Task ID | Deliverable |
|---------|-------------|
| P8-01 | `src/core/einvoice/sdk.ts` client |
| P8-02 | Event bus: `invoice.issued`, etc. |
| P8-03 | Rename "In hóa đơn" → "In phiếu bán hàng" where non-fiscal |
| P8-04 | Output invoices page |
| P8-05 | Sale commit → queue invoice (authoritative + outbox) |
| P8-06 | Sandbox E2E: sale → MISA → status in UI |

**Exit gate:** POS has zero MISA URL knowledge; E2E sandbox works.

---

## Phase 9 — Security + hardening

| Task ID | Deliverable |
|---------|-------------|
| P9-01 | Credential vault AES-GCM + rotation |
| P9-02 | Secret leak tests (backup, logs) |
| P9-03 | Chaos: crash before/after provider |
| P9-04 | Ops metrics + alerts |

---

## Phase 10 — Pilot

| Stage | Shops | Duration |
|-------|-------|----------|
| Pilot A | 3–5 | 2 weeks |
| Pilot B | 10 | 2 weeks |
| Pilot C | 50 | 2 weeks |
| GA | rollout | after zero S1/S2 |

---

## Production gate (from ROADMAP)

All items in `docs/3su-einvoice/ROADMAP.md` §Production gate + Phase 1b + Phase 0 written confirmations.

---

## Execution order

```
Phase 1 ✅ → Phase 2 (now) ─┬→ Phase 3 (cloud)
         Phase 0 (parallel)  ├→ Phase 4 (mock)
         Phase 1b (parallel) └→ Phase 5 (needs P0)
→ Phase 6 → Phase 7 → Phase 8 → Phase 9 → Phase 10
```

**Next action:** Execute `docs/3su-einvoice/PHASE-2-PLAN.md`.
