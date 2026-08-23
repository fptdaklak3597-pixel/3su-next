# 3SU E-Invoice — Phase 1 Task Breakdown

Goal: establish architecture, contracts, documentation and an independent TypeScript package skeleton without integrating into 3SU runtime.

## P1-T01 — Freeze roadmap and scope

Work:
- Add 11-phase roadmap.
- Record V1 in-scope/out-of-scope boundaries.
- Record production gate and integration rule.

Done when:
- `docs/3su-einvoice/ROADMAP.md` exists.
- 11 phases are explicit.
- V1 excludes VAT invoice, USB-token POS flow, legal delegation and multi-provider production.
- Module integration is blocked until Phase 8.

## P1-T02 — Write Technical Specification V1

Work:
- Define architecture and dependency direction.
- Define domain/compliance/provider/storage/application boundaries.
- Define lifecycle, commands, events, API, errors, idempotency, credential handling, audit, artifacts, testing and versioning.

Done when:
- `docs/3su-einvoice/TECHNICAL-SPEC-V1.md` exists.
- Core has a documented prohibition on MISA/React/Dexie/Zustand/Cloudflare runtime dependencies.
- Stable provider reference/idempotency rule is explicit.
- Open legal/provider questions are recorded instead of guessed.

## P1-T03 — Create independent package manifest

Work:
- Create `packages/3su-einvoice/package.json`.
- Keep package private during early development.
- Add independent `typecheck`, `test` and `build` scripts using existing repository tooling only.
- Do not add new root dependencies in Phase 1.

Done when:
- Package manifest exists.
- No new external runtime dependency is introduced.
- Package can be executed independently with repository-installed TypeScript/Vitest tooling.

## P1-T04 — Create package TypeScript boundary

Work:
- Create package-local `tsconfig.json`.
- Limit compilation to package `src`.
- Use strict TypeScript settings.
- Do not reference 3SU source aliases or UI types.

Done when:
- Package can typecheck without importing `src/web`, `src/mobile`, React, Dexie or Zustand.
- Output target is package-local `dist` for build mode.

## P1-T05 — Define canonical primitive/domain contracts

Work:
- Add public types for IDs, money, lifecycle states, document kinds, compliance results and error/retry categories.
- Add invoice snapshot interfaces.
- Add provider contract interfaces.
- Export contracts from package entrypoint.

Done when:
- Consumers can import all V1 boundary contracts from the package root.
- Types contain no MISA-specific wire fields except generic `providerRefId`/`providerTransactionId` concepts.
- Fiscal money is integer VND.

## P1-T06 — Add architecture guard documentation

Work:
- Add package README containing dependency rules and migration-to-standalone-repo guarantee.
- Explicitly state Phase 1 contains contracts only, not implementation.

Done when:
- README lists allowed/forbidden dependencies.
- README documents independent package commands.
- README explains that placing the package in `3su-next` is temporary development hosting, not POS coupling.

## P1-T07 — Add contract smoke tests

Work:
- Add minimal tests that validate exported constants/type-level runtime enum arrays where meaningful.
- Do not implement domain behavior prematurely.

Done when:
- Package test suite runs independently.
- Tests prove canonical lifecycle/error/retry literals are stable.

## P1-T08 — Validate Phase 1

Work:
- Run/verify package typecheck.
- Run package tests.
- Run package build.
- Review changed files for accidental POS/runtime integration.

Done when:
- Typecheck passes.
- Tests pass.
- Build passes.
- No modifications are required to existing 3SU runtime code.
- No MISA network call, credential, D1 migration or POS wiring exists.

## Phase 1 completion checklist

- [x] P1-T01 complete
- [x] P1-T02 complete
- [x] P1-T03 complete
- [x] P1-T04 complete
- [x] P1-T05 complete
- [x] P1-T06 complete
- [x] P1-T07 complete
- [x] P1-T08 complete

## Validation evidence

Phase 1 was validated twice before merge:

- GitHub Actions CI run `#277`: PASS after fixing package-test isolation.
- GitHub Actions CI run `#279` on the final completion-marker commit: PASS.

Both validation runs covered:

- Existing 3SU dependency security audit: PASS.
- Existing 3SU print-agent syntax check: PASS.
- Existing 3SU typecheck: PASS.
- Existing 3SU test suite: PASS.
- Existing 3SU build-all: PASS.
- `@3su/einvoice` typecheck: PASS.
- `@3su/einvoice` contract tests: PASS.
- `@3su/einvoice` build: PASS.

PR `#27` was squash-merged into `main` as commit `510c726bd5058bb0b74b487713e6c003195e3cbf`.

## Phase 1 status

**COMPLETE AND MERGED TO `main`.**
