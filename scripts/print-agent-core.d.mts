export const MAX_REQUEST_BYTES: number
export const MAX_TICKET_BYTES: number
export const MAX_CLOCK_SKEW_MS: number
export const DEFAULT_QUEUE_LIMIT: number
export const DEFAULT_RATE_LIMIT: number
export const DEFAULT_RATE_WINDOW_MS: number

export class PrintQueueFullError extends Error {}

export function escapeHtml(value: unknown): string
export function normalizePrintTicket(raw: unknown): Record<string, unknown>
export function ticketHtml(rawTicket: unknown, now?: Date): string
export function signPrintBody(secret: string, timestamp: string, nonce: string, body: string): string
export function verifyPrintSignature(input: {
  secret: string
  timestamp: string
  nonce: string
  signature: string
  body: string
  now?: number
}): { ok: boolean; status: number; error?: string }
export function createReplayGuard(maxEntries?: number): {
  consume(nonce: string, expiresAt: number, now?: number): boolean
  size(): number
}
export function createRateLimiter(options?: { limit?: number; windowMs?: number }): {
  allow(key: string, now?: number): boolean
}
export function createSerialQueue<T, R>(
  worker: (value: T) => Promise<R> | R,
  options?: { maxPending?: number },
): {
  enqueue(value: T): Promise<R>
  pending(): number
}
export function resolveAgentConfig(env?: Record<string, string | undefined>): {
  port: number
  host: string
  secret: string
  requireAuth: boolean
  queueLimit: number
}
