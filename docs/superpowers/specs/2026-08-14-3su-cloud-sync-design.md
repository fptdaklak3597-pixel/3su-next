# 3SU Cloud Sync — Thiết kế đã duyệt (Spec)

> Tài liệu này là "nguồn sự thật" cho toàn bộ quá trình chuyển đổi. Agent ở tab mới đọc file này TRƯỚC,
> sau đó thực thi từng plan trong `docs/superpowers/plans/` theo thứ tự ở mục "Lộ trình".

**Ngày duyệt:** 2026-08-14
**Phạm vi:** `3su-next` (client PWA) + repo mới `3su-cloud` (Cloudflare Worker + Durable Objects + D1)

---

## 1. Mục tiêu & tiêu chí thành công

1. **Offline tuyệt đối:** mất mạng vẫn bán, nhập kho, thu nợ, kiểm kê — không giới hạn thời gian. Có mạng lại thì tự đồng bộ, không mất op nào.
2. **Đồng bộ tức thì:** shop có ≥2 máy, đơn chốt ở máy A hiện ở máy B **< 1 giây** khi cùng online.
3. **Tối đa số shop trên gói miễn phí:** mục tiêu ≥ 1.000 shop hoạt động/ngày trong free tier (nút thắt là D1 100k row-writes/ngày — xem mục 7).
4. **Không phá UI đã làm:** desktop giữ giao diện kiểu KiotViet, mobile giữ giao diện 3SU v2.7.4 gốc. Toàn bộ chuyển đổi này là tầng dữ liệu/đồng bộ.

## 2. Kiến trúc đích (đã duyệt)

```
┌─ Client PWA (3su-next) ──────────────────────────────┐
│ IndexedDB (Dexie) = nguồn sự thật khi vận hành       │
│ Outbox op-log (syncQueue) + HLC + appliedOps          │
│ SyncTransport: fetch + WebSocket                      │
└──────────────┬────────────────────────────────────────┘
               │ HTTPS + WSS
┌─ Cloudflare ─▼────────────────────────────────────────┐
│ Worker (API /v1, verify JWT Firebase, đọc D1)         │
│ Durable Object — 1 DO / shop:                         │
│   • serialize ghi op, cấp seq tăng dần                │
│   • WebSocket room (hibernation): bump / mode / print │
│ D1: ops (log), snapshots, members, pair_codes         │
└──────────────┬────────────────────────────────────────┘
               │
┌─ Firebase ───▼──────────┐  ┌─ Netlify ────────────────┐
│ Auth (email/Google)     │  │ Host PWA + CDN            │
│ FCM push (app đóng)     │  │ Function: gemini-invoice,  │
│                         │  │ Function: fcm-send         │
└─────────────────────────┘  └───────────────────────────┘
```

**Những gì BỎ khỏi hot path:** Firestore (schema `shops/{key}/sync/op` của bản next hiện tại) và RTDB. Firebase chỉ còn 2 vai trò: Auth + FCM. App cũ 3su-v2.7.4 đang chạy trên hạ tầng cũ **không bị đụng tới** — hai app song song cho tới khi shop tự chuyển (mục 8).

**Nguyên tắc vàng — server "ngu", client "khôn":** server KHÔNG chứa nghiệp vụ. Server chỉ làm 3 việc: (a) nhận op, chống trùng, cấp `seq`, lưu; (b) lưu/serve snapshot; (c) broadcast tín hiệu. Toàn bộ reducer (áp op vào dữ liệu) chạy ở client. Mọi client replay cùng một dãy op theo `seq` → hội tụ. Hệ quả: 1 đơn hàng = **1 row D1** bất kể bao nhiêu mặt hàng, và server không bao giờ có bug nghiệp vụ.

## 3. Mô hình dữ liệu đồng bộ

### 3.1 Op envelope

```ts
interface SyncOp {
  id: string        // = chuỗi HLC, duy nhất toàn cục, đồng thời là idempotency key
  hlc: string       // "<ms 13 số>-<counter 4 hex>-<deviceId>" — so sánh chuỗi = so sánh thời gian
  deviceId: string
  type: OpType
  payload: unknown
  createdAt: number // giờ máy, chỉ để hiển thị
  attempts: number  // retry đếm phía client, không gửi lên server
  lastError?: string
}
```

### 3.2 Ba quy tắc trộn dữ liệu (bảng quyết định)

| Loại dữ liệu | Quy tắc | Lý do |
|---|---|---|
| Đơn bán, phiếu nhập, phiếu thu nợ, kiểm kê (record) | **Immutable append** — id duy nhất, không sửa, hủy đơn là op mới | Không thể conflict |
| Tồn kho, công nợ khách, totalSpent/orderCount, nợ NCC | **Delta** — op chỉ mang số cộng/trừ, replay giao hoán | Hai máy bán offline cùng lúc đều đúng |
| Hồ sơ SP/khách/NCC (tên, giá, barcode…), settings, notes | **LWW theo HLC** — bản ghi có trường `hlc`, op mới hơn thắng | Sửa hồ sơ hiếm khi va nhau |
| Kiểm kê đặt tồn tuyệt đối | **Set-then-delta**: `stock = actual + Σ(delta local chưa đẩy)` , LWW theo `stockSetHlc` | Không nuốt đơn offline chưa sync (xem 3.4) |

**Cấm tuyệt đối:** op `product.upsert` / `customer.upsert` KHÔNG BAO GIỜ mang `stock`, `batches`, `debt`, `totalSpent`, `orderCount` — các trường đó chỉ đổi qua delta op. Tạo SP mới có tồn ban đầu = `product.upsert` + `stock.adjust {delta: tồn_ban_đầu, reason: 'init'}`.

### 3.3 Danh sách OpType (v1)

```
sale.commit        payload: Sale                                   (immutable + delta kho/nợ suy từ items/debtAmount)
sale.void          payload: { saleId, reason }                     (delta đảo)
product.upsert     payload: { product: Omit<Product,'stock'|'batches'> }   (LWW)
product.delete     payload: { productId }                          (soft delete, LWW)
stock.adjust       payload: { productId, delta, reason, refId? }   (delta)
stocktake.commit   payload: StocktakeRecord                        (set-then-delta + append record)
customer.upsert    payload: { customer: Omit<Customer,'debt'|'totalSpent'|'orderCount'> } (LWW)
customer.delete    payload: { customerId }                         (LWW)
debt.pay           payload: DebtPayment                            (immutable + delta nợ)
gr.commit          payload: { gr: GoodsReceipt, patches: GrPatch[], supplierDelta? }  (immutable + delta kho + LWW giá vốn/giá bán)
supplier.upsert    payload: { supplier: Omit<Supplier,'debt'|'totalPurchased'|'orderCount'> } (LWW)
settings.set       payload: { key: 'settings' | 'shop', value }    (LWW)
note.upsert        payload: Note                                   (LWW)
note.delete        payload: { noteId }                             (LWW)
```

`GrPatch` = kết quả máy tạo phiếu ĐÃ TÍNH SẴN: `{ productId, addQty, newCost, newPrice?, expiry?, batches: ProductBatch[], priceLogRows: PriceLogEntry[] }`. Máy nhận chèn y nguyên (kể cả id batch) → giá vốn bình quân hội tụ chính xác bằng LWW thay vì tính lại lệch thứ tự. Chưa sync ở v1 (local-only): `purchaseOrders`, `users`, `pricingRules`, `quickAnswers`, `devices`, `archive`, `invoices` — chuyển dần ở Plan 3+.

### 3.4 HLC + chống áp trùng + delta treo

- **HLC clock** mỗi máy: `next() = max(now, last+1)`, nhận op remote thì `observe(remoteHlc)` để đẩy đồng hồ. Chịu được đồng hồ máy sai/lùi.
- **Bảng `appliedOps`** (chỉ chứa op id): op tạo local được ghi vào đây NGAY trong transaction tạo op → khi pull về gặp lại op của chính mình thì bỏ qua tự nhiên. Op remote áp xong cũng ghi vào đây. Mọi apply đều idempotent.
- **Quy tắc delta treo (pending re-apply):** khi áp `stocktake.commit` remote hoặc nhập snapshot: `stock_cuối = giá_trị_set + Σ delta` của các op còn trong outbox local (sale.commit trừ, gr.commit cộng, stock.adjust cộng/trừ, sale.void hoàn). Tương tự cho nợ khách khi nhập snapshot. Đây là chỗ dễ sai nhất — bắt buộc có test riêng.

### 3.5 SOLO / SYNC (kế thừa triết lý V2 của 2.7.4)

- Mọi máy đăng nhập cloud, khi online, mở **1 WebSocket** tới DO của shop (hibernation — gần như miễn phí khi im lặng).
- DO đếm kết nối và phát `{t:'mode', mode, peers}`:
  - **SOLO** (1 máy): client KHÔNG đẩy op realtime. Op vẫn ghi outbox đầy đủ. Mỗi ngày 1 lần (hoặc khi outbox > 500 op) đẩy **snapshot** nén + xóa outbox đã gói. Tiết kiệm ~98% lượt ghi D1 cho shop 1 máy.
  - **SYNC** (≥2 máy): cả hai xả outbox ngay (push batch), sau đó mỗi op mới đẩy tức thì.
- Máy nhận `{t:'bump', seq}` → `GET /ops?since=lastSeq` → `applyOps` → cập nhật UI (< 1s).
- Chưa đăng nhập cloud = mode **LOCAL**: app chạy offline thuần, không transport (trạng thái mặc định sau Plan 1).

## 4. Giao thức server (chuẩn cho Plan 2/3)

### 4.1 REST (Worker, prefix `/v1`, header `Authorization: Bearer <Firebase JWT>`)

```
POST /v1/shops                        → tạo shop mới, caller = owner
POST /v1/shops/:id/pair               → owner tạo mã ghép 6 ký tự, TTL 120s
POST /v1/pair/redeem {code}           → máy mới đổi mã lấy membership
POST /v1/shops/:id/ops   {ops: SyncOp[]}            → DO: dedup theo op id, cấp seq, lưu D1, bump room
                          ← {acked: string[], seq}
GET  /v1/shops/:id/ops?since=<seq>&limit=500        ← {ops, seq}   (Worker đọc D1 thẳng, không qua DO)
POST /v1/shops/:id/snapshot {gzipBase64, upToSeq}   → lưu bảng snapshots, giữ 7 bản gần nhất
GET  /v1/shops/:id/snapshot                          ← bản mới nhất + upToSeq (máy mới join: snapshot + ops sau đó)
GET  /v1/shops/:id/ws                 → upgrade WebSocket vào DO room
```

### 4.2 WebSocket messages (DO → client)

```ts
type ServerMsg =
  | { t: 'bump'; seq: number }                       // có op mới, pull đi
  | { t: 'mode'; mode: 'solo' | 'sync'; peers: number }
  | { t: 'print'; job: unknown }                     // in phiếu chéo máy (Plan 3+)
```

### 4.3 D1 schema

```sql
CREATE TABLE ops (
  shop_id TEXT NOT NULL, seq INTEGER NOT NULL,
  op_id TEXT NOT NULL, device_id TEXT NOT NULL, hlc TEXT NOT NULL,
  type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (shop_id, seq)
);
CREATE UNIQUE INDEX ux_ops_opid ON ops(shop_id, op_id);

CREATE TABLE snapshots (
  shop_id TEXT NOT NULL, day TEXT NOT NULL,          -- YYYY-MM-DD
  up_to_seq INTEGER NOT NULL, data BLOB NOT NULL,    -- gzip JSON
  created_at INTEGER NOT NULL,
  PRIMARY KEY (shop_id, day)
);

CREATE TABLE members (shop_id TEXT, uid TEXT, role TEXT, added_at INTEGER, PRIMARY KEY (shop_id, uid));
CREATE TABLE pair_codes (code TEXT PRIMARY KEY, shop_id TEXT, expires_at INTEGER);
```

Dọn dẹp (cron worker hằng ngày): xóa `ops` có `seq <= min(up_to_seq)` của snapshot cũ nhất còn giữ; xóa `pair_codes` hết hạn.

## 5. Bảo mật

- Worker verify Firebase JWT bằng `jose`, cache JWKS trong KV (TTL 6h). Mọi endpoint check `members`.
- Ghép máy: quét QR chứa mã 6 ký tự TTL 120s do chủ shop tạo. Không còn "cloud key" kiểu Firestore cũ.
- Op không được vượt 32KB (chặn ở Worker); batch tối đa 100 op/request.
- deviceId chỉ để đánh dấu nguồn, KHÔNG phải cơ chế xác thực.

## 6. FCM push (app đóng vẫn biết)

DO thấy op `sale.commit` mà room chỉ có máy gửi online → gọi Netlify function `fcm-send` (giữ service account trong env Netlify) → đẩy notification "Đơn 85.000đ vừa chốt ở máy 2" tới token của các máy offline. Token đăng ký ở client (Plan 3), lưu bảng `members` (cột `fcm_token`).

## 7. Ngân sách free tier (số chốt để không vượt)

| Tài nguyên | Giới hạn free/ngày | Tiêu thụ ước tính | Trần an toàn |
|---|---|---|---|
| D1 row writes | 100.000 | Shop SYNC ~60 rows (50 đơn + phụ); shop SOLO ~2 rows (snapshot) | ~800 shop SYNC + 5.000 shop SOLO |
| Workers requests | 100.000 | Shop SYNC ~150 req (push+pull+ws); SOLO ~8 req | khớp trần D1 |
| DO requests + duration | 100k req, 13k GB-s | WS hibernation ~0 khi im | không phải nút thắt |
| D1 reads | 5.000.000 | pull `since` là index scan nhỏ | không phải nút thắt |
| Firebase Auth | 50k MAU | 1 shop ~2-3 user | ~15k shop |
| FCM | không giới hạn | — | — |
| Netlify functions | 125k/tháng | gemini-invoice + fcm-send | đủ, có thể dời sang Worker nếu chạm |

Khi vượt (tín hiệu tốt): bật Workers Paid $5/tháng → trần nhảy ~15-20 lần. Không đổi kiến trúc.

## 8. Chuyển đổi từ 3su-v2.7.4 (app cũ đang chạy)

**Quyết định:** KHÔNG sync 2 chiều với Firestore `d_*` của app cũ. Duy trì 2 schema song song là nguồn bug vô tận. Thay vào đó:

1. App cũ đã có "Xuất JSON đầy đủ" — giữ nguyên, không đụng app cũ.
2. `3su-next` thêm màn **"Chuyển từ 3SU cũ"** (Plan 5): nhập file JSON, map schema cũ → mới (products/sales/customers/debts/receipts), đối chiếu checksum (tổng tồn, tổng nợ, số đơn) hiển thị cho chủ shop xác nhận.
3. Shop chuyển = chuyển hẳn một lần. Hai app chạy song song trên 2 URL trong giai đoạn quá độ.

## 9. Lộ trình — 5 plan, mỗi plan tự chạy được và test được

| # | Plan | Phạm vi | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | **Sync core client** (`plans/2026-08-14-plan1-sync-core-client.md`) | HLC, op schema v2, reducer `applyOps` idempotent, outbox dời vào domain transaction, snapshot, mode machine, `SyncTransport` interface + NullTransport, gỡ Firestore adapter. App chạy offline thuần y như cũ. | — | **Sẵn sàng thực thi** |
| 2 | Server `3su-cloud` | Repo mới tại `D:\claude\3su\3su-cloud`: Worker + DO + D1 theo mục 4, auth JWT, test bằng `@cloudflare/vitest-pool-workers`, deploy `wrangler`. | Spec mục 4-5 | Viết plan sau khi xong Plan 1 |
| 3 | Nối client ↔ server | `HttpTransport` (fetch+WS) implement `SyncTransport`, SOLO/SYNC live, join máy mới (snapshot+ops), ghép máy QR, Background Sync, FCM token + push, đăng nhập Firebase Auth trong 3su-next. | Plan 1+2 | — |
| 4 | Offline hardening + PWA | `navigator.storage.persist()`, Web Locks chống double-submit đa tab, BroadcastChannel refresh UI đa tab, iOS quirks, luồng update SW an toàn, GC `appliedOps`/outbox. | Plan 1 | — |
| 5 | Migration + khác biệt hóa | Màn "Chuyển từ 3SU cũ", hoàn thiện GDT invoice import, VietQR động thu nợ, cảnh báo FEFO/HSD xả hàng, sync các bảng còn lại (users, PO…). | Plan 1-3 | — |

**Quy trình cho agent tab mới:** đọc spec này → thực thi Plan 1 bằng skill `executing-plans` (hoặc `subagent-driven-development`) → xong Plan 1 thì dùng skill `writing-plans` viết Plan 2 dựa trên mục 4-5 của spec → tiếp tục tuần tự. Không gộp plan. Không đổi quyết định kiến trúc nếu chưa hỏi chủ dự án.

## 10. Rủi ro & đối sách

| Rủi ro | Đối sách |
|---|---|
| Giá vốn bình quân lệch giữa máy do thứ tự áp op | `GrPatch` mang giá vốn đã tính sẵn, LWW theo HLC (mục 3.3) |
| Kiểm kê remote nuốt đơn offline chưa đẩy | Quy tắc delta treo (mục 3.4) + test bắt buộc |
| iOS xóa IndexedDB sau 7 ngày không dùng | `storage.persist()` (Plan 4) + snapshot cloud hằng ngày + nhắc mở app qua FCM |
| D1 chạm trần 100k writes | Mode SOLO mặc định cho shop 1 máy; đo bằng counter trong `shop_meta`; nâng paid khi cần |
| Đồng hồ máy sai nhiều ngày | HLC bảo toàn thứ tự nhân quả; hiển thị cảnh báo nếu lệch server > 24h |
| Dexie transaction chết vì await promise ngoài Dexie | Quy ước code: trong transaction chỉ await thao tác Dexie (đã ghi trong Plan 1) |
