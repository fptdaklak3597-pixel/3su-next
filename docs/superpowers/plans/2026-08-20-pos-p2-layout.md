# POS P2 Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** POS catalog tiles on wide screens, list when searching, cart sheet on narrow, topbar 52px with overflow menus.

**Architecture:** File-contract tests read CSS and TSX. SalePage toggles `is-tiles` / `is-list` and `is-open` on the cart. WebShell moves chrome into user/burger menus. theme.css owns breakpoints 1100 / 720 / 900.

**Tech Stack:** React, CSS, Vitest.

## Global Constraints

- Files: `src/web/theme.css`, `src/web/pages/SalePage.tsx`, `src/web/layout/WebShell.tsx`, `tests/pos-layout.test.ts`, docs under `docs/superpowers/`.
- No domain/sync/db/auth edits. No rem. No mobile SalePage tile grid.
- No commit unless asked.

---

### Task 1: Contract tests then CSS + TSX

**Files:**
- Create: `3su-next/tests/pos-layout.test.ts`
- Modify: `src/web/theme.css`, `src/web/pages/SalePage.tsx`, `src/web/layout/WebShell.tsx`

**Interfaces:**
- Consumes: existing `.web-plist`, `.web-pc`, `.web-pos-body`, `.web-pos-r`, `.web-topbar`
- Produces: `.web-plist.is-tiles`, `.web-pos-r.is-open`, `.web-cart-toggle`, `.web-user-menu`, `.web-burger`, `.web-nav-mid`

- [ ] **Step 1: Write failing `tests/pos-layout.test.ts`**

Assert theme.css has `@media (min-width: 1100px)` with `.web-plist.is-tiles` and `minmax(168px`, tile `min-height` 88px, no `46vh`, stack at `719px` or `720px`, `.web-topbar` height 52px, `.web-user-menu` and `.web-burger` rules. Assert SalePage.tsx contains `is-tiles` and `is-list` gated on `query`. Assert WebShell contains `web-user-menu` and `web-burger`, and does not render Printer as a lone `web-ico` on the topbar.

- [ ] **Step 2: Run test (RED)**

`npm test -- tests/pos-layout.test.ts` from `3su-next`. Expected FAIL.

- [ ] **Step 3: Implement CSS + SalePage + WebShell** per spec.

- [ ] **Step 4: GREEN then full suite**

`npm test -- tests/pos-layout.test.ts` then `npm test`. Do not commit unless asked.
