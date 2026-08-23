# Phase 2 — In-memory authoritative command processor

> Spec: `docs/superpowers/specs/2026-08-20-authoritative-money-stock-design.md`
> Gate: roadmap Phase 2

**Goal:** Pure TS processor: idempotency, seq, sale stock race, fault-inject commit.

**Files:**
- `3su-next/src/core/authoritative/processor.ts`
- `3su-next/tests/authoritative/processor.test.ts`
- Mirror: `3su-cloud/src/commands/processor.ts` + `test/processor-harness.test.ts`
