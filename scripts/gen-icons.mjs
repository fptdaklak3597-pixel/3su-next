/**
 * Sinh bộ icon PWA cho 3SU Next — không dùng thư viện ảnh.
 * Vẽ biểu tượng "mái hiên cửa hàng" (storefront awning) bằng hàm khoảng
 * cách, khử răng cưa bằng supersampling 4x4, mã hoá RGBA thành PNG qua zlib.
 *
 * Bảng màu 3SU: ink #1C1917, gold #B8935A, paper #FAF7F2 (xem src/index.css)
 *
 *   node scripts/gen-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'public/icons')

// ---------------------------------------------------------------- PNG writer
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

const crc32 = (buf) => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

const encodePng = (width, height, rgba) => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ------------------------------------------------------------------- shapes
const roundedRect = (x, y, r) => {
  const cx = Math.min(Math.max(x, r), 1 - r)
  const cy = Math.min(Math.max(y, r), 1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

// -------------------------------------------------------------------- brand
const INK = [28, 25, 23]      // #1C1917
const GOLD = [184, 147, 90]   // #B8935A
const PAPER = [250, 247, 242] // #FAF7F2

/** Các tâm của vòm mái hiên (scallops). */
const SCALLOPS = [0.228, 0.364, 0.5, 0.636, 0.772]
const SCALLOP_R2 = 0.068 * 0.068

/**
 * Biểu tượng cửa hàng: mái hiên vàng có vòm, thân cửa hàng màu giấy,
 * cửa ra vào màu vàng. Nền ink.
 */
const sample = (x, y, { rounded, scale }) => {
  const inTile = rounded ? roundedRect(x, y, 0.22) : true
  if (!inTile) return null

  const gx = (x - 0.5) / scale + 0.5
  const gy = (y - 0.5) / scale + 0.5

  // 1. Thanh trên mái hiên (vàng)
  if (gx >= 0.16 && gx <= 0.84 && gy >= 0.24 && gy <= 0.40) return GOLD

  // 2. Các vòm mái hiên (nửa tròn vàng phía dưới thanh)
  for (const cx of SCALLOPS) {
    if ((gx - cx) ** 2 + (gy - 0.40) ** 2 <= SCALLOP_R2 && gy >= 0.40) return GOLD
  }

  // 3. Cửa ra vào (vàng) — kiểm trước thân để không bị đè
  if (gx >= 0.44 && gx <= 0.56 && gy >= 0.56 && gy <= 0.78) return GOLD

  // 4. Thân cửa hàng (giấy)
  if (gx >= 0.22 && gx <= 0.78 && gy >= 0.40 && gy <= 0.78) return PAPER

  return INK
}

const render = (size, { rounded = true, scale = 1 } = {}) => {
  const SS = 4
  const buf = Buffer.alloc(size * size * 4)
  const inv = 1 / size
  const subInv = 1 / (SS * size)

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(px * inv + (sx + 0.5) * subInv, py * inv + (sy + 0.5) * subInv, {
            rounded,
            scale,
          })
          if (c) {
            r += c[0]
            g += c[1]
            b += c[2]
            a += 255
          }
        }
      }
      const n = SS * SS
      const i = (py * size + px) * 4
      const alpha = a / n
      if (alpha > 0) {
        const cover = a / 255
        buf[i] = Math.round(r / cover)
        buf[i + 1] = Math.round(g / cover)
        buf[i + 2] = Math.round(b / cover)
      }
      buf[i + 3] = Math.round(alpha)
    }
  }
  return encodePng(size, size, buf)
}

// --------------------------------------------------------------------- emit
mkdirSync(OUT, { recursive: true })

const targets = [
  ['icon-192.png', 192, { rounded: true, scale: 0.9 }],
  ['icon-512.png', 512, { rounded: true, scale: 0.9 }],
  // Maskable: nền tràn viền, hình nằm gọn trong vùng an toàn.
  ['maskable-192.png', 192, { rounded: false, scale: 0.68 }],
  ['maskable-512.png', 512, { rounded: false, scale: 0.68 }],
  // Apple touch icon (iOS) — vuông tràn, hình lớn hơn maskable một chút.
  ['icon-180.png', 180, { rounded: false, scale: 0.82 }],
]

for (const [name, size, opts] of targets) {
  const png = render(size, opts)
  writeFileSync(resolve(OUT, name), png)
  console.log(`${name.padEnd(24)} ${String(size).padStart(3)}px  ${(png.length / 1024).toFixed(1)} kB`)
}

console.log(`\nĐã ghi ${targets.length} icon vào public/icons/`)
