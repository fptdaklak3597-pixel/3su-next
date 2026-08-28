import type {
  ComplianceDecisionId,
  ComplianceResult,
  PolicyVersion,
  ShopId,
} from '../core/contracts.js';
import type { RevenueDeclaration } from '../core/domain.js';

export interface ShopComplianceProfile {
  readonly shopId: ShopId;
  /** Tờ khai HĐĐT đã được CQT chấp nhận */
  readonly cqtRegistrationAccepted: boolean;
  /** Shop bật xuất HĐĐT tự nguyện trong 3SU (khi còn dưới ngưỡng) */
  readonly voluntaryEinvoiceEnabled: boolean;
}

export interface SaleLegalExemptContext {
  readonly legalBasisCode: string;
  readonly confirmedBy: string;
  readonly evidenceRef?: string;
}

export interface SaleComplianceContext {
  readonly legalExempt?: SaleLegalExemptContext;
}

export interface ComplianceEvaluationInput {
  readonly decisionId: ComplianceDecisionId;
  readonly profile: ShopComplianceProfile;
  readonly declaration: RevenueDeclaration | null;
  readonly saleContext?: SaleComplianceContext;
  readonly evaluatedAt: string;
}

export interface ComplianceDecision {
  readonly decisionId: ComplianceDecisionId;
  readonly shopId: ShopId;
  readonly result: ComplianceResult;
  readonly reasons: readonly string[];
  readonly policyVersion: PolicyVersion;
  readonly declarationId?: string;
  readonly declaredTotal?: number;
  readonly evaluatedAt: string;
  readonly legalBasisCode?: string;
}

export interface CompliancePolicy {
  readonly policyId: PolicyVersion;
  readonly effectiveFrom: string;
  readonly mandatoryThresholdVnd: number;
  readonly legalBasisRefs: readonly string[];
}
