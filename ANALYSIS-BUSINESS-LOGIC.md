# BÁO CÁO REVIEW CHUYÊN SÂU — NGHIỆP VỤ & LOGIC (3su-next v4.0)

- **Ngày review:** 2026-08-04
- **Phạm vi:** Logic nghiệp vụ / kế toán / toàn vẹn dữ liệu của `3su-next` — POS local-first thế hệ mới (React 18 + TS strict + Vite 6 + Dexie/IndexedDB + op-log v2 sync), thay thế `3su-v2.7.4`.
- **Phương pháp:** ĐỌC TOÀN VĂN toàn bộ `src/core` (domain + sync + db + format) và các điểm tích hợp UI quan trọng (SalePage/CheckoutPage/GoodsReceipt/Stocktake/PurchaseOrders/Customers/Orders/Settings/…); **xác minh thực nghiệm** bằng probe test (`fake-indexeddb`) cho 6 lỗi (S1–S4 + M11 + M12); chạy lại bộ test gốc **199/199 pass** và `tsc -b --noEmit` **sạch lỗi**. Read-only — không sửa mã. Lượt 2 là lượt đọc lại độc lập (không dùng báo cáo cũ làm bản kiểm), bổ sung M11/M12/L8 và đính chính L1.
- **Quan hệ báo cáo cũ:** Bổ trợ `ANALYSIS-REPORT.md` (tổng quan workspace, 2026-08-02) và `3su-v2.7.4/ANALYSIS-BUSINESS-LOGIC.md` (bản legacy). Bản này đi sâu vào **mô hình công nợ, tồn kho 2 nguồn sự thật, idempotency/đối xử lỗi của reducer sync, và snapshot/backup** — những nơi quyết định tính đúng đắn tiền – kho.

---

## 0. BỐI CẢNH KIẾN TRÚC (tóm tắt)

- **Lưu trữ:** Dexie, 25+ bảng; chứng từ bất biến (sales, goodsReceipts, debtPayments, stocktakes, supplierPayments), hồ sơ đột biến LWW (products/customers/suppliers/users/settings), sổ phụ `stockMoves` (mọi biến động kho đều ghi move), `priceLog`, `batches` (lô FEFO/HSD), `appliedOps` (dấu op đã áp, GC 30 ngày), `syncQueue` (outbox).
- **Sync op-log v2:** op là đơn vị lưu chuyển (`syncQueue`), áp qua reducer `applyOps` (một transaction/op, idempotent theo record id hoặc HLC); HLC cho thứ tự; clock observe; flush loop 30s; mode `local | solo | sync`; transport hiện tại là **`nullTransport` (offline build)** — mọi khẳng định về giao thức thật thuộc Plan 3 và được dán nhãn "thiết kế".
- **Tín hiệu tích cực (đã xác minh):** bộ test 199/199 xanh (25 file, gồm convergence + fefo + snapshot + apply), typecheck sạch; `startSyncLoop` được gọi ở cả `src/mobile/App.tsx:96` và `src/web/App.tsx:97` (nghi ngờ "vòng sync không được bật" trước đây đã được giải toả).

---

## 0.1 CÁC NGUYÊN NHÂN GỐC (ROOT CAUSES)

| Gốc | Mô tả | Phát hiện do gốc này |
|---|---|---|
| **R1 — Công nợ NCC ghi 2 nguồn, trừ 2 nơi** | Thanh toán tại phiếu nhập được ghi CẢ `GR.paid` LẪN `SupplierPayment`; hàm nợ lại trừ cả hai vế | S1, M7 (lệch máy) |
| **R2 — Công nợ KH không có sàn (floor)** | `payDebt`/`voidSale` trừ `debt` không clamp ≥ 0 → âm (credit) khi trả/hủy quá dư | S2, M10 |
| **R3 — Reducer sync không chịu lỗi per-op** | `applyOps` ném lỗi làm chết cả batch và không ghi dấu → pull lặp vô hạn; delete dùng LWW yếu bị upsert mới hơn nuốt | S3, S4 |
| **R4 — Snapshot/backup không thống nhất trạng thái outbox** | `restoreBackup` (khôi phục file) không xoá `syncQueue`/`appliedOps`/`lastSeq` trong khi `importSnapshot` thì có chủ đích; force-pull snapshot đặt lại `lastSeq` | S5, M8 |
| **R5 — Hai nguồn sự thật cho tồn kho** | `p.stock` được set tuyệt đối (stocktake, sửa SP) nhưng `batch.remain` không được điều chỉnh theo | M1 |
| **R6 — `unitRatio` rơi rớt ở lớp phân tích** | So sánh giá NCC, đếm SL báo cáo, PO receive dùng đơn vị cơ sở | M6 (SL), M7, M3 (ghi chú) |

| **R7 — Đường ghi dữ liệu không qua op-log** | Một số thao tác ghi thẳng IndexedDB (`seed500` bulkAdd, `setDeviceRole`, `touchThisDevice`) không tạo op → không bao giờ sang máy khác | M12 |

---

## 1. SEVERITY 1 — NGHIÊM TRỌNG

### S1. Nợ nhà cung cấp bị trừ TRÙNG khi trả tiền ngay tại phiếu nhập → sổ nợ sai, lệch giữa các máy

- **File:** `src/core/domain/inventory.ts` (`saveGoodsReceipt`), `src/core/domain/suppliers.ts` (`supplierDebt`, `supplierMonthlyStatement`).
- **Cơ chế lỗi** — `saveGoodsReceipt` ghi **một khoản thanh toán thành HAI bản ghi**:

```ts
// inventory.ts — saveGoodsReceipt
const gr: GoodsReceipt = {
  ...
  total,
  paid: input.paid ?? 0,        // (1) ghi trong GR
  payMethod: input.payMethod,
  ...
}
...
const paid = input.paid ?? 0
if (input.supplierId && paid > 0 && input.payMethod !== 'debt') {
  await dbx.supplierPayments.add({          // (2) ghi thêm 1 SupplierPayment
    id: uid('sp'),
    supplierId: input.supplierId,
    amount: paid,
    ...
  })
}
```

Trong khi hàm công nợ lại **trừ cả hai vế**:

```ts
// suppliers.ts
export function supplierDebt(supId, receipts, payments): number {
  const owed = receipts
    .filter((r) => r.supplierId === supId)
    .reduce((a, r) => a + Math.max(0, (r.total || 0) - (r.paid || 0)), 0)   // đã trừ paid
  const paid = payments
    .filter((p) => p.supplierId === supId)
    .reduce((a, p) => a + (p.amount || 0), 0)                                // trừ LẦN NỮA
  return Math.max(0, Math.round(owed - paid))
}
```

- **Xác minh thực nghiệm (probe):** nhập kho 100, trả ngay 70 → `GR.paid=70 payments=[70] debt=0`. **Đúng ra phải còn nợ 30**; kết quả trả về 0 (clamp) khiến cửa hàng tưởng đã thanh toán xong. Chỉ khi trả ĐỦ (100) kết quả mới tình cờ đúng (0).
- **Hệ quả thứ hai (lệch máy):** `gr.commit` op chỉ mang `gr/patches/supplierDelta` — **không mang theo SupplierPayment**, nên máy remote khi áp `gr.commit` **không tái tạo phiếu chi đó** (`applyOne` case `gr.commit` chỉ `goodsReceipts.add` + patches + `sup.debt += supplierDelta.debtDelta`). → Máy gốc tính nợ = 0 (sai), máy khác tính nợ = 30 (đúng): **cùng dữ liệu, hai con số công nợ khác nhau giữa các thiết bị**.
- **Hệ quả thứ ba:** `supplierMonthlyStatement` (sao kê NCC) cộng `paidOnReceipts` (từ `GR.paid`) và `extraPaid` (từ `SupplierPayment`) — cùng một khoản tiền, hiển thị trả gấp đôi.
- **Ghi chú đối chiếu:** field `Supplier.debt` nằm trong payload `gr.commit` luôn là `debtDelta: 0` (chỉ `purchasedDelta`), và `applyOne` `supplier.upsert` ép `debt: cur.debt` — trường này là **dead field**, không gây hại nhưng gây nhầm lẫn khi đọc mã.
- **Đề xuất:** chọn **một** nguồn sự thật: (a) nếu giữ `GR.paid` thì `supplierDebt` chỉ dùng `owed` (không trừ payments) và `supplierMonthlyStatement` bỏ một vế; (b) hoặc bỏ `GR.paid` khi `payMethod==='cash'|'transfer'` để mọi trả tiền đều là `SupplierPayment` (kèm `refId` chỉ phiếu nhập) — cách này đồng bộ được nguyên vẹn qua op `supplier.pay` (đã có case áp idempotent theo id phiếu).

### S2. Hủy đơn bán nợ sau khi khách đã trả tiền → công nợ khách ÂM (credit)

- **File:** `src/core/domain/sales.ts` (`voidSale`), `src/core/domain/customers.ts` (`payDebt`).
- **Cơ chế lỗi:**

```ts
// sales.ts — voidSale
if (sale.debtAmount > 0 && sale.customerId) {
  const c = await dbx.customers.get(sale.customerId)
  if (c) {
    c.debt -= sale.debtAmount      // trừ thẳng, không quan tâm khách đã trả bao nhiêu
    ...
```

```ts
// customers.ts — payDebt
c.debt -= amount                   // không clamp, không kiểm tra amount <= debt
```

- **Xác minh thực nghiệm (probe):** bán nợ 100 → thu nợ 100 (`debt=0`) → hủy đơn → **`debt=-100`**. Khách bỗng dưng thành "người được cửa hàng nợ".
- **Hệ quả:** âm nợ không hiển thị ở đâu đúng nghĩa: `totalDebt()` clamp `Math.max(0, c.debt)` và `customerDebtSummary` lọc `c.debt > 0` → khoản credit bị **che giấu khỏi mọi báo cáo**; khi bán tiếp, nợ mới sẽ bù vào số âm → khách "miễn phí" một phần. Cửa sổ void không giới hạn (chỉ yêu cầu lý do).
- **Đề xuất:** khi void đơn nợ, chỉ trừ phần **nợ còn thực tế**: `c.debt = Math.max(0, c.debt - sale.debtAmount)`, và **không** tạo/nới track "hoàn trả" — hoặc ngược lại: tạo bút toán credit minh bạch nếu nghiệp vụ cho phép trả lại tiền mặt. Tối thiểu: cảnh báo trong UI "Khách đã trả Xđ cho đơn này" trước khi xác nhận hủy.

### S3. Op đồng bộ "độc" (poison op) làm TẮT NGHẼN vĩnh viễn cả luồng sync

- **File:** `src/core/sync/apply.ts` (`applyOps`, `applyOne`), `src/core/sync/engine.ts` (`pullSince`).
- **Cơ chế lỗi:**

```ts
// apply.ts
export async function applyOps(ops: SyncOp[]): Promise<number> {
  let applied = 0
  for (const op of ops) {
    if (await dbx.appliedOps.get(op.id)) { observeRemoteHlc(op.hlc); continue }
    await dbx.transaction('rw', TABLES(), async () => {
      if (await dbx.appliedOps.get(op.id)) return
      await applyOne(op)                 // THROW ở đây → cả transaction rollback
      await dbx.appliedOps.add({ id: op.id })
    })
    ...
```

```ts
// engine.ts — pullSince
for (;;) {
  const since = await getMeta<number>('sync:lastSeq', 0)
  const res = await transport.pullOps(since, PULL_PAGE)
  if (res.ops.length > 0) await applyOps(res.ops)   // ném lỗi → không setMeta lastSeq
  const upTo = pulledUpTo(since, res.ops, res.seq)
  if (upTo > since) await setMeta('sync:lastSeq', upTo)
  ...
```

Các vị trí throw trong `applyOne`: `sale.commit` (`'sale.commit thiếu SP ' + it.productId` / `'sale.commit thiếu khách ' + ...`), `sale.void` (thiếu đơn/thiếu SP), `stock.adjust` (thiếu SP), `stocktake.commit` (thiếu SP), `gr.commit` (thiếu SP), `debt.pay` (thiếu khách), `supplier.pay` (thiếu dữ liệu). **Mọi op biến thể này đều có lỗi định dạng/tham chiếu — nhưng một op lỗi ở GIỮA danh sách sẽ chặn toàn bộ các op SAU nó trong cùng lượt pull, và vì `lastSeq` không tăng, lượt sau lại pull đúng batch cũ, lại throw** → vòng lặp 30s mãi mãi, mọi máy khác của shop đều chết theo (server không bao giờ nhận ack mới).
- **Xác minh thực nghiệm (probe):** batch `[sale tốt, sale tham chiếu SP không tồn tại, stock.adjust]` → `thrown=true`, `appliedFlags=[true,false,false]` (op tốt đầu áp, 2 op sau không), `sales=1, stock=9` — đúng hành vi mô tả.
- **Đề xuất:** bắt lỗi **per-op** trong `applyOps`: op lỗi → ghi vào bảng quarantine/error log (kèm `op.id`), **vẫn tăng `lastSeq`** (bỏ qua op), không để chặn cả batch; đồng thời thêm trình tự `validate payload` ngay khi tạo op ở tầng domain (không cho phép tạo `sale.commit` tham chiếu SP đã xóa).

### S4. Lệnh XÓA bị nuốt mất vĩnh viễn khi op update có HLC muộn hơn đến trước (LWW race)

- **File:** `src/core/sync/apply.ts` (`product.delete`, `customer.delete`).
- **Cơ chế lỗi:**

```ts
// apply.ts
case 'product.delete': {
  const { productId } = op.payload as { productId: string }
  const cur = await dbx.products.get(productId)
  if (cur && (!cur.hlc || compareHlc(op.hlc, cur.hlc) > 0))    // chỉ áp khi hlc XÓA lớn hơn hlc hiện tại
    await dbx.products.put({ ...cur, deleted: true, hlc: op.hlc })
  return
}
```

HLC của record tăng theo mọi upsert. Nếu máy B sửa sản phẩm (HLC=100) **sau khi** máy A xóa sản phẩm đó (HLC=90): op `product.delete` (90) đến máy B sau op `product.upsert` (100) → `compareHlc(90, 100) <= 0` → **bỏ qua xóa**. Sản phẩm "sống lại" và **không bao giờ** bị xóa trên toàn mạng (op delete chỉ push một lần, đã ack, không bao giờ gửi lại).
- **Xác minh thực nghiệm (probe):** `applyOps([upsert(HLC=T+1000ms), delete(HLC=T)])` → `deleted = undefined` — xóa bị bỏ qua.
- **Đề xuất:** xóa là **tombstone mạnh**: so sánh riêng với "HLC của lần xóa gần nhất" (lưu `deletedHlc`), hoặc khi upsert gặp record đã `deleted` thì chỉ cập nhật nếu HLC mới lớn hơn cả HLC xóa; đồng thời xem xét op `product.restore` tường minh thay cho upsert thường.

### S5. Kéo snapshot (force pull) có thể LÀM MẤT DỮ LIỆU đã đẩy — lỗi thiết kế Plan 3 (chưa test E2E được vì transport đang là `nullTransport`)

- **File:** `src/core/sync/engine.ts` (`pullCloudSnapshot`), `src/core/sync/snapshot.ts` (`importSnapshot`), `src/core/sync/transport.ts` (interface).
- **Kịch bản:** máy đã đồng bộ (A) nhấn "kéo bản sao từ cloud" (`pullCloudSnapshot(force=true)`):

```ts
// engine.ts — pullCloudSnapshot
await importSnapshot(got.snapshot)
await setMeta('sync:lastSeq', got.upToSeq)        // ← con trỏ nhảy thẳng lên mốc snapshot
await setMeta('sync:lastSnapshotSeq', got.upToSeq)
```

```ts
// snapshot.ts — importSnapshot
const pending = await dbx.syncQueue.orderBy('createdAt').toArray()
await restoreBackup(s.backup)     // xoá toàn bộ dữ liệu máy A
await dbx.appliedOps.clear()
await applyOps(pending)           // chỉ replay các op CÒN Ở OUTBOX cục bộ
```

Mọi op A đã **push + ack** đều đã bị xóa khỏi outbox của A — nên sau import, hy vọng duy nhất để A lấy lại chúng là `pullSince(since=upToSeq)`. Điều này chỉ an toàn khi snapshot thực sự chứa hiệu ứng của **mọi** op có `seq ≤ upToSeq`. Nhưng `upToSeq` do máy chụp snapshot cung cấp (`pushSnapshot(exp.snapshot, seq)` với `seq = sync:lastSeq` của máy đó), mà `lastSeq` lại được ước lượng bởi `pulledUpTo` — có thể **vượt quá** phạm vi op thực sự đã áp (`since + ops.length` khi đủ trang, `max(since, cloudSeq)` khi không đủ — xem L1). Nếu tồn tại op với `seq ≤ upToSeq` mà snapshot **không chứa** hiệu ứng của nó, A bị wipe → `lastSeq=upToSeq` → **không bao giờ kéo lại** các op đó → chúng chỉ còn trên server (nếu server còn giữ), không thiết bị nào có dữ liệu. **Mất vĩnh viễn.** (Với seq thật liền mạch, máy chụp "tụt sau" có `upToSeq` thấp → máy import chỉ tạm thời lùi state rồi pull bù lại — KHÔNG mất; mất chỉ xảy ra qua khe ước lượng vượt nói trên.)
- **Điều kiện để an toàn:** snapshot phải là ảnh **state của SERVER** (server hợp nhất mọi op đã nhận trước khi chụp), hoặc sau import phải replay khoảng `[snapshot.upToSeq, lastSeq cũ]` từ server, hoặc **chặn force-pull khi `lastSeq > 0`** (chỉ cho máy mới join dùng, như nhánh `!force` đã làm).
- **Ghi chú:** máy MỚI join (lastSeq=0) an toàn — outbox của nó là các op mới hơn snapshot, replay lên nền snapshot cho kết quả đúng (op xếp theo `createdAt`; stock khởi tạo là `product.upsert` + `stock.adjust` đi liền). Lỗi chỉ chạm đường force-pull trên máy đã hoạt động.

---

## 2. SEVERITY 2 — TRUNG BÌNH

### M1. Tồn kho hai nguồn sự thật lệch nhau: `p.stock` vs `batch.remain`

- **File:** `src/core/domain/inventory.ts` (`saveStocktake`, `updateProduct`, `saveGoodsReceipt`), `src/core/domain/reconcile.ts`.
- **Cơ chế:** `saveStocktake` set tuyệt đối `p.stock = r.actual` và `updateProduct` (sửa kho) ghi `stock.adjust` — **cả hai không đụng tới `batches`**; `saveGoodsReceipt` không có HSD thì **không tạo lô** (STOCK tăng nhưng Σbatch.remain không đổi). Chiều nguy hiểm nhất: **kiểm kê giảm / sửa giảm kho** → `batch.remain > p.stock`, module FEFO vẫn trừ theo lô (HSD sớm nhất) → có thể xuất ra **số lượng âm** trên lô, trong khi `allowNegativeStock` mặc định `true` lại cho phép chốt đơn.
- **Hệ quả:** hiển thị "còn X lô HSD …" sai; `liveBatchExpiry` dựa `remain > 0` → gợi ý HSD của lô đã cạn; kiểm kê không tự đề xuất bù/trừ lô; `reconcileBooks` chỉ đối chiếu `stock` (qua stockMoves) chứ **không** đối chiếu `Σbatch.remain ≤ stock`.
- **Đề xuất:** khi set stock tuyệt đối, điều chỉnh `batches` theo FEFO (ưu tiên trừ lô cũ nhất, thiếu/thừa ghi nhận chênh lệch lô); thêm check `Σremain ≤ stock` vào reconcile và dựng cảnh báo trước khi chốt đơn khi `allowNegativeStock=false`.

### M2. `stock.adjust` không tự idempotent — sau GC 30 ngày `appliedOps`, op cũ được pull lại sẽ cộng đôi

- **File:** `src/core/sync/apply.ts` (case `stock.adjust`), `src/core/sync/engine.ts` (`gcAppliedOps`).
- **Cơ chế:**

```ts
// apply.ts — case 'stock.adjust'
const p = await dbx.products.get(pl.productId)
if (!p) throw new Error('stock.adjust thiếu SP ' + pl.productId)
p.stock += pl.delta          // cộng vô điều kiện — không kiểm tra stockMoves/refId
await dbx.products.put(p)
await dbx.stockMoves.add({ id: 'mv_' + op.id, ... })
```

```ts
// engine.ts — gcAppliedOps
const stale = all.filter((r) => { const ms = Number(String(r.id).slice(0, 13)); return Number.isFinite(ms) && ms < cutoff })
if (stale.length) await dbx.appliedOps.bulkDelete(stale.map((r) => r.id))
```

Ngược lại với `sale.commit`/`gr.commit`/`debt.pay` — vốn chống trùng bằng **kiểm tra id chứng từ** — `stock.adjust` chỉ được chống lại bằng `appliedOps`. Sau >30 ngày, nếu server (hoặc snapshot replay) gửi lại op cũ → cộng đôi delta. Cửa sổ thực tế hẹp (op chỉ gửi lại khi ack mất / máy mới) nhưng không nên dựa vào may mắn.
- **Đề xuất:** trước khi cộng, kiểm tra `stockMoves` có `id === 'mv_' + op.id` (hoặc `refId` trùng) rồi mới áp; hoặc dời GC xuống 365 ngày + dựng cơ chế server dedup theo op.id.

### M3. Nhập kho theo đơn mua (PO) không nguyên tử → crash giữa chừng cho phép NHẬP TRÙNG, tồn kho tăng gấp đôi

- **File:** `src/core/domain/purchase.ts` (`receivePurchaseOrder`) + `src/core/domain/inventory.ts` (`saveGoodsReceipt`).
- **Cơ chế:** `receivePurchaseOrder` gọi `saveGoodsReceipt` — **một transaction riêng đã commit** (trừ kho, ghi nợ, tạo phiếu nhập) — rồi mới mở **transaction thứ hai** để cập nhật `po.status='received'`. Crash/đóng tab giữa hai transaction → PO vẫn `ordered`, lần nhập tiếp theo `receivePurchaseOrder` lại cho phép nhập (chỉ chặn status `received`) → **cùng một đơn nhập kho 2 lần: hàng + nợ + priceLog đều nhân đôi**.
- **Ghi chú kèm:** PO rows luôn ở đơn vị cơ sở (`unitRatio: 1` được hardcode tại `receivePurchaseOrder`) — nhất quán nội bộ nhưng là **giới hạn nghiệp vụ**: không đặt/nhận PO theo thùng/lốc; nếu sau này thêm `unitRatio` vào PO row, phải sửa cả cost và đếm.
- **Đề xuất:** gộp trừ kho + cập nhật PO vào **một** transaction; hoặc đánh dấu trạng thái trung gian `receiving` (kèm `receivingId`) để chặn trùng.

### M4. `saveGoodsReceipt` âm thầm bỏ qua dòng SP không tồn tại nhưng vẫn tính tiền → "nợ ma"

- **File:** `src/core/domain/inventory.ts` (`saveGoodsReceipt`).
- **Cơ chế:** `total = Σ r.qty * r.cost` tính từ `input.rows` **trước** khi biết SP nào còn tồn tại; vòng lặp áp dụng dùng `if (!p) continue` — dòng SP đã xóa/mất **không vào kho, không vào priceLog, không vào stockMoves**, nhưng **tiền tổng + công nợ NCC vẫn tính đủ**; thậm chí GR 100% hàng "ma" vẫn được lưu và báo thành công.
- **Hệ quả:** nợ NCC phình so với hàng thực nhập; báo cáo giá NCC (M7) cũng nhiễm dữ liệu ma này.
- **Đề xuất:** validate toàn bộ `productId` tồn tại trước transaction (`throw` kèm tên SP thiếu), hoặc khi bỏ qua dòng thì tổng phải được tính lại theo số dòng thực sự áp.

### M5. Một phiếu nhập từ PO hiện HAI dòng trong cùng danh sách "Đơn mua/nhập"

- **File:** `src/core/domain/purchase.ts` (`aggregatePurchases`).
- **Cơ chế:** dòng 187 và 202 (xem code):

```ts
// aggregatePurchases — trả về CẢ gr và po của cùng một giao dịch
debt: Math.max(0, g.total - (g.paid ?? 0)),          // phiếu nhập: nợ thật
debt: po.status === 'received' ? 0 : po.total,       // PO đã nhập: hiện nợ = 0
```

PO đã `received` hiện nợ **0** dù thực tế còn thiếu (chỉ GR mang thông tin trả tiền) → tính tổng nợ/phải trả theo danh sách **đếm gấp đôi** tổng tiền, và con số nợ hiển thị trên dòng PO là **sai**.
- **Đề xuất:** khi `po.status==='received'`, không emit entry `po:` (hoặc emit kèm debt thật = tổng GR của PO − tổng paid).

### M6. Báo cáo MTD lệch tháng do dùng ngày UTC; số lượng top sản phẩm không × unitRatio

- **File:** `src/core/domain/reports.ts` (`resolveRange`, `topProducts`), `src/core/domain/sales.ts` (`dayStats`).
- **Cơ chế:**

```ts
// reports.ts — resolveRange
if (f.preset === 'mtd') return { from: new Date().toISOString().slice(0, 8) + '01', to: t }
```

`toISOString()` là giờ UTC. Với UTC+7, từ **00:00–06:59 sáng mùng 1**, `from` rơi vào **đầu tháng TRƯỚC** → kỳ MTD hiển thị 1 tháng lệch (so sánh kỳ trước `prev` cũng lệch theo). Hàm `topProducts` đếm `qty += it.qty` không nhân `it.unitRatio` → bán 2 thùng (mỗi thùng 24) chỉ đếm 2; `dayStats` (thống kê nhanh) cũng vậy với `items`.
- **Đề xuất:** dùng ngày local (hàm `localDay` đã có sẵn trong codebase) để tính `from`; nhân `unitRatio` khi đếm qty/items; thêm test biên 00:30 mùng 1 cho `resolveRange`.

### M7. So sánh giá NCC bỏ qua `unitRatio` → chọn nhầm "nhà cung cấp rẻ nhất"

- **File:** `src/core/domain/suppliers.ts` (`compareSupplierPrices`).
- **Cơ chế:** tích lũy `cur.cost += row.cost * row.qty; cur.qty += row.qty` — đơn giá quy về **per-row** chứ không per-base-unit. NCC A bán chai 10k, NCC B bán thùng (r=24) giá 240k → phần mềm kết luận giá B = 240k/chai (gấp 24 lần) → khuyến nghị sai. Cùng gốc R6 với `detectPriceSpike` (raw-cost).
- **Đề xuất:** quy đổi `perUnit = (row.cost * row.qty) / (row.qty * (row.unitRatio || 1))`.

### M8. Khôi phục backup từ FILE không làm sạch `syncQueue`/`appliedOps`/`lastSeq` — khác hẳn `importSnapshot`

- **File:** `src/core/db.ts` (`restoreBackup`), `src/core/sync/snapshot.ts` (`importSnapshot`), UI khôi phục: `src/mobile/pages/SettingsPage.tsx:106` và `src/web/pages/SettingsPage.tsx:538`.
- **Cơ chế:** `restoreBackup` clear + `bulkPut` 18 bảng dữ liệu, nhưng **không clear `syncQueue`**, **không clear `appliedOps`**, **không reset `meta`** (`sync:lastSeq`, `sync:lastSnapshotSeq`, `hlc:*`) — chỉ ghi đè `shop`/`settings`. Trong khi `importSnapshot` làm đủ 3 việc đó:

```ts
// snapshot.ts — importSnapshot
const pending = await dbx.syncQueue.orderBy('createdAt').toArray()
await restoreBackup(s.backup)
await dbx.appliedOps.clear()          // ← importSnapshot XOÁ appliedOps
await applyOps(pending)               // replay outbox qua reducer chung
```

- **Hệ quả khi người dùng khôi phục file backup (không phải kéo cloud):** (a) các op đang nằm trong outbox từ trước restore **vẫn sẽ được đẩy lên server** → áp LẠI trên máy khác → trùng đơn/trùng điều chỉnh kho; (b) `lastSeq`/`appliedOps` giữ nguyên, không khớp mốc dữ liệu của bản khôi phục: nếu file cũ hơn `lastSeq`, các op trong khoảng (mốc file → `lastSeq`) đã bị xoá khỏi dữ liệu local nhưng **không bao giờ được kéo lại** (pull tiếp tục từ `lastSeq`), còn dấu `appliedOps` cũ vẫn chặn áp lại nếu server gửi lại op đó.
- **Đề xuất:** `restoreBackup` (đường khôi phục file) phải thực hiện đúng chuỗi của `importSnapshot`: clear `syncQueue` + `appliedOps` + reset `sync:lastSeq`/`sync:lastSnapshotSeq` (và ép `catchUpSnapshot` chạy lại), hoặc dùng chung một hàm.

### M9. Upsert khách hàng / NCC là LWW toàn record — mất cập nhật chéo máy

- **File:** `src/core/sync/apply.ts` (case `customer.upsert`, `supplier.upsert`).
- **Cơ chế:** so sánh HLC của **cả record** và ghi đè toàn record khi op mới hơn — trong khi `product.upsert` đã có `fieldHlc` (per-field):

```ts
// apply.ts — customer.upsert
if (cur?.hlc && compareHlc(op.hlc, cur.hlc) <= 0) return
if (cur) await dbx.customers.put({ ...cur, ...customer, debt: cur.debt, ... })
```

Hai máy cùng sửa hai trường khác nhau của cùng khách → **một trong hai sửa bị mất** (ngay cả khi cùng giây, HLC tie-break theo deviceId). `settings.set` cũng whole-key LWW (chấp nhận được vì settings ít xung đột).
- **Đề xuất:** mở rộng mô hình `fieldHlc` cho customer/supplier giống product (payload hiện đã là diff mỏng — chỉ thiếu cơ chế fieldHlc khi áp).

### M10. Trả nợ khách quá số dư được phép ở mọi tầng

- **File:** `src/core/domain/customers.ts` (`payDebt`), `src/web/pages/CustomersPage.tsx` (`handlePay`), `src/mobile/.../CustomersPage`.
- **Cơ chế:** `payDebt` trừ thẳng `c.debt -= amount`; UI web `handlePay` chỉ chặn `payAmount <= 0`, **không chặn `payAmount > payFor.debt`** → gõ 500k khi khách nợ 100k → `debt=-400k`. Cùng lớp với S2 nhưng đến từ hướng nhập liệu.
- **Đề xuất:** clamp trong domain (`amount = Math.min(amount, Math.max(0, debt))` hoặc throw), và UI disabled nút "Lưu" khi vượt dư nợ; giữ phiếu thu đúng số tiền thực nhận.

---

### M11. Kiểm kê qua sync đổi tồn kho nhưng KHÔNG ghi `stockMoves` → máy khác báo "lệch sổ" ảo

- **File:** `src/core/sync/apply.ts` (case `stocktake.commit`), đối chiếu `src/core/domain/inventory.ts` (`saveStocktake`).
- **Cơ chế:** máy gốc `saveStocktake` ghi đủ 2 thứ — đổi `p.stock` + ghi dòng `stockMoves` (type `stocktake`, qty = diff). Nhưng reducer apply trên máy NHẬN chỉ làm `p.stock += diff; p.stockSetHlc = op.hlc` — **không hề `dbx.stockMoves.add(...)`**. Vì `reconcileBooks` tính sổ theo tổng `stockMoves`, mọi SP được kiểm kê trên máy khác sẽ hiện drift bằng đúng số chênh lệch kiểm kê dù số liệu đang ĐÚNG.
- **Xác minh (probe):** máy nhận có SP stock 10 (ledger 10) → áp `stocktake.commit` diff +2 → `stock=12, ledger=10 → drift=2`. Máy gốc không drift.
- **Hệ quả:** công cụ "Đối soát sổ" mất giá trị trên các máy không phải máy kiểm kê; người dùng không phân biệt được drift giả này với drift thật (M1).
- **Đề xuất:** trong case `stocktake.commit`, ghi move `{ id: 'mv_' + op.id + '_' + row.productId, type: 'stocktake', qty: diff, ... }` đối xứng với máy gốc; xem thêm ghi chú idempotency ở mục 5.

### M12. `seed500` (nạp 500 mặt hàng mẫu) ghi thẳng DB KHÔNG tạo op — máy khác không thấy, và bán SP seed có thể thành "op độc"

- **File:** `src/core/domain/seed.ts` (`seed500` — chỉ `dbx.products.bulkAdd`), đối chiếu `src/core/domain/inventory.ts` (`addProduct` — luôn `enqueueOp('product.upsert')`).
- **Cơ chế:** mọi đường tạo sản phẩm khác đều đi qua op-log; riêng `seed500` bulkAdd 500 SP vào thẳng bảng `products` mà không đưa op nào vào `syncQueue`. Trên shop nhiều máy: máy A nạp mẫu → máy B/C vĩnh viễn không có các SP này (không có op để pull).
- **Hệ quả dây chuyền (giao S3):** máy A bán một SP seed → op `sale.commit` chứa `productId` mà máy B không có → reducer máy B ném `sale.commit thiếu SP ...` → theo S3, batch pull của máy B **tắc nghẽn vĩnh viễn** (retry 30s, `lastSeq` không nhích). Một cú nạp mẫu vô tình có thể làm liệt sync toàn shop.
- **Xác minh (probe):** sau `seed500(0)` → `syncQueue.count() === 0`.
- **Đề xuất:** `seed500` phải tạo 500 op `product.upsert` (hoặc 1 op batch `seed.apply` có reducer riêng), và/hoặc case `sale.commit` thiếu SP cần xử lý mềm theo S3.

## 3. SEVERITY 3 — THẤP / GHI CHÚ

### L1. `lastSeq` có thể bị ƯỚC LƯỢNG VƯỢT quá trạng thái thực áp — chính là nguồn mở của S5

- **File:** `src/core/sync/engine.ts` (`pulledUpTo`). Khi op không mang `seq` (Plan 1) hoặc trang pull đầy `PULL_PAGE`, con trỏ được ước lượng: `if (ops.length >= PULL_PAGE) return since + ops.length`; trang không đầy thì `return Math.max(since, cloudSeq)` — tức `lastSeq` có thể nhảy **QUA** những op chưa từng được áp (server lọc/lệch thứ tự/không liền mạch). Riêng lẻ thì đây chỉ là xấp xỉ khi pull; nhưng vì `pushSnapshot` gửi kèm `upToSeq = sync:lastSeq` và `importSnapshot` đặt lại `lastSeq = upToSeq`, ước lượng vượt trở thành cơ chế mất dữ liệu của **S5**. Plan 3 cần `seq` thật do server gán cho từng op.
- **Ghi chú đính chính so với nhận định ban đầu:** comment trong `flushQueue` — `"// lastSeq = mốc đã ÁP, không phải MAX cloud. push trả seq toàn shop — // ghi vào đây rồi pullSince sẽ bỏ op máy kia nằm giữa."` — là lý do **CỐ Ý KHÔNG ghi** `lastSeq` sau push (ghi vào sẽ làm mất op của máy khác nằm giữa), chứ KHÔNG phải comment hứa ghi rồi code bỏ sót. Điểm "comment/code mâu thuẫn" trước đây bị bỏ.

### L2. Mất ack `pushOps` → op bị đẩy LẠI → server phải dedup theo `op.id`
- **File:** `src/core/sync/engine.ts`, `src/core/sync/transport.ts`. Outbox chỉ xóa khi `acked` trả về; mất ack (mạng rớt sau khi server nhận) → lần sau đẩy lại nguyên op. Server (Plan 3) **bắt buộc** lưu `op.id` đã nhận để bỏ qua; ứng dụng hiện tại không có hậu thuẫn gì cho việc này ngoài việc `applyOps` idempotent (nhưng M2 cho thấy `stock.adjust` không tự idempotent).

### L3. `importSnapshot` không nguyên tử + cửa sổ hẹp áp đôi op chưa ack

- **File:** `src/core/sync/snapshot.ts` (`importSnapshot`). Chuỗi `đọc pending → restoreBackup (1 tx) → appliedOps.clear() → applyOps(pending)` nằm **ngoài một transaction duy nhất**: crash giữa chừng để lại DB nền snapshot nhưng chưa replay outbox (các op đó vẫn nằm trong `syncQueue`, hiệu ứng không còn trong DB — sẽ được đẩy lên server và chỉ quay về local sau một vòng pull).
- Cửa sổ áp đôi: nếu op của máy A được đẩy (server nhận) nhưng A **mất ack** (op vẫn ở outbox A), máy B pull được op đó rồi **đẩy snapshot chứa hiệu ứng của nó**; A kéo snapshot → replay op từ outbox → với `stock.adjust` sẽ cộng đôi (giao với S5/M2). Chỉ xảy ra với combo "mất ack + B chụp snapshot nhanh" — cần chặn theo M2.

### L4. Bảo mật tài khoản (ghi chú, không đánh giá sâu)
- **File:** `src/core/domain/auth.ts`. Mật khẩu băm SHA-256 + salt (KDF nhanh, dễ brute-force bằng GPU; độ dài tối thiểu chỉ **4 ký tự**), không rate-limit login, và **user records (kèm hash) được đồng bộ qua op** — nếu server sync bị lộ, hash lộ theo. Riêng op `user.password` (đổi mật khẩu) mang nguyên `{ passwordHash, salt }` trong payload op → lọt vào outbox, server và mọi thiết bị. Với POS nội bộ cửa hàng nhỏ mức rủi ro vừa phải, nhưng nên nâng lên scrypt/argon2 (WebCrypto `PBKDF2`) khi mở Plan 3.

### L5. Delete KHÔNG có guard LWW ở 3 loại: `pricing.delete`, `note.delete`, `invoice.delete`

- **File:** `src/core/sync/apply.ts`. Cả 3 case đều xóa record **vô điều kiện**, không so HLC với bản upsert cuối:
  ```ts
  case 'pricing.delete': { const { ruleId } = ...; if (ruleId) await dbx.pricingRules.delete(ruleId); return }
  case 'note.delete':    { const { noteId } = ...;  await dbx.notes.delete(noteId); return }
  case 'invoice.delete': { const { invoiceId } = ...; if (invoiceId) await dbx.invoices.delete(invoiceId); return }
  ```
- **Kịch bản:** máy A sửa rule/ghi chú (upsert HLC t2) trong khi máy B xóa (delete HLC t1, t1 < t2). Op đi theo thứ tự seq: delete đến trước rồi upsert đến sau → record **hồi sinh** (upsert không kiểm tra trạng thái deleted); upsert đến trước, delete đến sau → mất bản sửa. Không máy nào "đúng" vì không có tombstone + so HLC như `product.delete`/`customer.delete` (S4). Mức thấp vì chỉ ảnh hưởng dữ liệu phụ (rule giá, ghi chú, hồ sơ hóa đơn).

### L6. Auto-backup lưu cả DB vào `meta:backups` — cùng IndexedDB, cùng điểm chết
- **File:** `src/core/domain/trial.ts` (`scheduleAutoBackup`). Bản sao tự động nằm trong **chính** IndexedDB (chỉ 3 bản), nên nếu DB hỏng/quota đầy/thủ công xóa → backup chết theo dữ liệu chính; bản backup đáng tin nhất vẫn là file export (`exportBackup`) do người dùng tải về. Ghi chú cho UX: nhắc xuất file định kỳ.

### L7. `estimateDataSize` chỉ đếm 6 bảng
- **File:** `src/core/domain/readiness.ts`. Cảnh báo "dung lượng an toàn ~900KB" bỏ qua invoices/priceLog/notes/batches/purchaseOrders… → con số luôn thấp hơn thực tế (chỉ ảnh hưởng màn hình "sẵn sàng dùng thật").

---


### L8. UI khôi phục backup từ file KHÔNG gọi `validateBackupSchema`

- **File:** `src/core/domain/trial.ts` (đã có `validateBackupSchema`), `src/mobile/pages/SettingsPage.tsx:106` và `src/web/pages/SettingsPage.tsx:538` (gọi thẳng `restoreBackup` sau `JSON.parse`, không validate).
- **Cơ chế:** validator tồn tại nhưng chỉ được dùng ở đường nhập liệu cũ (`migrate.previewLegacy`). File backup hỏng/sai cấu trúc (vd `products` không phải mảng hoặc phần tử thiếu `name`) → `restoreBackup` bulkPut dữ liệu rác hoặc ném lỗi giữa chừng; app có thể treo ở `useLiveQuery` khi render. Nên gọi `validateBackupSchema(data)` trước khi `setConfirmRestore`.

## 4. ĐÃ KIỂM TRA — ĐÚNG (kết quả tích cực)

- **Idempotency chứng từ:** `sale.commit`/`sale.void`/`gr.commit`/`debt.pay`/`stocktake.commit` đều chống trùng bằng **id record/phiếu** (khác hẳn `stock.adjust`, M2). Test `apply.test.ts` và probe xác nhận (`debt.pay` áp 2 lần chỉ trừ 1 lần).
- **`confirmSale` có lock** (`withExclusiveLock('sale-commit')`) + transaction toàn cục — chống chốt đơn trùng trong cùng tab/thiết bị; tồn kho/khuyến mãi/công nợ cập nhật cùng một lúc. `voidSale` không dùng lock (chấp nhận được về mặt nghiệp vụ hiện tại nhưng nên thêm khi multi-tab).
- **Giá vốn bình quân gia quyền đúng:** công thức `(oldStock*oldCost + qty*cost)/(oldStock+qty)` tại `saveGoodsReceipt` nhất quán với `consumeBatchesFefo` (giá theo lô) — không phát hiện sai công thức.
- **Sổ phụ `stockMoves` đầy đủ** cho sale/void_restore/purchase/stocktake/adjust/init — ledger khớp `p.stock` theo `reconcileBooks` (test `reconcile.test.ts` xanh); hạn chế duy nhất là không đối chiếu `batches` (M1) và không đối chiếu công nợ NCC (S1).
- **Giỏ hàng đơn vị đúng:** `cartUnitPrice` nhân `unitRatio` (test `domain.test.ts` có case thùng=24 → 120.000đ).
- **HLC đơn điệu + observe:** `hlc.test.ts` và `convergence.test.ts` xác nhận thứ tự hội tụ giữa 2 máy → nền tảng thứ tự sync vững.
- **Mode solo an toàn:** outbox chỉ xóa SAU khi `pushSnapshot` thành công (`flushQueue`: `bulkDelete(exp.pendingOpIds)` trong mode solo) — không mất op khi push lỗi.
- **Nhập hóa đơn GDT (invoiceImport):** tách rõ `preTax`/`tax`/`grand`, `numVN` xử lý số âm/dấu phẩy chuẩn — không tìm thấy lỗi tính tiền trong luồng tạo GR từ hóa đơn.
- **UI tích hợp đúng luồng:** CheckoutPage → `confirmSale`; GoodsReceiptPage → `saveGoodsReceipt`; StocktakePage → `saveStocktake`; PurchaseOrders receive → `receivePurchaseOrder`; Settings → `saveSettingsSynced`; barcode/print/quickAnswers đều gọi đúng domain function; `tendered=0` tại checkout = ghi nợ (có chọn khách) — nhất quán.
- **Hygiene:** error logger sanitize secret (`AIza…`, Bearer, `sk-ant-*`, `password=…`) và giới hạn buffer; `validateBackupSchema` kiểm tra cấu trúc trước restore; 199/199 test + `tsc -b --noEmit` sạch — không có lỗi build/test ẩn.
- **Đã giải toả:** nghi ngờ "`startSyncLoop` không được gọi" là SAI — được gọi ở cả `src/mobile/App.tsx` và `src/web/App.tsx`.

---

## 5. CÂU HỎI CẦN CHỦ ĐỘNG XÁC NHẬN (không tự ý sửa vì chưa rõ chủ đích)

1. **Trả tiền tại phiếu nhập:** ghi CẢ `GR.paid` lẫn `SupplierPayment` là chủ đích hay sót? Nếu chủ đích → `supplierDebt` phải bỏ một vế (S1); nếu không → bỏ `SupplierPayment` tại GR.
2. **Hủy đơn nợ đã thu:** nghiệp vụ mong muốn là gì — trả lại tiền mặt, giữ credit cho khách, hay chặn hủy khi đã có phiếu thu? (S2, M10)
3. **`allowNegativeStock` mặc định `true`:** cố ý cho cửa hàng nhỏ (bán khi thiếu kiểm tra) hay cần đổi `false` + cảnh báo? Ảnh hưởng cách khắc phục M1.
4. **Snapshot trên server (Plan 3):** nguồn state chuẩn để chụp là gì — máy đẩy bất kỳ hay server tự hợp nhất? Câu trả lời quyết định S5 cần sửa ở client hay server.
5. **GC `appliedOps` 30 ngày:** có chấp nhận đánh đổi "quên idempotency" cho `stock.adjust` (M2) hay cần giữ lâu hơn + idempotency theo move?
6. **PO đơn vị phụ:** có kế hoạch nhận PO theo thùng/lốc không (hiện hardcode `unitRatio: 1`)?

---

## Phụ lục A — Phương pháp & bằng chứng

- Đọc toàn văn: `src/core/{db.ts, store.ts, format.ts, types.ts}`, toàn bộ `src/core/domain/*` (sales, inventory, invoices, pricing, customers, purchase, suppliers, units, reports, reconcile, settings, trial, devices, notes, readiness, vietqr, auth, migrate, invoiceImport, seed*), toàn bộ `src/core/sync/*` (apply, hlc, engine, snapshot, mode, transport, http, cloud, cloudAuth, offline, confirmGate, boot, firebase*), `errorLogger.ts`; các UI: web+mobile Checkout/Sale/GoodsReceipt/Stocktake/PurchaseOrders/Orders/Customers/Suppliers/Settings/Tools + catalogXlsx + print + barcode + quickAnswers + voice (điểm tích hợp).
- Xác minh: `npx vitest run` → **25 files, 199 tests pass**; `npx tsc -b --noEmit` → **0 lỗi**; 6 probe thực nghiệm (đã chạy và xoá, không còn trong tree): S1 (debt=0 thay vì 30), S2 (debt=−100), S4 (delete bị nuốt), S3 (batch throw, op sau không áp), M11 (stock=12, ledger=10 → drift 2), M12 (`syncQueue=0` sau `seed500`).
- **Lượt review 2 (đọc lại độc lập, không dùng báo cáo cũ làm bản kiểm):** tái xác nhận cả 6 probe + toàn bộ trích dẫn; bổ sung **M11, M12, L8**; đính chính **L1** (comment `flushQueue` là lý do CỐ Ý không ghi `lastSeq` sau push, không phải comment/code mâu thuẫn; `pulledUpTo` có nhánh seq chính xác khi op mang `seq`); chính xác hóa **S5** (mất chỉ qua khe ước lượng vượt `upToSeq`, máy chụp tụt sau với seq liền mạch thì KHÔNG mất); bổ sung chi tiết **M8** (cả 2 UI SettingsPage) và **L3** (importSnapshot không nguyên tử). Đính chính cả 2 lượt đều đã ghi ngay trong thân báo cáo.
- Mã trích dẫn trong báo cáo là **nguyên văn** từ các file tại thời điểm review (2026-08-04).

## Phụ lục B — Bản đồ phát hiện → file

| ID | Severity | File chính |
|---|---|---|
| S1 | 1 | `domain/inventory.ts`, `domain/suppliers.ts` |
| S2 | 1 | `domain/sales.ts`, `domain/customers.ts` |
| S3 | 1 | `sync/apply.ts`, `sync/engine.ts` |
| S4 | 1 | `sync/apply.ts` |
| S5 | 1 (thiết kế) | `sync/engine.ts`, `sync/snapshot.ts`, `sync/transport.ts` |
| M1 | 2 | `domain/inventory.ts`, `domain/reconcile.ts` |
| M2 | 2 | `sync/apply.ts`, `sync/engine.ts` |
| M3 | 2 | `domain/purchase.ts`, `domain/inventory.ts` |
| M4 | 2 | `domain/inventory.ts` |
| M5 | 2 | `domain/purchase.ts` |
| M6 | 2 | `domain/reports.ts`, `domain/sales.ts` |
| M7 | 2 | `domain/suppliers.ts` |
| M8 | 2 | `core/db.ts`, `sync/snapshot.ts` |
| M9 | 2 | `sync/apply.ts` |
| M10 | 2 | `domain/customers.ts`, web/mobile CustomersPage |
| M11 | 2 | `sync/apply.ts` (case `stocktake.commit`) |
| M12 | 2 | `domain/seed.ts` |
| L1–L8 | 3 | `sync/engine.ts`, `sync/transport.ts`, `sync/snapshot.ts`, `domain/auth.ts`, `domain/pricing.ts` (+`notes`/`invoices`), `domain/trial.ts`, `domain/readiness.ts`, web/mobile SettingsPage |
