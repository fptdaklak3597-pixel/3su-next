# Authoritative Money & Stock — Design Spec

> Nguồn sự thật cho chuyển đổi hàng/tiền của `3su-next` + `3su-cloud`.
> Agent đọc file này trước khi viết plan phase hoặc code.
>
> **Roadmap gate:** `docs/superpowers/plans/2026-08-20-authoritative-money-stock-roadmap.md`
> (sau khi spec này được Approved, roadmap phải chỉnh lại cho khớp model offline lạc quan + Conflict Inbox — **không** lấy escrow đa máy làm mặc định).

**Trạng thái:** Approved  
**Ngày soạn:** 2026-08-20  
**Ngày duyệt:** 2026-08-20  
**Phạm vi repo:** `3su-next` (client), `3su-cloud` (Worker + Durable Object + D1)

---

## 1. Mục tiêu & tiêu chí thành công

### 1.1 Mục tiêu

1. Nhiều thiết bị **đồng bộ gần realtime** khi cùng online (WS bump + kéo event).
2. **Không lệch tiền và hàng hóa trên sổ chính thức:** tồn, công nợ KH/NCC, doanh thu, giá vốn chỉ thay đổi qua Canonical Event do server commit.
3. **Offline-first về thao tác:** mất mạng vẫn bán / nhập được trên mọi thiết bị; khi có mạng lại có **ritual đồng bộ chuẩn** và **xử lý conflict có người** — sổ canonical không bị ghi âm kho hay double-pay.
4. Giữ UX local (IndexedDB, giỏ hàng, danh mục); đổi **ranh giới trách nhiệm** cho domain hàng/tiền.

### 1.2 Định nghĩa “không lệch”

- **Có nghĩa:** sổ canonical (ledger + projection server) luôn thỏa invariant; báo cáo chính thức chỉ đọc canonical + event đã commit.
- **Không nghĩa:** mọi đơn offline đều chắc chắn được accept. Đơn xung đột vào Conflict Inbox; sau xử lý đúng quy trình thì sổ vẫn đúng.
- **Không dùng** `Math.max(0)` (hoặc tương đương) để nuốt phần trả/thu vượt nợ cho “đẹp số”.

### 1.3 Tiêu chí thành công (measurable)

- Hai máy online cùng bán item cuối (stock = 1): đúng một accept; một conflict/reject; stock canonical = 0.
- Hai máy offline mỗi máy bán 1 khi stock = 1: sau reconnect ritual, đúng một vào sổ; một conflict; **không** stock = −1.
- Cùng `commandId` gửi/retry N lần: ≤ 1 business effect.
- Overpay (amount > nợ): reject cả command; balance không đổi sai.
- Payment (thu nợ / trả NCC) không tạo được khi offline.
- UI không in bill chính thức / toast “đã chốt sổ” cho bản ghi `pending` hoặc `conflict`.

---

## 2. Quan hệ với spec sync cũ

Spec `2026-08-14-3su-cloud-sync-design.md` giữ nguyên cho:

- Op-log, HLC, `/ops`, LWW cho hồ sơ / note / settings / metadata không phải sổ cái hàng–tiền.
- WS bump như tín hiệu “có dữ liệu mới”.

**Supersede (chỉ domain hàng/tiền khi feature flag bật):**

- Nguyên tắc “server ngu / client khôn” **không áp dụng** cho sale, void sale, goods receipt, customer payment, supplier payment.
- Client **không** được tự commit canonical stock/debt/cost/total rồi đẩy op “đã tính sẵn” như nguồn sự thật.

Dual-path trong thời gian chuyển đổi:

| Path | Dùng cho |
|------|----------|
| **Command / Canonical Event** | sale, sale.void, goodsReceipt, customerPayment, supplierPayment |
| **Legacy `/ops`** | note, settings UI, và các type chưa chuyển |

---

## 3. Policy đã khóa (product)

| ID | Policy | Quyết định |
|----|--------|------------|
| P1 | Thu/trả vượt nợ | **Reject cả command** — không tạo credit tự động |
| P2 | Thu nợ KH / trả NCC offline | **Cấm** — online bắt buộc |
| P3 | Âm kho canonical | **Cấm** khi authoritative mode bật |
| P4 | Nhập hàng offline | **Cho phép** (pending); hỗ trợ `dependsOn` |
| P5 | Bán hàng offline | **Cho phép mọi thiết bị** (pending, không hạn mức escrow mặc định) |
| P6 | Sau reconnect | Pull event → apply canonical → flush command; conflict → Inbox |
| P7 | Hủy pending / đóng conflict kiểu hủy | **Chỉ owner** |
| P8 | Void đơn đã confirmed | Theo quyền **`sale.void` hiện có** |
| P9 | `stock.adjust` khi xử lý lệch | **Chỉ owner** + lý do bắt buộc |
| P10 | Unit quy đổi | Client gửi **tên/id đơn vị**; server resolve ratio từ catalog — **không tin `unitRatio` client** |
| P11 | Số tiền/kho chính thức | Server tính: price, cost, total, profit, debt, stock delta, weighted cost |

---

## 4. Kiến trúc đích

```
Client (3su-next)
  IndexedDB: canonical projection + commandQueue + pending overlay + conflicts
  confirm* → build Command (ý định) → queue
       │
       ├─ online:  reconnect ritual / flush
       └─ offline: pending only (trừ payment bị chặn)
       │
       ▼
Cloudflare Worker + 1 Durable Object / shop
  auth (Firebase JWT) + device binding (audit)
  POST /v1/shops/:shopId/commands
  idempotency → validate → load state → business rules
  → atomic commit ledgers + projections + events
  → WS bump { t: "bump", seq }
       │
Client pull GET /events?since=cursor → applyCanonicalEvents
```

**Durable Object** = cổng serialize duy nhất xử lý command của shop (không race giữa hai request).  
**D1 / SQLite trong DO:** persistence events, commands dedupe, ledgers, projections — chi tiết schema chốt ở plan phase backend; spec yêu cầu: commit durable **trước** bump.

Realtime: bump **không** mang business payload; client luôn kéo event để áp dụng.

---

## 5. Hợp đồng dữ liệu

### 5.1 Command types (wave 1)

```ts
type CommandType =
  | 'sale.create'
  | 'sale.void'
  | 'goodsReceipt.create'
  | 'customerPayment.create'
  | 'supplierPayment.create'
```

### 5.2 CommandEnvelope

```ts
interface CommandEnvelope {
  id: string            // idempotency key; client sinh ổn định, không đổi khi retry
  shopId: string
  deviceId: string      // phải khớp credential thiết bị đã cấp
  userId: string
  type: CommandType
  payload: unknown      // chỉ fact / ý định — cấm field canonical (xem 5.5)
  occurredAt: string    // ISO lúc nghiệp vụ xảy ra trên máy
  localSeq: number      // thứ tự local trên device
  dependsOn?: string[]  // commandId cha phải accepted trước
  createdAt: number
}
```

### 5.3 CommandResult

```ts
interface CommandResult {
  commandId: string
  status: 'accepted' | 'rejected' | 'conflict'
  events: CanonicalEvent[]
  error?: { code: string; message: string }
}
```

- `rejected`: sai dữ liệu / không đủ quyền / vi phạm rule (vd overpay, unit không tồn tại) — thường không sửa được bằng “đợi hàng”.
- `conflict`: state hiện tại không cho apply (vd hết tồn do máy khác) — vào Conflict Inbox.

### 5.4 CanonicalEvent

```ts
interface CanonicalEvent {
  id: string
  seq: number           // monotonic theo shop; thứ tự canonical
  shopId: string
  commandId: string
  type: string          // vd SaleCommitted, InventorySold, CustomerCharged, ...
  occurredAt: string
  committedAt: string
  schemaVersion: number
  payload: unknown      // đủ để rebuild projection; snapshot tên SP/NCC lúc giao dịch
}
```

### 5.5 Payload client được gửi / bị cấm

**sale.create — gửi:** `items[{ productId, qty, unitName }]`, `discountRequest`, `payMethod`, `tendered`, `customerId?`, `wholesale?`  
**Cấm:** `total`, `profit`, `cost`, `price` từng dòng (server gán), `stockAfter`, `debtAfter`, `unitRatio` như nguồn sự thật.

**goodsReceipt.create — gửi:** supplier/PO/ref, `rows[{ productId, qty, unitName, purchasePrice, expiry? }]`, `paid`, `payMethod`, `note?`  
**Cấm:** `newCost`, `stockAfter`, weighted average đã tính sẵn.

**customerPayment / supplierPayment — gửi:** đối tượng, `amount`, `method`, `note?`, ref tùy chọn  
**Cấm:** `balanceAfter`. Offline: client **không enqueue** (chặn ở UI + engine).

---

## 6. Ledger & invariant

### 6.1 Tồn kho

```
canonicalStock =
  opening
  + receipts
  + adjustments
  + void/restore
  − sales
```

Mọi thay đổi tồn = dòng **inventory ledger** (signed) + cập nhật projection trong cùng commit.

### 6.2 Công nợ KH / NCC

Source of truth = **signed ledger** (charge / payment / void reversal).  
Projection balance = Σ entries.  
`amount > nợ hiện tại` (theo chiều thu/trả) → **reject cả command** (P1).

### 6.3 Giá vốn

Chỉ server tính weighted average (và batch/FEFO theo rule inventory hiện có khi gắn canonical).  
Client không ghi đè cost canonical.

### 6.4 Idempotency & sequence

- Một `commandId` → tối đa một lần apply business effect; retry trả cùng `CommandResult`.
- `seq` event không lùi; apply event theo `seq`; duplicate event id/`seq` = no-op.

---

## 7. Trạng thái client & UI

### 7.1 syncState trên chứng từ hàng/tiền

`pending` | `confirmed` | `rejected` | `conflict` | `cancelled`

### 7.2 Pending overlay (UX, không phải sổ chính)

Trên mỗi device:

```
displayStock(sku) =
  canonicalStock(sku)
  − Σ pending local sale qty (base unit)
  + Σ pending local receipt qty (base unit)
```

Máy khác **không** thấy overlay của máy này cho đến khi event/conflict đồng bộ. Overlay chỉ giảm bán “ảo” trên chính máy đó.

### 7.3 UI policy

| Trạng thái | In bill chính thức | Clear cart kiểu “đã chốt sổ” | Báo cáo chính thức |
|------------|--------------------|------------------------------|--------------------|
| pending | Không (chỉ bản “CHƯA XÁC NHẬN” nếu cần) | Không coi là confirmed | Không |
| conflict | Không | Không | Không |
| rejected / cancelled | Không | Không | Không |
| confirmed | Có | Có | Có |

Conflict Inbox: hiện trên mọi máy đã online sau khi có tín hiệu; **nút Hủy chỉ owner**.

---

## 8. Chu trình mất mạng → có mạng → đồng bộ

### 8.1 Online bình thường

Command → POST → events → bump → pull → `confirmed`.

### 8.2 Mất mạng

1. Mode `degraded` + banner: đơn chờ đồng bộ, chưa vào sổ chính.  
2. Cho: sale.create, goodsReceipt.create (pending).  
3. Chặn: customerPayment, supplierPayment.  
4. Mỗi thao tác: `commandId` ổn định + `commandQueue` + record `syncState=pending` + overlay; **không** ghi vào canonical projection như đã trừ sổ chính.

### 8.3 Reconnect ritual (thứ tự bắt buộc)

```
1. Auth + device OK
2. PULL events until caught up; apply → canonical + cursor
3. Recompute pending overlay trên canonical mới
4. FLUSH commandQueue (localSeq / createdAt, tôn trọng dependsOn)
5. Map result → confirmed | rejected | conflict
6. Nếu còn conflict mở → Conflict Inbox
7. Kết thúc degraded chỉ khi ritual xong và không còn command “sending”
```

**Cấm:** flush command trước khi catch-up event.  
**Cấm:** trừ canonical local rồi mới sync (dễ double-count).

### 8.4 Đa thiết bị cùng reconnect

DO serialize: ai được xử lý trước nhận hàng còn lại; máy sau có thể conflict. Đó là hành vi đúng, không phải lỗi sync.

---

## 9. Xử lý lệch (Conflict)

### 9.1 Phân loại

| Mã | Tình huống | Xử lý |
|----|------------|--------|
| L1 | Không đủ tồn | `conflict` → Inbox |
| L2 | Payload/unit/qty không hợp lệ | `rejected` |
| L3 | `dependsOn` chưa accepted | Giữ queue, thử lại sau |
| L4 | Trùng `commandId` | Trả result cũ |
| L5 | Overpay | `rejected` |
| L6 | Drift projection ≠ ledger (migration/bug) | Chặn ghi / cảnh báo owner; reconcile có chủ đích |

### 9.2 Hành động Inbox (L1)

| Hành động | Ai | Mô tả |
|-----------|----|--------|
| **Hủy** pending/conflict | **Owner only** | Không vào sổ; audit bắt buộc |
| Sửa bằng hủy + tạo sale mới | Staff (sau khi owner hủy, hoặc owner tự làm) | Wave 1 không làm amend tại chỗ |
| Nhập bù rồi bán lại | Theo quyền nhập/bán | GR → sale mới |
| `stock.adjust` | **Owner only** + lý do | Rồi mới bán lại nếu cần |

**Cấm:** force accept làm âm kho.

### 9.3 Đóng conflict

Conflict đóng khi pending gốc `cancelled`/`rejected` đã acknowledge, không còn command treo liên quan, invariant cầm: tồn ≥ 0, balance = Σ ledger. Ghi audit/event `ConflictResolved`.

---

## 10. Device identity

Firebase Auth chứng minh **user**. Command gắn **deviceId** phải khớp **device credential** do server cấp (bootstrap / rotate / revoke), bind user+shop+device.

Dùng cho: audit, chống giả mạo deviceId, giới hạn flush.  
**Wave 1 không** cấp stock escrow đa máy làm mặc định (P5). Escrow có thể là phase tùy chọn sau nếu product đổi policy.

---

## 11. Migration (Genesis)

Khi bật flag authoritative cho shop:

1. Backup local.  
2. Reconcile kiểm tra drift stockMoves ↔ stock, sales/payments ↔ debt (theo tool hiện có + rule mới).  
3. Drift không chấp nhận được → **không** bật flag; báo owner.  
4. Tạo Genesis Snapshot (opening stock / customer balances / supplier balances).  
5. Server tạo opening ledger + projection; ghi `migrationVersion`.  
6. Retry genesis idempotent; snapshot lệch sau genesis → block.  
7. Lịch sử UI cũ giữ xem; sổ authoritative bắt đầu từ opening checkpoint.

Không replay mù toàn bộ lịch sử bẩn thành ledger canonical.

---

## 12. Feature flag & rollout

- Flag theo shop, mặc định **off**.  
- Off: behavior legacy (op path hiện tại) không gãy.  
- On: chỉ sau genesis OK + credential device.  
- Rollout: shop thử → theo dõi Conflict Inbox → mới mở rộng.  
- Gỡ legacy `sale.commit` / `gr.commit` / `debt.pay` khỏi path tiền-kho chỉ ở phase cuối roadmap khi gate chaos xanh.

---

## 13. Phạm vi / ngoài phạm vi

**Trong scope:** contracts, command processor, events, client queue, reconnect ritual, Conflict Inbox, sale/GR/payment/void, UI pending/confirmed, genesis, tests/gates.

**Ngoài scope wave 1:** escrow đa máy mặc định; payment lease offline; peer-to-peer LAN sync; force-accept âm kho; tự tạo customer/supplier credit từ overpay; đổi UI branding lớn.

---

## 14. Testing & Definition of Done (tóm tắt)

Chi tiết phase/gate: roadmap. Mọi phase: fail gate → làm lại phase đó.

Bắt buộc có test cho:

- Concurrent online hết hàng → 1 accept / 1 conflict, stock = 0  
- Concurrent offline cùng SKU → sau ritual không âm kho; conflict hiện đủ  
- Retry cùng commandId  
- Mất response sau commit → pull → confirmed, không nhân đôi  
- dependsOn receipt → sale  
- Overpay reject  
- Payment bị chặn offline  
- Owner-only cancel conflict  
- Unit giả / ratio giả bị reject hoặc bỏ qua theo server catalog  
- Reconnect: pull trước flush  
- Duplicate event no-op; seq không lùi  

Không `.skip` / xóa test để xanh.

---

## 15. Thứ tự triển khai (tham chiếu)

0. Spec Approved (file này)  
1. Contracts  
2. Processor harness (in-memory)  
3. API/DO wire  
4. Client commandQueue  
5. Sale online + UI policy  
6. Offline pending + reconnect ritual + Conflict Inbox (owner cancel)  
7. Void  
8. Goods receipt + dependsOn  
9. Payments online-only  
10. Genesis + flag  
11. Chaos / gỡ legacy path tiền-kho  

Plan task-level viết **từng phase** sau khi spec được Approved; không code production tiền-kho trước Approved.

---

## 16. Quyết định đã chốt trong brainstorm

- Hướng: server-authoritative cho hàng/tiền + dual-path legacy ops.  
- Offline: lạc quan đa máy + conflict resolution (không escrow mặc định).  
- Overpay: reject (C). Payment offline: cấm (A). Âm kho: cấm (A). GR offline: cho (A).  
- Hủy pending/conflict: owner only. Void confirmed: quyền `sale.void` hiện có (B).

---

## Approved

```
Approved: 2026-08-20
Người duyệt: chủ project (chat — "làm đi")
```

Chỉ khi có dòng Approved mới mở plan/code Phase 1+.
