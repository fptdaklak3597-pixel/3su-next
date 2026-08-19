# Hướng dẫn triển khai — 3SU Next (v4.0)

Tài liệu hướng dẫn build và triển khai hai ứng dụng (web + mobile PWA) lên hosting.

---

## 1. Yêu cầu môi trường

| Công cụ | Phiên bản | Ghi chú |
|---------|-----------|---------|
| **Node.js** | ≥ 20 (khuyến nghị 22 LTS) | Cần cho build + script sinh icon |
| **npm** | ≥ 10 | đi kèm Node |

> Script `scripts/gen-icons.mjs` chạy bằng Node thuần (chỉ dùng `zlib`, `fs` có sẵn),
> **không cần** thư viện xử lý ảnh như `sharp` hay `canvas`.

Cài dependencies:

```bash
npm install
```

---

## 2. Build

### 2.1 Sinh icon PWA

Bộ icon PNG (192, 512, maskable, apple-touch 180) được sinh tự động:

```bash
npm run icons
```

Lệnh này **tự chạy** trước mỗi lần `build` / `build:mobile` (đã cấu hình trong
`package.json`), nên bình thường không cần gọi riêng.

Icon vẽ bằng hàm khoảng cách + mã hoá PNG qua `zlib`, có 4x4 supersampling cho mép
mịn. Nguồn thiết kế: `public/icons/icon.svg` (biểu tượng cửa hàng, nền ink, mái hiên
vàng gold).

### 2.2 Build từng app

```bash
# Bản web (trang quản lý) → dist/
npm run build

# Bản mobile PWA (bán hàng) → dist-mobile/
npm run build:mobile

# Cả hai
npm run build:all
```

Chuỗi build: `gen-icons.mjs` → `tsc -b` (kiểm tra type strict) → `vite build`.
Nếu TypeScript báo lỗi, build dừng lại — sửa lỗi trước khi triển khai.

### 2.3 Xem thử bản build

```bash
npm run preview          # web   → http://localhost:5290
npm run preview:mobile   # mobile → http://localhost:5291
```

> **Lưu ý PWA**: service worker chỉ đăng ký qua HTTPS hoặc `localhost`. Khi preview
> trên `localhost` PWA hoạt động bình thường.

---

## 3. Triển khai tĩnh (static hosting)

Cả hai app đều là **SPA tĩnh** (HTML + JS + CSS + asset), không cần server runtime.
Triển khai bằng cách đẩy thư mục output lên bất kỳ static host nào.

### 3.1 Netlify (khuyến nghị — giống 3su-icoffee)

Hai app = hai site Netlify riêng (hoặc hai đường dẫn). Ví dụ cấu hình:

**Site web** (trang quản lý):
- Build command: `npm run build`
- Publish directory: `dist`

**Site mobile** (PWA bán hàng):
- Build command: `npm run build:mobile`
- Publish directory: `dist-mobile`

**SPA redirect** — bắt buộc để React Router hoạt động khi vào sâu (vd `/ban-hang`):

Tạo file `_redirects` trong `public/` (sao chép vào output khi build):

```
/*    /index.html    200
```

Hoặc dùng `netlify.toml`:

```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### 3.2 Firebase Hosting

```bash
firebase init hosting
# Public directory: dist  (hoặc dist-mobile)
# Single-page app: Yes
# Overwrite index.html: No
firebase deploy --only hosting
```

Firebase Hosting tự thêm `**/index.html` rewrite khi chọn "Single-page app: Yes".

### 3.3 Cloudflare Pages / Vercel / S3 + CloudFront

Nguyên tắc chung:

1. Trỏ output dir (`dist` hoặc `dist-mobile`).
2. Bật **SPA fallback**: mọi route không khớp file tĩnh → trả về `index.html`.
3. Đặt cache dài cho asset có hash (`/assets/*`), `no-cache` cho `index.html` và
   `manifest.webmanifest` (để nhận bản cập nhật PWA).

---

## 4. HTTPS — bắt buộc cho PWA

PWA (service worker, install prompt, IndexedDB ổn định) yêu cầu **HTTPS** (hoặc
`localhost` khi dev). Đảm bảo host có chứng chỉ TLS hợp lệ.

- Netlify / Vercel / Cloudflare Pages / Firebase Hosting: tự cấp HTTPS.
- Self-host: dùng reverse proxy (Caddy / nginx) + Let's Encrypt.

---

## 5. Cài PWA lên thiết bị

### Android (Chrome)

1. Mở site mobile qua HTTPS.
2. Chạm menu ⋮ → **"Cài đặt ứng dụng"** / **"Thêm vào màn hình chính"**.
3. Hoặc app tự hiện banner cài (hook `useInstallPrompt` bắt `beforeinstallprompt`).

### iOS (Safari)

1. Mở site mobile trong **Safari** (bắt buộc — Chrome/Firefox iOS không hỗ trợ PWA đầy đủ).
2. Chạm nút **Chia sẻ** → **"Thêm vào MH chính"** (Add to Home Screen).
3. Icon lấy từ `apple-touch-icon` (`/icons/icon-180.png`).

> Trên iOS, `apple-mobile-web-app-capable` và `apple-touch-icon` đã khai báo sẵn trong
> `mobile.html`.

---

## 6. Biến môi trường

Các giá trị build-time được inject qua `define` trong `vite.config.ts`:

| Biến | Nguồn | Mặc định |
|------|-------|----------|
| `__APP_NAME__` | mode (`web`/`mobile`) | — |
| `__APP_VERSION__` | `npm_package_version` | `4.0.0` |

Tuỳ chọn runtime (qua `process.env` khi dev/build):

| Biến | Tác dụng |
|------|----------|
| `APP=mobile` | ép build mobile (thay cho `--mode mobile`) |
| `PORT` | ghi đè port dev/preview |

Khi tích hợp backend đồng bộ (Firebase / Cloudflare D1), thêm cấu hình vào adapter
trong `src/core/sync/` — **không** hard-code secret vào source; dùng biến môi trường
của host và rule bảo mật ở phía server.

---

## 7. Kiểm tra sau triển khai (checklist)

- [ ] Vào `/` hiện splash rồi vào dashboard, không lỗi console.
- [ ] Vào thẳng `/ban-hang` (deep link) không bị 404 (SPA fallback hoạt động).
- [ ] DevTools → Application → Manifest: tên, icon, `display: standalone` đúng.
- [ ] Application → Service Workers: SW đã đăng ký, status `activated`.
- [ ] Tắt mạng → app vẫn mở được, bán hàng offline bình thường (local-first).
- [ ] Bật mạng lại → badge đồng bộ chạy, hàng đợi push hết.
- [ ] Lighthouse PWA: installable, performance ≥ 90.
- [ ] Theme tối/sáng không nhấp nháy khi tải lại.
- [ ] Icon cài lên màn hình chính đúng (cả Android lẫn iOS).

---

## 8. Rollback

Vì build ra thư mục tĩnh, rollback = trỏ host về bản build trước:

- **Netlify**: Deploys → chọn bản cũ → **Publish deploy**.
- **Firebase**: `firebase hosting:rollback` (hoặc chọn release trong console).
- **Tự host**: giữ lại các thư mục `dist-<version>`, đổi symlink.

> PWA dùng `registerType: 'prompt'` nên người dùng đang mở app **không** bị đổi phiên
> bản đột ngột — họ bấm "Cập nhật" khi sẵn sàng. Sau rollback, SW cũ tiếp tục phục vụ
> cache cũ cho tới khi người dùng tải bản mới.
