/**
 * AI chat UI state (Zustand).
 */
import { create } from 'zustand'
import type { AiChatMessage, AiChatResponse } from './client'
import { confirmAiProposal, sendAiChat } from './client'

const MAX_CHAT_HISTORY = 12
const MAX_STORED_MESSAGES = 40

export type AiUiMessage = AiChatMessage & {
  id: string
  proposal?: AiChatResponse['proposal']
  proposalConsumed?: boolean
}

type AiState = {
  open: boolean
  loading: boolean
  messages: AiUiMessage[]
  setOpen: (v: boolean) => void
  toggle: () => void
  clear: () => void
  send: (text: string) => Promise<void>
  confirmProposal: (proposalId: string, accept: boolean) => Promise<void>
}

function uid(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function note(content: string): AiUiMessage {
  return { id: uid(), role: 'assistant', content }
}

function keep(messages: AiUiMessage[]): AiUiMessage[] {
  return messages.slice(-MAX_STORED_MESSAGES)
}

export const useAiChat = create<AiState>((set, get) => ({
  open: false,
  loading: false,
  messages: [],

  setOpen: (v) => set({ open: v }),
  toggle: () => set((s) => ({ open: !s.open })),
  clear: () => set({ messages: [] }),

  send: async (text) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const userMsg: AiUiMessage = { id: uid(), role: 'user', content: trimmed }
    const history = [...get().messages, userMsg]
    set({ messages: history, loading: true })
    try {
      const res = await sendAiChat(
        history.slice(-MAX_CHAT_HISTORY).map(({ role, content }) => ({ role, content })),
      )
      const assistant: AiUiMessage = {
        id: uid(),
        role: 'assistant',
        content: res.text,
        proposal: res.proposal,
      }
      set({ messages: keep([...history, assistant]), loading: false })
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Lỗi AI'
      set({
        messages: keep([...history, note(`⚠ ${errMsg}`)]),
        loading: false,
      })
    }
  },

  confirmProposal: async (proposalId, accept) => {
    set({ loading: true })
    const consume = (messages: AiUiMessage[]) =>
      messages.map((m) => m.proposal?.proposalId === proposalId ? { ...m, proposalConsumed: true } : m)
    try {
      if (accept) {
        await confirmAiProposal(proposalId, true)
        set((s) => ({
          messages: keep([...consume(s.messages), note('✓ Đã thực hiện lệnh.')]),
          loading: false,
        }))
      } else {
        await confirmAiProposal(proposalId, false)
        set((s) => ({
          messages: keep([...consume(s.messages), note('Đã hủy đề xuất.')]),
          loading: false,
        }))
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Lỗi xác nhận'
      set((s) => ({
        messages: keep([...s.messages, note(`⚠ ${errMsg}`)]),
        loading: false,
      }))
    }
  },
}))
