# 3SU E-Invoice — Compliance Baseline (HKD)

Policy ID: `hk-2026-v1`
Effective: 2026-01-01
Status: Draft — confirm edge cases with CQT before production marketing.

## Subject

Household business / individual business household (hộ kinh doanh / cá nhân kinh doanh) using 3SU Next POS.

## Threshold

| Total annual revenue (all channels) | Obligation |
|-----------------------------------|------------|
| ≤ 1,000,000,000 VND | Not required to use e-invoice for ordinary retail |
| > 1,000,000,000 VND | Required: e-invoice with tax code or cash-register invoice connected to CQT |
| Voluntary registration | Must issue when selling (except legal exemptions) |

Revenue includes: counter, social, marketplaces, other software — not only 3SU-recorded sales.

## Document type V1

- Sales invoice from cash register (hóa đơn bán hàng khởi tạo từ máy tính tiền / MTT).
- Not VAT invoice (hóa đơn GTGT) in V1.

## Legal references

- NĐ 141/2026/NĐ-CP (threshold 1 tỷ)
- NĐ 254/2026/NĐ-CP (MTT, exceptions Điều 7)
- TT 91/2026/TT-BTC
- Luật Quản lý thuế 108/2025/QH15 (buyer right to request invoice)

## Article 7 exemptions (mandatory shops)

When shop is in mandatory mode but transaction is legally exempt from invoicing:
- Compliance result: `legal_exempt`
- Required: `legalBasisCode`, operator, timestamp, optional evidence reference
- Must not display as issued e-invoice

## Open questions (Phase 0 — written CQT reply)

1. Voluntary registered shop: may seller skip per-order issuance for walk-in retail?
2. Offline MTT: end-of-day transmission vs must be online at sale time?
3. Single customer request invoice before registration for sub-1B shop?

## 3SU product rules

- Receipt/phiếu bán hàng ≠ hóa đơn điện tử when HĐĐT not active.
- No backdated issuance.
- Credentials never in browser/backup.
