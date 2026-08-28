import { getMeta, setMeta } from '../db'
import type { PrintDispatchResult, PrintVia } from './printQueue'

export const PRINT_LOG_KEY = 'print:bySaleId'

export interface PrintLogEntry {
  via: PrintVia
  at: number
  error?: string | null
}

export function printStatusLabel(log: PrintLogEntry | undefined | null): string {
  if (!log) return 'Chưa gửi'
  if (log.via === 'none') return log.error ? `Lỗi: ${log.error}` : 'Lỗi'
  return 'Đã gửi'
}

export async function recordPrintResult(saleId: string | undefined, r: PrintDispatchResult): Promise<void> {
  if (!saleId) return
  const prev = await getMeta<Record<string, PrintLogEntry>>(PRINT_LOG_KEY, {})
  await setMeta(PRINT_LOG_KEY, {
    ...prev,
    [saleId]: { via: r.via, at: Date.now(), error: r.error ?? null },
  })
}

export async function getPrintLog(saleId: string): Promise<PrintLogEntry | null> {
  const all = await getMeta<Record<string, PrintLogEntry>>(PRINT_LOG_KEY, {})
  return all[saleId] ?? null
}
