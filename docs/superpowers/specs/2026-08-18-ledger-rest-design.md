# Đợt còn lại — S3/M12, M8/L8, M11/M1, S5/M2, LWW, báo cáo

**Ngày:** 2026-08-18  
**Nguồn:** `ANALYSIS-BUSINESS-LOGIC.md` + đánh giá 2026-08-18. Đợt 1 (S1/S2/M10/M3/M4) đã xong.  
**Không làm lại:** S1, S2, M10, M3, M4, L2 (server đã UNIQUE `(shop_id, op_id)`).  
**Không làm:** L4 (hash mật khẩu), L6/L7 (UX copy), viết lại sổ derived.

## Mục tiêu

Shop cloud không kẹt vì một op độc; seed và khôi phục file không phá sync; kiểm kê ghi sổ + khớp lô; snapshot không nhảy `lastSeq` quá xa; LWW xóa/sửa không nuốt nhau; báo cáo mua/MTD/đơn vị đúng.

## Thứ tự ship (mỗi đợt độc lập, test xanh)

| Đợt | Finding | Vì sao trước |
|---|---|---|
| **2** | S3 + M12 + M8 + L8 | Shop live có thể kẹt sync hôm nay; restore file đẩy outbox cũ |
| **3** | M11 + M1 | Sổ kho / lô sai trên máy remote và sau kiểm kê |
| **4** | M2 rồi S5 (+ `3su-cloud` GC) | Replay snapshot an toàn chỉ khi `stock.adjust` idempotent |
| **5** | S4 + M9 + L5 | Hội tụ đa máy — không chặn bán hàng một máy |
| **6** | M5 + M6 + M7 | Báo cáo / so giá — không mất tiền |

## Quyết định đã chốt

| ID | Quyết định |
|---|---|
| S3 | `applyOps` **không throw**. Op lỗi: rollback tx đó, ghi `appliedOps`, ghi `sync:poisoned` (meta), `observeRemoteHlc`, sang op sau. Không retry (retry = kẹt mãi). Op tốt sau đó vẫn áp. |
| M12 | `seed500` / `seedCatalog` ghi `product.upsert` (+ `stock.adjust` nếu `stock > 0`) giống `addProduct`. Không thêm `OpType` mới. |
| M8 | File Settings → `restoreLocalBackup` = `restoreBackup` rồi **xóa `syncQueue`**. Không xóa `appliedOps`, không reset `sync:lastSeq`. |
| M8/cloud | `importSnapshot` **vẫn** `restoreBackup` (không `restoreLocalBackup`). Pending đã copy trước — xóa queue trong `restoreBackup` sẽ mất outbox khi kéo snapshot. |
| L8 | Parse file qua `parseRestoreFile` → `validateBackupSchema`. Không còn check tay `products && sales`. |
| M11 | `stocktake.commit` trên apply ghi `stockMoves` id `mv_${op.id}_${productId}`, `type: 'stocktake'`. Trùng id → bỏ qua dòng đó (không cộng stock lần 2). |
| M1 | Kiểm kê / sửa tồn: `diff < 0` → `consumeBatchesFefo`; `diff > 0` → lô `stocktake` mới (`remain = diff`). `p.batches` + bảng `batches` cùng lúc. |
| M2 | `stock.adjust`: nếu đã có `stockMoves` id `mv_${op.id}` thì return (không cộng `p.stock` lần 2). |
| S5 client | `pullCloudSnapshot`: sau `importSnapshot` **không** `setMeta('sync:lastSeq', got.upToSeq)`. Giữ `lastSeq` cũ nếu `oldLastSeq > 0`; máy mới (`oldLastSeq === 0`) mới gán `upToSeq`. Luôn ghi `sync:lastSnapshotSeq = upToSeq`. |
| S5 server | `gcOldOps` **không xóa ops**. Chỉ xóa `pair_codes` hết hạn. Bảng ops giữ để máy lực `lastSeq` thấp còn kéo được. |
| S4 | `product.delete` / `customer.delete` / `supplier.delete`: tombstone `deleted` + `deletedHlc = op.hlc`. Upsert / field patch bỏ qua nếu `deletedHlc` mới hơn. |
| M9 | `customer.upsert` / `supplier.upsert` trộn theo `fieldHlc` giống `product.upsert` (không LWW cả record). |
| L5 | `invoice.delete` / `pricing.delete` / `note.delete`: tombstone + `deletedHlc`, không `table.delete`. |
| M5 | `aggregatePurchases`: bỏ PO `status === 'received'` (GR đã hiện). Giữ PO draft/sent/partial. |
| M6 | `resolveRange` preset `mtd`: `from = today().slice(0, 8) + '01'` (local), không `toISOString()`. |
| M7 | `compareSupplierPrices`: `qty` quy đổi `row.qty * (row.unitRatio \|\| 1)`; `cost` giữ nguyên đơn giá dòng (đã là / đơn vị dòng) → `unit = costSum / baseQty`. |
| Git | Không commit trừ khi được hỏi. |
| Loop | Không bật lại `/loop` trừ khi được hỏi. |

## Không làm

- Dexie version mới / bảng `failedOps` (dùng meta `sync:poisoned`).
- `catalog.seed` op type.
- Reset `lastSeq` về 0 sau restore file (kéo snapshot cloud sẽ đè file).
- Xóa `syncQueue` bên trong `restoreBackup`.
- Chặn `allowNegativeStock` trong kiểm kê (ngoài phạm vi M1).
- Snapshot server-side merge (đợt sau nếu còn lệch).

## Ràng buộc

- Đợt 2–3, 5–6: chỉ `3su-next`. Đợt 4 thêm `3su-cloud` (`gcOldOps`).
- Identifier English, comment Vietnamese.
- TDD: test đỏ trước.
- Impact GitNexus trước khi sửa symbol public domain/sync/db: `applyOps`, `seed500`, `restoreLocalBackup` (mới), `parseRestoreFile` (mới), `saveStocktake`, `updateProduct`, `pullCloudSnapshot`, `pulledUpTo` (nếu đụng), `gcOldOps`, `applyOne` nhánh liên quan, `aggregatePurchases`, `resolveRange`, `compareSupplierPrices`.
- `confirmSale` vẫn atomic + lock `sale-commit`.
- Test: `npm test` + `npm run typecheck` trong `3su-next`. Đợt 4 thêm test Worker hiện có trong `3su-cloud`.

## Kiến trúc

```
applyOps
  per op: try tx(applyOne + appliedOps)
          catch → appliedOps.add + append sync:poisoned + continue

seedCatalog(items, stock)
  1 tx: mỗi SP giống addProduct (upsert ± stock.adjust)

Settings file
  parseRestoreFile → confirm → restoreLocalBackup (data + clear syncQueue)

importSnapshot
  pending = syncQueue.toArray()
  restoreBackup(snapshot)     // KHÔNG clear queue ở đây
  appliedOps.clear()
  applyOps(pending)

stocktake.apply
  stock += diff (như cũ, stockSetHlc)
  stockMoves id ổn định theo op+SP
  lô: consume / thêm lô stocktake

stock.adjust.apply
  nếu mv_${op.id} đã có → return
  else stock += delta + ghi move

pullCloudSnapshot(force)
  importSnapshot
  lastSeq = oldLastSeq > 0 ? oldLastSeq : upToSeq
  lastSnapshotSeq = upToSeq
```

## File đợt 2 (làm trước)

| File | Việc |
|---|---|
| `src/core/sync/apply.ts` | `applyOps` catch; `getPoisonedOps` / `recordPoisonedOp` |
| `src/core/domain/seed.ts` | `seedCatalog`; `seed500` gọi nó |
| `src/core/db.ts` | `restoreLocalBackup` |
| `src/core/domain/trial.ts` | `parseRestoreFile` |
| `src/web/pages/SettingsPage.tsx` | parse + `restoreLocalBackup` |
| `src/mobile/pages/SettingsPage.tsx` | như web |
| `tests/apply.test.ts` | đổi case "thiếu SP → throw" |
| `tests/sync-rest.test.ts` | S3 + M12 + M8 + L8 |

## File đợt 3–6 (sau)

| Đợt | File chính |
|---|---|
| 3 | `apply.ts` `stocktake.commit`; `inventory.ts` `saveStocktake` / `updateProduct` |
| 4 | `apply.ts` `stock.adjust`; `engine.ts` `pullCloudSnapshot`; `3su-cloud/src/d1.ts` `gcOldOps` |
| 5 | `apply.ts` delete/upsert; `types.ts` `deletedHlc`; domain delete helpers |
| 6 | `purchase.ts` `aggregatePurchases`; `reports.ts` `resolveRange`; `suppliers.ts` `compareSupplierPrices` |
