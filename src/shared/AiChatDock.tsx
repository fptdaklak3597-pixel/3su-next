/**
 * AI chat dock — web + mobile.
 */
import { useEffect, useRef, useState } from 'react'
import { Bot, MessageCircle, Send, X } from 'lucide-react'
import { useAiChat } from '@/core/ai/store'
import { apiBase } from '@/core/sync/cloud'
import { isDevUiPreview } from '@/core/devPreview'

export function AiChatDock() {
  const cloudOk = !!apiBase()
  const open = useAiChat((s) => s.open)
  const loading = useAiChat((s) => s.loading)
  const messages = useAiChat((s) => s.messages)
  const toggle = useAiChat((s) => s.toggle)
  const setOpen = useAiChat((s) => s.setOpen)
  const send = useAiChat((s) => s.send)
  const confirmProposal = useAiChat((s) => s.confirmProposal)
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  const uiPreview = isDevUiPreview()
  if (!cloudOk && !uiPreview) return null

  async function handleSend() {
    const t = input.trim()
    if (!t || loading) return
    setInput('')
    await send(t)
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          className="ai-fab"
          aria-label="Mở trợ lý AI"
          onClick={toggle}
        >
          <MessageCircle size={22} />
        </button>
      )}
      {open && (
        <div className="ai-dock" role="dialog" aria-label="Trợ lý AI 3SU">
          <header className="ai-dock-head">
            <span className="ai-dock-title"><Bot size={18} /> Trợ lý 3SU</span>
            <button type="button" className="ai-dock-close" aria-label="Đóng" onClick={() => setOpen(false)}>
              <X size={18} />
            </button>
          </header>
          <div className="ai-dock-msgs">
            {messages.length === 0 && (
              <p className="ai-dock-hint">Hỏi cách dùng app, doanh thu hôm nay, hoặc &quot;tạo đơn 2 cà phê&quot;…</p>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`ai-msg ai-msg--${m.role}`}>
                <div className="ai-msg-bubble">{m.content}</div>
                {m.proposal && !m.proposalConsumed && (
                  <div className="ai-proposal">
                    <strong>{m.proposal.summary}</strong>
                    <div className="ai-proposal-actions">
                      <button
                        type="button"
                        className="ai-btn pri"
                        disabled={loading}
                        onClick={() => void confirmProposal(m.proposal!.proposalId, true)}
                      >
                        Xác nhận
                      </button>
                      <button
                        type="button"
                        className="ai-btn"
                        disabled={loading}
                        onClick={() => void confirmProposal(m.proposal!.proposalId, false)}
                      >
                        Hủy
                      </button>
                    </div>
                  </div>
                )}
                {m.proposal && m.proposalConsumed && (
                  <div className="ai-proposal">
                    <strong>{m.proposal.summary}</strong>
                    <p className="ai-dock-hint">Đề xuất đã xử lý</p>
                  </div>
                )}
              </div>
            ))}
            {loading && <p className="ai-dock-hint">Đang suy nghĩ…</p>}
            <div ref={bottomRef} />
          </div>
          <footer className="ai-dock-foot">
            <input
              className="ai-dock-input"
              placeholder="Nhập câu hỏi…"
              value={input}
              disabled={loading}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend() } }}
            />
            <button type="button" className="ai-dock-send" disabled={loading || !input.trim()} onClick={() => void handleSend()}>
              <Send size={18} />
            </button>
          </footer>
        </div>
      )}
    </>
  )
}
