/**
 * 3SU Next — Người dùng, đăng nhập & phân quyền
 * Port nghiệp vụ từ 50-auth-cloud-ai.js (users/auth/perms).
 *
 * Bảo mật: mật khẩu KHÔNG lưu plain text — lưu SHA-256(salt + password).
 * Local-first: tài khoản lưu trên máy; cloud auth (tuỳ chọn) đồng bộ sau.
 */
import { dbx } from '../db'
import { uid } from '../format'
import { makeOp, persistOp, requestFlush } from '../sync/engine'
import type { User, UserRole, UserPerms } from '../types'

/* ─── Hash mật khẩu ─── */

function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** FNV-1a 32-bit × 4 vòng — chỉ dùng khi thiếu Web Crypto (môi trường không HTTPS). */
function fallbackHash(input: string): string {
  let out = ''
  for (let round = 0; round < 4; round++) {
    let h = 0x811c9dc5 ^ round
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    out += (h >>> 0).toString(16).padStart(8, '0')
  }
  return out
}

export function genSalt(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint8Array(16)
    crypto.getRandomValues(arr)
    return bufToHex(arr.buffer)
  }
  return fallbackHash(String(Math.random()) + Date.now()).slice(0, 32)
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const input = salt + ':' + password
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const data = new TextEncoder().encode(input)
      const digest = await crypto.subtle.digest('SHA-256', data)
      return bufToHex(digest)
    } catch {
      /* rơi xuống fallback */
    }
  }
  return fallbackHash(input)
}

/** So sánh chuỗi an toàn (hằng thời, tránh timing attack). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifyPassword(password: string, salt: string, hash: string): Promise<boolean> {
  const h = await hashPassword(password, salt)
  return safeEqual(h, hash)
}

/* ─── Phân quyền ─── */
export const PERM_LIST: { k: keyof UserPerms; l: string }[] = [
  { k: 'sell', l: 'Bán hàng' },
  { k: 'inventory', l: 'Quản lý kho' },
  { k: 'reports', l: 'Xem báo cáo' },
  { k: 'settings', l: 'Cài đặt cửa hàng' },
  { k: 'suppliers', l: 'Nhà cung cấp & công nợ' },
  { k: 'invoices', l: 'Hóa đơn' },
  { k: 'users', l: 'Quản lý người dùng' },
]

/** owner/admin có toàn quyền; staff theo perms. */
export function hasPerm(user: User | null | undefined, key: keyof UserPerms): boolean {
  if (!user) return false
  if (user.role === 'owner' || user.role === 'admin') return true
  if (user.perms?.all) return true
  return !!user.perms?.[key]
}

export const ROLE_LABEL: Record<UserRole, string> = {
  owner: 'Chủ cửa hàng',
  admin: 'Quản trị',
  staff: 'Nhân viên',
}

/* ─── Quản lý tài khoản ─── */
export interface NewUserInput {
  username: string
  name: string
  password: string
  role: UserRole
  perms?: UserPerms
}

export async function createUser(input: NewUserInput): Promise<User> {
  const username = input.username.trim().toLowerCase()
  if (!username) throw new Error('Cần tên đăng nhập')
  if (!input.password || input.password.length < 4) throw new Error('Mật khẩu tối thiểu 4 ký tự')
  const existing = await dbx.users.where('username').equals(username).first()
  if (existing && !existing.deleted) throw new Error('Tên đăng nhập đã tồn tại')
  const salt = genSalt()
  const now = Date.now()
  const u: User = {
    id: uid('u'),
    username,
    name: input.name.trim() || username,
    email: '',
    role: input.role,
    passwordHash: await hashPassword(input.password, salt),
    salt,
    passwordNeedsReset: input.role === 'staff',
    perms: input.perms ?? (input.role === 'staff' ? {} : { all: true }),
    active: true,
    createdAt: now,
    updatedAt: now,
  }
  return persistUserUpsert(u)
}

export async function login(username: string, password: string): Promise<User> {
  const u = await dbx.users.where('username').equals(username.trim().toLowerCase()).first()
  if (!u || u.deleted || !u.active) throw new Error('Sai tên đăng nhập hoặc mật khẩu')
  const ok = await verifyPassword(password, u.salt, u.passwordHash)
  if (!ok) throw new Error('Sai tên đăng nhập hoặc mật khẩu')
  return u
}

export async function changePassword(userId: string, newPassword: string): Promise<void> {
  const u = await dbx.users.get(userId)
  if (!u) return
  if (!newPassword || newPassword.length < 4) throw new Error('Mật khẩu tối thiểu 4 ký tự')
  const salt = genSalt()
  const passwordHash = await hashPassword(newPassword, salt)
  const updatedAt = Date.now()
  await dbx.transaction('rw', [dbx.users, dbx.syncQueue, dbx.appliedOps], async () => {
    const cur = await dbx.users.get(userId)
    if (!cur) return
    const op = makeOp('user.password', null)
    const next: User = {
      ...cur,
      salt,
      passwordHash,
      passwordNeedsReset: false,
      updatedAt,
      hlc: op.hlc,
    }
    op.payload = {
      userId,
      passwordHash,
      salt,
      passwordNeedsReset: false,
      updatedAt,
    }
    await dbx.users.put(next)
    await persistOp(op)
  })
  requestFlush()
}

export async function updateUser(
  userId: string,
  patch: { name?: string; role?: UserRole; perms?: UserPerms; active?: boolean },
): Promise<void> {
  const u = await dbx.users.get(userId)
  if (!u) return
  if (patch.name !== undefined) u.name = patch.name.trim() || u.name
  if (patch.role !== undefined) u.role = patch.role
  if (patch.perms !== undefined) u.perms = patch.perms
  if (patch.active !== undefined) u.active = patch.active
  u.updatedAt = Date.now()
  await persistUserUpsert(u)
}

export async function deleteUser(userId: string): Promise<void> {
  const u = await dbx.users.get(userId)
  if (!u) return
  await dbx.transaction('rw', [dbx.users, dbx.syncQueue, dbx.appliedOps], async () => {
    const cur = await dbx.users.get(userId)
    if (!cur) return
    const op = makeOp('user.delete', { userId })
    await dbx.users.put({
      ...cur,
      deleted: true,
      active: false,
      updatedAt: Date.now(),
      hlc: op.hlc,
    })
    await persistOp(op)
  })
  requestFlush()
}

async function persistUserUpsert(u: User): Promise<User> {
  let saved = u
  await dbx.transaction('rw', [dbx.users, dbx.syncQueue, dbx.appliedOps], async () => {
    const op = makeOp('user.upsert', null)
    saved = { ...u, hlc: op.hlc }
    op.payload = { user: saved }
    await dbx.users.put(saved)
    await persistOp(op)
  })
  requestFlush()
  return saved
}

/** Số tài khoản đang hoạt động (chưa xóa). */
export async function countActiveUsers(): Promise<number> {
  const all = await dbx.users.toArray()
  return all.filter((u) => !u.deleted).length
}
