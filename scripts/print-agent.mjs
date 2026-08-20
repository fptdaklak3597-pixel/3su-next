#!/usr/bin/env node
/**
 * 3SU Next print agent.
 *
 * Mặc định chỉ nghe localhost:
 *   node scripts/print-agent.mjs
 *
 * Mở ra LAN bắt buộc có shared secret:
 *   PRINT_AGENT_LAN=1 PRINT_AGENT_SECRET="mot-secret-dai-it-nhat-16-ky-tu" node scripts/print-agent.mjs
 *
 * Cloud polling nên đọc token từ file có quyền hạn chế:
 *   PRINT_API=https://... PRINT_SHOP=shop_xxx PRINT_TOKEN_FILE=/path/token node scripts/print-agent.mjs
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  MAX_CLOCK_SKEW_MS,
  MAX_REQUEST_BYTES,
  PrintQueueFullError,
  createRateLimiter,
  createReplayGuard,
  createSerialQueue,
  normalizePrintTicket,
  resolveAgentConfig,
  ticketHtml,
  verifyPrintSignature,
} from './print-agent-core.mjs'

const config = resolveAgentConfig()
const DEFAULT_ORIGINS = [
  'https://su-next-web.pages.dev',
  'https://su-next-app.pages.dev',
  'http://localhost:5200',
  'http://localhost:5201',
  'http://127.0.0.1:5200',
  'http://127.0.0.1:5201',
]
const extraOrigins = String(process.env.PRINT_AGENT_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const ORIGINS = new Set([...DEFAULT_ORIGINS, ...extraOrigins])
const replayGuard = createReplayGuard()
const rateLimiter = createRateLimiter({
  limit: Number(process.env.PRINT_RATE_LIMIT || 30),
  windowMs: 60_000,
})
const TEMP_PREFIX = '3su-print-'
const TEMP_MAX_AGE_MS = 60 * 60_000
const PRINT_FILE_TTL_MS = 2 * 60_000
const PRINT_HANDOFF_MS = Math.max(250, Math.min(10_000, Number(process.env.PRINT_HANDOFF_MS || 1_500)))

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  return candidates.find((candidate) => fs.existsSync(candidate)) || ''
}

function cleanupFile(file) {
  fs.promises.unlink(file).catch(() => {})
}

async function sweepStaleFiles(now = Date.now()) {
  let names = []
  try { names = await fs.promises.readdir(os.tmpdir()) } catch { return }
  await Promise.all(names
    .filter((name) => name.startsWith(TEMP_PREFIX) && name.endsWith('.html'))
    .map(async (name) => {
      const file = path.join(os.tmpdir(), name)
      try {
        const stat = await fs.promises.stat(file)
        if (now - stat.mtimeMs > TEMP_MAX_AGE_MS) await fs.promises.unlink(file)
      } catch { /* file đã biến mất */ }
    }))
}

async function handOffToChrome(rawTicket) {
  const ticket = normalizePrintTicket(rawTicket)
  const chrome = findChrome()
  if (!chrome) throw new Error('Không tìm thấy Chrome. Hãy đặt CHROME_PATH.')

  const file = path.join(os.tmpdir(), `${TEMP_PREFIX}${Date.now()}-${randomUUID()}.html`)
  await fs.promises.writeFile(file, ticketHtml(ticket), { encoding: 'utf8', mode: 0o600 })
  const safetyCleanup = setTimeout(() => cleanupFile(file), PRINT_FILE_TTL_MS)
  safetyCleanup.unref?.()

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(chrome, [
        '--kiosk-printing',
        '--disable-print-preview',
        '--no-first-run',
        pathToFileURL(file).href,
      ], {
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
      })
      let settled = false
      const fail = (error) => {
        if (settled) return
        settled = true
        reject(error)
      }
      child.once('error', fail)
      child.once('spawn', () => {
        child.unref()
        const handoff = setTimeout(() => {
          if (settled) return
          settled = true
          resolve()
        }, PRINT_HANDOFF_MS)
        handoff.unref?.()
      })
      child.once('exit', () => {
        const delayed = setTimeout(() => cleanupFile(file), 5_000)
        delayed.unref?.()
      })
    })
    return { ok: true }
  } catch (error) {
    cleanupFile(file)
    throw error
  }
}

const printQueue = createSerialQueue(handOffToChrome, { maxPending: config.queueLimit })

function requestOriginAllowed(req, res) {
  const origin = String(req.headers.origin || '')
  if (!origin) return true
  if (!ORIGINS.has(origin)) return false
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  return true
}

function setCommonHeaders(res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
}

function sendJson(res, status, body) {
  setCommonHeaders(res)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function clientKey(req) {
  return String(req.socket.remoteAddress || 'unknown')
}

async function readBody(req, maxBytes = MAX_REQUEST_BYTES) {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, 'body-too-large')
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) {
      req.resume()
      throw new HttpError(413, 'body-too-large')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function authenticatePrintRequest(req, rawBody) {
  if (!config.requireAuth) return
  const timestamp = String(req.headers['x-3su-timestamp'] || '')
  const nonce = String(req.headers['x-3su-nonce'] || '')
  const signature = String(req.headers['x-3su-signature'] || '')
  const verified = verifyPrintSignature({
    secret: config.secret,
    timestamp,
    nonce,
    signature,
    body: rawBody,
  })
  if (!verified.ok) throw new HttpError(verified.status, `auth-${verified.error}`)
  if (!replayGuard.consume(nonce, Number(timestamp) + MAX_CLOCK_SKEW_MS)) {
    throw new HttpError(409, 'replay')
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (!requestOriginAllowed(req, res)) throw new HttpError(403, 'origin')
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-3SU-Timestamp,X-3SU-Nonce,X-3SU-Signature')
      res.setHeader('Access-Control-Max-Age', '600')
      setCommonHeaders(res)
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url || '/', `http://${config.host}:${config.port}`)
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        service: '3su-print-agent',
        auth: config.requireAuth,
        queue: printQueue.pending(),
      })
      return
    }

    if (req.method === 'POST' && url.pathname === '/print') {
      if (!rateLimiter.allow(clientKey(req))) throw new HttpError(429, 'rate-limit')
      if (!/^application\/json(?:;|$)/i.test(String(req.headers['content-type'] || ''))) {
        throw new HttpError(415, 'content-type')
      }
      const rawBody = await readBody(req)
      authenticatePrintRequest(req, rawBody)
      let parsed
      try { parsed = JSON.parse(rawBody) } catch { throw new HttpError(400, 'json') }
      const ticket = normalizePrintTicket(parsed?.ticket ?? parsed)
      await printQueue.enqueue(ticket)
      sendJson(res, 200, { ok: true, status: 'sent' })
      return
    }

    throw new HttpError(404, 'not-found')
  } catch (error) {
    if (error instanceof PrintQueueFullError) {
      sendJson(res, 429, { ok: false, error: 'queue-full' })
      return
    }
    if (error instanceof HttpError) {
      sendJson(res, error.status, { ok: false, error: error.message })
      return
    }
    console.error('request', error instanceof Error ? error.message : error)
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'request' })
  }
})

server.requestTimeout = 15_000
server.headersTimeout = 10_000
server.keepAliveTimeout = 5_000
server.maxRequestsPerSocket = 100
server.listen(config.port, config.host, () => {
  console.log(`3SU print agent http://${config.host}:${config.port}`)
  console.log(config.requireAuth ? 'LAN authentication: required' : 'LAN authentication: localhost-only mode')
})

void sweepStaleFiles()
const sweepTimer = setInterval(() => { void sweepStaleFiles() }, 30 * 60_000)
sweepTimer.unref?.()

const api = String(process.env.PRINT_API || '').replace(/\/+$/, '')
const shopId = String(process.env.PRINT_SHOP || '')
const tokenFile = String(process.env.PRINT_TOKEN_FILE || '')
const legacyToken = String(process.env.PRINT_TOKEN || '')
const agentId = String(process.env.PRINT_AGENT_ID || `lan-${os.hostname()}`).slice(0, 120)

if (legacyToken && !tokenFile) {
  console.warn('PRINT_TOKEN là biến môi trường dài hạn. Nên dùng PRINT_TOKEN_FILE và xoay token thường xuyên.')
}

async function cloudToken() {
  if (tokenFile) return (await fs.promises.readFile(tokenFile, 'utf8')).trim()
  return legacyToken
}

async function fetchDeadline(url, init = {}, timeoutMs = 10_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try { return await fetch(url, { ...init, signal: controller.signal }) } finally { clearTimeout(timer) }
}

async function pollCloudOnce() {
  const token = await cloudToken()
  if (!token) throw new Error('Thiếu PRINT_TOKEN_FILE/PRINT_TOKEN')
  const headers = { Authorization: `Bearer ${token}` }
  const list = await fetchDeadline(`${api}/v1/shops/${encodeURIComponent(shopId)}/print-jobs`, { headers })
  if (!list.ok) throw new Error(`list ${list.status}`)
  const payload = await list.json()
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs.slice(0, 100) : []

  for (const job of jobs) {
    const id = typeof job?.id === 'string' ? job.id : ''
    if (!id) continue
    const claim = await fetchDeadline(`${api}/v1/shops/${encodeURIComponent(shopId)}/print-jobs/${encodeURIComponent(id)}/claim`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ agentId }),
    })
    if (!claim.ok) continue

    let status = 'error'
    let error = ''
    try {
      const claimed = await claim.json()
      const ticket = normalizePrintTicket(claimed?.ticket)
      await printQueue.enqueue(ticket)
      status = 'done'
    } catch (cause) {
      error = String(cause instanceof Error ? cause.message : cause).slice(0, 240)
    }

    await fetchDeadline(`${api}/v1/shops/${encodeURIComponent(shopId)}/print-jobs/${encodeURIComponent(id)}/ack`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ status, error }),
    })
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function cloudPollLoop() {
  let delay = 2_500
  for (;;) {
    try {
      await pollCloudOnce()
      delay = 2_500
    } catch (error) {
      console.error('poll', error instanceof Error ? error.message : error)
      delay = Math.min(60_000, Math.max(5_000, delay * 2))
    }
    await sleep(delay + Math.floor(Math.random() * Math.min(1_000, delay * 0.2)))
  }
}

if (api && shopId && (tokenFile || legacyToken)) void cloudPollLoop()
else if (api || shopId || tokenFile || legacyToken) console.warn('Cloud print cần đủ PRINT_API, PRINT_SHOP và token.')

function shutdown(signal) {
  console.log(`Nhận ${signal}, đang dừng print agent…`)
  clearInterval(sweepTimer)
  server.close(() => process.exit(0))
  const force = setTimeout(() => process.exit(1), 5_000)
  force.unref?.()
}
process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
