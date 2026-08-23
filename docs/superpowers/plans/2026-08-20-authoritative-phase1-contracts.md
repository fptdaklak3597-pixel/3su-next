# Phase 1 — Command/Event contracts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spec:** `docs/superpowers/specs/2026-08-20-authoritative-money-stock-design.md` (Approved 2026-08-20)  
> **Roadmap:** `docs/superpowers/plans/2026-08-20-authoritative-money-stock-roadmap.md` — Phase 1

**Goal:** Thêm type + parse/validate thuần cho `CommandEnvelope` / `CommandResult` / `CanonicalEvent` ở `3su-next` và mirror `3su-cloud`. Chưa gắn POS, chưa đổi `confirmSale`.

**Architecture:** Module thuần (không Dexie/fetch). Client và cloud giữ bản mirror cùng rule (chưa có package shared). Forbidden canonical fields bị reject ở parse payload.

**Tech Stack:** TypeScript, Vitest (đã có sẵn từng package).

## Global Constraints

- Spec §5 và policy P10/P11.
- Không đổi behavior `confirmSale` / `/ops`.
- Sau task: `npm test` + `npm run typecheck` xanh ở package đã sửa.
- Comment tiếng Việt; identifier tiếng Anh.
- Không `.skip` test gate.

---

### Task 1: Contracts module + gate tests (`3su-next`)

**Files:**
- Create: `src/core/authoritative/contracts.ts`
- Create: `tests/authoritative/contracts.test.ts`

**Interfaces:**
- Produces: `CommandType`, `CommandEnvelope`, `CommandResult`, `CanonicalEvent`, `ContractError`, `parseCommandEnvelope(raw)`, `parseCommandResult(raw)`, `parseCanonicalEvent(raw)`, `COMMAND_TYPES`, `COMMAND_RESULT_STATUSES`

- [x] **Step 1: Viết test gate (đỏ trước)**
- [x] **Step 2: Implement `contracts.ts` tối thiểu**
- [x] **Step 3: Chạy** — `tests/authoritative/contracts.test.ts` 5/5 PASS + typecheck PASS
- [ ] **Step 4: Commit** (khi user yêu cầu commit)

---

### Task 2: Mirror contracts (`3su-cloud`)

**Files:**
- Create: `src/commands/contracts.ts` (cùng rule với next)
- Create: `test/commands-contracts.test.ts`

- [x] **Step 1: Copy/adapt module + test tương đương**
- [x] **Step 2: Chạy** — `test/commands-contracts.test.ts` 5/5 PASS  
  (`npx tsc --noEmit` cloud còn lỗi sẵn `cloudflare:test` / node types — không do Phase 1)
- [x] **Step 3: Phase 1 GATE PASS** (contracts next + cloud)

**Done khi (roadmap Phase 1):** mọi gate contracts xanh; typecheck xanh; POS behavior cũ không đổi.
