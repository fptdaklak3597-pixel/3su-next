import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * 3SU Next — Cấu hình Vitest
 *
 * Tách riêng khỏi vite.config.ts để không nạp plugin PWA / mobileEntry
 * khi chạy test. Dùng happy-dom (cung cấp navigator/localStorage) +
 * fake-indexeddb (cung cấp IndexedDB cho Dexie) để test logic miền
 * mà không cần trình duyệt thật.
 */
const SRC = path.resolve(__dirname, './src')

export default defineConfig({
  resolve: {
    alias: {
      '@/core': path.resolve(SRC, 'core'),
      '@/shared': path.resolve(SRC, 'shared'),
      '@/web': path.resolve(SRC, 'web'),
      '@/mobile': path.resolve(SRC, 'mobile'),
      '@': SRC,
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
})
