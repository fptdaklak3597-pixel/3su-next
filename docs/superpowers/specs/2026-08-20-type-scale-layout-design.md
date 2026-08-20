# 3SU Next — Thang chữ và vùng chạm POS

**Ngày:** 2026-08-20  
**Phạm vi:** `3su-next/src/index.css`, `3su-next/src/web/theme.css`, test hợp đồng CSS. Không đụng domain/sync/db/auth, không đụng icoffee / v2.7.4 / admin.css / in nhiệt.  
**Nguồn:** đánh giá đối chiếu Square / Toast / Shopify POS / KiotViet / HIG / M3 / WCAG 2.2. User: lên kế hoạch và sửa.

## Mục tiêu

Quầy nhìn và chạm được như POS toàn cầu. Văn phòng vẫn mật độ KiotViet. Một thang 8 cỡ, không nửa pixel, không chữ dưới 11px.

## Không làm

- Migration rem / bỏ `zoom: 1.125`.
- Đổi IA, màu, copy, in nhiệt (`print.ts` 8–12px giữ).
- Commit trừ khi được hỏi.

P2 (ô POS, giỏ sheet, topbar) nằm ở `2026-08-20-pos-p2-layout-design.md`.

## Hướng đã chọn

**A — Token CSS + thay cỡ tại chỗ.** Thêm `--fs-*` / `--hit-*` trên `:root` (mobile) và `html[data-shell="web"]`. Thay số cứng ở rule POS và sàn chữ. Giữ body web 14px.

Bỏ: B (rem toàn app — rủi ro zoom/layout), C (chỉ vài rule POS — vẫn còn caret 9px và tab 10px).

## Thang

| Token | Mobile | Web | Dùng |
|---|---|---|---|
| `--fs-caption` | 12px | 11px | Sàn. Nav caret, chart, badge nhỏ. |
| `--fs-label` | 13px | 12px | Meta, chip, filter. Gom 11.5 / 12.5. |
| `--fs-body` | 16px | 13px | Bảng, phụ đề. Gom 13.5 → 13. |
| `--fs-plus` | 16px | 14px | Body web, tên món. |
| `--fs-title` | 20px | 22px | Tiêu đề trang (web giữ 22). |
| `--fs-price` | 17px | 17px | Giá ô POS (`.web-pc .p`). |
| `--fs-qr` | 20px | 20px | Số tiền QR. |
| `--fs-total` | 24px | 24px | Phải thu (`.web-ln.big`). |
| `--fs-display` | 28px | 26px | KPI. |
| `--hit-qty` | 36px | 36px | Nút +/- giỏ. |
| `--hit-pay` | 44px | 44px | Phương thức TT. |
| `--hit-cta` | 56px | 48px | Nút thanh toán web. Mobile CTA đã 56. |

## P0

`.web-ln.big` 24px. `.web-pos-qr-amt` 20px. `.web-qty button` 36×36. `.web-pay button` min-height 44, chữ 14. `.web-cta` 48×16. `.web-pc .p` 17px. `.web-tender` cao 36.

## P1

Cấm `font-size` < 11px trong hai file UI. Cấm nửa pixel (9.5 / 10.5 / 11.5 / 12.5 / 13.5). Tab mobile và section-label 12px. `.field-input` 16px (thắng `text-sm` trên input). Caret `.web-m .c` 11px.

## Kiểm thử

`tests/type-scale.test.ts` đọc CSS: token có mặt, sàn 11px, không nửa pixel, hit POS. Rồi `npm test` trong `3su-next`.

## Ràng buộc

- Identifier English, comment Vietnamese.
- Không đụng public function domain/sync/db/auth (không cần GitNexus impact).
- Test: `npm test -- tests/type-scale.test.ts` rồi `npm test`.
