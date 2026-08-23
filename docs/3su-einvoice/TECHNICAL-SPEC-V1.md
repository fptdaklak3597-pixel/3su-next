# 3SU E-Invoice — Technical Specification V1

Status: Phase 1 baseline
Scope: Architecture, contracts and boundaries only. No production MISA implementation and no POS integration in Phase 1.

## 1. Purpose

`3su-einvoice` is an independent server-side module responsible for deciding invoice obligations, creating immutable fiscal snapshots, orchestrating issuance through a provider, reconciling provider/tax status, archiving invoice artifacts, and exposing a narrow API/SDK to 3SU.

The first provider is MISA meInvoice. Core behavior must remain provider-agnostic.

## 2. Non-goals for V1

V1 does not implement:
- VAT invoices.
- USB-token signing at POS.
- legal delegation authorizing 3SU to issue on behalf of a seller.
- multiple production providers.
- arbitrary editing/deleting/cancelling of issued invoices.
- browser-side credential storage.
- direct coupling to React, Dexie, Zustand or 3SU page components.

## 3. Architectural boundaries

Recommended package layout:

```text
packages/3su-einvoice/
├── src/
│   ├── core/
│   ├── compliance/
│   ├── provider/
│   ├── storage/
│   ├── application/
│   └── index.ts
├── tests/
├── package.json
├── tsconfig.json
└── README.md
```

Later phases may extract provider implementations and worker code into separate packages, but Phase 1 defines the contracts now.

Dependency direction:

```text
core            <- compliance
core            <- provider contract
core            <- storage contract
core + contracts <- application

provider-misa   -> provider contract
provider-mock   -> provider contract
worker          -> application
sdk             -> public HTTP contract
```

Forbidden dependencies:
- `core` -> MISA.
- `core` -> Cloudflare runtime.
- `core` -> React/Dexie/Zustand.
- provider implementation -> 3SU UI.

## 4. Domain model

### 4.1 OutputInvoice

Represents one fiscal document version.

Required properties conceptually:
- `invoiceId` internal immutable ID.
- `shopId` tenant boundary.
- `saleId` originating sale.
- `documentKind` such as original, replacement, adjustment.
- `state` invoice lifecycle state.
- `seller` immutable seller snapshot.
- `buyer` immutable buyer snapshot or explicit anonymous-retail representation.
- `items` immutable item snapshots.
- `totals` immutable monetary snapshot.
- `occurredAt` economic transaction time.
- `createdAt` internal creation time.
- `provider` selected provider identifier.
- `providerRefId` stable idempotency reference once allocated.
- `providerTransactionId` nullable provider result reference.
- `invoiceNumber`, `series`, `taxAuthorityCode` when assigned.
- `complianceDecisionId` decision that allowed/required issuance.
- `policyVersion` legal-policy version used.

After `issued`, fiscal payload fields are immutable.

### 4.2 SellerSnapshot

Minimum conceptual fields:
- legal name.
- tax code.
- registered address.
- selling location identity/address where legally required.

### 4.3 BuyerSnapshot

Supports:
- anonymous/retail buyer where lawful.
- named buyer.
- tax-code/legal-name/address for buyers requiring fiscal identification.

The API must not silently fabricate buyer data.

### 4.4 InvoiceItemSnapshot

Conceptual fields:
- line identity.
- description.
- quantity.
- unit.
- unit price.
- discounts/adjustments if applicable.
- line total.

All amounts used for issuance originate from an authoritative sale snapshot, not arbitrary client totals.

### 4.5 InvoiceTotals

Conceptual fields:
- subtotal.
- discount total.
- adjustment total if relevant.
- payable total.
- currency, default VND in V1.

Money must be represented using integer minor/base units appropriate for VND, never IEEE floating-point arithmetic for fiscal totals.

## 5. Compliance model

### 5.1 CompliancePolicy

Versioned rule set. A policy has:
- `policyId`.
- `effectiveFrom`.
- optional `effectiveTo`.
- legal-basis references.
- threshold/rule data.
- rule version metadata.

No invoice service may embed an unversioned revenue threshold constant as the source of truth.

### 5.2 RevenueDeclaration

Tracks what 3SU knows versus what the seller declares:
- `shopId`.
- `period`.
- `revenueObservedBy3su`.
- `externalRevenueDeclared`.
- `declaredTotal`.
- `declaredBy`.
- `declaredAt`.
- `policyVersion`.

3SU does not claim external revenue is independently verified.

### 5.3 ComplianceDecision

Output values for V1:
- `receipt_only`.
- `voluntary_einvoice`.
- `mandatory_einvoice`.
- `manual_review` when rules cannot safely determine a result.

Decision fields include:
- decision ID.
- shop ID.
- result.
- reasons.
- policy version.
- source declaration version.
- evaluated timestamp.

## 6. Invoice lifecycle

Canonical states:

```text
draft
  -> ready
  -> queued
  -> submitting
  -> provider_received
  -> tax_pending
      -> issued
      -> rejected
      -> manual_review
```

Additional terminal/derived markers:
- `replaced`.
- `adjusted`.
- `return_adjusted`.

Rules:
- only `issued` is presented externally as successfully issued.
- `rejected` is not retried unless the error classifier explicitly marks the cause retryable after correction.
- ambiguous transport failures transition into reconciliation logic, not blind reissue.
- issued fiscal payload cannot be updated or deleted.

## 7. Commands

Application-level commands to support across phases:
- `EvaluateCompliance`.
- `PrepareInvoice`.
- `PreviewInvoice`.
- `QueueInvoiceIssue`.
- `ReconcileInvoice`.
- `SendInvoiceEmail`.
- `ReplaceInvoice`.
- `RecordReturn`.
- `AdjustInvoice`.

Phase 1 defines command contracts; implementation begins later.

## 8. Domain/application events

Canonical events:
- `invoice.prepared`.
- `invoice.queued`.
- `invoice.submitting`.
- `invoice.provider_received`.
- `invoice.tax_pending`.
- `invoice.issued`.
- `invoice.rejected`.
- `invoice.manual_review`.
- `invoice.replaced`.
- `invoice.adjusted`.
- `invoice.return_adjusted`.

Every event includes:
- `eventId`.
- `shopId`.
- `invoiceId`.
- `occurredAt`.
- `eventType`.
- minimal typed payload.
- trace/correlation ID where available.

## 9. Provider contract

The domain consumes a generic provider interface. MISA-specific wire fields stay in the adapter.

Conceptual TypeScript contract:

```ts
export interface EInvoiceProvider {
  connect(input: ProviderConnectionInput): Promise<ProviderConnectionResult>;
  readiness(input: ProviderReadinessInput): Promise<ProviderReadinessResult>;
  listTemplates(input: ProviderTemplateQuery): Promise<ProviderTemplate[]>;
  preview(input: ProviderInvoiceRequest): Promise<ProviderPreviewResult>;
  issue(input: ProviderInvoiceRequest): Promise<ProviderIssueResult>;
  status(input: ProviderStatusQuery): Promise<ProviderStatusResult>;
  replace(input: ProviderReplacementRequest): Promise<ProviderIssueResult>;
  adjust(input: ProviderAdjustmentRequest): Promise<ProviderIssueResult>;
  download(input: ProviderArtifactQuery): Promise<ProviderArtifacts>;
  sendEmail(input: ProviderSendEmailRequest): Promise<ProviderSendEmailResult>;
}
```

Provider implementations must map provider-specific status/error codes into the canonical result/error model.

## 10. Idempotency and provider references

Each invoice document version receives one stable provider reference (`RefID` for MISA) before first submission.

Rules:
- retries reuse the same reference.
- ambiguous timeout triggers status lookup with the same reference.
- a new reference is only created for a genuinely new fiscal document version, such as a legally valid replacement/adjustment.
- public API idempotency is also keyed by tenant + sale + document kind.

## 11. Persistence contracts

Future D1 persistence will include at minimum:
- `einvoice_profiles`.
- `einvoice_connections`.
- `output_invoices`.
- `output_invoice_items`.
- `einvoice_jobs`.
- `einvoice_events`.
- `einvoice_corrections`.
- `revenue_declarations`.
- `compliance_decisions`.

Required uniqueness:
- `(shop_id, sale_id, document_kind)`.
- `(shop_id, provider_ref_id)` when present.

All persistence access must include `shopId` as an explicit tenant boundary.

## 12. Transactional outbox

When a sale snapshot is accepted for issuance, persistence must atomically write:
1. invoice snapshot.
2. outbox/job record.
3. initial event/audit record.

The design must not allow "invoice saved but job missing" or "job created without canonical invoice snapshot".

## 13. Concurrency and ordering

Provider issuance may require serialization by series. The application contract therefore exposes a series coordination key:

```text
(shopId, invoiceSeries)
```

Implementation is expected to use a single-writer/coordinator mechanism in later phases, likely a Cloudflare Durable Object when deployed on existing 3SU infrastructure.

## 14. Public HTTP API V1

Initial contract:

```text
POST /v1/shops/:shopId/einvoice/connections/misa
GET  /v1/shops/:shopId/einvoice/readiness

POST /v1/invoices/preview
POST /v1/invoices
GET  /v1/invoices/:invoiceId
GET  /v1/invoices/by-sale/:saleId

POST /v1/invoices/:invoiceId/replace
POST /v1/invoices/:invoiceId/return
POST /v1/invoices/:invoiceId/adjust

POST /v1/invoices/:invoiceId/send-email
GET  /v1/invoices/:invoiceId/artifacts

POST /v1/internal/reconcile
```

### API conventions

- All shop-scoped calls require authenticated tenant context and must verify URL/body `shopId` matches authorization context.
- POST operations accept an idempotency key where appropriate.
- Error responses never contain secrets, passwords, raw provider tokens or unredacted provider credential payloads.
- Fiscal-money values are serialized as integer VND amounts in V1.

## 15. Error model

Canonical categories:
- `validation_error`.
- `not_ready`.
- `compliance_blocked`.
- `auth_failed`.
- `provider_rejected`.
- `provider_rate_limited`.
- `provider_unavailable`.
- `ambiguous_provider_result`.
- `conflict`.
- `not_found`.
- `forbidden`.
- `manual_review_required`.
- `internal_error`.

Retry classification is independent from category:
- `retryable`.
- `non_retryable`.
- `ambiguous_reconcile_first`.
- `manual_review`.

## 16. Credential handling

Provider credentials are server-side only.

Hard requirements:
- never return credentials to clients after connection setup.
- never log passwords/tokens.
- never store credentials in browser state, IndexedDB, localStorage, Zustand, analytics or frontend backups.
- production storage must use authenticated encryption and key separation/rotation.
- token refresh/use is auditable without recording the token itself.

## 17. Audit model

Audit/events are append-only. Relevant events include:
- invoice created/submitted/accepted/rejected/reconciled.
- provider response classification.
- replacement/adjustment creation.
- credential created/rotated/revoked/used-for-token.
- compliance decision created/superseded.

Sensitive payloads are represented by hashes/redacted metadata, not raw secrets.

## 18. Artifact model

For issued invoices, archive:
- original XML returned/authorized by provider where available.
- PDF/rendered representation.
- metadata including invoice number, series, provider transaction ID, tax-authority code/status and timestamps.

XML is treated as the canonical archived fiscal artifact when supplied by the provider; PDF is a rendering/presentation artifact.

## 19. Offline and delayed transmission

The domain distinguishes:
- economic transaction time.
- invoice creation time.
- provider submission time.
- tax-authority acceptance/status time.

A disconnected sale may create a pending fiscal record if allowed by the confirmed legal/provider contract. It must never be displayed as `issued` until provider/tax status confirms issuance.

Exact end-of-day transmission behavior remains a Phase 0/5 contract item and must not be guessed inside V1 core logic.

## 20. Replacement, return and adjustment

These are distinct commands and document relationships.

Rules:
- mistakes in an issued invoice never mutate the original.
- replacement creates a new linked fiscal document.
- returns/refunds create the legally appropriate linked adjustment/return document after provider/legal confirmation.
- correction history is append-only and queryable as a chain.

## 21. Testing strategy

### Unit
- money/value objects.
- state transitions.
- policy decisions.
- error classification.

### Contract
- every provider implementation must pass the same canonical provider suite.

### Integration
- DB transaction + outbox.
- worker/coordinator.
- archive.

### Chaos
- crash before provider call.
- crash after provider received but before local commit.
- timeout after provider received.
- repeated idempotent requests.
- token expiry.
- provider 429/5xx.

### Security
- cross-tenant read/write attempts.
- secret redaction.
- authorization role checks.

## 22. Observability

Minimum operational dimensions:
- shop ID (non-secret identifier).
- invoice ID.
- provider.
- canonical state.
- attempt count.
- last error category.
- age in pending state.
- reconciliation outcome.

Never attach raw credentials/tokens or full sensitive buyer data to telemetry.

## 23. Versioning

- Public HTTP API uses `/v1`.
- Compliance policies have independent version IDs/effective dates.
- Provider wire adapters may version internal mappings without changing domain semantics.
- Breaking API changes require a new API version or explicit migration plan.

## 24. Phase 1 acceptance criteria

Phase 1 is complete when:
- this specification and roadmap exist in repository.
- task breakdown is explicit and reviewable.
- independent package skeleton exists under `packages/3su-einvoice`.
- package has no runtime integration with 3SU app.
- package typechecks/builds independently using repository TypeScript tooling.
- package exposes only placeholder contracts/types necessary to establish boundaries.
- no MISA HTTP calls, credentials, D1 schema or POS wiring are implemented prematurely.

## 25. Open questions gated outside Phase 1

The following must remain explicit until confirmed:
- multi-tenant `app_id` behavior.
- OAuth/delegated authorization availability.
- final production SignType.
- exact HKD MTT payload mapping.
- replacement/adjustment wire APIs.
- provider rate limits.
- webhook availability.
- offline/end-of-day semantics at MISA API level.
- sandbox/production differences.