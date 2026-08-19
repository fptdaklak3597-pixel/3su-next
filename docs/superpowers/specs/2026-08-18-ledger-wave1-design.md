# Đợt 1 sổ tiền — S1 / S2 / M10 / M3 / M4

**Ngày:** 2026-08-18  
**Phạm vi:** `3su-next` only. Không đụng `3su-cloud`, `3su.shop`, icoffee.  
**Nguồn:** `ANALYSIS-BUSINESS-LOGIC.md` + đánh giá 2026-08-18. Đã duyệt cách A, 4 mục thiết kế.  
**Không làm đợt này:** S3–S5, M1, M2, M5–M9, M11–M12, L1–L8 (trừ chỗ clamp trên `apply.ts` cho `sale.void` / `debt.pay`).

## Mục tiêu

Sổ nợ NCC và nợ khách đúng trên một máy; nhập PO không nhân đôi khi crash giữa hai transaction; phiếu nhập không tính tiền hàng ma. Sau khi xanh: file test hồi quy + Cursor `/loop` 2 phút chạy lại file đó.

## Không làm

- Viết lại sổ derived (nợ luôn tính từ chứng từ, bỏ field `customer.debt`).
- Credit (debt âm) minh bạch trên báo cáo.
- Chặn hủy đơn đã thu.
- `persistOp('supplier.pay')` lúc nhập kho.
- Migration Dexie / xóa `supplierPayments` cũ.
- Sửa `3su-cloud` GC snapshot, poison op, seed500, backup validate (L8).

## Quyết định đã chốt

| ID | Quyết định |
|---|---|
| S1 | Giữ `GR.paid`. Không tạo `SupplierPayment` lúc nhập. Trả sau mới `recordSupplierPayment`. |
| S1 cũ | `supplierDebt` / sao kê bỏ qua payment có `note` bắt đầu `Thanh toán phiếu nhập`. |
| S2 | `voidSale`: `debt = max(0, debt − sale.debtAmount)`. Toast cảnh báo nếu đã thu — vẫn cho hủy. |
| S2 cũ | **One-shot trên mỗi máy khi boot:** `clampNegativeCustomerDebts()` — mọi `customer.debt < 0` ghi `max(0, debt)`. Không op (upsert giữ debt). Idempotent. Không dùng clamp-on-read `totalDebt` (đã có, chỉ che số). |
| M10 | `payDebt` clamp `amount` về dư nợ; phiếu thu = số sau clamp; 0 thì không tạo phiếu. |
| M3 | `receivePurchaseOrder` + ghi GR trong **một** Dexie transaction. |
| M4 | Thiếu `productId` → throw (kèm tên), không `continue` âm thầm. |
| Loop | `tests/ledger-regress.test.ts` + `/loop` 2 phút `vitest run` file đó. |
| Git | Không commit trừ khi được hỏi. |

## Ràng buộc

- Identifier English, comment Vietnamese.
- `confirmSale` vẫn atomic, lock `sale-commit`.
- Test: `npm test` + `npm run typecheck` trong `3su-next`.
- TDD: test đỏ trước, rồi vá tối thiểu.
- Impact GitNexus trước khi sửa: `saveGoodsReceipt`, `applyGoodsReceiptInTx` (export mới), `voidSale`, `payDebt`, `receivePurchaseOrder`, `supplierDebt`, `clampNegativeCustomerDebts` (export mới), và `applyOne` (nhánh `sale.void` / `debt.pay`).

## Kiến trúc

Một nguồn sự thật tiền nhập = field `GoodsReceipt.paid`. Một nguồn sự thật nợ khách = field `Customer.debt` có sàn 0. PO nhận hàng = một transaction Dexie. Test hồi quy là hợp đồng; loop chỉ chạy lại hợp đồng đó, không sửa production.

```
saveGoodsReceipt ──► GR.paid
                     không ghi supplierPayments
recordSupplierPayment ──► supplierPayments (trả riêng)
supplierDebt = Σ max(0, total−paid) − Σ extraPaid
  extraPaid bỏ note "Thanh toán phiếu nhập…"

payDebt / voidSale / apply debt.pay / apply sale.void
  ──► debt = max(0, debt − n)
bootApp ──► clampNegativeCustomerDebts() (local, không op)

receivePurchaseOrder
  ──► 1 tx: applyGoodsReceiptInTx + cập nhật PO
```

## Thay đổi theo file

### `src/core/domain/inventory.ts`

- Rút phần thân transaction thành `export async function applyGoodsReceiptInTx(input)` (cùng tables, không `dbx.transaction`). `purchase.ts` import hàm này — phải export.
- `saveGoodsReceipt`: validate mọi `row.productId` tồn tại **trước** tx; thiếu → `throw new Error('Không tìm thấy hàng: ' + name)`. Rồi `transaction` + `applyGoodsReceiptInTx`.
- Trong `applyGoodsReceiptInTx`: **xóa** khối `supplierPayments.add` khi `paid > 0 && payMethod !== 'debt'`. Vẫn ghi `gr.paid`.
- `total` vẫn `Σ qty * cost` sau khi đã chắc mọi dòng tồn tại.

### `src/core/domain/suppliers.ts`

- Hằng `GR_PAY_NOTE_PREFIX = 'Thanh toán phiếu nhập'`.
- `isOnReceiptPayment(p)`: `note` bắt đầu bằng prefix.
- `supplierDebt` / `supplierMonthlyStatement`: `extraPaid` chỉ cộng payment **không** on-receipt.
- Rủi ro đã biết: user tự gõ note bắt đầu đúng prefix ở `recordSupplierPayment` thì khoản trả riêng bị bỏ qua. Chấp nhận — app không còn tự gắn prefix sau khi bỏ `supplierPayments.add` lúc nhập.

### `src/core/domain/customers.ts`

- `export async function clampNegativeCustomerDebts(): Promise<number>` — duyệt `customers`, `debt < 0` thì `put` `debt = 0`. Trả về số bản ghi sửa. Gọi từ `bootApp` (không chặn UI: `void …catch`).
- `payDebt`: đọc `c.debt`; `amount = Math.round` rồi `Math.min(amount, Math.max(0, c.debt))`; `amount <= 0` → return không ghi phiếu / không op.

### `src/core/domain/sales.ts`

- `voidSale`: `c.debt = Math.max(0, c.debt - sale.debtAmount)` khi `debtAmount > 0`.

### `src/core/sync/apply.ts`

- `sale.void`: cùng sàn `max(0, …)`.
- `debt.pay`: `c.debt = Math.max(0, c.debt - dp.amount)` (payload đã là số đã clamp từ máy gốc; sàn vẫn cần cho op cũ).

### `src/core/domain/purchase.ts`

- `receivePurchaseOrder`: **một** `dbx.transaction` với đúng 10 bảng (thiếu 1 là Dexie ném runtime):
  `products, goodsReceipts, stockMoves, suppliers, supplierPayments, batches, priceLog, purchaseOrders, syncQueue, appliedOps`.
  `saveGoodsReceipt` dùng 9 bảng (như trên, không `purchaseOrders`).
  Gọi `applyGoodsReceiptInTx` rồi cập nhật `receivedQty` / `status` / `po.upsert`. Không gọi `saveGoodsReceipt` (tránh tx lồng).

### UI

- `CustomersPage` web + mobile: disable nút thu khi `payAmount <= 0 || payAmount > payFor.debt`.
- `OrdersPage` (web + mobile nếu có void): trước `voidSale`, nếu `sale.debtAmount > 0` và (`customer.debt < sale.debtAmount` hoặc đã có `debtPayments` của khách sau `sale.date`) thì toast `Khách đã trả cho đơn này` — không chặn.
- `PurchaseOrdersPage` web + mobile: `catch` `receivePurchaseOrder` và `showToast(e.message)` — web đã có; mobile giữ cùng pattern. M4 đổi hành vi: PO có `productId` mất hẳn (không phải xóa mềm) sẽ ném thay vì bỏ dòng.

### Test

- Tạo `tests/ledger-regress.test.ts` (setup như `domain.test.ts`: `initSyncEngine`, clear tables).
  1. S1: GR 100 paid 70 → `supplierDebt === 30`, `supplierPayments.count() === 0`.
  2. S1 + trả sau 30 → debt 0, một payment.
  3. S1 cũ: GR paid 70 + payment note `Thanh toán phiếu nhập NK-…` amount 70 → debt 30 (heuristic).
  4. S2: bán nợ 100 → thu 100 → hủy → `customer.debt === 0`.
  5. M10: nợ 100, `payDebt(500)` → debt 0, phiếu `amount === 100`.
  6. M4: GR `productId` không tồn tại → throw, 0 goodsReceipts.
  7. M3 chống trùng: `receivePurchaseOrder` đủ hàng lần 2 → throw `/đã nhập kho/i`.
  8. S2 cũ: customer `debt = -100` → `clampNegativeCustomerDebts()` → `debt === 0`, trả về 1.

Nhận từng phần rồi phần còn: đã có ở `tests/wave-rest.test.ts` — không copy. Giữ `outbox.test.ts`. Sửa test cũ nếu chúng expect `SupplierPayment` lúc nhập.

## Loop

Sau khi `ledger-regress` xanh lần đầu:

```
/loop 2m vitest run tests/ledger-regress.test.ts trong 3su-next
```

Mỗi tick: chạy file đó, báo pass/fail. Dừng khi user bảo dừng. Không sửa production trong tick trừ khi test đỏ vì regress.

## Thành công

- 8 case `ledger-regress` xanh; `npm test` + `typecheck` xanh.
- Probe cũ S1 (debt=0) và S2 (debt=−100) đảo thành 30 và 0; bản ghi `debt < 0` cũ về 0 sau boot.
- Không còn `supplierPayments.add` trong `saveGoodsReceipt`.

## Ngoài phạm vi (đợt sau)

S3 poison + M12 seed; M8/L8 backup; M11 stocktake moves; S4/S5; M5–M7 báo cáo.
