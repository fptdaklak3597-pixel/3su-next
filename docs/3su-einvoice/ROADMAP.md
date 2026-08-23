# 3SU E-Invoice — Delivery Roadmap

Status: Draft baseline for implementation
Target: `3su-einvoice` independent module, integrated into 3SU only after provider contracts are proven.

## Product scope V1

V1 supports Vietnamese household/business-individual sellers using sales invoices created from cash registers, with MISA meInvoice as the first provider. The module must remain provider-agnostic so another lawful e-invoice provider can be added later.

Out of scope for V1: VAT invoices, USB token workflows at POS, legal authorization for 3SU to invoice on behalf of sellers, multiple providers in production, and unusual regulated invoice cases that are not part of ordinary retail sales.

## Guiding principles

1. Sale state, compliance decision, invoice document, provider transport, and archive are separate concerns.
2. `core` must not import or depend on MISA-specific code.
3. Law and thresholds are versioned policy data, never buried as unversioned constants inside invoice services.
4. Issued fiscal documents are immutable. Corrections create linked fiscal documents, not edits.
5. Every issuance request is idempotent and uses a stable provider reference.
6. A sale requiring an e-invoice must end the day as either an issued invoice or a documented legal exception.
7. Credentials and provider tokens never reach browser state, IndexedDB, analytics, logs, or client backups.

## Phase 0 — MISA and legal gate

Goal: remove unknowns that must not be guessed.

Deliverables:
- MISA `app_id` for 3SU.
- Sandbox credentials and test tax code.
- Sandbox tenant with accepted declaration, active cash-register sales-invoice template, valid series and test quota.
- Current Postman collection/schema applicable to 2026 rules.
- Written answers for multi-tenant `app_id`, authentication/delegation, token lifecycle, SignType, request ordering, retry, timeout reconciliation, webhook/polling, rate limits, replacement workflow, return/refund workflow, offline/end-of-day transmission, and sandbox/production differences.
- Versioned compliance baseline document.

Exit gate:
- `app_id` received.
- Sandbox works.
- MTT sales-invoice template exists.
- SignType confirmed.
- Multi-tenant use confirmed.
- Replacement workflow confirmed.

This phase runs in parallel with Phases 1–4.

## Phase 1 — Foundation and Technical Specification

Goal: freeze architecture and create an independent, buildable module skeleton without integrating into POS runtime.

Deliverables:
- Technical Specification V1.
- Package boundaries and dependency rules.
- Public API contract and event contract.
- Error taxonomy and state model.
- Independent `packages/3su-einvoice` skeleton.
- Development commands for typecheck/test/build.
- Phase 1 task breakdown with explicit Definition of Done.

Exit gate:
- Technical Spec V1 reviewed and internally consistent.
- Package builds independently.
- No imports from 3SU UI/runtime code.
- No MISA implementation in core.

## Phase 2 — Core domain and compliance engine

Goal: implement fiscal domain and versioned compliance decisions.

Deliverables:
- `OutputInvoice`, immutable seller/buyer/item/totals snapshots.
- Invoice state machine.
- `CompliancePolicy`, `ComplianceDecision`, `RevenueDeclaration`, `LegalBasis`, `PolicyVersion`.
- Results such as `receipt_only`, `voluntary_einvoice`, `mandatory_einvoice`.
- Boundary tests around revenue threshold and mid-year transition.

Exit gate:
- Core has zero MISA dependency.
- Issued invoices cannot be edited.
- Policy version is persisted in every decision.
- Threshold and transition tests pass.

## Phase 3 — Persistence, idempotency and transactional outbox

Goal: guarantee no lost invoice jobs and no duplicate fiscal issuance.

Deliverables:
- D1 schema for profiles, connections, invoices, items, jobs, events, corrections, declarations and decisions.
- Unique `(shop_id, sale_id, document_kind)`.
- Unique `(shop_id, ref_id)`.
- Stable `RefID` lifecycle.
- Atomic invoice snapshot + outbox job creation.
- Tenant isolation constraints.

Exit gate:
- Replaying an API request cannot create a second invoice.
- Worker crash cannot lose an accepted job.
- Retrying never changes RefID.
- Cross-tenant read/write tests fail closed.

## Phase 4 — Mock provider and worker engine

Goal: prove orchestration before depending on MISA sandbox.

Deliverables:
- `EInvoiceProvider` contract.
- `MockMisaProvider` scenarios: success, token expiry, timeout-before-receive, timeout-after-receive, duplicate RefID, tax pending/accepted/rejected, 429, 5xx, invalid template/series, sequence conflict.
- Retry classifier: retryable, non-retryable, ambiguous, manual review.
- Series coordinator keyed by `(shopId, InvSeries)`.
- Reconciliation flow after ambiguous timeout.

Exit gate:
- Mock scenario suite passes.
- Timeout-after-receive resolves by status lookup, not duplicate issuance.
- Sequence coordinator passes concurrency tests.

## Phase 5 — MISA sandbox integration

Goal: implement real MISA transport without changing core semantics.

Deliverables:
- Authentication/token cache.
- Template discovery.
- Preview.
- Issue.
- Status lookup.
- XML/PDF download.
- Email send if supported by confirmed contract.
- Sandbox contract test suite shared with mock provider.

Exit gate:
- Auth, template, preview, issue, status, duplicate RefID, timeout-reconcile, rejection and XML/PDF all pass in sandbox.

## Phase 6 — Shop onboarding and readiness

Goal: make seller setup understandable without developer assistance.

Deliverables:
- Household-business classification and declaration flow.
- Legal/profile data collection.
- MISA connection flow.
- Readiness checks with human-readable errors.
- Template/series selection.
- Preview and activation confirmation.

Exit gate:
- A normal shop owner can reach ready state without technical intervention.

## Phase 7 — Replacement, return and refund

Goal: implement legally distinct correction workflows.

Deliverables:
- Replacement document chain.
- Full and partial return flows.
- Refund/adjustment workflow according to confirmed provider/legal contract.
- Append-only correction history.

Exit gate:
- Original documents remain immutable.
- Every derived document links to its source.
- XML/PDF and audit history remain complete.

## Phase 8 — SDK and 3SU integration

Goal: integrate only through the module contract.

Deliverables:
- SDK for issue, query-by-sale, replace, return and artifact access.
- Event integration: queued, submitting, tax_pending, issued, rejected, replaced, adjusted.
- Rename non-fiscal print actions to receipt terminology where required.
- End-to-end sale snapshot → 3su-einvoice → MISA sandbox → status → 3SU.

Exit gate:
- POS has no MISA endpoint knowledge.
- Full sandbox E2E works.

## Phase 9 — Security and production hardening

Goal: make failure safe and secrets non-observable.

Deliverables:
- Credential vault with envelope encryption/rotation.
- Tenant authorization matrix.
- Append-only audit trail.
- Secret-leak tests.
- Chaos tests around provider call and DB commit boundaries.
- Operational dashboards and alerts.

Exit gate:
- No duplicate/missing invoice path remains under tested crash scenarios.
- No cross-tenant access.
- No credential/token in logs or client surfaces.

## Phase 10 — Pilot and production rollout

Goal: validate operations with real shops before broad release.

Pilot progression:
- 3–5 shops.
- 10 shops.
- 50 shops.
- General rollout only after stability gates pass.

Pilot should include voluntary and mandatory groups, return/refund activity, unstable networks and multi-device shops.

Operational metrics:
- issued count.
- tax pending count and age.
- rejection rate.
- retry/manual review counts.
- mean issuance latency.
- token refresh failures.
- reconciliation mismatch.
- duplicate-prevention events.

Exit gate:
- No Severity 1/2 defects attributable to invoice correctness, tenant isolation or secret handling.
- Daily reconciliation is clean or fully explained by documented exceptions.

## Production gate

Production is blocked unless all of the following pass:
- MISA production `app_id` and multi-tenant confirmation.
- Confirmed production SignType and current contract.
- Core state-machine and idempotency tests.
- Transactional outbox tests.
- Duplicate RefID and timeout reconciliation tests.
- Token-expiry tests.
- Rejection workflow tests.
- Replacement and return/refund tests.
- Tenant-isolation and secret-leak tests.
- XML/PDF archive integrity.
- Immutable audit chain.
- Full sale-to-invoice E2E.
- Pilot stability gate.

## Integration rule

Until Phase 8, `3su-einvoice` must remain isolated from the 3SU POS runtime. Phase 1 may live under this repository for development convenience, but it must be structured so it can be moved to a standalone repository without semantic changes.