# Type Scale + POS Touch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce a readable type floor and Square-like POS money/touch sizes in 3SU Next CSS without changing domain logic.

**Architecture:** Contract test reads `src/index.css` and `src/web/theme.css`. Tokens live on `:root` and `html[data-shell="web"]`. POS and floor rules consume tokens. Print/admin CSS stay out of scope.

**Tech Stack:** CSS custom properties, Vitest, Node `fs`.

## Global Constraints

- Files only: `3su-next/src/index.css`, `3su-next/src/web/theme.css`, `3su-next/tests/type-scale.test.ts`, docs under `3su-next/docs/superpowers/`.
- No rem migration, no POS tile grid, no domain/sync/auth edits.
- No `font-size` below 11px and no half-pixel font sizes in the two UI CSS files.
- Web body stays 14px. Page title stays 22px.
- Identifier English, comment Vietnamese.
- Do not commit unless asked.

---

### Task 1: Contract test (RED)

**Files:**
- Create: `3su-next/tests/type-scale.test.ts`
- Test: `3su-next/tests/type-scale.test.ts`

**Interfaces:**
- Consumes: file text of `src/index.css` and `src/web/theme.css`
- Produces: assertions listed in the spec P0/P1 table

- [ ] **Step 1: Write the failing test**

Write `tests/type-scale.test.ts` that:
1. Requires `--fs-caption`, `--fs-label`, `--fs-body`, `--fs-plus`, `--fs-title`, `--fs-price`, `--fs-qr`, `--fs-total`, `--fs-display`, `--hit-qty`, `--hit-pay`, `--hit-cta` in `:root` of `index.css`.
2. Requires the same names on `html[data-shell="web"]` in `theme.css`.
3. Parses `font-size: Npx` in both files; fails if N < 11 or N has a decimal.
4. Requires `.web-qty button` width and height to be `var(--hit-qty)` or >= 36px.
5. Requires `.web-ln.big` to use `var(--fs-total)` or 24px.
6. Requires `.web-pos-qr-amt` to use `var(--fs-qr)` or 20px.
7. Requires `.web-pay button` min-height `var(--hit-pay)` or >= 44px and font-size 14px or `var(--fs-plus)`.
8. Requires `.web-cta` height `var(--hit-cta)` or >= 48px.
9. Requires `.field-input` font-size 16px or `var(--fs-body)` / a 16px important rule.
10. Requires `.tab-item` font-size >= 12px or `var(--fs-caption)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/type-scale.test.ts` from `3su-next`  
Expected: FAIL (tokens missing, 9px/10px/half-pixels still present, qty 22px)

- [ ] **Step 3: Add tokens + P0/P1 CSS**

`index.css` `:root`: mobile token values from spec.  
`theme.css` `html[data-shell="web"]`: web token values from spec.  
Replace POS rules and floor sizes per spec.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/type-scale.test.ts`  
Expected: PASS

- [ ] **Step 5: Full suite**

Run: `npm test` from `3su-next`  
Expected: existing tests still PASS

Do not commit unless the user asks.
