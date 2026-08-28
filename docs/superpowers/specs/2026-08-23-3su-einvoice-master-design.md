# 3SU E-Invoice — Master Design (consolidated)

Status: Approved for implementation (2026-08-23)
Supersedes gaps in `docs/3su-einvoice/ROADMAP.md` §deployment and §authoritative dependency.

## Goal

Independent `@3su/einvoice` module: HKD sales invoices (MTT) via MISA meInvoice first provider. Shops ≤1B VND/year optional; >1B mandatory. No VAT invoices, no USB token at POS, no legal delegation to 3SU.

## Repository topology

| Location | Responsibility |
|----------|----------------|
| `3su-next/packages/3su-einvoice/` | Domain, compliance, provider contracts, mock provider (Phase 4) |
| `3su-cloud/src/einvoice/` | HTTP API, D1, Durable Object series coordinator, R2 artifacts |
| `3su-cloud/migrations/` | `einvoice_*` tables |
| `3su-next/src/` (Phase 6/8) | SDK client, onboarding wizard, output-invoice UI |
| `3su_invoice/` (reuse only) | XML viewer / `invoice-core.js` for artifact display — not MISA |

`3su-cloud` is not on GitHub yet; Phase 3 requires pushing or submodule before deploy.

## Authoritative sale gate (Phase 1b)

Production e-invoice is **blocked** until:

1. POS uses `sale.create` authoritative path (not local-only `confirmSale` totals).
2. Cloud emits `SaleCommitted` with server-calculated totals.
3. Invoice outbox job created in same D1 batch as canonical persist.

## Compliance baseline (HKD, policy `hk-2026-v1`)

- Source: NĐ 141/2026/NĐ-CP (threshold 1 tỷ/năm), NĐ 254/2026, TT 91/2026.
- HKD/CNKD ≤1 tỷ tổng doanh thu mọi kênh: không bắt buộc HĐĐT (`receipt_only`).
- HKD/CNKD >1 tỷ: bắt buộc (`mandatory_einvoice`).
- Shop tự nguyện đăng ký: sau CQT chấp nhận → `voluntary_einvoice` (xuất mọi giao dịch thuộc diện).
- Doanh thu ngoài 3SU: `RevenueDeclaration.externalRevenueDeclared` — 3SU không verify.
- Ngoại lệ Điều 7 NĐ 254: `legal_exempt` + `legalBasisCode` + evidence — không phát HĐ nhưng phải lưu hồ sơ.
- Open legal question (xin CQT văn bản): shop voluntary có được chọn từng đơn sau đăng ký?

## Package layout (target after Phase 2 restructure)

```text
packages/3su-einvoice/src/
  core/           contracts.ts, domain.ts, money.ts, state-machine.ts
  compliance/     policy.ts, engine.ts, types.ts
  provider/       contract.ts (EInvoiceProvider)
  index.ts
```

## Phase summary

| Phase | Name | Outcome |
|-------|------|---------|
| 0 | MISA/legal gate | app_id, sandbox, COMPLIANCE-BASELINE signed off |
| 1 | Foundation | ✅ contracts package |
| 1b | Authoritative sale | UI → cloud SaleCommitted |
| 2 | Domain + compliance | engine, state machine, tests |
| 3 | D1 + outbox | migrations in 3su-cloud, atomic job |
| 4 | Mock + worker | MockMisaProvider, in-memory then DO coordinator |
| 5 | MISA sandbox | real adapter contract tests |
| 6 | Onboarding UX | wizard + readiness keys |
| 7 | Corrections | replace/adjust/return chains |
| 8 | 3SU integration | SDK, events, rename receipt print |
| 9 | Security hardening | vault, chaos, leak tests |
| 10 | Pilot | 3→10→50 shops |

Phases 3 and 4 may run in parallel after Phase 2.

## Integration rule

No POS/MISA wiring before Phase 8 except feature-flagged sandbox pilot after Phase 5.
