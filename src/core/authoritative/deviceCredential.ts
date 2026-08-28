/**
 * Bootstrap device credential for authoritative commands (Phase 5 gate).
 */
import { getMeta, setMeta } from '../db'
import { getThisDeviceId } from '../domain/devices'
import { apiBase, getCloudShopId } from '../sync/cloud'
import { getCloudIdToken } from '../sync/firebase'
import { fetchWithTimeout } from '../sync/http'

const SECRET_META = 'deviceCredentialSecret'

export async function getDeviceCredentialSecret(): Promise<string> {
  return getMeta<string>(SECRET_META, '')
}

export async function ensureDeviceCredential(): Promise<string> {
  const existing = await getDeviceCredentialSecret()
  if (existing) return existing

  const base = apiBase()
  const shopId = await getCloudShopId()
  if (!base || !shopId) throw new Error('Chưa kết nối cloud shop')

  const deviceId = await getThisDeviceId()
  const token = await getCloudIdToken()
  const res = await fetchWithTimeout(
    `${base.replace(/\/+$/, '')}/v1/shops/${encodeURIComponent(shopId)}/devices/credential`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId }),
    },
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || 'Không cấp device credential')
  }
  const body = (await res.json()) as { secret?: string }
  if (!body.secret) throw new Error('Phản hồi credential thiếu secret')
  await setMeta(SECRET_META, body.secret)
  return body.secret
}

export async function clearDeviceCredentialForTests(): Promise<void> {
  await setMeta(SECRET_META, '')
}
