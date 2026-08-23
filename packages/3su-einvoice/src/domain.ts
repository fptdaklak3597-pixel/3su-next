import type {
  ComplianceDecisionId,
  DocumentKind,
  InvoiceId,
  InvoiceState,
  PolicyVersion,
  ProviderId,
  ProviderRefId,
  ProviderTransactionId,
  SaleId,
  ShopId,
  VndAmount,
} from './contracts.js';

export interface SellerSnapshot {
  readonly legalName: string;
  readonly taxCode: string;
  readonly registeredAddress: string;
  readonly sellingLocationId?: string;
  readonly sellingLocationName?: string;
  readonly sellingLocationAddress?: string;
}

export type BuyerSnapshot =
  | {
      readonly kind: 'anonymous_retail';
    }
  | {
      readonly kind: 'identified';
      readonly legalName: string;
      readonly taxCode?: string;
      readonly address?: string;
      readonly email?: string;
    };

export interface InvoiceItemSnapshot {
  readonly lineId: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit?: string;
  readonly unitPrice: VndAmount;
  readonly discountAmount: VndAmount;
  readonly adjustmentAmount: VndAmount;
  readonly lineTotal: VndAmount;
}

export interface InvoiceTotals {
  readonly subtotal: VndAmount;
  readonly discountTotal: VndAmount;
  readonly adjustmentTotal: VndAmount;
  readonly payableTotal: VndAmount;
  readonly currency: 'VND';
}

export interface OutputInvoiceSnapshot {
  readonly invoiceId: InvoiceId;
  readonly shopId: ShopId;
  readonly saleId: SaleId;
  readonly documentKind: DocumentKind;
  readonly state: InvoiceState;
  readonly seller: SellerSnapshot;
  readonly buyer: BuyerSnapshot;
  readonly items: readonly InvoiceItemSnapshot[];
  readonly totals: InvoiceTotals;
  readonly occurredAt: string;
  readonly createdAt: string;
  readonly provider: ProviderId;
  readonly providerRefId?: ProviderRefId;
  readonly providerTransactionId?: ProviderTransactionId;
  readonly invoiceNumber?: string;
  readonly series?: string;
  readonly taxAuthorityCode?: string;
  readonly complianceDecisionId: ComplianceDecisionId;
  readonly policyVersion: PolicyVersion;
}

export interface RevenueDeclaration {
  readonly declarationId: string;
  readonly shopId: ShopId;
  readonly period: string;
  readonly revenueObservedBy3su: VndAmount;
  readonly externalRevenueDeclared: VndAmount;
  readonly declaredTotal: VndAmount;
  readonly declaredBy: string;
  readonly declaredAt: string;
  readonly policyVersion: PolicyVersion;
}
