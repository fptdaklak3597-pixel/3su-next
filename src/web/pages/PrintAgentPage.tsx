/**
 * Trang máy in trên PC — một màn: đăng nhập rồi chờ in.
 * Cùng cửa hàng với điện thoại (email chủ hoặc mã một lần) thì chờ in.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { useApp } from '@/core/store'
import { logError } from '@/core/errorLogger'
import {
  apiBase, connectCloud, enterExistingCloudShop, loadApiBaseOverride,
} from '@/core/sync/cloud'
import {
  getCloudIdToken, isCloudEmailPending, isFirebaseConfigured, waitCloudUser,
} from '@/core/sync/firebase'
import {
  ackCloudPrintJob, claimCloudPrintJob, cloudPrintErrorMessage, retryPrintTicket,
  connectPrintAgentSocket, listCloudPrintJobs,
} from '@/core/browser/printQueue'
import { printTicketLocal } from '@/core/browser/print'
import { testTicket, type PrintTicket } from '@/core/browser/printTicket'

type Phase = 'boot' | 'login' | 'ready' | 'printing' | 'error'

function agentId(): string {
  const key = '3su:print-agent-id'
  let id = localStorage.getItem(key)
  if (!id) {
    id = `pc_${Math.random().toString(36).slice(2, 10)}`
    localStorage.setItem(key, id)
  }
  return id
}

export function WebPrintAgentPage() {
  const navigate = useNavigate()
  const shop = useApp((s) => s.shop)
  const printer = useApp((s) => s.settings.printer)
  const showToast = useApp((s) => s.showToast)
  const [phase, setPhase] = useState<Phase>('boot')
  const [detail, setDetail] = useState('Đang mở…')
  const [printed, setPrinted] = useState(0)
  const [lastOkAt, setLastOkAt] = useState<number | null>(null)
  const busyDrain = useRef(false)
  const stopRef = useRef(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [retryTicket, setRetryTicket] = useState<PrintTicket | null>(null)

  const drain = useCallback(async () => {
    if (busyDrain.current) return
    busyDrain.current = true
    try {
      const { jobs } = await listCloudPrintJobs()
      for (const job of jobs) {
        setPhase('printing')
        setDetail('Đang in…')
        const claimed = await claimCloudPrintJob(job.id, agentId())
        if (!claimed?.ticket) continue
        const ticket = claimed.ticket as PrintTicket
        const ok = printTicketLocal(ticket)
        await ackCloudPrintJob(job.id, ok ? 'done' : 'error', ok ? '' : 'in lỗi')
        if (ok) setPrinted((n) => n + 1)
        else setRetryTicket(ticket)
      }
      if (!stopRef.current) {
        setPhase('ready')
        setDetail('Bán trên điện thoại — phiếu in ra đây.')
        setLastOkAt(Date.now())
      }
    } catch (e) {
      logError(e, 'print.drain')
      if (!stopRef.current) {
        setPhase('error')
        setDetail(cloudPrintErrorMessage(e))
      }
    } finally {
      busyDrain.current = false
    }
  }, [])

  const enterShop = useCallback(async () => {
    await loadApiBaseOverride()
    if (!isFirebaseConfigured() || !apiBase()) {
      setPhase('error')
      setDetail('Chưa cấu hình Firebase / API')
      return
    }
    const u = await waitCloudUser()
    if (!u || isCloudEmailPending(u)) {
      setPhase('login')
      setDetail('Cần tài khoản cloud (Google/email). Tài khoản nhân viên trong máy không dùng để in.')
      return
    }
    try {
      await getCloudIdToken()
      const id = await enterExistingCloudShop()
      if (!id) throw new Error('Chưa vào cửa hàng. Mở Tài khoản, nhập mã hoặc tạo cửa hàng trước.')
      await connectCloud()
      setPhase('ready')
      setDetail('Bán trên điện thoại — phiếu in ra đây.')
      setLastOkAt(Date.now())
      void drain()
    } catch (e) {
      logError(e, 'print.enter')
      setPhase('error')
      setDetail(cloudPrintErrorMessage(e))
    }
  }, [drain])

  useEffect(() => {
    stopRef.current = false
    void enterShop()
    return () => {
      stopRef.current = true
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [enterShop])

  useEffect(() => {
    if (phase !== 'ready' && phase !== 'printing') return
    if (wsConnected) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      return
    }
    pollRef.current = setInterval(() => { void drain() }, 4000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [phase, drain, wsConnected])

  useEffect(() => {
    if (phase !== 'ready' && phase !== 'printing') return
    return connectPrintAgentSocket(
      () => { void drain() },
      (connected) => { setWsConnected(connected) },
    )
  }, [phase, drain])

  const ready = phase === 'ready' || phase === 'printing'
  const printing = phase === 'printing'

  return (
    <div className={`web-print-agent is-${phase} ${ready ? 'is-ready' : ''}`}>
      <header className="web-chrome">
        <nav className="web-topbar" aria-label="Máy in">
          <span className="web-logo">3SU</span>
          <span className="web-m on">Máy in</span>
          <div className="web-bar-r">
            {shop.name ? (
              <span className="web-top-shop">
                <span className="web-top-shop-name">{shop.name}</span>
              </span>
            ) : null}
          </div>
        </nav>
      </header>

      <div className="web-page web-print-agent-body">
        <div className="web-ph">
          <div>
            <h2>Máy in</h2>
            <p>{detail}</p>
          </div>
        </div>

        {phase === 'login' && (
          <div className="web-card web-print-agent-panel">
            <button type="button" className="web-btn pri" onClick={() => navigate('/tai-khoan?next=/may-in')}>
              Đăng nhập / Đăng ký
            </button>
            <p className="web-print-agent-note">
              Vào xong sẽ quay lại trang này và in, không hỏi lần nữa trên máy này.
            </p>
          </div>
        )}

        {ready && (
          <>
            <div className="web-print-agent-kpis">
              <div className="web-kpi-card">
                <div className="web-kpi-head">
                  <span className="web-kpi-label">Trạng thái</span>
                  <div className={`web-kpi-ico ${printing ? 'orange' : 'green'}`} aria-hidden>
                    <Printer size={17} />
                  </div>
                </div>
                <div className={`web-kpi-val web-print-agent-live ${printing ? 'is-print' : 'is-ok'}`}>
                  {printing ? 'ĐANG IN' : 'SẴN SÀNG'}
                </div>
                <div className="web-kpi-desc web-print-agent-keep">Đừng tắt trang này</div>
              </div>
              <div className="web-kpi-card">
                <div className="web-kpi-head">
                  <span className="web-kpi-label">Phiếu đã in</span>
                </div>
                <div className="web-kpi-val">{printed}</div>
                <div className="web-kpi-desc">Đã in {printed} phiếu</div>
              </div>
            </div>
            <p className="web-print-agent-check">
              {lastOkAt
                ? `Đã nối máy chủ · kiểm tra lúc ${new Date(lastOkAt).toLocaleTimeString('vi-VN')}`
                : 'Đang nối máy chủ…'}
            </p>
            <div className="web-print-agent-actions">
              <button
                type="button"
                className="web-btn"
                onClick={() => {
                  const ok = printTicketLocal(testTicket(shop.name, printer.width))
                  showToast(ok ? 'Chrome sẽ hỏi In — chọn máy in giấy ở đó.' : 'Không mở được hộp thoại in', ok ? 'ok' : 'bad')
                }}
              >
                In thử trên máy này
              </button>
            </div>
          </>
        )}

        {phase === 'error' && (
          <div className="web-card web-print-agent-panel">
            <button type="button" className="web-btn pri" onClick={() => window.location.reload()}>Thử lại</button>
            {retryTicket && (
              <button
                type="button"
                className="web-btn"
                onClick={() => {
                  void retryPrintTicket(retryTicket, printer, shop).then((r) => {
                    if (r.via !== 'none') {
                      showToast('Đã gửi in lại', 'ok')
                      setPhase('ready')
                    } else {
                      showToast(r.error || 'In lại lỗi', 'bad')
                    }
                  }).catch((e) => {
                    logError(e, 'print.retry')
                    showToast(e instanceof Error ? e.message : 'In lại lỗi', 'bad')
                  })
                }}
              >Thử in lại</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
