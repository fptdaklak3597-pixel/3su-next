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

function sessionUserId(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' ? id : ''
}

async function currentActorInTransaction(): Promise<User | null> {
  const session = await dbx.meta.get('currentUser')
  const id = sessionUserId(session?.value)
  if (!id) return null
  const user = await dbx.users.get(id)
  return user && !user.deleted && user.active ? user : null
}

/** Đọc actor hiện hành từ record mới nhất, không tin object session đã cache. */
export async function getCurrentActor(): Promise<User | null> {
  return dbx.transaction('r', [dbx.users, dbx.meta], currentActorInTransaction)
}

/** Guard dùng cho command ngoài auth. DB hoàn toàn trống được phép bootstrap ban đầu. */
export async function requirePermission(
  permission: keyof UserPerms,
  opts: { allowEmptyStore?: boolean } = { allowEmptyStore: true },
): Promise<User | null> {
  return dbx.transaction('r', [dbx.users, dbx.meta], async () => {
    if (opts.allowEmptyStore !== false && await dbx.users.count() === 0) return null
    const actor = await currentActorInTransaction()
    if (!actor || !hasPerm(actor, permission)) throw new Error('Bạn không có quyền thực hiện thao tác này')
    return actor
  })
}

async function requireUserManagerInTransaction(): Promise<User> {
  const actor = await currentActorInTransaction()
  if (!actor || !hasPerm(actor, 'users')) throw new Error('Bạn không có quyền quản lý người dùng')
  return actor
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
  return persistNewUser(u, input.role === 'owner')
}

let recentlyVerifiedUserId = ''

export async function login(username: string, password: string): Promise<User> {
  const clean = username.trim().toLowerCase()
  const u = await dbx.users.where('username').equals(clean)
    .filter((row) => !row.deleted && row.active)
    .first()
  if (!u) throw new Error('Sai tên đăng nhập hoặc mật khẩu')
  const ok = await verifyPassword(password, u.salt, u.passwordHash)
  if (!ok) throw new Error('Sai tên đăng nhập hoặc mật khẩu')
  recentlyVerifiedUserId = u.id
  return u
}

export async function changePassword(userId: string, newPassword: string): Promise<void> {
  if (!newPassword || newPassword.length < 4) throw new Error('Mật khẩu tối thiểu 4 ký tự')
  const salt = genSalt()
  const passwordHash = await hashPassword(newPassword, salt)
  const updatedAt = Date.now()
  await dbx.transaction('rw', [dbx.users, dbx.meta, dbx.syncQueue, dbx.appliedOps], async () => {
    const cur = await dbx.users.get(userId)
    if (!cur || cur.deleted || !cur.active) throw new Error('Không tìm thấy tài khoản đang hoạt động')
    const actor = await currentActorInTransaction()
    const verifiedSelf = recentlyVerifiedUserId === userId
    const signedInSelf = actor?.id === userId
    if (!verifiedSelf && !signedInSelf) {
      if (!actor || !hasPerm(actor, 'users')) throw new Error('Bạn không có quyền đổi mật khẩu tài khoản này')
      if (cur.role === 'owner' && actor.role !== 'owner') throw new Error('Chỉ chủ cửa hàng được đổi mật khẩu chủ cửa hàng')
    }
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
  if (recentlyVerifiedUserId === userId) recentlyVerifiedUserId = ''
  requestFlush()
}

export async function updateUser(
  userId: string,
  patch: { name?: string; role?: UserRole; perms?: UserPerms; active?: boolean },
): Promise<void> {
  await dbx.transaction('rw', [dbx.users, dbx.meta, dbx.syncQueue, dbx.appliedOps], async () => {
    const actor = await requireUserManagerInTransaction()
    const cur = await dbx.users.get(userId)
    if (!cur || cur.deleted) throw new Error('Không tìm thấy tài khoản')
    if (patch.role === 'owner' && cur.role !== 'owner') throw new Error('Không thể cấp vai trò chủ cửa hàng')
    if (cur.role === 'owner') {
      if (actor.role !== 'owner') throw new Error('Chỉ chủ cửa hàng được thay đổi tài khoản chủ cửa hàng')
      if (patch.role && patch.role !== 'owner') throw new Error('Không thể hạ vai trò chủ cửa hàng')
      if (patch.active === false) throw new Error('Không thể khóa tài khoản chủ cửa hàng')
    }
    if (actor.id === cur.id && patch.active === false) throw new Error('Không thể tự khóa tài khoản đang dùng')

    const next: User = { ...cur }
    if (patch.name !== undefined) next.name = patch.name.trim() || next.name
    if (patch.role !== undefined) next.role = patch.role
    if (patch.perms !== undefined) next.perms = patch.perms
    if (patch.active !== undefined) next.active = patch.active
    next.updatedAt = Date.now()

    const op = makeOp('user.upsert', null)
    next.hlc = op.hlc
    op.payload = { user: next }
    await dbx.users.put(next)
    await persistOp(op)
  })
  requestFlush()
}

export async function deleteUser(userId: string): Promise<void> {
  await dbx.transaction('rw', [dbx.users, dbx.meta, dbx.syncQueue, dbx.appliedOps], async () => {
    const actor = await requireUserManagerInTransaction()
    const cur = await dbx.users.get(userId)
    if (!cur || cur.deleted) throw new Error('Không tìm thấy tài khoản')
    if (cur.role === 'owner') throw new Error('Không thể xóa tài khoản chủ cửa hàng')
    if (actor.id === userId) throw new Error('Không thể tự xóa tài khoản đang dùng')
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

async function persistNewUser(u: User, ownerBootstrap: boolean): Promise<User> {
  let saved = u
  await dbx.transaction('rw', [dbx.users, dbx.meta, dbx.syncQueue, dbx.appliedOps], async () => {
    if (ownerBootstrap) {
      if (await dbx.users.count() > 0) throw new Error('Chủ cửa hàng chỉ được tạo khi thiết bị chưa có tài khoản')
    } else {
      await requireUserManagerInTransaction()
    }
    const existing = await dbx.users.where('username').equals(u.username).first()
    if (existing) throw new Error('Tên đăng nhập đã tồn tại')
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
  return all.filter((u) => !u.deleted && u.active).length
}
