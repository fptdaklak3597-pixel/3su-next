/**
 * 3SU Next — Vitest setup
 * Polyfill IndexedDB (fake-indexeddb) trước khi Dexie mở database.
 * happy-dom (environment) đã cung cấp navigator / localStorage / window.
 */
import 'fake-indexeddb/auto'
