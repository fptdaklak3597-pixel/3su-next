# Bốn lỗ sync — đã duyệt và đã làm

**Ngày:** 2026-08-18

1. Ngắt cloud đóng WebSocket, ghi `cloud:paused`. Nút Ngắt / Bật trên Thiết bị.
2. Mode sync đẩy snapshot khi `lastSeq − lastSnapshotSeq ≥ 20`. Không xóa outbox. Snapshot sau khi kéo op.
3. Máy trống không đẩy snapshot rỗng.
4. `product.upsert` chỉ field đổi. `device.upsert` / `device.remove` lên mây. Đăng ký lần hai cùng tên không thêm op.
