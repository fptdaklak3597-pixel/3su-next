# 3SU Next — P2 bố cục POS

**Ngày:** 2026-08-20  
**Phạm vi:** `SalePage.tsx` (web), `WebShell.tsx`, `theme.css`, test hợp đồng. Không đụng domain/sync/db/auth, không rem, không đổi màu/IA báo cáo.  
**Nguồn:** review cỡ chữ/bố cục; user: làm tiếp P2.

## Mục tiêu

Tablet/desktop rộng: catalog chạm như Square (ô). Tìm nhiều SKU: vẫn hàng list. Màn hẹp: catalog không bị giỏ cắt 46vh. Topbar đỡ nhồi.

## Không làm

- Migration rem / zoom.
- Đổi mobile SalePage sang ô (PWA khác mật độ).
- Đổi IA menu (nhãn Hàng hóa / Giao dịch giữ).
- Commit trừ khi được hỏi.

## Hướng đã chọn

**A — CSS + class, ít JS.**  
`is-tiles` khi ô tìm trống, `is-list` khi có query. Lưới từ 1100px. 2 cột POS tới 720px. Dưới 720px giỏ `is-open` dạng sheet, mặc định chỉ hiện tổng + CTA. Topbar 52px; in/cài đặt/avatar vào `.web-user-menu`; dưới 900px nav giữa vào `.web-burger`.

Bỏ: B (luôn ô, tìm cũng ô — khó quét 80 dòng). C (chỉ đổi CSS 46vh, vẫn list — không đạt glance POS).

## Catalog

- `.web-plist.is-tiles` từ `min-width: 1100px`: `grid`, `repeat(auto-fill, minmax(168px, 1fr))`.
- Ô `.web-pc` cột, `min-height: 88px`.
- Có `query.trim()`: class `is-list`, hàng ngang như cũ (mọi bề rộng).
- Dưới 1100px không tìm: vẫn list (chuột / máy hẹp).
- Bỏ inline `display:flex` trên `.web-pc` để CSS thắng.

## Giỏ hẹp

- Xóa `max-height: 46vh`.
- `@media (max-width: 899px)` không còn xếp chồng.
- `@media (max-width: 719px)`: 1 cột, `.web-pos-r` dính đáy. Không `.is-open`: ẩn dòng giỏ. Có nút `Giỏ · N · tiền` bật `.is-open` (sheet, max 70vh).

## Topbar

- `.web-topbar` cao 52px.
- Xóa `web-ico` Máy in / Cài đặt trên thanh.
- Menu user (avatar): Tài khoản, Máy in, Cài đặt (theo perm).
- Dưới 900px: `.web-nav-mid` ẩn, `.web-burger` mở cùng các mục.

## Kiểm thử

`tests/pos-layout.test.ts` đọc CSS + nguồn TSX: token lưới, không 46vh, topbar 52, class `is-tiles` / `web-user-menu` / `web-burger`. Rồi `npm test`.
