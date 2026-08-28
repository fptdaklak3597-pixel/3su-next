import { describe, expect, it } from 'vitest';
import { evaluateCompliance, requiresEinvoice } from '../src/compliance/engine.js';
import {
  HKD_MANDATORY_THRESHOLD_VND,
  HK_2026_V1_POLICY_ID,
} from '../src/compliance/policy-hk-2026-v1.js';
import type { ComplianceEvaluationInput, ShopComplianceProfile } from '../src/compliance/types.js';
import type { RevenueDeclaration } from '../src/core/domain.js';

function profile(overrides: Partial<ShopComplianceProfile> = {}): ShopComplianceProfile {
  return {
    shopId: 'shop_1',
    cqtRegistrationAccepted: false,
    voluntaryEinvoiceEnabled: false,
    ...overrides,
  };
}

function makeDeclaration(total: number): RevenueDeclaration {
  return {
    declarationId: 'decl_1',
    shopId: 'shop_1',
    period: '2026',
    revenueObservedBy3su: Math.floor(total / 2),
    externalRevenueDeclared: total - Math.floor(total / 2),
    declaredTotal: total,
    declaredBy: 'owner',
    declaredAt: '2026-08-01T00:00:00.000Z',
    policyVersion: HK_2026_V1_POLICY_ID,
  };
}

function evalInput(
  overrides: Partial<ComplianceEvaluationInput> = {},
): ComplianceEvaluationInput {
  return {
    decisionId: 'dec_1',
    profile: profile(),
    declaration: makeDeclaration(500_000_000),
    evaluatedAt: '2026-08-23T00:00:00.000Z',
    ...overrides,
  };
}

describe('evaluateCompliance hk-2026-v1', () => {
  it('returns receipt_only below threshold without activation', () => {
    const d = evaluateCompliance(evalInput());
    expect(d.result).toBe('receipt_only');
    expect(requiresEinvoice(d)).toBe(false);
  });

  it('returns voluntary_einvoice when registered and enabled under threshold', () => {
    const d = evaluateCompliance(
      evalInput({
        profile: profile({
          cqtRegistrationAccepted: true,
          voluntaryEinvoiceEnabled: true,
        }),
      }),
    );
    expect(d.result).toBe('voluntary_einvoice');
    expect(requiresEinvoice(d)).toBe(true);
  });

  it('returns mandatory_einvoice above 1 billion VND', () => {
    const d = evaluateCompliance(
      evalInput({
        declaration: makeDeclaration(HKD_MANDATORY_THRESHOLD_VND + 1),
      }),
    );
    expect(d.result).toBe('mandatory_einvoice');
    expect(requiresEinvoice(d)).toBe(true);
  });

  it('treats exactly 1 billion as not mandatory', () => {
    const d = evaluateCompliance(
      evalInput({
        declaration: makeDeclaration(HKD_MANDATORY_THRESHOLD_VND),
      }),
    );
    expect(d.result).toBe('receipt_only');
  });

  it('returns legal_exempt when sale has legal basis code', () => {
    const d = evaluateCompliance(
      evalInput({
        saleContext: {
          legalExempt: { legalBasisCode: 'ND254-D7-EXAMPLE', confirmedBy: 'owner' },
        },
      }),
    );
    expect(d.result).toBe('legal_exempt');
    expect(d.legalBasisCode).toBe('ND254-D7-EXAMPLE');
    expect(requiresEinvoice(d)).toBe(false);
  });

  it('returns manual_review without revenue declaration', () => {
    const d = evaluateCompliance(evalInput({ declaration: null }));
    expect(d.result).toBe('manual_review');
  });
});
