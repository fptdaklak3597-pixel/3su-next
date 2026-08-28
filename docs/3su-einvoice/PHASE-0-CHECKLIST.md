# Phase 0 — MISA & legal gate checklist

External dependencies blocking production MISA adapter (Phase 5).

## P0-01 MISA sandbox access

- [ ] Email MISA: `app_id` sandbox, MST test shop, MTT template id
- [ ] Postman collection NĐ254 / TT91 confirmed
- [ ] Sandbox base URL + auth flow documented

## P0-02 Compliance baseline

- [x] `COMPLIANCE-BASELINE.md` in `3su-next/docs/3su-einvoice/`
- [ ] Open legal questions closed with advisor

## P0-03 CQT voluntary per-order

- [ ] Written CQT guidance on voluntary HKD + offline MTT stored in repo `docs/3su-einvoice/legal/`

## P0-04 Sandbox API checklist

- [ ] Auth token
- [ ] List templates / series
- [ ] Preview invoice
- [ ] Issue invoice
- [ ] Poll status
- [ ] Duplicate RefID idempotency

## P0-05 Multi-tenant confirmation

- [ ] One 3SU `app_id`, per-shop MST/account
- [ ] SignType 5/6 for HKD MTT
- [ ] Replace/adjust API paths confirmed

## Env template (cloud Worker secrets)

```
MISA_APP_ID=           # one-time 3SU app id from MISA
MISA_SANDBOX_BASE=     # optional override
EINVOICE_CREDENTIAL_KEY= # 32-byte hex for AES-GCM vault (Phase 9)
```

## Until P0-04 + P0-05

Use `provider: mock` in cloud worker (`einvoice/worker.ts`) for dev/pilot UI.
