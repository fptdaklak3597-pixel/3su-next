# @3su/einvoice

Independent, provider-agnostic e-invoice contracts for 3SU.

## Phase 1 scope

Phase 1 establishes architecture and public contracts only. It deliberately does **not** implement MISA HTTP calls, D1 persistence, credentials, Cloudflare workers, or POS integration.

## Dependency rules

Allowed:
- TypeScript standard library types.
- Package-local source modules.
- Test tooling already available in the parent repository.

Forbidden from `core`/public contracts:
- MISA wire-format types or endpoint-specific fields.
- React.
- Dexie.
- Zustand.
- 3SU web/mobile/admin source aliases.
- Cloudflare runtime bindings.

Provider-specific adapters must implement the generic `EInvoiceProvider` contract instead of leaking provider details into domain types.

## Fiscal invariants established in Phase 1

- V1 monetary values are integer VND amounts.
- One fiscal document version keeps one stable provider reference across retries.
- Issued fiscal payloads are immutable by design; corrections create linked documents in later phases.
- Provider transport failures can be ambiguous and must be reconciled before reissue.
- Tenant identity (`shopId`) is explicit on all shop-scoped contracts.

## Local commands

From `packages/3su-einvoice`:

```bash
npm run typecheck
npm test
npm run build
```

These commands use TypeScript/Vitest tooling installed by the parent repository. No Phase 1 dependency is added to the root application.

## Temporary repository placement

This package is hosted under `3su-next/packages/3su-einvoice` during initial development because the connected GitHub environment cannot create a new repository. This location is not an architectural dependency on the POS application.

The package must remain extractable into a standalone `3su-einvoice` repository without importing or moving 3SU UI/runtime code.

## Specification

See:
- `docs/3su-einvoice/ROADMAP.md`
- `docs/3su-einvoice/TECHNICAL-SPEC-V1.md`
- `docs/3su-einvoice/PHASE-1-TASKS.md`
