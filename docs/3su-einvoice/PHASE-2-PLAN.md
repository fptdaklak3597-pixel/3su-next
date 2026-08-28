# Phase 2 — Domain + Compliance Engine

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans` or inline execution.

**Goal:** Implement fiscal compliance decisions and invoice state transitions in `@3su/einvoice` with zero MISA dependency.

**Architecture:** Pure functions in `compliance/` and `core/state-machine.ts`; policy data in `compliance/policy-hk-2026-v1.ts`.

---

### Task P2-01: Restructure package layout

**Files:**
- Move: `src/contracts.ts` → `src/core/contracts.ts`
- Move: `src/domain.ts` → `src/core/domain.ts`
- Move: `src/provider.ts` → `src/provider/contract.ts`
- Modify: `src/index.ts`
- Modify: `tests/contracts.test.ts` import paths

- [ ] Move files and update exports
- [ ] Run: `cd packages/3su-einvoice && npm run typecheck && npm test`

---

### Task P2-02: Add `legal_exempt` + money guard

**Files:**
- Modify: `src/core/contracts.ts`
- Create: `src/core/money.ts`
- Modify: `tests/contracts.test.ts`

- [ ] Add `legal_exempt` to `COMPLIANCE_RESULTS`
- [ ] Add `assertIntegerVnd(n: number): VndAmount`
- [ ] Update contract stability test

---

### Task P2-03: Compliance types + policy hk-2026-v1

**Files:**
- Create: `src/compliance/types.ts`
- Create: `src/compliance/policy-hk-2026-v1.ts`

**Interfaces produced:**
- `ShopComplianceProfile` (registration status, mandatory flag)
- `ComplianceEvaluationInput` (profile, declaration, sale context)
- `ComplianceDecision` (result, reasons, policyVersion, decisionId)

- [ ] Define types
- [ ] Export `HK_2026_V1_POLICY_ID`, `HKD_MANDATORY_THRESHOLD_VND = 1_000_000_000`

---

### Task P2-04: Compliance engine

**Files:**
- Create: `src/compliance/engine.ts`
- Create: `tests/compliance-engine.test.ts`

- [ ] `evaluateCompliance(input): ComplianceDecision`
- [ ] Cases: receipt_only, voluntary, mandatory, legal_exempt, manual_review
- [ ] Mid-year crossing threshold → mandatory

---

### Task P2-05: State machine

**Files:**
- Create: `src/core/state-machine.ts`
- Create: `tests/state-machine.test.ts`

- [ ] `canTransition(from, to): boolean`
- [ ] `assertTransition(from, to): InvoiceState`
- [ ] Issued is terminal for payload edits

---

### Task P2-06: Validate Phase 2

- [ ] `npm run typecheck && npm test && npm run build`
- [ ] CI workflow still passes

**Exit gate:** All P2 tests green; no imports from MISA/React/Dexie.

## Phase 2 status

**COMPLETE** (2026-08-23): package restructure, `legal_exempt`, `evaluateCompliance`, state machine, 18 tests passing.
