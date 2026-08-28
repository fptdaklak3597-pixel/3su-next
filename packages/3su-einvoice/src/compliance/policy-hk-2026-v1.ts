import type { CompliancePolicy } from './types.js';

export const HK_2026_V1_POLICY_ID = 'hk-2026-v1';

/** NĐ 141/2026 — HKD trên 1 tỷ/năm bắt buộc HĐĐT */
export const HKD_MANDATORY_THRESHOLD_VND = 1_000_000_000;

export const HK_2026_V1_POLICY: CompliancePolicy = {
  policyId: HK_2026_V1_POLICY_ID,
  effectiveFrom: '2026-01-01',
  mandatoryThresholdVnd: HKD_MANDATORY_THRESHOLD_VND,
  legalBasisRefs: [
    'NĐ 141/2026/NĐ-CP',
    'NĐ 254/2026/NĐ-CP',
    'TT 91/2026/TT-BTC',
  ],
};
