# KẾ HOẠCH CHI TIẾT SỬA LỖI — 3su-next (bản rà lại 23-08-2026)

> Kế thay `FIX-PLAN.md` (lập 18-08, đã lỗi thời). Đối chiếu code ngày 23-08 qua 2 lượt
> audit độc lập + git history: **19/20 lỗi trong phạm vi Phase 1–3 ĐÃ SỬA XONG**
> trên nhánh `main` (27 commit 19–20/08). Kế hoạch này chỉ liệt kê việc còn lại.

## 0. Trạng thái FIX-PLAN cũ — đã xác minh

| Nhóm | Kết quả | Bằng chứng chính |
|------|---------|------------------|
| S1 nợ NCC trừ trùng | ✅ | `inventory-core.ts:205-227` giữ paid trên GR, bỏ supplierPayments.add; `suppliers.ts:35-59` 1 nguồn sự thật |
| S2 void đơn nợ → debt âm | ✅ | `sales-core.ts:288-306` allocateCustomerDebt FIFO + clamp ≥0 + phiếu hoàn âm; UI cảnh báo OrdersPage:155 |
| S3 poison op tắc sync | ✅ | `apply-core.ts:129-180` quarantine per-op; `engine.ts:407-412` lastSeq vẫn tăng; SyncDiagnosticsPanel |
| S4 delete bị upsert nuốt | ✅ | `apply-core.ts:607-621` deletedHlc tombstone cả product/customer |
| M1–M3, M8, M9, M11 | ✅ | stocktake điều chỉnh batches FEFO; stock.adjust idempotent theo mvId; PO receive 1 tx + exclusive lock; restoreLocalBackup clear outbox; fieldHlc cho customer/supplier; stocktake.commit ghi move |
| M4–M7, M10, M12 | ✅ | validate GR trước write; PO received không emit trùng; vnDay + unitRatio trong reports; perUnit NCC; payDebt throw+clamp+UI disable; seed500 enqueue op |
| L5, L8 | ✅ | 3 delete có guard HLC; parseRestoreFile gọi validateBackupSchema |
| L4 auth | ✅ | PBKDF2-SHA256 210k vòng + lockout + migration hash cũ (`auth.ts:21-140`) |
| **L7** | ❌ **CÒN** | `readiness.ts:33` thiếu invoices, priceLog, batches, purchaseOrders, supplierPayments, stocktakes, notes, pricingRules |
| **L6** | 🟡 **Một phần** | Có auto-backup ngày (`trial.ts:100-104`) nhưng chưa nhắc export file khi bản cuối quá cũ |

## Phase A — Dọn nợ còn sót từ FIX-PLAN (½ ngày)

A0. **Sửa test đỏ trên baseline** (`tests/local-auth-hardening.test.ts:98`, xác minh 23-08)
    - Hiện trạng: 477/478 pass; test "đổi mật khẩu owner phát lệnh xóa verifier"
      gọi `changePassword(owner.id, 'owner-new-pass')` thiếu `opts.currentPassword`
      → code hardening mới (`auth.ts:429-431`) throw 'Nhập mật khẩu hiện tại' — đúng thiết kế,
      test cũ chưa cập nhật.
    - Fix: truyền `{ currentPassword: 'owner-pass' }` vào lời gọi trong test; giữ nguyên assertion
      op `user.password` có `clearVerifier: true`.
    - Rủi ro: THẤP — chỉ sửa test, không đụng production code.


A1. **L7 — estimateDataSize đủ bảng** (`src/core/domain/readiness.ts:33`)
    - Thêm: invoices, priceLog, batches, purchaseOrders, supplierPayments, stocktakes, notes, pricingRules.
    - Test: `tests/` — size sau khi thêm bảng ≥ size cũ; mỗi bảng có mặt trong tổng.
    - Rủi ro: THẤP.

A2. **L6 — Nhắc xuất backup khi bản auto-backup cũ** (2 SettingsPageCore)
    - Đọc `lastBackupAt` từ meta; nếu > 7 ngày → banner "Đã X ngày chưa xuất backup ra file" + nút dẫn thẳng Export.
    - Test logic: hàm `shouldRemindExport(lastBackupAt, now)`.
    - Rủi ro: THẤP.

A3. **Cập nhật tài liệu trạng thái**: đánh dấu FIX-PLAN.md = superseded, trỏ về file này;
    sửa comment stale `types.ts:247` ("SHA-256 salted" → PBKDF2).

## Phase B — Chống hồi quy quy trình (1 ngày)

B1. **Lint phủ toàn bộ src**: package.json `lint`: `eslint src/web src/mobile` → `eslint src`
    (custom rule noDirectDbxWrites hiện KHÔNG chạy trên core/shared/admin — nơi quan trọng nhất).
    Sửa hết warning lộ ra (không tắt rule).

B2. **Typecheck tests/**: tsconfig include thêm `tests` (hiện tests chỉ được vitest transpile,
    lỗi type trong test không chặn CI).

B3. **CI thêm bước đối chiếu**: bật `vitest --coverage --thresholds.lines=70` (hoặc số hợp lý
    sau khi đo baseline); cân nhắc gitleaks secret-scan.

## Phase C — Hiệu năng scale (2–3 ngày, làm trước khi mở rộng tính năng)

C1. **Query sales theo index** thay vì toArray() toàn bảng:
    - `ReportsPage` (web): buildReport nhận mảng → đổi thành đọc `sales.where('date').between(from,to)`
      hoặc materialized view theo ngày.
    - `CustomersPage`, `CheckoutPage`, `SalePage`: dùng index `[date+voided]` / `customerId`.
    - `sales-core.ts:288-291` void quét filter() → `.where('customerId').equals(...)`.
    - Test: convergence + report không đổi kết quả với dataset seed 500.
    - Rủi ro: TRUNG BÌNH — đụng đường đọc dữ liệu mọi page; phải giữ nguyên output báo cáo
      (đã có test reconcile line/payment level làm lưới an toàn).

C2. **GC bằng cursor** (`engine.ts gcAppliedOps/gcPriceLog`): thay toArray() bằng
    `.each()` cursor + index timestamp; giới hạn số xóa/flush.

C3. **Export/snapshot streaming** (`snapshot.ts`, `db-core.ts`): ghi từng bảng tuần tự
    vào stream thay vì gom object lớn trong RAM; gzip chunk.

## Phase D — Phục hồi thiết bị offline lâu (cần phối hợp server 3su-cloud, 1–2 ngày)

D1. Server trả `minSeqAvailable` trong response pull; client thấy `lastSeq < minSeq` →
    tự động catchUpSnapshot (hiện chỉ chạy khi lastSeq===0).
    - Client: engine.ts pull gap detection; test mô phỏng thiết bị lag vượt cửa sổ GC.
D2. Backup JSON mã hóa AES-GCM bằng mật khẩu (WebCrypto, có sẵn PBKDF2 util ở auth.ts)
    + cảnh báo plaintext khi người dùng bỏ trống mật khẩu.

## Phase E — Cứng hóa nhỏ còn lại (tuỳ chọn, ½ ngày)

E1. `batchProjection.ts` residual: log cảnh báo (errorLogger) khi Σremain lệch p.stock
    sau projection-repair thay vì im lặng.
E2. `voidSale` bọc `withExclusiveLock('sale-commit')` như confirmSale (chống double-click 2 tab).
E3. Op envelope thêm `schemaVersion`; reducer hỗ trợ N-1.
E4. Retry push backoff + jitter thay interval cố định 30s.

---

## Tiêu chí hoàn thành

- [ ] Phase A: L7/L6 đóng + tài liệu cập nhật.
- [ ] Phase B: lint/typecheck phủ toàn repo, CI xanh.
- [ ] Phase C: load thử dataset 50k sales — Reports mở < 500ms; test converge vẫn xanh.
- [ ] Phase D: kịch bản "offline 40 ngày rồi online" phục hồi không mất dữ liệu.
- [ ] Sau mỗi fix: test mới fail-trước-pass-sau, `tsc -b --noEmit` sạch, 199+ test cũ xanh.

## Quy tắc thực thi (giữ từ FIX-PLAN cũ)

1 fix = 1 commit (message theo ID: `fix(L7): ...`). Impact analysis GitNexus trước khi sửa
hàm public domain/sync/db/auth. Không đụng các phần đã xác minh đúng (outbox atomic, HLC,
giá vốn bình quân, FEFO). Sau Phase A+B: chạy `npm run build:all` trước khi merge.
