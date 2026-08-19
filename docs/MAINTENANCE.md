# Bảo trì & gỡ lỗi — 3SU Next (v4.0)

Tài liệu hướng dẫn vận hành hằng ngày, chẩn đoán sự cố và quy trình phát triển an toàn.

---

## 1. Công cụ phát triển

```bash
npm run dev            # web   → http://localhost:5190
npm run dev:mobile     # mobile → http://localhost:5191
npm run typecheck      # TypeScript strict, không emit
npm run test           # Vitest (chạy 1 lần)
npm run test:watch     # Vitest (watch)
npm run lint           # ESLint src/
```

Quy tắc trước khi commit:

1. `npm run typecheck` sạch.
2. `npm run test` xanh.
3. Build được cả hai app: `npm run build:all`.

---

## 2. Ghi lỗi tập trung (errorLogger)

Xem [errorLogger.ts](file:///d:/claude/3su/3su-next/src/core/errorLogger.ts).

### 2.1 Cách dùng

Mọi khối `catch` trong nghiệp vụ gọi:

```ts
import { logError } from '@/core/errorLogger'
try {
  await saveGoodsReceipt(input)
} catch (e) {
  logError(e, 'gr.save')      // tag ngắn gọn để lọc
  showToast('Lỗi khi lưu', 'bad')
}
```

`installGlobalErrorHandlers()` (gọi một lần ở `main.tsx`) tự bắt:

- `window.error` — lỗi runtime không bắt.
- `unhandledrejection` — Promise reject không xử lý.

### 2.2 Đặc tính

- **Sanitize secret**: tự strip API key, password, token, Bearer, firebaseConfig
  trước khi lưu — không bao giờ ghi secret vào log.
- **Gom lỗi trùng**: lỗi cùng `tag|msg` chỉ tăng bộ đếm `n`, không nhân bản bản ghi.
- **Buffer giới hạn**: tối đa 200 bản ghi trong bộ nhớ; persist **50 lỗi gần nhất**
  vào `localStorage` khoá `3su_errLog`.
- **Không tự crash**: logger bọc trong try/catch — logger hỏng không làm sập app.

### 2.3 Đọc log trên máy người dùng

Mở DevTools → Console:

```js
JSON.parse(localStorage.getItem('3su_errLog'))
```

Hoặc trong code: `getErrorLog()` (mảng `ErrorRecord`), `clearErrorLog()` để xoá.

Mỗi bản ghi:

```ts
{ t: 'ISO time', tag: 'gr.save', msg: '...', stack: '...', n: 3 }
```

---

## 3. Chẩn đoán dữ liệu (IndexedDB)

### 3.1 Xem dữ liệu thủ công

DevTools → **Application** → **IndexedDB** → `3su_next_v4`. Các table:
`products`, `sales`, `customers`, `debtPayments`, `goodsReceipts`, `stockMoves`,
`stocktakes`, `invoices`, `syncQueue`, `meta`.

### 3.2 Kiểm tra nhanh trong Console

```js
// Mở DB (Dexie đã expose qua module, nhưng có thể tra trực tiếp)
const req = indexedDB.open('3su_next_v4')
req.onsuccess = () => {
  const db = req.result
  const tx = db.transaction('sales', 'readonly')
  tx.objectStore('sales').getAll().onsuccess = (e) =>
    console.log('Tổng đơn:', e.target.result.length)
}
```

### 3.3 Hàng đợi đồng bộ bị kẹt

Nếu badge sync báo còn op chờ mãi không hết:

```js
// Xem hàng đợi
indexedDB.open('3su_next_v4').onsuccess = (e) => {
  const tx = e.target.result.transaction('syncQueue', 'readonly')
  tx.objectStore('syncQueue').getAll().onsuccess = (ev) =>
    console.table(ev.target.result.map(o => ({
      type: o.type, attempts: o.attempts, lastError: o.lastError,
    })))
}
```

- `attempts` tiến gần 10 → op sắp bị bỏ (chết). Kiểm tra `lastError` để biết nguyên nhân
  (mạng, quyền, payload sai).
- Op chết bị xoá khỏi queue và ghi `logError(..., 'sync.deadOp')` — tra trong `3su_errLog`.

---

## 4. Gỡ lỗi PWA / Service Worker

### 4.1 SW không đăng ký

- Chỉ hoạt động qua **HTTPS** hoặc `localhost`.
- DevTools → Application → Service Workers: xem trạng thái.
- `vite.config.ts` đặt `devOptions.enabled: false` — khi dev thường **không** có SW
  (cố ý, để HMR không bị cache). Muốn test PWA khi dev: build rồi `npm run preview`.

### 4.2 App không cập nhật bản mới

Thiết kế `registerType: 'prompt'` — SW mới **chờ** người dùng bấm "Cập nhật"
(`UpdateBanner`). Đây là hành vi đúng, không phải lỗi (tránh đổi app giữa lúc bán hàng).

Để ép cập nhật khi test:

```js
// DevTools → Application → Service Workers → "Update" / "Unregister"
// Hoặc console:
navigator.serviceWorker.ready.then(r => r.update())
```

### 4.3 Cache cũ sau rollback

Workbox `cleanupOutdatedCaches: true` tự dọn cache hết hạn. Cache id tách theo app:
`3su-next-web` / `3su-next-mobile`. Xoá thủ công: Application → Storage →
**Clear site data**.

### 4.4 Install prompt không hiện

Điều kiện Chrome: HTTPS + manifest hợp lệ + SW + người dùng chưa cài + có tương tác.
Hook `useInstallPrompt` trả về `canInstall` — nếu `false`, kiểm tra:

- Manifest đủ icon 192 + 512 (chạy `npm run icons`).
- `start_url` và `scope` khớp.
- Lighthouse → PWA để biết tiêu chí còn thiếu.

---

## 5. Sự cố thường gặp

| Triệu chứng | Nguyên nhân có thể | Hướng xử lý |
|-------------|--------------------|-------------|
| Vào `/ban-hang` bị 404 | Thiếu SPA redirect | Thêm `_redirects` / rewrite `/* → /index.html` (xem DEPLOYMENT) |
| Màn hình trắng sau deploy | `base` path sai hoặc asset 404 | Kiểm tra Network; đảm bảo asset có hash được phục vụ |
| Theme nhấp nháy khi tải | Script no-flash không chạy | Đảm bảo script trong `<head>` chạy đồng bộ trước paint |
| Số liệu báo cáo sai lệch | Lọc chưa loại đơn `voided` | `buildReport` đã loại đơn huỷ; kiểm tra dữ liệu đầu vào |
| Tồn kho lệch sau kiểm kê | Chưa lưu stocktake | `saveStocktake` chỉ điều chỉnh dòng có chênh lệch |
| Giá vốn không đổi sau nhập | Chưa gọi `saveGoodsReceipt` | Giá vốn tính bình quân gia quyền trong hàm này |
| Sync không chạy | Chưa set adapter / offline | `setSyncAdapter(...)` ở boot; kiểm tra `navigator.onLine` |
| Icon cài màn hình sai | Thiếu PNG | Chạy `npm run icons` rồi build lại |

---

## 6. Sao lưu & khôi phục

### 6.1 Từ UI

Settings (Cài đặt) → **Sao lưu / Khôi phục**:

- **Xuất**: `exportBackup()` → tải file JSON (chứa toàn bộ sản phẩm, đơn, khách,
  phiếu nhập, kiểm kê, shop, settings).
- **Nhập**: chọn file JSON → `restoreBackup(data)` (xoá sạch + nạp lại trong một
  transaction). **Cảnh báo người dùng**: thao tác ghi đè toàn bộ dữ liệu hiện tại.

### 6.2 Khôi phục khẩn cấp từ console

```js
const data = JSON.parse(/* dán nội dung file backup */)
// gọi qua module đã bundle, hoặc dùng Dexie trực tiếp để bulkPut từng table
```

Ưu tiên dùng UI để đảm bảo transaction atomic và merge settings default.

### 6.3 Xoá toàn bộ (wipe)

`wipeAll()` xoá database và mở lại. Chỉ dành cho chủ shop khi muốn bắt đầu lại —
UI phải xác nhận nhiều bước trước khi gọi.

---

## 7. Nâng cấp schema IndexedDB

Khi thêm table hoặc index mới:

1. Tăng version trong [db.ts](file:///d:/claude/3su/3su-next/src/core/db.ts):

```ts
this.version(2).stores({
  // khai báo đầy đủ table (kể cả table cũ không đổi)
  products: 'id, name, cat, barcode, deleted, updatedAt',
  // ... table mới
})
```

2. Nếu cần di chuyển dữ liệu, dùng `.upgrade()` của Dexie.
3. Test trên DB cũ (mở app phiên bản trước rồi nâng cấp) để chắc chắn migration chạy.

> Giữ tên database `3su_next_v4` ổn định; chỉ tăng version bên trong. Đổi tên DB =
> mất dữ liệu người dùng.

---

## 8. Quy trình thêm tính năng mới

1. **Kiểu dữ liệu**: thêm interface vào `src/core/types.ts` (nếu cần).
2. **Schema**: thêm table/index vào `db.ts` + tăng version (mục 7).
3. **Logic miền**: viết pure function trong `src/core/domain/`, bọc transaction,
   không tin dữ liệu UI truyền lên.
4. **Sync**: sau khi ghi DB, `enqueueSync('push_x', payload)`; thêm type vào `SyncOp`.
5. **UI**: tạo page trong `src/mobile/pages/` → tự dùng được cho cả web.
6. **Route**: khai báo trong **cả** `src/mobile/App.tsx` và `src/web/App.tsx`.
7. **Điều hướng**: thêm nút/menu ở `MobileShell` (tab) và `WebShell` (sidebar) nếu là
   mục chính.
8. **Test**: thêm test Vitest cho logic miền; chạy `typecheck` + `test`.
9. **Tiếng Việt**: toàn bộ nhãn, thông báo, toast.

---

## 9. Test

```bash
npm run test
```

- Vitest + `fake-indexeddb` (devDependency) để test logic Dexie mà không cần trình duyệt.
- Ưu tiên test các hàm miền quan trọng: `confirmSale`, `voidSale`, `saveGoodsReceipt`
  (giá vốn bình quân), `saveStocktake`, `buildReport`.
- Test cả đường lỗi: hết hàng, huỷ đơn hoàn nợ, op sync chết sau 10 lần.

---

## 10. Checklist bảo trì định kỳ

- [ ] Xem `3su_errLog` trên thiết bị mẫu — có lỗi lặp lại (`n` cao) không?
- [ ] Kiểm tra `syncHealth` — `lastPushErr` có mới hơn `lastPushOk` liên tục không?
- [ ] Lighthouse định kỳ (performance, PWA, accessibility).
- [ ] Rà soát dependency lỗi thời / lỗ hổng: `npm audit`.
- [ ] Sao lưu dữ liệu thực tế trước mỗi lần deploy lớn.
- [ ] Kiểm tra PWA trên cả Android (Chrome) và iOS (Safari) sau release.
