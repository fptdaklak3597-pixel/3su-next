# Kiến trúc hệ thống — 3SU Next (v4.0)

Tài liệu mô tả kiến trúc tổng thể của 3SU Next: cách tổ chức code, luồng dữ liệu,
mô hình local-first, cơ chế đồng bộ và các quyết định thiết kế quan trọng.

---

## 1. Triết lý thiết kế

3SU Next kế thừa hai dự án tiền nhiệm:

- **3su-v2.7.4** — nghiệp vụ bán hàng đầy đủ (POS, kho, công nợ, báo cáo, hóa đơn),
  data model và các thuật toán miền (giá vốn bình quân gia quyền, HSD, dự báo tồn).
- **3su-icoffee** — kiến trúc đa ứng dụng (một codebase build ra web + mobile PWA),
  PWA chuẩn mực (Workbox, offline, install prompt), design system CSS thuần.

Năm nguyên tắc xuyên suốt:

1. **Local-first** — mọi nghiệp vụ ghi vào IndexedDB trước, app chạy hoàn toàn offline;
   đồng bộ lên cloud sau khi có mạng.
2. **Không tin client** — các hàm miền (vd `confirmSale`) tính lại giá từ product trong
   transaction, không dùng tổng do UI truyền lên.
3. **Atomic transaction** — trừ kho, ghi đơn, cập nhật công nợ nằm trong một Dexie
   transaction; không có trạng thái "nửa vời" nếu lỗi giữa chừng.
4. **Bảo mật** — CSP trong HTML, sanitize secret trước khi log, không gửi stack/secret ra ngoài.
5. **Tiếng Việt** — toàn bộ UI, thông báo, tài liệu.

---

## 2. Hai ứng dụng, một codebase

Giống `3su-icoffee`, Vite build ra **hai ứng dụng** từ cùng một nguồn, chỉ khác shell
điều hướng:

| App | Entry | Output | Port dev | Shell | Mô tả |
|-----|-------|--------|----------|-------|-------|
| **web** | `index.html` | `dist/` | 5190 | `WebShell` (sidebar) | Trang quản lý đầy đủ nghiệp vụ |
| **mobile** | `mobile.html` | `dist-mobile/` | 5191 | `MobileShell` (tab bar) | PWA bán hàng tối ưu điện thoại |

Logic nghiệp vụ dùng chung `src/core/`. UI tách theo app: `src/web/pages` (quản lý)
và `src/mobile/pages` (PWA). `src/shared` chỉ chứa màn/form dùng cả hai (auth, toast, PWA).

### Cách chọn app

`vite.config.ts` quyết định app qua `--mode mobile` hoặc biến môi trường `APP=mobile`:

```ts
const appOf = (mode: string): AppName =>
  process.env.APP === 'mobile' || mode === 'mobile' ? 'mobile' : 'web'
```

Mỗi app có cấu hình PWA riêng (tên, shortcuts, orientation, output dir) trong `APP_CONFIG`.

### Plugin `mobileEntry`

`mobile.html` phải được phục vụ tại `/` (gốc) để PWA hoạt động đúng (scope, start_url).
Plugin `mobileEntry` xử lý hai việc:

- **Dev**: middleware rewrite mọi request không có đuôi file (và không phải path nội bộ
  `/@`, `/node_modules`, `/src`, `/icons`) về `/mobile.html`.
- **Build**: `writeBundle` đổi tên `mobile.html` → `index.html` trong `dist-mobile/`.

---

## 3. Phân tầng module

```
┌─────────────────────────────────────────────────────────────┐
│  src/web/            src/mobile/                            │
│  ├─ App.tsx          ├─ App.tsx        (root + routing)     │
│  ├─ main.tsx         ├─ main.tsx       (entry React)        │
│  └─ layout/          ├─ layout/        (shell điều hướng)   │
│     WebShell.tsx     └─ pages/         (12 page components) │
└───────────────────────────┬─────────────────────────────────┘
                            │ dùng chung 100%
┌───────────────────────────┴─────────────────────────────────┐
│  src/shared/         components.tsx (Toast, Sheet, Dialog…) │
│                      pwa.ts (hooks: online, install, SW)    │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────────┐
│  src/core/                                                  │
│  ├─ types.ts         Kiểu dữ liệu trung tâm                 │
│  ├─ db.ts            Dexie schema + backup/restore + meta   │
│  ├─ format.ts        Định dạng số/ngày tiếng Việt + uid     │
│  ├─ store.ts         Zustand app state (session/UI)         │
│  ├─ errorLogger.ts   Ghi lỗi tập trung (sanitize secret)    │
│  ├─ domain/          sales.ts · inventory.ts · reports.ts   │
│  └─ sync/            engine.ts (hàng đợi + retry + delta)   │
└─────────────────────────────────────────────────────────────┘
```

Quy tắc phụ thuộc (chỉ được phép đi xuống):

```
web/mobile  →  shared  →  core
```

- `core` không import bất kỳ thứ gì từ `shared`, `web`, `mobile`.
- `shared` chỉ import từ `core` (và file khác trong `shared`).
- `web`/`mobile` import từ `shared` và `core`, không import chéo nhau
  (ngoại lệ hẹp: `web/App.tsx` dùng `LoginPage` từ `@/mobile/pages`).

### Path alias

Định nghĩa trong `vite.config.ts` và `tsconfig.json`:

| Alias | Trỏ tới |
|-------|---------|
| `@/core` | `src/core` |
| `@/shared` | `src/shared` |
| `@/web` | `src/web` |
| `@/mobile` | `src/mobile` |
| `@` | `src` |

---

## 4. Lớp dữ liệu (local-first)

### 4.1 Dexie schema

Toàn bộ dữ liệu nằm trong IndexedDB, database `3su_next_v4` (xem [db.ts](file:///d:/claude/3su/3su-next/src/core/db.ts)):

| Table | Khoá chính | Index phụ | Nội dung |
|-------|-----------|-----------|----------|
| `products` | `id` | name, cat, barcode, deleted, updatedAt | Sản phẩm, tồn, đơn vị, batch HSD |
| `sales` | `id` | date, voided, customerId, synced, `[date+voided]` | Đơn bán |
| `customers` | `id` | name, phone, deleted | Khách hàng + công nợ |
| `debtPayments` | `id` | customerId, date | Phiếu thu nợ |
| `goodsReceipts` | `id` | code, ts | Phiếu nhập kho |
| `stockMoves` | `id` | productId, type, ts, date | Biến động kho (audit log) |
| `stocktakes` | `id` | ts | Biên bản kiểm kê |
| `invoices` | `id` | code, type, ts | Hóa đơn / GDT |
| `syncQueue` | `id` | type, createdAt | Hàng đợi đồng bộ |
| `meta` | `key` | — | settings, shop, currentUser, trial |

### 4.2 Meta helpers

Cài đặt, thông tin shop, người dùng hiện tại, trial được lưu trong table `meta`
dưới dạng key-value, có default merge để luôn đủ trường:

```ts
getSettings() / saveSettings(s)
getShop() / saveShop(shop)
getCurrentUser() / setCurrentUser(u)
getTrial() / saveTrial(t)
```

### 4.3 Reactive UI

Page components dùng `useLiveQuery` từ `dexie-react-hooks` để tự động render lại khi
dữ liệu thay đổi — không cần quản lý cache hay invalidation thủ công:

```ts
const products = useLiveQuery(
  () => dbx.products.filter((p) => !p.deleted).toArray(),
  [],
  [] as Product[],
)
```

### 4.4 Backup / Restore

- `exportBackup()` — gom toàn bộ table + shop + settings thành một object `BackupData`
  (version 4) để tải xuống dạng JSON.
- `restoreBackup(data)` — xoá sạch và nạp lại trong **một transaction** (đảm bảo atomic).
- `wipeAll()` — xoá toàn bộ database (chỉ chủ shop được phép, kiểm tra ở UI).

---

## 5. Logic miền (domain)

Ba module thuần (pure functions + Dexie transaction), không phụ thuộc React:

### 5.1 `domain/sales.ts`

- `confirmSale(input)` — **hàm quan trọng nhất**. Trong một transaction:
  tính lại giá từng item từ product (không tin tổng UI truyền), trừ kho theo batch
  (FIFO HSD), ghi `Sale`, ghi `StockMove`, cập nhật `totalSpent`/`orderCount`/`debt`
  của khách. Trả về `CheckoutResult`.
- `voidSale(saleId, reason)` — huỷ đơn: hoàn kho, hoàn nợ, đánh dấu `voided`.
- `dayStats(sales, date)`, `weekProfitSeries(sales, days)` — thống kê nhanh cho dashboard.
- `totalDebt(customers)`, `bestSellerIds(sales, limit)`, `cartUnitPrice(item, p, wholesale)`.
- `DENOMINATIONS` — mệnh giá tiền mặt gợi ý khi thanh toán.

### 5.2 `domain/inventory.ts`

- `saveGoodsReceipt(input)` — nhập kho nhiều dòng, tính **giá vốn bình quân gia quyền**:
  `costMoi = (tonCu*giaCu + nhapMoi*giaNhap) / (tonCu + nhapMoi)`. Cập nhật batch HSD.
- `suggestSellPrice(cost, currentPrice)` — gợi ý giá bán theo biên lợi nhuận.
- `saveStocktake(rows, note)` — kiểm kê: điều chỉnh tồn theo số thực tế, ghi `StockMove`
  loại `stocktake`.
- `forecastStock(products, sales, days)` — dự báo ngày hết hàng dựa trên tốc độ bán
  trung bình, trả về `StockForecast[]`.

### 5.3 `domain/reports.ts`

- `resolveRange(f)` — dịch preset (7/30/mtd/ytd/all) hoặc khoảng tuỳ chọn thành `[from, to]`.
- `buildReport(sales, products, f)` — tổng hợp doanh thu, lợi nhuận, số đơn, top sản phẩm,
  top danh mục, phân bổ hình thức thanh toán, so sánh kỳ trước → `ReportResult`.

---

## 6. State quản lý (Zustand)

`store.ts` giữ state phiên/UI (không phải dữ liệu nghiệp vụ — dữ liệu ở IndexedDB):

- `ready`, `settings`, `shop`, `user`, `trial`
- `sync` (SyncState), `online`
- `theme` + `setTheme` (đổi `data-theme` trên `<html>`, ghi `localStorage`)
- `toast` + `showToast(msg, kind)`, `celebrate` (hiệu ứng ăn mừng khi bán thành công)

Dữ liệu nghiệp vụ (products, sales…) **luôn đọc trực tiếp từ Dexie qua `useLiveQuery`**,
không đưa vào store — tránh hai nguồn sự thật.

---

## 7. Đồng bộ (sync engine)

Xem [engine.ts](file:///d:/claude/3su/3su-next/src/core/sync/engine.ts). Port từ
`55-cloud-sync-v2` / `58-cloud-sync-v3` / `59-cloud-sync-router` của 3su-v2.7.4.

### 7.1 Mô hình

```
UI gọi enqueueSync(type, payload)
        │
        ▼
  thêm SyncOp vào syncQueue (IndexedDB)  ← ghi trước, sync sau
        │
        ▼ (nếu online)
  flushQueue():
    - lấy op theo createdAt, lọc attempts < MAX_ATTEMPTS (10)
    - adapter.push(op) → xoá op khỏi queue
    - lỗi → attempts++, lưu lastError; đủ 10 lần → bỏ op chết + logError
    - adapter.pull(lastSync) → kéo thay đổi từ cloud
        │
        ▼
  setState → emit tới listeners (UI cập nhật badge)
```

### 7.2 Đặc tính

- **Retry backoff**: vòng lặp nền `startSyncLoop()` chạy mỗi 30s; sync lại ngay khi có
  sự kiện `online`.
- **Idempotency**: mỗi op có `id` duy nhất (`uid('op')`), server từ chối op trùng.
- **Delta**: `pull(since)` chỉ kéo thay đổi kể từ mốc `lastSyncAt`.
- **Tách biệt error reporting**: sync và ghi lỗi đi hai đường riêng, không dùng chung.
- **Adapter hoá**: backend hiện tại là Firebase Firestore, nhưng có thể thay bằng
  Cloudflare Worker + D1 (như 3su-v2.7.4) chỉ bằng cách đổi `setSyncAdapter(...)`.

### 7.3 Sync health watchdog

`syncHealth` (trong errorLogger) theo dõi `lastPushOk` / `lastPushErr` / `lastPullOk`
để phát hiện sync "chết lặng" (không lỗi nhưng không đẩy được).

---

## 8. PWA

Cấu hình trong `vite.config.ts` qua `vite-plugin-pwa` (Workbox):

- **`registerType: 'prompt'`** — không bao giờ auto-update. Service worker mới chỉ kích
  hoạt khi người dùng bấm "Cập nhật" — tránh thay app giữa lúc đang bán hàng.
- **`injectRegister: null`** — tự đăng ký SW qua hook `useServiceWorkerUpdate`.
- **Workbox**: precache `js/css/html/svg/png/woff2`, `navigateFallback: index.html`,
  `skipWaiting: false`, `clientsClaim: false`, runtime caching cho Google Fonts (CacheFirst).
- **Manifest** mỗi app: `lang: vi`, `display: standalone`,
  `display_override: ['window-controls-overlay', 'standalone', 'minimal-ui']`,
  orientation `portrait` (mobile) / `any` (web), shortcuts tiếng Việt.
- **Icon**: PNG sinh bởi `scripts/gen-icons.mjs` (không cần thư viện ảnh) + `icon.svg`.

### Hooks PWA (`shared/pwa.ts`)

| Hook | Tác dụng |
|------|----------|
| `useOnline()` | trạng thái online/offline |
| `useInstallPrompt()` | bắt `beforeinstallprompt`, `promptInstall()`, nhận biết đã cài |
| `useServiceWorkerUpdate()` | phát hiện SW mới, `applyUpdate()` gửi `SKIP_WAITING` |
| `useDisplayMode()` | `standalone` hay `browser` |

### Theme không nhấp nháy (no-flash)

`index.html` / `mobile.html` có script đọc `localStorage('3su_theme')` **đồng bộ trước
khi paint**, set `data-theme` lên `<html>` và đổi `meta theme-color` — tránh chớp sáng/tối
khi khởi động.

---

## 9. Bảo mật

- **CSP** trong HTML: `base-uri 'self'; form-action 'self'; object-src 'none';`.
- **Sanitize secret** (`errorLogger.sanitize`): strip API key (`sk-ant-*`, `AIza*`),
  password/token/apiKey, `Authorization: Bearer`, firebaseConfig trước khi log.
- **Không gửi stack/secret ra ngoài** — lỗi chỉ lưu buffer nội bộ + localStorage (50 lỗi
  gần nhất), phục vụ debug tại máy.
- **Không tin client** — `confirmSale` tính lại giá trong transaction.
- **Origin validation** — kế thừa mẫu bảo mật bridge từ 3su-v2.7.4 khi tích hợp cloud.

---

## 10. Luồng nghiệp vụ tiêu biểu

### Bán hàng (POS)

```
SalePage (chọn SP, đơn vị, giá sỉ/lẻ)
   → CheckoutPage (giảm giá, khách, phương thức, tiền đưa)
   → confirmSale() [transaction: tính giá, trừ kho FIFO-HSD, ghi đơn, cập nhật nợ]
   → enqueueSync('push_sale', sale)
   → showToast + celebrate (nếu bật)
   → (tuỳ chọn) in hóa đơn theo PrinterSettings
```

### Nhập kho

```
GoodsReceiptPage (chọn SP, số lượng, giá nhập, HSD)
   → saveGoodsReceipt() [giá vốn bình quân gia quyền, cộng tồn, thêm batch]
   → enqueueSync('push_gr', gr)
```

### Kiểm kê

```
StocktakePage (nhập số thực tế từng SP)
   → saveStocktake() [điều chỉnh tồn, ghi StockMove 'stocktake']
   → enqueueSync('push_settings', { stocktake })
```

---

## 11. Design system

`src/index.css` định nghĩa design system bằng CSS thuần + biến màu:

- **Bảng màu warm-paper**: `--paper #FAF7F2`, `--ink #1C1917`, `--gold #B8935A`,
  `--up #4A7C59`, `--down #9E4A3E`, `--dark #1A1816`, `--mute #78716C`,
  `--mute-2 #A8A29E`, `--hair #D6D3D1`.
- **Dark theme** qua `[data-theme="dark"]`.
- **Typography**: heading Georgia serif (`.font-brand`) + body system sans.
- **Component class**: `.card`, `.btn-cta`, `.btn-back`, `.app-hdr`, `.field-input`,
  `.stock-badge`, `.tab-bar`, `.web-sidebar`, `.side-item`…
- TailwindCSS bổ trợ utility, nhưng màu sắc nhất quán qua CSS variables để đổi theme
  một chỗ.
