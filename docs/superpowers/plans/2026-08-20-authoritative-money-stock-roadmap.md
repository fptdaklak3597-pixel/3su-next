# Authoritative Money/Stock — Master Roadmap (gate loop)

> **For agentic workers:** Đây là **master roadmap + Definition of Done**. Mỗi phase khi bắt đầu phải có plan chi tiết riêng (`…-phase-N-….md`) và thi công task-by-task (subagent-driven-development hoặc executing-plans). Không nhảy phase khi gate đỏ.
>
> **Không phải** plan thay thế sync op-log hiện tại cho note/settings — dual-path: command cho hàng/tiền, legacy `/ops` cho dữ liệu không quan trọng cho đến phase cuối.

**Goal:** Nhiều thiết bị realtime đồng bộ; mọi số chính thức về hàng/tiền chỉ đến từ server Canonical Event; offline không được phá invariant.

**Architecture:** Client ghi Command (ý định) + pending overlay; Durable Object / shop xử lý authoritative; Canonical Event stream + WS bump; offline bán/nhập lạc quan trên mọi máy → reconnect ritual (pull events rồi flush) → Conflict Inbox; thu/trả nợ online-only. Escrow đa máy **không** phải mặc định (xem spec 2026-08-20).

**Spec:** `docs/superpowers/specs/2026-08-20-authoritative-money-stock-design.md` (phải Approved trước khi code Phase 1+).

**Tech Stack:** `3su-next` (Dexie, Vitest), `3su-cloud` (Worker, Durable Object, D1), feature flag theo shop.

## Global Constraints

- Mục tiêu cứng: **không sai lệch** ledger kho / KH / NCC dưới policy đã chốt ở Phase 0.
- Pending **không** được UI coi như confirmed (in bill chính thức / clear cart / “Đã nhập kho” / “Đã thu”).
- Client **không** gửi canonical: `total`, `profit`, `cost`, `stockAfter`, `debtAfter`, `newCost`. `unitRatio` **không** tin từ client — chỉ `unitName` / unit id → server resolve.
- Không dùng `Math.max(0)` để nuốt trả dư; overpay → **reject cả command** (policy spec).
- Mỗi phase: fail gate → **làm lại phase đó**, không “pass tạm” hoặc `.skip` test.
- Feature flag `authoritativeMoneyStock` (tên cuối chốt ở plan phase) mặc định off cho shop thật cho đến Phase 11.

---

## Cách đánh giá “đã đạt chưa” (áp dụng mọi phase)

### 1. Ba lớp chứng cứ (đủ cả 3)

| Lớp | Ý nghĩa | Ai chạy |
|-----|---------|---------|
| **A. Automated gate** | Suite test gắn phase phải xanh 100%, không `.only` / `.skip` mới để “cho xanh” | `npm test` / file test phase |
| **B. Invariant check** | Script hoặc assert trong test chứng minh luật P0 vẫn giữ trên fixture phase | cùng suite hoặc `tests/invariants/*.test.ts` |
| **C. Manual/scenario note** | 1 checklist ngắn trong PR/commit message: scenario người thật làm được gì sau phase | reviewer / bạn |

Thiếu lớp A → **chưa đạt**. Có A nhưng phá invariant cũ → **chưa đạt**.

### 2. Thẻ điểm phase (Definition of Done)

Một phase **PASS** chỉ khi:

1. **Entry OK** — phase trước đã PASS (hoặc N/A với Phase 0).
2. **Scope đúng** — chỉ deliverable của phase; không lẻn feature phase sau.
3. **Gate tests xanh** — đúng danh sách test đặt tên trong phase (bên dưới).
4. **Regression xanh** — `npm test` + `npm run typecheck` ở package đã đụng (`3su-next` và/hoặc `3su-cloud`).
5. **Không regress invariant** — không test nào của phase trước bị xóa/skip để xanh.
6. **DoD checklist** phase (mục “Done khi”) tick đủ.
7. **Ghi nhận** — commit/PR ghi: `Phase N GATE PASS` + lệnh test đã chạy.

**FAIL** nếu bất kỳ mục nào đỏ → quay lại implement/fix trong **cùng phase**, chạy lại toàn bộ gate phase (không chỉ 1 test).

### 3. Vòng lặp bắt buộc

```text
chọn phase N (duy nhất)
  → viết/ cập nhật gate tests (đỏ trước nếu TDD)
  → implement tối thiểu
  → chạy gate phase N
  → chạy typecheck + full test package liên quan
  → FAIL? sửa trong phase N, lặp
  → PASS? đánh dấu phase N done → mới được mở phase N+1
```

Cấm: làm song song nhiều phase “cho nhanh” nếu gate còn phụ thuộc nhau.

### 4. Phân biệt “code có” vs “đạt”

| Không đủ để PASS | Đủ để PASS |
|------------------|------------|
| Có type/interface | Gate test gọi được API/contract và assert hành vi |
| Demo tay 1 lần | Scenario trong suite lặp lại được |
| “Gần đúng” / skip edge | Edge trong danh sách gate phải cover |
| Comment “sẽ làm offline sau” | Offline chưa thuộc phase thì **không** claim done offline |

---

## Phase roadmap

Mỗi phase dưới đây: **Mục tiêu → Deliverable → Gate tests (tiêu chí đánh giá) → Done khi**.

Chi tiết file/step code: viết plan con khi **bắt đầu** phase đó.

---

### Phase 0 — Chốt invariant + policy (không code production)

**Mục tiêu:** Luật bất biến và quyết định product viết thành spec đã duyệt.

**Deliverable:**
- Spec: `docs/superpowers/specs/2026-08-20-authoritative-money-stock-design.md` (tạo khi bắt đầu phase)
- Bảng invariant + policy: overpay = reject; payment online-only; allowNegativeStock = false; offline lạc quan + Conflict Inbox (owner hủy)

**Gate tests / tiêu chí đánh giá:**
- [ ] Spec có đủ 9 invariant (stock identity, server totals, server cost, customer ledger, supplier ledger, idempotency, sequence, confirmed-only-from-events, pending≠confirmed)
- [ ] Spec ghi rõ: unit resolve server-side; device credential; reconnect ritual; Conflict Inbox; DO vs D1 ownership
- [ ] Spec ghi rõ UI: khi nào được in / clear cart / toast thành công
- [ ] Reviewer (bạn) ký duyệt 1 câu trong spec: `Approved: YYYY-MM-DD`

**Done khi:** Spec approved. **Chưa có** merge behavior mới.

**Cách biết đạt:** Checklist spec đủ mục + chữ Approved của bạn. Không có automated test code ở phase này — gate = review ký.

---

### Phase 1 — Contracts: Command / Result / Event

**Mục tiêu:** Type + schema validate thuần (shared hoặc mirror `3su-next` + `3su-cloud`).

**Deliverable:** `CommandEnvelope`, `CommandResult`, `CanonicalEvent`, `CommandType` union; parse/validate helpers; **chưa** gắn POS.

**Gate tests (ví dụ tên file: `tests/authoritative/contracts.test.ts` + cloud tương đương):**
- [ ] Parse command hợp lệ → OK
- [ ] Thiếu `id` / `shopId` / `type` → reject
- [ ] Payload sale có `total`/`profit`/`cost` canonical → reject (forbidden fields)
- [ ] `CommandResult` status chỉ trong `accepted|rejected|conflict`
- [ ] Event bắt buộc có `seq`, `commandId`, `schemaVersion`

**Done khi:** Mọi gate trên xanh; typecheck xanh; chưa đổi `confirmSale`.

**Cách biết đạt:** Chỉ cần nhìn output test contracts + typecheck. Nếu POS vẫn compile với import mới nhưng behavior cũ — vẫn PASS phase 1.

---

### Phase 2 — Backend: idempotent command processor (in-memory / test harness trước)

**Mục tiêu:** Engine xử lý command **độc lập UI**, có thể test không cần Cloudflare network.

**Deliverable:** Module processor (trong `3su-cloud` hoặc package shared testable): idempotency theo `commandId`, seq tăng, apply sale tối thiểu (stock + sale record), atomic commit giả lập.

**Gate tests:**
- [ ] Cùng `commandId` gửi 10 lần → 1 business effect
- [ ] Seq không lùi
- [ ] Duplicate event apply → no-op
- [ ] Stock=1, hai command bán 1 (khác commandId) → 1 accepted + 1 rejected/conflict, stock=0
- [ ] Client giả price/cost/total → server không dùng (nếu gửi vẫn bị strip/reject)
- [ ] Commit fail (fault inject) → không lộ state “ma”, không bump

**Done khi:** Harness xanh; chưa bắt buộc wire production route (có thể cùng phase hoặc đầu phase 3).

**Cách biết đạt:** Suite harness 100% xanh + có fault-injection case. Không cần browser.

---

### Phase 3 — Backend wire: `POST /commands` + events + bump

**Mục tiêu:** DO shop là cổng duy nhất; D1/SQLite persistence theo spec Phase 0.

**Deliverable:** Route commands/events; WS bump chỉ sau durable commit; authz shop member.

**Gate tests:**
- [ ] API test: command → event readable `GET /events?since=`
- [ ] Commit fail → không bump
- [ ] WS chết sau commit → transaction vẫn persist; reconnect pull đủ
- [ ] User không thuộc shop → 403
- [ ] device giả (khi credential đã có) → reject — nếu credential chưa làm, gate này chuyển Phase 5 và ghi rõ trong DoD phase 3

**Done khi:** `3su-cloud` `npm test` xanh gồm API integration; health route cũ không gãy.

**Cách biết đạt:** Cloud test suite + (tuỳ chọn) `wrangler dev` smoke 1 command tay ghi vào checklist C.

---

### Phase 4 — Client: commandQueue + syncState (chưa cắt confirmSale)

**Mục tiêu:** Dexie tables mới; enqueue/persist/reload; dual-path engine stub.

**Deliverable:** Migration Dexie; `commandQueue`; field `syncState` trên model liên quan (hoặc bảng song song); API client `postCommand` / `pullEvents` chưa thay checkout.

**Gate tests:**
- [ ] Enqueue trùng `commandId` không nhân bản hàng đợi
- [ ] Reload browser (fake-idb reset+reopen pattern repo) vẫn còn command pending
- [ ] `dependsOn`: con không flush trước cha
- [ ] Status transition: pending → sending → accepted|rejected|conflict (mock server)

**Done khi:** Gate trên xanh; POS UX chưa đổi behavior confirmed.

**Cách biết đạt:** Chỉ test Dexie/engine; SalePage vẫn confirm cũ là chấp nhận ở phase này.

---

### Phase 5 — Device credential + Conflict Inbox nền

**Mục tiêu:** Device credential (audit / chống giả deviceId); model conflict `accepted|rejected|conflict`; Inbox data tối thiểu. **Không** triển khai escrow đa máy mặc định.

**Deliverable:** Bootstrap/rotate/revoke credential; lưu conflict mở; quyền hủy = owner only.

**Gate tests:**
- [ ] Member hợp lệ xin credential lần đầu → OK
- [ ] Non-member → reject
- [ ] Command sai device credential → reject
- [ ] Revoke → không dùng tiếp
- [ ] Hết tồn → `conflict` (không âm kho)
- [ ] Overpay → `rejected`
- [ ] Non-owner gọi hủy conflict → reject; owner hủy → OK + audit

**Done khi:** Gate credential + conflict status xanh.

**Cách biết đạt:** API/harness assert status + quyền owner; không yêu cầu allocation quota.

---

### Phase 6 — Bán hàng authoritative (online trước)

**Mục tiêu:** `confirmSale` path mới (flag on): command → pending sale → server → canonical → confirmed.

**Deliverable:** Đổi `sales-core` / coordinator; server tính tiền–kho–nợ; UI badge pending/confirmed; **không** clear cart / in bill chính thức khi pending không đủ quyền.

**Gate tests:**
- [ ] Online happy path → 1 sale confirmed, stock/ledger đúng
- [ ] Giả unitName không tồn tại → rejected
- [ ] Qty NaN/Infinity → rejected
- [ ] Nhiều dòng cùng SKU → trừ đủ
- [ ] Retry sau timeout (server đã commit) → không nhân đôi; client về confirmed qua pull
- [ ] UI policy test: pending/conflict → không clear cart / bill chính thức; confirmed → cho clear/in
- [ ] Owner-only hủy conflict; non-owner bị từ chối
- [ ] Flag off → behavior legacy không gãy (regression)

**Done khi:** Gate sale online + UI policy xanh; void chưa bắt buộc đủ (phase 8) nhưng create ổn.

**Cách biết đạt:** Test domain + (nên có) test coordinator UI policy; flag off regression.

---

### Phase 7 — Offline lạc quan + reconnect ritual + dependsOn

**Mục tiêu:** Mọi device bán/nhập pending offline; reconnect = pull events rồi flush; Conflict Inbox; dependsOn receipt→sale.

**Gate tests:**
- [ ] Offline sale → pending; không trừ canonical như confirmed
- [ ] Reconnect: pull trước flush (test thứ tự)
- [ ] Hai device offline cùng bán hết hàng → sau flush: 1 confirmed, 1 conflict; stock ≥ 0
- [ ] dependsOn receipt rồi sale → server thứ tự đúng
- [ ] Mất response sau commit → pull event tự confirmed, không POST nhân đôi
- [ ] Payment offline bị chặn (không enqueue)

**Done khi:** Gate ritual + dual-device conflict xanh.

**Cách biết đạt:** Multi-context test (2 device state) bắt buộc.

---

### Phase 8 — Void / reversal

**Mục tiêu:** Void = event đảo kho/nợ; không xóa lịch sử; idempotent.

**Gate tests:**
- [ ] Void 2 lần / retry → stock & debt chỉ reverse 1 lần
- [ ] Multi-line cùng SKU restore đủ
- [ ] Concurrent void vs payment policy đúng spec Phase 0

**Done khi:** Gate void xanh + invariant stock/debt sau void.

---

### Phase 9 — Nhập hàng authoritative

**Mục tiêu:** Client chỉ gửi fact; server weighted cost + batch/FEFO hooks theo spec.

**Gate tests:**
- [ ] 10@100 +10@200 +20@300 → cost canonical = 225 (fixture chuẩn)
- [ ] Concurrent GR deterministic
- [ ] Duplicate command → 1 effect
- [ ] unit resolve server; ratio giả → không tin
- [ ] Không NCC + debt payMethod → reject; không orphan payable
- [ ] Snapshot tên SP/NCC trên dòng lịch sử không đổi khi rename master

**Done khi:** Gate GR xanh; sale vẫn regression.

---

### Phase 10 — Customer + supplier payment ledger (online-only)

**Mục tiêu:** Ledger signed; overpay reject; không double-pay; payment online-only.

**Gate tests:**
- [ ] Nợ 100; A thu 80 + B thu 80 concurrent → không thành thu 160 (1 conflict/reject theo policy)
- [ ] Trả vượt nợ → reject cả command (không credit, không đổi balance sai)
- [ ] paymentId/commandId idempotency
- [ ] NaN/Infinity reject
- [ ] Supplier tương tự
- [ ] Offline: không enqueue được customerPayment/supplierPayment

**Done khi:** Ledger invariant tests xanh (balance = sum signed entries).

**Cách biết đạt:** Assert `sum(ledger) === projection`; cấm test chỉ nhìn field `customer.debt` cũ nếu đã chuyển sang projection.

---

### Phase 11 — Reconciliation client + realtime + genesis migration

**Mục tiêu:** `display = canonical ⊕ pending`; genesis opening; flag rollout.

**Gate tests:**
- [ ] Apply event 10 lần = 1 lần
- [ ] Hai client replay cùng stream → cùng projection
- [ ] Reconnect WS → catch-up `since=seq`
- [ ] Genesis retry idempotent; snapshot lệch → block
- [ ] Shop flag on chỉ khi genesis OK

**Done khi:** Migration dry-run trên DB fixture + gate trên xanh.

---

### Phase 12 — Chaos / concurrency / tắt legacy path

**Mục tiêu:** Chứng minh sẵn sàng production; gỡ `sale.commit` / `gr.commit` / `debt.pay` khỏi path authoritative.

**Gate tests:**
- [ ] Harness concurrent (ngưỡng chốt trong plan con: ví dụ N shops × M sales) — 0 lost, 0 dup effect, 0 stock/ledger invariant break
- [ ] Client cũ gửi payload giả → reject
- [ ] Flag on shop: legacy money ops không còn ghi canonical lậu
- [ ] Full `npm test` + `typecheck` + `build` packages liên quan

**Done khi:** Gate chaos xanh + legacy path money/stock removed hoặc dead-code fail test nếu còn gọi.

---

## Bảng tra cứu nhanh: “dựa vào đâu để đánh giá”

| Câu hỏi | Trả lời |
|---------|---------|
| Phase xong chưa? | Gate tests phase đó **100% PASS** + DoD checklist |
| Tin demo tay không? | Chỉ là lớp C bổ sung — **không** thay lớp A |
| Được skip test khó không? | **Không** — skip = FAIL phase |
| Được làm phase sau “song song” không? | Chỉ phần không phụ thuộc; mặc định **không** |
| Regression phase trước gãy? | Phase hiện tại **FAIL** dù feature mới chạy |
| “100% không lệch” chứng minh thế nào? | Invariant tests (stock identity, ledger sum, idempotency, concurrent fixtures) phải nằm trong gate từ Phase 2 trở đi và không được gỡ |

---

## Thứ tự thi công (nhắc lại)

```text
0 Spec/policy
 → 1 Contracts
 → 2 Processor harness
 → 3 API/DO wire
 → 4 Client queue
 → 5 Credential + Conflict Inbox
 → 6 Sale online + UI policy
 → 7 Offline lạc quan + reconnect ritual
 → 8 Void
 → 9 Goods receipt
 → 10 Payments online-only
 → 11 Reconcile + genesis + flag
 → 12 Chaos + remove legacy
```

---

## Handoff

Khi bắt đầu làm: tạo plan con **Phase 0** (spec) trước, duyệt spec, rồi mới Phase 1 task-level.

**Hai cách thi công sau khi có plan con:**

1. **Subagent-Driven** — mỗi task một agent, review giữa các task  
2. **Inline Execution** — làm tuần tự trong session với checkpoint gate  

**Phase nào mở trước:** Phase 0 (viết + duyệt spec). Không viết production code tiền/kho trước khi spec có `Approved`.
