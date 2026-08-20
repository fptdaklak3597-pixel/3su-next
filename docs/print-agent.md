# 3SU Print Agent

Print agent nhận phiếu có cấu trúc, dựng HTML cục bộ và chuyển cho Chrome. Không gửi HTML từ trình duyệt đến agent.

## 1. Chế độ an toàn mặc định: chỉ máy hiện tại

```bash
npm run print:agent
```

Agent nghe tại `http://127.0.0.1:9101`. Trong **Cài đặt → LAN Agent**, đặt URL này. Localhost không bắt buộc shared secret, nhưng vẫn có thể dùng secret.

## 2. In từ thiết bị khác trong cùng Wi-Fi

1. Trên web/mobile, mở **Cài đặt → LAN Agent**.
2. Bấm **Tạo secret** và giữ nguyên giá trị đó trên thiết bị gửi in.
3. Trên máy tính nối máy in, chạy agent với đúng secret.
4. Đặt URL trong ứng dụng thành `http://<IP-máy-tính>:9101`.
5. Chỉ mở cổng 9101 trong mạng riêng; không NAT/public cổng này ra Internet.

Linux/macOS:

```bash
PRINT_AGENT_LAN=1 \
PRINT_AGENT_SECRET='thay-bang-secret-it-nhat-16-ky-tu' \
npm run print:agent
```

Windows PowerShell:

```powershell
$env:PRINT_AGENT_LAN='1'
$env:PRINT_AGENT_SECRET='thay-bang-secret-it-nhat-16-ky-tu'
npm run print:agent
```

Mỗi request LAN được ký HMAC-SHA256 trên timestamp, nonce và exact JSON body. Agent từ chối chữ ký sai, request quá hạn và nonce dùng lại.

## 3. Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `9101` | Cổng HTTP |
| `PRINT_AGENT_HOST` | `127.0.0.1` | Địa chỉ bind; host không phải loopback bắt buộc secret |
| `PRINT_AGENT_LAN` | rỗng | `1` để bind `0.0.0.0` khi không đặt host |
| `PRINT_AGENT_SECRET` | rỗng | Shared secret, tối thiểu 16 ký tự khi mở LAN |
| `PRINT_AGENT_ORIGINS` | rỗng | Danh sách origin bổ sung, phân cách dấu phẩy |
| `PRINT_QUEUE_LIMIT` | `20` | Số job tối đa chờ trong queue |
| `PRINT_RATE_LIMIT` | `30` | Số request tối đa mỗi IP/phút |
| `PRINT_HANDOFF_MS` | `1500` | Thời gian giữ queue sau khi Chrome nhận file |
| `CHROME_PATH` | tự dò | Đường dẫn Chrome/Chromium |
| `PRINT_API` | rỗng | Base URL cloud print API |
| `PRINT_SHOP` | rỗng | Shop ID dùng cho cloud polling |
| `PRINT_TOKEN_FILE` | rỗng | File chứa token cloud; được đọc lại mỗi vòng poll |
| `PRINT_TOKEN` | rỗng | Tương thích cũ; không khuyến nghị vì token nằm lâu trong môi trường |
| `PRINT_AGENT_ID` | hostname | ID agent gửi khi claim cloud job |

Shared secret chỉ nằm trong IndexedDB của từng thiết bị gửi in. Nó không thuộc Settings, không đồng bộ cloud và không nằm trong file backup.

## 4. Giới hạn và phòng vệ

- Body HTTP tối đa 64 KiB; ticket sau chuẩn hóa tối đa 16 KiB.
- Tối đa 80 dòng hàng và 5 bản in trong một ticket.
- Tiền/số lượng phải hữu hạn và nằm trong giới hạn.
- Mọi trường chèn vào HTML đều được escape.
- Print queue chạy tuần tự, có giới hạn pending và rate limit theo IP.
- File HTML tạm có quyền hạn chế, được xóa sau job và có stale-file sweep.
- Cloud poll không chạy chồng; request có deadline và lỗi dùng exponential backoff.
- WebSocket cloud không đặt bearer token trong query string.

## 5. Kiểm tra

```bash
npm run check:print-agent
npm test -- tests/print-agent-security.test.ts tests/print-agent-client-auth.test.ts
```

Health endpoint:

```text
GET http://127.0.0.1:9101/health
```

Endpoint chỉ trả trạng thái, việc có yêu cầu authentication và độ dài queue; không trả secret hoặc token.
