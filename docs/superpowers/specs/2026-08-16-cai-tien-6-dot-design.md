# 3SU Next — Cải tiến 6 đợt (đã duyệt A)

**Ngày:** 2026-08-16  
**Phạm vi:** `3su-next` + chỗ dọn chết. Không đụng `3su.shop`, `3su-v2.7.4`, icoffee, invoice.  
**Nguồn:** rà 185 mục; 81 cải / 104 giữ. Gộp trùng ≈ 74 việc.

## Mục tiêu

Shop già bán được dễ hơn: nút đúng chỗ, không chữ lừa, giỏ/kho/in/login khớp data đã có. Dexie vẫn nguồn đúng. Worker vẫn ngu.

## Không làm

Ảnh SP · live GDT/Gemini · paywall trial · đổi chrome KiotViet · kiosk Chrome · ca/két/QZ/FCM · đè `3su.shop`.

Việc chủ làm tay: Firebase Authorized domains (`su-next-web.pages.dev`, `su-next-app.pages.dev`).

## Ràng buộc

- Identifier English, comment Vietnamese.
- `confirmSale` vẫn atomic, tính lại giá từ Dexie.
- `payMethod: 'debt'` = ghi nợ cả đơn (cần khách). Tiền mặt đưa thiếu vẫn ghi nợ phần còn như cũ.
- Giảm % chỉ đổi ở UI → số tiền đưa vào `confirmSale.discount`.
- Beep: Web Audio oscillator, tôn trọng `settings.soundOn`. Không file mp3.
- Test: `npm test` + `npm run typecheck` trong `3su-next` (và `3su-cloud` nếu đụng Worker).
- Không commit trừ khi được hỏi. Deploy Pages `--branch main` sau mỗi đợt xanh, không đè production cũ.

## Đợt 1 — POS (làm trước)

| # | Việc | Cách |
|---|---|---|
| 24 68 | Beep | `playPosSound('scan-ok'\|'scan-miss'\|'sale')` nếu `soundOn` |
| 43 | Mobile cộng dồn | `mergeCartLine` — cùng SP + cùng ĐV thì cộng qty |
| 45 | Xóa dòng web | Nút X trên `CartRow` |
| 47 | ĐANG SỈ | Chữ to trên thanh POS khi `useWs` |
| 48 | Cảnh hết hàng lúc thêm | Toast khi `stock - qty*ratio < 0` (vẫn thêm nếu `allowNegative`) |
| 49 | Xóa giỏ | Nút trên cột giỏ web + mobile cart bar |
| 53 | Giảm % | UI đ/%; `discountToAmount` → số tiền |
| 54 | Nút Ghi nợ | `payMethod === 'debt'`; `confirmSale` ghi `debtAmount = total` |
| 56 57 | Mệnh giá + Đủ | Chip `DENOMINATIONS` + Đủ trên POS web |
| 42 | Chip nhóm mobile | Bán chạy / tất cả / nhóm như web |
| 44 | Gõ SL | Ô số trên dòng giỏ |
| 46 | Chọn ĐV lúc thêm | Chip ĐV trên dòng SP nếu `suggestUnits` > 1 |
| 8 | Mừng web | Overlay 1000ms trên web, 2800ms mobile |
| 38 | Chấm in | Chấm xanh/xám trên thanh POS từ `onPrintAgentOnline` |

## Đợt 2 — Chữ / lừa

23 copy âm kho · 32 ẩn `cloudRelay` · 100 bỏ “trả NCC” hoặc phiếu trả (mặc định **bỏ chữ**) · 121 101 bỏ chữ cổng thuế · 16 redirect `/thanh-toan` web · 10 11 chữ PWA / ghim app · 39 nút thanh toán to · 142 lọc `WebShell` theo `hasPerm`.

## Đợt 3 — Kho

21 85 lọc sắp hết · 22 badge HSD · 86 `units[]` trên form SP · 87 trừ FEFO lúc `confirmSale` · 88 vốn cũ→mới · 89 tab `priceLog` · 91 nút áp giá gợi ý · 94 quét mã lúc nhập · 102 quét kiểm kê · 103 tạo PO từ dự báo.

FEFO: trừ `batches.remain` theo HSD sớm nhất; cập nhật `product.expiry = liveBatchExpiry`. Không đổi công thức vốn BQ.

## Đợt 4 — Sổ

72 tìm mã + ngày · 74 bắt buộc lý do hủy · 110 biên lai thu nợ · 112 3 món hay mua · 115 sao kê NCC · 116 118 nhận PO từng phần · 119 120 nhãn sổ tay + gắn saleId · 122 ô ngày báo cáo · 128 xuất Excel kỳ · 129 chip câu hỏi.

## Đợt 5 — In / login / sync

29 slider font · 30 `showLogo` hoặc xóa cờ · 36 xem trước VietQR · 134 QR `/may-in` · 146 ghi chú domain (không tự sửa Firebase) · 147 PIN NV sau khi domain xong — **tách nếu 146 chưa xong** · 154 nút kéo snapshot · 159 QR pair · 161 tag máy in · 163 giải thích lệch · 168 gọi `scheduleAutoBackup` lúc boot + khôi phục.

## Đợt 6 — Dọn

1 một origin = ghi chú, không gộp host lúc này · 5 in báo cáo ngày · 13 theme lệch: web theo `settings.theme` hoặc bỏ UI theme mobile · 14 nút gửi log · 25 181–184 xóa field/type chết · 67 ô nhập tay camera · 69 báo iOS không nghe · 70 rưỡi/chục · 84 Excel báo dòng lỗi · 138 ESC/POS chỉ nếu agent gửi byte — **bỏ qua nếu chưa có máy** · 144 xóa hoặc bắt `passwordNeedsReset` · 167 báo field bỏ · 172 preview quy tắc giá · 173 readiness trên home trống · 174 xóa `archive` module chết.

## Kiểm thử

Mỗi đợt: test domain/browser liên quan đỏ→xanh, rồi `npm test` + `typecheck`. FEFO và `confirmSale` debt phải có test Dexie.

## Lộ trình

Đợt 1 → 2 → 3 → 4 → 5 → 6. Không hỏi lại giữa đợt trừ blocker (domain Firebase, máy nhiệt).
