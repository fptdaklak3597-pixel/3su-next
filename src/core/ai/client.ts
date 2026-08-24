/**
 * AI API client — all requests via 3su-cloud (never embed provider keys).
 */
import { apiBase, getCloudShopId } from '../sync/cloud'
import { getCloudIdToken } from '../sync/firebase'
import { apiGet, apiPost, fetchWithTimeout } from '../sync/http'

export type AiChatMessage = { role: 'user' | 'assistant' | 'system'; content: string }

export type AiChatResponse = {
  text: string
  provider?: string
  tool?: string
  proposal?: {
    proposalId: string
    type: string
    summary: string
    payload: unknown
    ownerOnly: boolean
  }
}

export type AiStatus = {
  hasGeminiKey: boolean
  usageToday: number
  quotaLimit: number
  provider: string
}

async function shopPath(suffix: string): Promise<{ base: string; path: string }> {
  const base = apiBase()
  const shopId = await getCloudShopId()
  if (!base || !shopId) throw new Error('Chưa kết nối cloud — vào Cài đặt → Đồng bộ')
  return { base, path: `/v1/shops/${encodeURIComponent(shopId)}${suffix}` }
}

export async function fetchAiStatus(): Promise<AiStatus> {
  const { base, path } = await shopPath('/ai/status')
  return apiGet<AiStatus>(base, path, getCloudIdToken)
}

export async function sendAiChat(
  messages: AiChatMessage[],
  mode?: 'guide-only' | 'auto',
): Promise<AiChatResponse> {
  const { base, path } = await shopPath('/ai/chat')
  return apiPost<AiChatResponse>(base, path, getCloudIdToken, { messages, mode }, 60_000)
}

export async function confirmAiProposal(proposalId: string, confirm = true): Promise<unknown> {
  const { base, path } = await shopPath('/ai/confirm')
  return apiPost(base, path, getCloudIdToken, { proposalId, confirm }, 30_000)
}

export async function saveGeminiApiKey(apiKey: string): Promise<void> {
  const { base, path } = await shopPath('/ai/key')
  const token = await getCloudIdToken()
  const res = await fetchWithTimeout(`${base.replace(/\/+$/, '')}${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(j.error || res.statusText)
  }
}

export async function deleteGeminiApiKey(): Promise<void> {
  const { base, path } = await shopPath('/ai/key')
  const token = await getCloudIdToken()
  const res = await fetchWithTimeout(`${base.replace(/\/+$/, '')}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(j.error || res.statusText)
  }
}

export async function scanInvoiceImages(parts: Array<{ b64: string; mime: string }>): Promise<string> {
  const { base, path } = await shopPath('/ai/scan-invoice')
  const res = await apiPost<{ text: string }>(base, path, getCloudIdToken, { parts }, 120_000)
  return res.text
}

export function fileToBase64(file: File): Promise<{ b64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (!m) { reject(new Error('Không đọc được file')); return }
      resolve({ mime: m[1]!, b64: m[2]! })
    }
    reader.onerror = () => reject(reader.error ?? new Error('Đọc file thất bại'))
    reader.readAsDataURL(file)
  })
}
