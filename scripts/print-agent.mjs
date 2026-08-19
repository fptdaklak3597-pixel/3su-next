#!/usr/bin/env node
/**
 * Agent in LAN cho 3SU Next — nhận phiếu JSON, mở Chrome in.
 *   node scripts/print-agent.mjs
 *   PORT=9101 node scripts/print-agent.mjs
 *
 * Tuỳ chọn poll cloud (điện thoại 4G):
 *   PRINT_API=https://3su-cloud.3suspace.workers.dev
 *   PRINT_SHOP=shop_xxx
 *   PRINT_TOKEN=firebase-id-token
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.PORT || 9101)
const ORIGINS = new Set([
  'https://su-next-web.pages.dev',
  'https://su-next-app.pages.dev',
  'http://localhost:5200',
  'http://localhost:5201',
  'http://127.0.0.1:5200',
  'http://127.0.0.1:5201',
])

function cors(req, res) {
  const origin = req.headers.origin || ''
  if (ORIGINS.has(origin) || /^http:\/\/192\.168\.\d+\.\d+:(5200|5201)$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const cands = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
  ].filter(Boolean)
  return cands.find((p) => fs.existsSync(p)) || ''
}

function ticketHtml(ticket) {
  const shop = ticket.shop?.name || '3SU'
  const w = ticket.width === 80 ? 80 : 58
  if (ticket.kind === 'test') {
    return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${w}mm auto;margin:0}body{margin:0;width:${w}mm;font:12px sans-serif;padding:4mm;text-align:center}</style></head><body><b>3SU — KIỂM TRA MÁY IN</b><br>${esc(shop)}<br>${new Date().toLocaleString('vi-VN')}</body></html>`
  }
  const s = ticket.sale || { items: [], total: 0, id: '' }
  const rows = (s.items || []).map((it) => `<div>${esc(it.name)} ×${it.qty} — ${it.price}</div>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${w}mm auto;margin:0}body{margin:0;width:${w}mm;font:12px sans-serif;padding:4mm}</style></head><body><b>${esc(shop)}</b><div>HĐ ${esc(s.id)}</div>${rows}<div><b>Tổng ${s.total}</b></div></body></html>`
}

function esc(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

function printTicket(ticket) {
  const html = ticketHtml(ticket)
  const file = path.join(os.tmpdir(), `3su-print-${Date.now()}.html`)
  fs.writeFileSync(file, html, 'utf8')
  const chrome = findChrome()
  if (!chrome) {
    console.log('Không thấy Chrome — đã ghi', file)
    return false
  }
  spawn(chrome, ['--kiosk-printing', '--disable-print-preview', file], { detached: true, stdio: 'ignore' }).unref()
  return true
}

const server = http.createServer(async (req, res) => {
  cors(req, res)
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: '3su-print-agent' }))
    return
  }
  if (req.method === 'POST' && url.pathname === '/print') {
    const chunks = []
    for await (const c of req) chunks.push(c)
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
      res.writeHead(400); res.end(JSON.stringify({ error: 'JSON' })); return
    }
    const ticket = body.ticket || body
    if (!ticket || ticket.v !== 1) { res.writeHead(400); res.end(JSON.stringify({ error: 'ticket' })); return }
    const ok = printTicket(ticket)
    res.writeHead(ok ? 200 : 202, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok }))
    return
  }
  res.writeHead(404); res.end('not found')
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`3SU print agent http://0.0.0.0:${PORT}`)
  console.log('Cài đặt Next: Agent LAN = http://<IP-máy-này>:9101')
})

const api = (process.env.PRINT_API || '').replace(/\/+$/, '')
const shopId = process.env.PRINT_SHOP || ''
const token = process.env.PRINT_TOKEN || ''
if (api && shopId && token) {
  const agentId = 'lan-node'
  setInterval(async () => {
    try {
      const list = await fetch(`${api}/v1/shops/${shopId}/print-jobs`, { headers: { Authorization: `Bearer ${token}` } })
      if (!list.ok) return
      const { jobs } = await list.json()
      for (const job of jobs || []) {
        const claim = await fetch(`${api}/v1/shops/${shopId}/print-jobs/${job.id}/claim`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ agentId }),
        })
        if (!claim.ok) continue
        const { ticket } = await claim.json()
        const ok = printTicket(ticket)
        await fetch(`${api}/v1/shops/${shopId}/print-jobs/${job.id}/ack`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ status: ok ? 'done' : 'error' }),
        })
      }
    } catch (e) {
      console.error('poll', e.message || e)
    }
  }, 2500)
}
