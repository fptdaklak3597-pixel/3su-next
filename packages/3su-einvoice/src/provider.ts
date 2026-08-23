import type {
  CanonicalError,
  ProviderId,
  ProviderRefId,
  ProviderTransactionId,
  ShopId,
} from './contracts.js';
import type { OutputInvoiceSnapshot } from './domain.js';

export interface ProviderConnectionInput {
  readonly shopId: ShopId;
  readonly provider: ProviderId;
  readonly credentials: Readonly<Record<string, string>>;
}

export interface ProviderConnectionResult {
  readonly connected: boolean;
  readonly provider: ProviderId;
  readonly error?: CanonicalError;
}

export interface ProviderReadinessInput {
  readonly shopId: ShopId;
}

export interface ProviderReadinessCheck {
  readonly key: string;
  readonly ok: boolean;
  readonly message?: string;
}

export interface ProviderReadinessResult {
  readonly ready: boolean;
  readonly checks: readonly ProviderReadinessCheck[];
}

export interface ProviderTemplateQuery {
  readonly shopId: ShopId;
}

export interface ProviderTemplate {
  readonly templateId: string;
  readonly series: string;
  readonly displayName: string;
  readonly active: boolean;
}

export interface ProviderInvoiceRequest {
  readonly invoice: OutputInvoiceSnapshot;
}

export interface ProviderPreviewResult {
  readonly ok: boolean;
  readonly previewReference?: string;
  readonly error?: CanonicalError;
}

export interface ProviderIssueResult {
  readonly accepted: boolean;
  readonly providerRefId: ProviderRefId;
  readonly providerTransactionId?: ProviderTransactionId;
  readonly error?: CanonicalError;
}

export interface ProviderStatusQuery {
  readonly shopId: ShopId;
  readonly providerRefId: ProviderRefId;
  readonly providerTransactionId?: ProviderTransactionId;
}

export interface ProviderStatusResult {
  readonly status: 'pending' | 'issued' | 'rejected' | 'unknown';
  readonly providerTransactionId?: ProviderTransactionId;
  readonly invoiceNumber?: string;
  readonly series?: string;
  readonly taxAuthorityCode?: string;
  readonly error?: CanonicalError;
}

export interface ProviderReplacementRequest {
  readonly originalInvoice: OutputInvoiceSnapshot;
  readonly replacementInvoice: OutputInvoiceSnapshot;
}

export interface ProviderAdjustmentRequest {
  readonly originalInvoice: OutputInvoiceSnapshot;
  readonly adjustmentInvoice: OutputInvoiceSnapshot;
}

export interface ProviderArtifactQuery {
  readonly shopId: ShopId;
  readonly providerRefId: ProviderRefId;
}

export interface ProviderArtifacts {
  readonly xml?: Uint8Array;
  readonly pdf?: Uint8Array;
  readonly error?: CanonicalError;
}

export interface ProviderSendEmailRequest {
  readonly shopId: ShopId;
  readonly providerRefId: ProviderRefId;
  readonly recipients: readonly string[];
}

export interface ProviderSendEmailResult {
  readonly sent: boolean;
  readonly error?: CanonicalError;
}

export interface EInvoiceProvider {
  connect(input: ProviderConnectionInput): Promise<ProviderConnectionResult>;
  readiness(input: ProviderReadinessInput): Promise<ProviderReadinessResult>;
  listTemplates(input: ProviderTemplateQuery): Promise<readonly ProviderTemplate[]>;
  preview(input: ProviderInvoiceRequest): Promise<ProviderPreviewResult>;
  issue(input: ProviderInvoiceRequest): Promise<ProviderIssueResult>;
  status(input: ProviderStatusQuery): Promise<ProviderStatusResult>;
  replace(input: ProviderReplacementRequest): Promise<ProviderIssueResult>;
  adjust(input: ProviderAdjustmentRequest): Promise<ProviderIssueResult>;
  download(input: ProviderArtifactQuery): Promise<ProviderArtifacts>;
  sendEmail(input: ProviderSendEmailRequest): Promise<ProviderSendEmailResult>;
}
