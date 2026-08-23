export const INVOICE_STATES = [
  'draft',
  'ready',
  'queued',
  'submitting',
  'provider_received',
  'tax_pending',
  'issued',
  'rejected',
  'manual_review',
  'replaced',
  'adjusted',
  'return_adjusted',
] as const;

export type InvoiceState = (typeof INVOICE_STATES)[number];

export const DOCUMENT_KINDS = [
  'original',
  'replacement',
  'adjustment',
  'return_adjustment',
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const COMPLIANCE_RESULTS = [
  'receipt_only',
  'voluntary_einvoice',
  'mandatory_einvoice',
  'manual_review',
] as const;

export type ComplianceResult = (typeof COMPLIANCE_RESULTS)[number];

export const ERROR_CATEGORIES = [
  'validation_error',
  'not_ready',
  'compliance_blocked',
  'auth_failed',
  'provider_rejected',
  'provider_rate_limited',
  'provider_unavailable',
  'ambiguous_provider_result',
  'conflict',
  'not_found',
  'forbidden',
  'manual_review_required',
  'internal_error',
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export const RETRY_CLASSIFICATIONS = [
  'retryable',
  'non_retryable',
  'ambiguous_reconcile_first',
  'manual_review',
] as const;

export type RetryClassification = (typeof RETRY_CLASSIFICATIONS)[number];

export const INVOICE_EVENT_TYPES = [
  'invoice.prepared',
  'invoice.queued',
  'invoice.submitting',
  'invoice.provider_received',
  'invoice.tax_pending',
  'invoice.issued',
  'invoice.rejected',
  'invoice.manual_review',
  'invoice.replaced',
  'invoice.adjusted',
  'invoice.return_adjusted',
] as const;

export type InvoiceEventType = (typeof INVOICE_EVENT_TYPES)[number];

export type ShopId = string;
export type SaleId = string;
export type InvoiceId = string;
export type ComplianceDecisionId = string;
export type EventId = string;
export type CorrelationId = string;
export type PolicyVersion = string;
export type ProviderId = string;
export type ProviderRefId = string;
export type ProviderTransactionId = string;

/** Integer Vietnamese dong. Fractional VND and IEEE-754 arithmetic are forbidden for fiscal calculations. */
export type VndAmount = number;

export interface CanonicalError {
  readonly category: ErrorCategory;
  readonly retry: RetryClassification;
  readonly code: string;
  readonly message: string;
  readonly providerCode?: string;
}

export interface InvoiceEvent<TPayload = Readonly<Record<string, unknown>>> {
  readonly eventId: EventId;
  readonly shopId: ShopId;
  readonly invoiceId: InvoiceId;
  readonly occurredAt: string;
  readonly eventType: InvoiceEventType;
  readonly correlationId?: CorrelationId;
  readonly payload: TPayload;
}
