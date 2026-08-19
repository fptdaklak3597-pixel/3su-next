/** QR chữ (ghép máy, mở /may-in) — ảnh công khai, không key. */
export function textQrSrc(data: string, size = 180): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}`
}
