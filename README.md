# 3SU Next (v4.0)

**Phần mềm bán hàng cho người bán nhỏ Việt Nam** — bản nâng cấp toàn diện của `3su-v2.7.4`, xây dựng lại từ đầu trên nền tảng hiện đại, kế thừa kiến trúc đa ứng dụng của `3su-icoffee`.

Hoàn toàn bằng **tiếng Việt** · **Local-first** · **Web + PWA** (Android / iOS)

---

## Tổng quan

3SU Next là ứng dụng quản lý bán hàng cho các cửa hàng nhỏ (tạp hóa, quán nước, đại lý):

- **Bán hàng (POS)** — tìm sản phẩm, thêm giỏ, chọn đơn vị (gói/lốc/thùng), giá sỉ/lẻ, thanh toán tiền mặt / chuyển khoản / ghi nợ.
- **Kho hàng** — sản phẩm, tồn kho, hạn sử dụng (HSD), nhập kho (giá vốn bình quân gia quyền), kiểm kê, dự báo hết hàng.
- **Đơn hàng** — lịch sử, chi tiết, hủy đơn (hoàn kho / hoàn nợ).
- **Khách hàng & công nợ** — theo dõi nợ, thu nợ, lịch sử chi tiêu.
- **Báo cáo** — doanh thu / lợi nhuận theo kỳ, so sánh kỳ trước, sản phẩm bán chạy, danh mục, hình thức thanh toán.
- **Cài đặt** — thông tin shop, vận hành, giao diện (sáng/tối/hệ thống), QR chuyển khoản, máy in, sao lưu / khôi phục.

## Hai ứng dụng, một codebase

Giống mô hình `3su-icoffee`, dự án build ra **ba ứng dụng** từ cùng một nguồn:

| App | Entry | Output | Mô tả |
|-----|-------|--------|-------|
| **web** | `index.html` | `dist/` | Trang quản lý — sidebar desktop, đầy đủ nghiệp vụ |
| **mobile** | `mobile.html` | `dist-mobile/` | PWA bán hàng — tối ưu điện thoại, tab bar, cài lên màn hình chính |
| **admin** | `admin.html` | `dist-admin/` | Quản lý shop (gia hạn, khoá) — `npm run dev:admin` |

Cả hai dùng chung **100% page components** (`src/mobile/pages/`) và toàn bộ logic nghiệp vụ (`src/core/`). Chỉ khác **shell điều hướng** (sidebar vs tab bar). Điều này đảm bảo tính năng luôn đồng nhất và không phân nhánh logic.

## Công nghệ

- **Vite 6** + **React 18** + **TypeScript 5.7** (strict)
- **TailwindCSS 3.4** + design system CSS thuần (biến màu warm-paper)
- **Zustand 5** — state UI/session
- **Dexie 4** (IndexedDB) — lưu trữ local-first, reactive qua `dexie-react-hooks`
- **React Router 7** — điều hướng
- **Recharts** — biểu đồ báo cáo
- **vite-plugin-pwa** (Workbox) — service worker, offline, install prompt
- **lucide-react** — icon

## Bắt đầu

```bash
# Cài dependencies
npm install

# Chạy bản web (port 5190)
npm run dev

# Chạy bản mobile PWA (port 5191)
npm run dev:mobile

# Admin quản lý shop (port 5192)
npm run dev:admin
```

## Build

```bash
# Build bản web → dist/
npm run build

# Build bản mobile PWA → dist-mobile/
npm run build:mobile

# Build admin → dist-admin/
npm run build:admin

# Build cả hai
npm run build:all

# Xem thử bản build
npm run preview          # web
npm run preview:mobile   # mobile
```

> **Lưu ý:** lệnh `build` tự chạy `node scripts/gen-icons.mjs` để sinh bộ icon PWA (PNG) trước khi build. Icon được vẽ bằng hàm khoảng cách + mã hoá PNG qua zlib — **không cần thư viện ảnh**.

## Kiểm tra

```bash
npm run typecheck   # TypeScript strict, không emit
npm run test        # Vitest
```

## Cấu trúc thư mục

```
3su-next/
├── index.html              # Entry web (quản lý)
├── mobile.html             # Entry mobile (PWA bán hàng)
├── vite.config.ts          # Cấu hình đa ứng dụng + PWA
├── public/icons/           # Icon PWA (icon.svg + PNG sinh bởi script)
├── scripts/
│   └── gen-icons.mjs       # Sinh icon PNG không dùng thư viện ảnh
├── src/
│   ├── core/               # Logic nghiệp vụ + data (dùng chung)
│   │   ├── types.ts        # Kiểu dữ liệu trung tâm
│   │   ├── db.ts           # Dexie schema + backup/restore
│   │   ├── format.ts       # Định dạng số/ngày tiếng Việt
│   │   ├── store.ts        # Zustand app state
│   │   ├── errorLogger.ts  # Ghi lỗi tập trung (sanitize secret)
│   │   ├── domain/         # sales, inventory, reports
│   │   └── sync/           # sync engine (local-first → cloud)
│   ├── shared/             # components + PWA hooks (dùng chung)
│   ├── mobile/             # App mobile: shell tab-bar + pages
│   │   ├── App.tsx
│   │   ├── layout/MobileShell.tsx
│   │   └── pages/          # 12 page components (dùng chung cho web)
│   ├── web/                # App web: shell sidebar
│   │   ├── App.tsx
│   │   └── layout/WebShell.tsx
│   └── index.css           # Design system (biến màu, components)
└── docs/                   # ARCHITECTURE, DEPLOYMENT, MAINTENANCE
```

## Đồng bộ (op-log v2)

Kiến trúc đồng bộ thế hệ mới dùng **op-log + HLC (Hybrid Logical Clock)**:

- Mọi mutation nghiệp vụ ghi **op** vào `syncQueue` + `appliedOps` trong cùng Dexie transaction với dữ liệu (outbox pattern — không bao giờ có dữ liệu mà thiếu op).
- **Reducer idempotent** (`applyOps`) áp op từ máy khác: tồn kho/công nợ qua delta, hồ sơ qua LWW (so HLC), chứng từ immutable append; chống áp trùng qua `appliedOps`.
- **Snapshot** = toàn bộ state + danh sách op chờ, dùng để backup (mode SOLO) hoặc nền cho máy mới join.
- `SyncTransport` là giao diện trừu tượng — Plan 3 sẽ cắm server `3su-cloud` (Cloudflare Worker + D1), hiện tại chạy offline thuần với `nullTransport`.

Spec chi tiết: [3su-cloud-sync-design](docs/superpowers/specs/2026-08-14-3su-cloud-sync-design.md)

## Tài liệu

- [Kiến trúc hệ thống](docs/ARCHITECTURE.md)
- [Hướng dẫn triển khai](docs/DEPLOYMENT.md)
- [Bảo trì & gỡ lỗi](docs/MAINTENANCE.md)

## Nguyên tắc thiết kế

1. **Local-first** — mọi nghiệp vụ ghi vào IndexedDB trước, hoạt động hoàn toàn offline; đồng bộ lên cloud sau khi có mạng (hàng đợi + retry + idempotency).
2. **Không tin client** — `confirmSale` tính lại giá từ product trong transaction, không dùng tổng do UI truyền lên.
3. **Atomic transaction** — trừ kho, ghi đơn, cập nhật công nợ trong một Dexie transaction.
4. **Bảo mật** — CSP trong HTML, sanitize secret trước khi log, không gửi stack/secret ra ngoài.
5. **Tiếng Việt** — toàn bộ UI, thông báo, tài liệu.
