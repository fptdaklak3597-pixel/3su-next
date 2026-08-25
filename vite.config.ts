import { defineConfig, loadEnv, type Plugin } from 'vite'
import { applyProductionEnvForAppBuild } from './scripts/apply-production-env'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import { existsSync, renameSync } from 'node:fs'
import {
  gisCallbackPage,
  gisErrorPage,
  gisResponseHeaders,
  MAX_GIS_POST_BYTES,
  randomNonce,
  validateGisSubmission,
} from './functions/__/gis-core.js'

/**
 * 3SU Next — Cấu hình Vite đa ứng dụng
 *
 * Ba app dùng chung codebase:
 *  - web    : trang quản lý (index.html → dist/)
 *  - mobile : PWA bán hàng trên điện thoại (mobile.html → dist-mobile/)
 *  - admin  : quản lý shop (admin.html → dist-admin/)
 *
 * Chọn app: `--mode mobile` / `--mode admin` hoặc APP=mobile|admin.
 */

const ONE_YEAR = 60 * 60 * 24 * 365

/** Web = KiotViet xanh; mobile = warm paper (xem src/index.css / web/theme.css). */
const THEME_COLOR_WEB = '#1E40AF'
const THEME_COLOR_MOBILE = '#FAF7F2'
const BACKGROUND_COLOR_WEB = '#F6F8FB'
const BACKGROUND_COLOR_MOBILE = '#FAF7F2'

const SRC = path.resolve(__dirname, './src')

type AppName = 'web' | 'mobile' | 'admin'
const appOf = (mode: string): AppName => {
  if (process.env.APP === 'mobile' || mode === 'mobile') return 'mobile'
  if (process.env.APP === 'admin' || mode === 'admin') return 'admin'
  return 'web'
}

const ICON_192 = { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }

const ICONS = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' as const },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' as const },
  { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' as const },
  { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' as const },
  { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' as const },
]

const shortcut = (name: string, url: string, description: string) => ({
  name,
  short_name: name,
  description,
  url,
  icons: [ICON_192],
})

/* ------------------------------------------------------------------ *
 * Hai app, hai cấu hình PWA riêng
 * ------------------------------------------------------------------ */
const APP_CONFIG = {
  web: {
    entry: 'index.html',
    outDir: 'dist',
    port: 5190,
    manifest: {
      name: '3SU — Quản lý cửa hàng',
      short_name: '3SU Quản lý',
      description: 'Phần mềm quản lý bán hàng — kho, đơn hàng, khách hàng, báo cáo',
      start_url: '/',
      shortcuts: [
        shortcut('Tổng quan', '/', 'Bảng điều khiển cửa hàng'),
        shortcut('Bán hàng', '/ban-hang', 'Màn hình bán hàng'),
        shortcut('Kho hàng', '/kho', 'Quản lý sản phẩm và tồn kho'),
        shortcut('Báo cáo', '/bao-cao', 'Báo cáo doanh thu và lợi nhuận'),
      ],
    },
  },
  mobile: {
    entry: 'mobile.html',
    outDir: 'dist-mobile',
    port: 5191,
    manifest: {
      name: '3SU — Bán hàng',
      short_name: '3SU',
      description: 'Phần mềm bán hàng cho người bán nhỏ Việt Nam',
      start_url: '/',
      shortcuts: [
        shortcut('Bán hàng', '/ban-hang', 'Bắt đầu bán ngay'),
        shortcut('Đơn hàng', '/don-hang', 'Lịch sử đơn hàng'),
        shortcut('Kho hàng', '/kho', 'Xem tồn kho nhanh'),
        shortcut('Thu tiền', '/khach-hang', 'Quản lý công nợ khách'),
      ],
    },
  },
  admin: {
    entry: 'admin.html',
    outDir: 'dist-admin',
    port: 5192,
    manifest: {
      name: '3SU Admin',
      short_name: '3SU Admin',
      description: 'Quản lý shop — gia hạn, khoá, thông tin',
      start_url: '/',
      shortcuts: [],
    },
  },
} satisfies Record<AppName, unknown>

function setGisHeaders(res: import('node:http').ServerResponse, nonce = ''): void {
  for (const [key, value] of Object.entries(gisResponseHeaders(nonce))) res.setHeader(key, String(value))
  res.setHeader('allow', 'POST')
}

function endGisResponse(
  res: import('node:http').ServerResponse,
  status: number,
  html: string,
  nonce = '',
): void {
  res.statusCode = status
  setGisHeaders(res, nonce)
  res.end(html)
}

/** POST /__/gis — mô phỏng chính xác callback Cloudflare trong dev. */
function gisLogin(): Plugin {
  return {
    name: '3su-gis-login',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '/').split('?')[0] ?? '/'
        if (pathname !== '/__/gis') return next()
        if (req.method !== 'POST') {
          endGisResponse(res, 405, gisErrorPage('Phương thức không được hỗ trợ'))
          return
        }
        const contentType = String(req.headers['content-type'] || '').toLowerCase()
        if (!contentType.startsWith('application/x-www-form-urlencoded')) {
          endGisResponse(res, 415, gisErrorPage('Định dạng yêu cầu không hợp lệ'))
          return
        }
        const contentLength = Number(req.headers['content-length'] || 0)
        if (Number.isFinite(contentLength) && contentLength > MAX_GIS_POST_BYTES) {
          endGisResponse(res, 413, gisErrorPage('Yêu cầu đăng nhập quá lớn'))
          return
        }

        const chunks: Buffer[] = []
        let size = 0
        let tooLarge = false
        req.on('data', (chunk) => {
          const next = Buffer.from(chunk)
          size += next.byteLength
          if (size > MAX_GIS_POST_BYTES) {
            tooLarge = true
            chunks.length = 0
            return
          }
          if (!tooLarge) chunks.push(next)
        })
        req.on('error', () => {
          if (!res.writableEnded) endGisResponse(res, 400, gisErrorPage('Không đọc được yêu cầu đăng nhập'))
        })
        req.on('end', () => {
          if (res.writableEnded) return
          if (tooLarge) {
            endGisResponse(res, 413, gisErrorPage('Yêu cầu đăng nhập quá lớn'))
            return
          }
          const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
          const result = validateGisSubmission({
            credential: form.get('credential'),
            bodyCsrf: form.get('g_csrf_token'),
            cookieHeader: req.headers.cookie,
          })
          if (!result.ok) {
            endGisResponse(res, result.status, gisErrorPage(result.message))
            return
          }
          const nonce = randomNonce()
          endGisResponse(res, 200, gisCallbackPage(result.credential, nonce), nonce)
        })
      })
    },
  }
}

function adminEntry(app: AppName): Plugin {
  return {
    name: '3su-next-admin-entry',
    apply: () => app === 'admin',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? '/'
        const pathname = url.split('?')[0] ?? '/'
        const isInternal =
          pathname.startsWith('/@') ||
          pathname.startsWith('/node_modules') ||
          pathname.startsWith('/src') ||
          pathname.startsWith('/icons') ||
          pathname.startsWith('/__/') ||
          pathname.startsWith('/v1')
        if (!isInternal && path.extname(pathname) === '') req.url = '/admin.html'
        next()
      })
    },
    writeBundle(options) {
      const outDir = path.resolve(options.dir ?? APP_CONFIG.admin.outDir)
      const source = path.join(outDir, 'admin.html')
      const target = path.join(outDir, 'index.html')
      if (!existsSync(source)) return
      if (existsSync(target)) throw new Error(`Không thể tạo admin index: ${target} đã tồn tại`)
      renameSync(source, target)
    },
  }
}

function mobileEntry(app: AppName): Plugin {
  return {
    name: '3su-next-mobile-entry',
    apply: () => app === 'mobile',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? '/'
        const pathname = url.split('?')[0] ?? '/'
        const isInternal =
          pathname.startsWith('/@') ||
          pathname.startsWith('/node_modules') ||
          pathname.startsWith('/src') ||
          pathname.startsWith('/icons') ||
          pathname.startsWith('/__/')
        if (!isInternal && path.extname(pathname) === '') req.url = '/mobile.html'
        next()
      })
    },
    writeBundle(options) {
      const outDir = path.resolve(options.dir ?? APP_CONFIG.mobile.outDir)
      const source = path.join(outDir, 'mobile.html')
      const target = path.join(outDir, 'index.html')
      if (!existsSync(source)) return
      if (existsSync(target)) throw new Error(`Không thể tạo mobile index: ${target} đã tồn tại`)
      renameSync(source, target)
    },
  }
}

export default defineConfig(({ command, mode }) => {
  const app = appOf(mode)
  const current = APP_CONFIG[app]
  const merged = applyProductionEnvForAppBuild(
    command,
    mode,
    loadEnv(mode, process.cwd(), ''),
    loadEnv('production', process.cwd(), ''),
  )
  for (const [key, value] of Object.entries(merged)) {
    if (!process.env[key]) process.env[key] = String(value)
  }

  return {
    define: {
      __APP_NAME__: JSON.stringify(app),
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '4.0.0'),
    },
    plugins: [
      gisLogin(),
      react(),
      ...(app === 'admin' ? [] : [VitePWA({
        /**
         * Hook PWA của app đăng ký /sw.js và chỉ gửi SKIP_WAITING khi người dùng
         * bấm Cập nhật trên banner (không auto-apply).
         */
        registerType: 'prompt',
        injectRegister: null,
        includeManifestIcons: false,
        manifest: {
          ...current.manifest,
          lang: 'vi',
          dir: 'ltr',
          scope: '/',
          display: 'standalone',
          display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
          orientation: app === 'mobile' ? 'portrait' : 'any',
          background_color: app === 'mobile' ? BACKGROUND_COLOR_MOBILE : BACKGROUND_COLOR_WEB,
          theme_color: app === 'mobile' ? THEME_COLOR_MOBILE : THEME_COLOR_WEB,
          categories: ['business', 'productivity', 'shopping'],
          icons: ICONS,
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2,json}'],
          globIgnores: [
            '**/vendor/zxing*',
            '**/mockup/**',
            '**/*xlsx*',
          ],
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/__\/auth/, /^\/__\/gis/],
          cleanupOutdatedCaches: true,
          skipWaiting: false,
          clientsClaim: false,
          cacheId: `3su-next-${app}`,
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: `3su-next-${app}-fonts-css`,
                expiration: { maxEntries: 20, maxAgeSeconds: ONE_YEAR },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: `3su-next-${app}-fonts-woff`,
                expiration: { maxEntries: 40, maxAgeSeconds: ONE_YEAR },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
        devOptions: { enabled: false },
      })]),
      mobileEntry(app),
      adminEntry(app),
    ],
    resolve: {
      alias: {
        '@/core': path.resolve(SRC, 'core'),
        '@/shared': path.resolve(SRC, 'shared'),
        '@/web': path.resolve(SRC, 'web'),
        '@/mobile': path.resolve(SRC, 'mobile'),
        '@/admin': path.resolve(SRC, 'admin'),
        '@': SRC,
      },
    },
    build: {
      outDir: current.outDir,
      emptyOutDir: true,
      rollupOptions: { input: path.resolve(__dirname, current.entry) },
    },
    server: {
      host: true,
      port: process.env.PORT ? Number(process.env.PORT) : current.port,
      strictPort: false,
      proxy: {
        '/v1': { target: 'http://127.0.0.1:8787', changeOrigin: true },
        '/__/auth': { target: 'https://su-next.firebaseapp.com', changeOrigin: true },
        '/__/firebase': { target: 'https://su-next.firebaseapp.com', changeOrigin: true },
      },
    },
    preview: {
      port: process.env.PORT ? Number(process.env.PORT) : current.port + 100,
    },
  }
})
