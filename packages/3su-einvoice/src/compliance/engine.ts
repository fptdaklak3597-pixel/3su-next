import type { ComplianceDecision, ComplianceEvaluationInput } from './types.js';
import { HK_2026_V1_POLICY, HKD_MANDATORY_THRESHOLD_VND } from './policy-hk-2026-v1.js';

/**
 * Pure compliance evaluation — no MISA, no network.
 * Threshold uses declared total revenue (3SU observed + external declared).
 */
export function evaluateCompliance(input: ComplianceEvaluationInput): ComplianceDecision {
  const { profile, declaration, saleContext, decisionId, evaluatedAt } = input;
  const policyVersion = HK_2026_V1_POLICY.policyId;

  const exempt = saleContext?.legalExempt;
  if (exempt?.legalBasisCode) {
    const base: ComplianceDecision = {
      decisionId,
      shopId: profile.shopId,
      result: 'legal_exempt',
      reasons: [`Ngoại lệ pháp lý: ${exempt.legalBasisCode}`],
      policyVersion,
      evaluatedAt,
      legalBasisCode: exempt.legalBasisCode,
    };
    if (declaration) {
      return { ...base, declarationId: declaration.declarationId, declaredTotal: declaration.declaredTotal };
    }
    return base;
  }

  if (!declaration) {
    return {
      decisionId,
      shopId: profile.shopId,
      result: 'manual_review',
      reasons: ['Chưa có khai báo doanh thu — không thể đánh giá ngưỡng'],
      policyVersion,
      evaluatedAt,
    };
  }

  const declaredTotal = declaration.declaredTotal;
  const aboveThreshold = declaredTotal > HKD_MANDATORY_THRESHOLD_VND;
  const atOrBelowThreshold = declaredTotal <= HKD_MANDATORY_THRESHOLD_VND;

  if (aboveThreshold) {
    return {
      decisionId,
      shopId: profile.shopId,
      result: 'mandatory_einvoice',
      reasons: [
        `Tổng doanh thu khai báo ${declaredTotal} VND vượt ngưỡng ${HKD_MANDATORY_THRESHOLD_VND} VND/năm`,
      ],
      policyVersion,
      declarationId: declaration.declarationId,
      declaredTotal,
      evaluatedAt,
    };
  }

  if (atOrBelowThreshold && profile.cqtRegistrationAccepted && profile.voluntaryEinvoiceEnabled) {
    return {
      decisionId,
      shopId: profile.shopId,
      result: 'voluntary_einvoice',
      reasons: ['Shop tự nguyện đăng ký và đã kích hoạt HĐĐT'],
      policyVersion,
      declarationId: declaration.declarationId,
      declaredTotal,
      evaluatedAt,
    };
  }

  if (atOrBelowThreshold && !profile.cqtRegistrationAccepted && !profile.voluntaryEinvoiceEnabled) {
    return {
      decisionId,
      shopId: profile.shopId,
      result: 'receipt_only',
      reasons: ['Doanh thu dưới ngưỡng và chưa kích hoạt HĐĐT'],
      policyVersion,
      declarationId: declaration.declarationId,
      declaredTotal,
      evaluatedAt,
    };
  }

  if (atOrBelowThreshold && profile.cqtRegistrationAccepted && !profile.voluntaryEinvoiceEnabled) {
    return {
      decisionId,
      shopId: profile.shopId,
      result: 'receipt_only',
      reasons: ['Đã đăng ký CQT nhưng chưa kích hoạt xuất HĐĐT trong 3SU'],
      policyVersion,
      declarationId: declaration.declarationId,
      declaredTotal,
      evaluatedAt,
    };
  }

  return {
    decisionId,
    shopId: profile.shopId,
    result: 'manual_review',
    reasons: ['Không khớp quy tắc compliance đã định nghĩa'],
    policyVersion,
    declarationId: declaration.declarationId,
    declaredTotal,
    evaluatedAt,
  };
}

/** Whether a sale must produce an e-invoice (not receipt-only or legal exempt). */
export function requiresEinvoice(decision: ComplianceDecision): boolean {
  return decision.result === 'voluntary_einvoice' || decision.result === 'mandatory_einvoice';
}
