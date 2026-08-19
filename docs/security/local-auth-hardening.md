# Local credential hardening

- New credentials use versioned PBKDF2-HMAC-SHA-256 verifiers.
- Existing legacy SHA-256/FNV verifiers remain readable and are upgraded after a successful login.
- Owner/admin credentials require at least 8 characters; staff credentials require at least 6.
- Failed logins are throttled per username on each device.
- Owner/admin verifier material is never included in new sync profile payloads; remote devices receive a disabled verifier and must reset locally.
- Staff verifier sync remains for the intentional offline staff-login workflow.

This migration is backward-compatible at read time. No plaintext password is stored or exported by this change.
