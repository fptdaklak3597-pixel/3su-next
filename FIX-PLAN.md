# KẾ HOẠCH SỬA LỖI — 3su-next v4.0 (từ báo cáo ANALYSIS-BUSINESS-LOGIC.md)

- **Ngày lập kế hoạch:** 2026-08-18
- **Nguồn:** `ANALYSIS-BUSINESS-LOGIC.md` (review 2026-08-04, 2 lượt đọc độc lập + 6 probe thực nghiệm)
- **Trạng thái:** CHỈ KẾ HOẠCH — chưa sửa dòng code nào. Mọi fix bắt đầu sau khi kế hoạch được duyệt.
- **Baseline đã xác minh lại hôm nay (18:13):** vitest **199/199 pass** (25 file), `tsc -b --noEmit` **0 lỗi**, HEAD = `fee201c` (branch `feat/sync-core-v2`), toàn bộ file anchors trong báo cáo còn nguyên.

## 0. Tổng quan catalog lỗi cần xử lý

| Nhóm | Số lượng | Định nghĩa |
|---|---|---|
| Severity 1 (S) | 5 | Sai tiền/nợ, tắc sync vĩnh viễn, mất dữ liệu |
| Severity 2 (M) | 12 | Sai số liệu báo cáo, lệch kho/ledger, idempotency, toàn vẹn thao tác |
| Severity 3 (L) | 8 | Ghi chú thấp: L1-L4 liên quan Plan 3/server, L5-L8 sửa được ở client |
| Câu hỏi nghiệp vụ | 6 | Gating — phải có câu trả lời trước khi sửa S1, S2, S5, M1, M2, M3 |

**Quyết định phạm vi:** sửa ngay S1-S4, M1-M12, L5, L7, L8 (20/22 lỗi). Hoãn sang Plan 3/server: **S5, L1, L2, L3** (đòi hỏi spec server — câu hỏi Q4). Hoãn: **L4** (bảo mật auth, cần kế hoạch migrate hash) và **L6** (UX nhắc export file).

---

## 1. NGUYÊN TẮC SỬA (áp dụng cho mọi fix)

1. **Test-first:** mỗi lỗi phải có test tái hiện thất bại TRƯỚC khi sửa, xanh SAU khi sửa (mô phỏng lại probe của báo cáo thành test chính thức trong `tests/`).
2. **Không phá baseline:** 199/199 test cũ phải giữ xanh + test mới thêm vào; `tsc -b --noEmit` phải sạch sau mỗi commit.
3. **Impact analysis trước khi sửa** mọi hàm public trong `domain/`, `sync/`, `db/`, `auth/` (quy tắc AGENTS.md + Cursor override): chạy `impact` (GitNexus) theo hướng upstream, báo blast radius; cảnh báo người dùng nếu HIGH/CRITICAL. `detect_changes()` trước mỗi commit.
4. **1 lỗi = 1 commit**, message theo ID (vd `fix(S1): chốt nguồn sự thật công nợ NCC`). Không gộp nhiều lỗi khác nhóm.
5. **Không đụng phần đã xác minh đúng** (mục 4 của báo cáo): idempotency chứng từ, confirmSale lock, giá vốn bình quân, stockMoves, cartUnitPrice, HLC, mode solo.
6. **UI cảnh báo** đi kèm khi fix domain làm thay đổi hành vi người dùng (S2, M10).
7. Sau mỗi fix: cập nhật trạng thái vào bảng theo dõi cuối file này + đánh dấu trong `ANALYSIS-BUSINESS-LOGIC.md`.

## 2. CÂU HỎI NGHIỆP VỤ PHẢI CHỐT TRƯỚC (Phase 0)

| # | Câu hỏi | Quyết định ảnh hưởng |
|---|---|---|
| Q1 | Trả tiền ngay tại phiếu nhập: giữ **một** nguồn sự thật nào? (a) chỉ `GR.paid`, bỏ `SupplierPayment`; (b) chỉ `SupplierPayment` (kèm `refId`), bỏ `GR.paid` khi cash/transfer — đề xuất của reviewer là (b) vì đồng bộ được nguyên vẹn qua op `supplier.pay` | **S1** |
| Q2 | Hủy đơn bán nợ khi khách đã trả một phần/toàn bộ: (a) clamp nợ ≥ 0 + cảnh báo; (b) chặn hủy khi có phiếu thu; (c) tạo bút toán credit minh bạch (hoàn tiền mặt) | **S2**, M10 |
| Q3 | `allowNegativeStock` mặc định `true` có phải chủ đích không? Đổi `false` + cảnh báo trước khi chốt đơn? | **M1** |
| Q4 | Snapshot Plan 3: máy nào chụp, `seq` do server gán thật chứ? (quyết định S5 sửa ở client hay server) | **S5** (hoãn) |
| Q5 | GC `appliedOps` 30 ngày: chấp nhận đổi GC lên 365 ngày + idempotency theo `stockMoves` cho `stock.adjust`? | **M2** |
| Q6 | Có kế hoạch nhận PO theo đơn vị thùng/lốc không (hiện hardcode `unitRatio: 1`)? | **M3** (nếu có → thêm việc riêng) |

## 3. PHÂN PHA THỰC HIỆN

```
Phase 0  Chuẩn bị + chốt Q1-Q6                      (1 buổi)
Phase 1  Quick wins domain — độc lập, rủi ro thấp    (M4 M5 M6 M7 M10 M12 L7 L8)
Phase 2  Đúng tiền-nợ-kho — cần chốt nghiệp vụ       (S1 S2 M1 M2 M3 M8 M9 M11)
Phase 3  Cứng hóa reducer sync — không cần server    (S3 S4 L5)
Phase 4  Plan 3 / server                             (S5 L1 L2 L3) — HOÃN, chờ Q4
Tùy chọn Bảo mật & UX                                (L4 L6) — HOÃN
```

Thứ tự có chủ đích:
- **Phase 1 trước** vì không đụng kiến trúc sync, không phụ thuộc quyết định nghiệp vụ; sửa nhanh các con số báo cáo sai (M6/M7), dữ liệu ma (M4), hiển thị trùng (M5).
- **Phase 2 sau khi có câu trả lời Q1-Q3, Q5** vì đây là nhóm "đúng tiền": công nợ NCC/KH, tồn kho 2 nguồn sự thật, idempotency, khôi phục backup.
- **Phase 3 trước Phase 4** vì quarantine per-op (S3) là lá chắn client cho kịch bản op độc (giao với M12); tombstone (S4) và guard delete (L5) thuần client, không phụ thuộc spec server.
- **Phase 4** phụ thuộc hoàn toàn vào thiết kế server Plan 3 (Q4) — không thể sửa đúng nếu chưa có spec.

---

## 4. CHI TIẾT TỪNG FIX

### PHASE 0 — Chuẩn bị
- [ ] Tạo nhánh mới từ `feat/sync-core-v2` (vd `fix/business-logic-v1`).
- [ ] Chốt Q1-Q6 với chủ shop (điền đáp án vào mục 2).
- [ ] Kiểm tra GitNexus index tươi (`node .gitnexus/run.cjs analyze` nếu cần).
- [ ] Lập bảng theo dõi trạng thái (cuối file này).

### PHASE 1 — Quick wins domain (8 fix, độc lập)

**M4 — "Nợ ma" khi phiếu nhập chứa SP không tồn tại** — `domain/inventory.ts` `saveGoodsReceipt`
- Dự kiến: validate toàn bộ `productId` tồn tại TRƯỚC transaction; `throw` kèm tên SP thiếu; nếu chấp nhận bỏ dòng thì tính lại `total` theo số dòng thực áp.
- Test: `tests/goods-receipt.test.ts` — GR chứa 1 SP đã xóa → expect throw (hoặc total chỉ tính dòng hợp lệ, theo quyết định).
- Rủi ro: THẤP — thuần domain, không đụng sync. UI GoodsReceiptPage cần bắt lỗi hiển thị.

**M5 — PO đã nhập hiện 2 dòng / nợ hiển thị sai** — `domain/purchase.ts` `aggregatePurchases`
- Dự kiến: khi `po.status==='received'` không emit entry `po:` (hoặc emit với debt thật = ΣGR − Σpaid).
- Test: aggregate sau receive → chỉ 1 dòng, tổng nợ đếm 1 lần.
- Rủi ro: THẤP — thuần đọc/tổng hợp.

**M6 — Báo cáo MTD lệch tháng (UTC) + qty không × unitRatio** — `domain/reports.ts` `resolveRange`, `topProducts`; `domain/sales.ts` `dayStats`
- Dự kiến: dùng `localDay` (đã có sẵn) thay `toISOString`; nhân `unitRatio` khi đếm qty/items.
- Test: biên 00:30 mùng 1 (UTC+7) → `from` = đầu tháng hiện tại; topProducts với thùng 24.
- Rủi ro: THẤP — hàm thuần; lưu ý không làm đổi hành vi các preset khác.

**M7 — So sánh giá NCC bỏ qua unitRatio** — `domain/suppliers.ts` `compareSupplierPrices`
- Dự kiến: quy đổi `perUnit = (row.cost * row.qty) / (row.qty * row.unitRatio)`.
- Test: NCC A chai 10k vs NCC B thùng 240k (r=24) → B rẻ hơn A.
- Rủi ro: THẤP.

**M10 — Trả nợ khách quá dư → nợ âm** — `domain/customers.ts` `payDebt` + UI web/mobile CustomersPage
- Dự kiến: clamp/throw trong domain (`amount = Math.min(amount, Math.max(0, debt))` hoặc throw theo Q2); UI disable nút Lưu khi `payAmount > debt`.
- Test: payDebt 500k trên nợ 100k → debt = 0 (không âm).
- Rủi ro: THẤP-TRUNG BÌNH — đổi hành vi nhập liệu; cần thông báo rõ trong UI.

**M12 — `seed500` không tạo op → máy khác không thấy + có thể thành op độc** — `domain/seed.ts`
- Dự kiến: sinh 500 op `product.upsert` vào `syncQueue` (hoặc 1 op batch `seed.apply` + reducer riêng — chọn theo khối lượng op chấp nhận được).
- Test: sau `seed500` → `syncQueue.count() >= 500` (hoặc 1); máy nhận áp được.
- Rủi ro: TRUNG BÌNH — thay đổi cơ chế seed; cần đảm bảo idempotent khi áp (upsert đã có fieldHlc).

**L7 — `estimateDataSize` đếm thiếu bảng** — `domain/readiness.ts`
- Dự kiến: đếm đủ invoices/priceLog/notes/batches/purchaseOrders/supplierPayments/stockMoves/…
- Test: size ước lượng ≥ trước.
- Rủi ro: THẤP.

**L8 — Restore từ file không validate schema** — `mobile/SettingsPage.tsx`, `web/SettingsPage.tsx`
- Dự kiến: gọi `validateBackupSchema(data)` (đã có trong `domain/trial.ts`) trước khi `setConfirmRestore`.
- Test: file backup hỏng → báo lỗi, không vào confirm.
- Rủi ro: THẤP — thuần UI guard.

### PHASE 2 — Đúng tiền-nợ-kho (8 fix, cần Q1-Q3/Q5)

**S1 — Nợ NCC trừ trùng + lệch giữa các máy** — `domain/inventory.ts` `saveGoodsReceipt`; `domain/suppliers.ts` `supplierDebt`, `supplierMonthlyStatement`; `sync/apply.ts` case `gr.commit`
- Dự kiến (theo Q1): chọn (b) — thanh toán tại GR chỉ ghi `SupplierPayment` (kèm `refId`), `GR.paid` giữ 0 khi cash/transfer; `supplierDebt`/`supplierMonthlyStatement` chỉ dùng một vế; case `gr.commit` mang kèm op `supplier.pay` (hoặc payload mở rộng) để máy remote tái tạo phiếu chi. Nếu chọn (a): `supplierDebt` chỉ dùng `owed`, bỏ trừ payments.
- Test: nhập 100 trả 70 → nợ = 30 trên MỌI máy; sao kê NCC không nhân đôi; apply `gr.commit` trên máy nhận tạo đủ phiếu chi.
- Rủi ro: **CAO** — đụng mô hình công nợ + payload op sync; phải impact analysis `saveGoodsReceipt`/`supplierDebt`/case `gr.commit`; **cần migrate dữ liệu cũ** (GR đang có paid>0 lẫn SupplierPayment trùng → script quy chuẩn).

**S2 — Hủy đơn nợ đã thu → nợ khách âm** — `domain/sales.ts` `voidSale`; `domain/customers.ts` `payDebt`; UI Orders/Checkout
- Dự kiến (theo Q2): clamp `c.debt = Math.max(0, c.debt - sale.debtAmount)`; UI cảnh báo "Khách đã trả Xđ cho đơn này" trước khi xác nhận hủy; hoặc chặn hủy / tạo bút toán credit tùy đáp án.
- Test: bán nợ 100 → thu 100 → hủy → debt = 0 (không âm), có cảnh báo.
- Rủi ro: **CAO về nghiệp vụ** — hành vi hủy đơn đổi; cần Q2 chốt rõ; impact analysis `voidSale`, `payDebt`.

**M1 — `p.stock` vs `batch.remain` lệch (2 nguồn sự thật)** — `domain/inventory.ts` `saveStocktake`, `updateProduct`, `saveGoodsReceipt`; `domain/reconcile.ts`
- Dự kiến: khi set stock tuyệt đối → điều chỉnh `batches` theo FEFO (trừ lô cũ nhất trước, chênh lệch ghi nhận); thêm check `Σremain ≤ stock` vào `reconcileBooks`; cảnh báo trước chốt đơn khi `allowNegativeStock=false` (theo Q3).
- Test: kiểm kê giảm dưới Σbatch.remain → batches được trừ theo FEFO, không còn âm khi xuất; reconcile phát hiện lệch.
- Rủi ro: **CAO** — đụng logic xuất kho FEFO + kiểm kê; phải giữ nguyên giá vốn bình quân đã đúng; impact analysis `consumeBatchesFefo` liên quan.

**M2 — `stock.adjust` không tự idempotent** — `sync/apply.ts` case `stock.adjust`; `sync/engine.ts` `gcAppliedOps`
- Dự kiến (theo Q5): trước khi cộng delta, kiểm tra `stockMoves` có `id === 'mv_' + op.id` → bỏ qua nếu đã áp; GC nâng lên 365 ngày (hoặc giữ 30 + dedup theo move).
- Test: áp cùng op `stock.adjust` 2 lần (xóa appliedOps giữa chừng mô phỏng GC) → chỉ cộng 1 lần.
- Rủi ro: TRUNG BÌNH — thêm 1 truy vấn trong reducer; không đổi format op.

**M3 — Nhận PO không nguyên tử → nhập trùng** — `domain/purchase.ts` `receivePurchaseOrder` + `domain/inventory.ts` `saveGoodsReceipt`
- Dự kiến: gộp trừ kho + tạo GR + cập nhật `po.status` vào **một** transaction duy nhất (hoặc trạng thái trung gian `receiving` kèm `receivingId` chặn trùng).
- Test: mô phỏng crash giữa 2 bước (stub transaction) → không thể nhập lại lần 2.
- Rủi ro: TRUNG BÌNH — refactor transaction boundary; impact analysis `receivePurchaseOrder`. (Nếu Q6 = có kế hoạch đơn vị phụ → tách task riêng.)

**M8 — Restore backup từ file không làm sạch outbox/appliedOps/lastSeq** — `core/db.ts` `restoreBackup`; `sync/snapshot.ts`; 2 UI SettingsPage
- Dự kiến: đường khôi phục file thực hiện đúng chuỗi `importSnapshot`: clear `syncQueue` + `appliedOps` + reset `sync:lastSeq`/`sync:lastSnapshotSeq` + ép `catchUpSnapshot` chạy lại (hoặc dùng chung một hàm).
- Test: restore file → syncQueue rỗng, lastSeq khớp mốc file, không đẩy lại op cũ.
- Rủi ro: TRUNG BÌNH — thay đổi ngữ nghĩa restore (người dùng phải được báo "sẽ kéo lại dữ liệu từ cloud sau restore"); impact analysis `restoreBackup` (dùng bởi importSnapshot, migrate…).

**M9 — Upsert khách/NCC là LWW toàn record → mất cập nhật chéo máy** — `sync/apply.ts` case `customer.upsert`, `supplier.upsert`
- Dự kiến: mở rộng mô hình `fieldHlc` (đã có ở `product.upsert`) cho customer/supplier; domain khi tạo op gửi diff mỏng theo field.
- Test: 2 máy sửa 2 trường khác nhau → cả 2 thay đổi cùng tồn tại sau converge.
- Rủi ro: **CAO** — đổi payload op + schema record; cần giữ `debt` bất biến qua upsert như hiện tại; impact analysis toàn bộ đường tạo op customer/supplier.

**M11 — Kiểm kê qua sync không ghi `stockMoves` → drift ảo** — `sync/apply.ts` case `stocktake.commit`
- Dự kiến: ghi move `{ id: 'mv_' + op.id + '_' + row.productId, type: 'stocktake', qty: diff }` đối xứng máy gốc (idempotent theo id move).
- Test: máy nhận áp stocktake diff +2 → reconcile drift = 0.
- Rủi ro: THẤP-TRUNG BÌNH — thêm write trong reducer, idempotent theo id.

### PHASE 3 — Cứng hóa reducer sync (3 fix, không cần server)

**S3 — Poison op tắc nghẽn cả luồng sync** — `sync/apply.ts` `applyOps`; `sync/engine.ts` `pullSince`
- Dự kiến: bắt lỗi **per-op**: op lỗi → ghi quarantine/error log (kèm `op.id`) và **vẫn tăng `lastSeq`** (bỏ qua op), không rollback cả batch; thêm validate payload ngay ở tầng domain khi tạo op (chặn `sale.commit` tham chiếu SP đã xóa).
- Test: batch `[sale tốt, sale SP không tồn tại, stock.adjust]` → op tốt áp, op lỗi vào quarantine, `lastSeq` nhích qua batch, không lặp vô hạn.
- Rủi ro: **CAO** — thay đổi ngữ nghĩa áp op (bỏ qua thay vì dừng); cần bảng mới trong schema Dexie + màn hình xem quarantine; impact analysis `applyOps`, `pullSince`. **Lưu ý:** M12 phải sửa TRƯỚC hoặc cùng lúc để giảm nguồn sinh op độc.

**S4 — Delete bị nuốt bởi LWW race** — `sync/apply.ts` case `product.delete`, `customer.delete`
- Dự kiến: tombstone mạnh — lưu `deletedHlc` (hoặc trường riêng), upsert gặp record `deleted` chỉ áp nếu HLC mới > HLC xóa; xem xét op `product.restore` tường minh.
- Test: `[upsert(T+1s), delete(T)]` → sản phẩm vẫn bị xóa (không hồi sinh).
- Rủi ro: **CAO** — đổi schema record (thêm field) + ngữ nghĩa upsert; impact analysis case `product.upsert`, `product.delete`; cần đảm bảo tương thích dữ liệu cũ (migrate nhẹ).

**L5 — 3 delete không có guard LWW** — `sync/apply.ts` case `pricing.delete`, `note.delete`, `invoice.delete`
- Dự kiến: áp cùng cơ chế tombstone như S4 (so HLC với bản upsert cuối / trạng thái deleted).
- Test: upsert mới hơn đến trước delete cũ hơn → không mất bản sửa.
- Rủi ro: THẤP-TRUNG BÌNH — làm cùng đợt với S4, dùng chung helper.

### PHASE 4 — Plan 3 / server (HOÃN, chờ Q4 + spec server)
- **S5** force-pull snapshot mất dữ liệu (ước lượng `lastSeq` vượt) — cần `seq` thật do server gán.
- **L1** `pulledUpTo` ước lượng vượt — xử lý chung với S5 trong spec server.
- **L2** server phải dedup theo `op.id` khi mất ack.
- **L3** `importSnapshot` không nguyên tử — bọc transaction + xử lý cửa sổ mất ack (giao M2).
- Điều kiện mở: có tài liệu spec server Plan 3 (định dạng op có `seq` thật, chính sách snapshot, dedup).

### TÙY CHỌN (HOÃN)
- **L4** bảo mật: nâng SHA-256 → PBKDF2/scrypt (WebCrypto), tăng độ dài tối thiểu, rate-limit login, KHÔNG gửi `passwordHash` qua op sync — cần kế hoạch migrate hash + làm cùng Plan 3.
- **L6** auto-backup nằm trong IndexedDB — thêm nhắc xuất file định kỳ trong UI (UX).

---

## 5. QUY TRÌNH KIỂM THỬ & ĐỊNH NGHĨA HOÀN THÀNH

Với mỗi fix:
- [ ] Test mới tái hiện đúng lỗi (fail trước, pass sau).
- [ ] Toàn bộ test cũ + mới xanh; `tsc -b --noEmit` sạch.
- [ ] `impact` (GitNexus) đã chạy cho hàm public trong domain/sync/db/auth; blast radius được báo cáo; HIGH/CRITICAL được cảnh báo trước khi sửa.
- [ ] `detect_changes()` trước commit — phạm vi thay đổi đúng như dự kiến.
- [ ] Probe thủ công (nếu lỗi cần môi trường thật) được chạy và XÓA sau khi xác minh.
- [ ] Cập nhật trạng thái trong bảng theo dõi + `ANALYSIS-BUSINESS-LOGIC.md`.

Định nghĩa hoàn thành của toàn kế hoạch:
- Phase 1-3 hoàn tất: 20/22 lỗi trong phạm vi được sửa + test đầy đủ.
- Phase 4 mở sau khi có spec server (Q4).

## 6. BẢNG THEO DÕI TRẠNG THÁI

| ID | Sev | Phase | Trạng thái | Quyết định gating |
|---|---|---|---|---|
| S1 | 1 | 2 | ⬜ chờ | Q1 |
| S2 | 1 | 2 | ⬜ chờ | Q2 |
| S3 | 1 | 3 | ⬜ chờ | — |
| S4 | 1 | 3 | ⬜ chờ | — |
| S5 | 1 | 4 | ⏸ hoãn | Q4 |
| M1 | 2 | 2 | ⬜ chờ | Q3 |
| M2 | 2 | 2 | ⬜ chờ | Q5 |
| M3 | 2 | 2 | ⬜ chờ | Q6 (tham khảo) |
| M4 | 2 | 1 | ⬜ chờ | — |
| M5 | 2 | 1 | ⬜ chờ | — |
| M6 | 2 | 1 | ⬜ chờ | — |
| M7 | 2 | 1 | ⬜ chờ | — |
| M8 | 2 | 2 | ⬜ chờ | — |
| M9 | 2 | 2 | ⬜ chờ | — |
| M10 | 2 | 1 | ⬜ chờ | Q2 (chi tiết UI) |
| M11 | 2 | 2 | ⬜ chờ | — |
| M12 | 2 | 1 | ⬜ chờ | — |
| L1-L3 | 3 | 4 | ⏸ hoãn | Q4 |
| L4 | 3 | — | ⏸ hoãn | migrate hash |
| L5 | 3 | 3 | ⬜ chờ | — |
| L6 | 3 | — | ⏸ hoãn | UX |
| L7 | 3 | 1 | ⬜ chờ | — |
| L8 | 3 | 1 | ⬜ chờ | — |

**Ký hiệu:** ⬜ chưa làm · 🔧 đang sửa · ✅ xong · ⏸ hoãn

## 7. RỦI RO TỔNG THỂ & LƯU Ý

1. **S1/S2/M1/M9** là 4 fix có rủi ro cao nhất — đụng mô hình tiền/nợ/kho và payload sync. Làm riêng từng cái, không gộp, review kỹ impact + test converge.
2. **Dữ liệu đang tồn tại**: fix S1 cần script quy chuẩn GR cũ (paid + SupplierPayment trùng); fix M1 có thể lộ lệch lô đang có sẵn trong DB thật — phải có bước đối soát thử trên bản sao dữ liệu trước khi áp shop thật.
3. **Multi-device**: mọi thay đổi payload op (S1, M9, S4) phải kiểm tra kịch bản 2 máy converge (đã có `convergence.test.ts` làm nền).
4. **Không được phá** các phần đã xác minh đúng trong báo cáo (mục 4) — nếu fix nào buộc phải đụng tới, phải dừng và hỏi.
5. Sau Phase 1-3: chạy lại toàn bộ 199 test + build cả web & mobile trước khi merge.
