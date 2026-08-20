/**
 * 3SU Next — Người dùng, đăng nhập & phân quyền
 *
 * Mật khẩu mới dùng PBKDF2-SHA-256 có version. Hash legacy vẫn đăng nhập được
 * và tự nâng cấp sau lần xác thực thành công. Verifier owner/admin chỉ tồn tại
 * trên thiết bị đặt mật khẩu, không được phát sang máy nhân viên.
 */
import { dbx } from '../db'
import { uid } from '../format'
import { makeOp, persistOp, requestFlush } from '../sync/engine'
import type { User, UserRole, UserPerms } from '../types'

/* ─── Hash mật khẩu ─── */

const KDF_NAME = 'pbkdf2-sha256'
const KDF_ITERATIONS = import.meta.env.MODE === 'test' ? 2_000 : 210_000
const LOGIN_WINDOW_MS = 15 * 60_000
const LOGIN_LOCK_AFTER = 5
const LOGIN_BASE_LOCK_MS = 30_000
const LOGIN_MAX_LOCK_MS = 15 * 60_000
const LOGIN_META_PREFIX = 'auth:login:'

interface LoginAttemptState {
  failures: number
  lastFailedAt: number
  lockedUntil: number
}

function requireWebCrypto(): SubtleCrypto {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Thiết bị không hỗ trợ mã hóa mật khẩu an toàn')
  }
  return crypto.subtle
}

function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) throw new Error('Salt không hợp lệ')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** Chỉ dùng để xác minh hash FNV legacy 32-hex; không bao giờ tạo verifier mới. */
function legacyFallbackHash(input: string): string {
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
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('Thiết bị không có bộ sinh số ngẫu nhiên an toàn')
  }
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return bufToHex(arr.buffer)
}

async function derivePbkdf2(password: string, salt: string, iterations: number): Promise<string> {
  if (!Number.isSafeInteger(iterations) || iterations < 1_000 || iterations > 2_000_000) {
    throw new Error('Tham số mã hóa mật khẩu không hợp lệ')
  }
  const subtle = requireWebCrypto()
  const key = await subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )
  const bits = await subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: hexToBytes(salt),
    iterations,
  }, key, 256)
  return bufToHex(bits)
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const digest = await derivePbkdf2(password, salt, KDF_ITERATIONS)
  return `${KDF_NAME}$${KDF_ITERATIONS}$${digest}`
}

/** So sánh hằng thời tương đối, kể cả chuỗi khác độ dài. */
export function safeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

function parsePbkdf2(hash: string): { iterations: number; digest: string } | null {
  const match = /^pbkdf2-sha256\$(\d+)\$([0-9a-f]{64})$/i.exec(hash)
  if (!match) return null
  return { iterations: Number(match[1]), digest: match[2]!.toLowerCase() }
}

async function legacySha256(password: string, salt: string): Promise<string> {
  const subtle = requireWebCrypto()
  const data = new TextEncoder().encode(salt + ':' + password)
  return bufToHex(await subtle.digest('SHA-256', data))
}

export async function verifyPassword(password: string, salt: string, hash: string): Promise<boolean> {
  if (!password || !salt || !hash) return false
  const parsed = parsePbkdf2(hash)
  if (parsed) {
    try {
      return safeEqual(await derivePbkdf2(password, salt, parsed.iterations), parsed.digest)
    } catch {
      return false
    }
  }
  // SHA-256 legacy = 64 hex. FNV fallback legacy = 32 hex.
  if (/^[0-9a-f]{64}$/i.test(hash)) {
    try { return safeEqual(await legacySha256(password, salt), hash.toLowerCase()) } catch { return false }
  }
  if (/^[0-9a-f]{32}$/i.test(hash)) {
    return safeEqual(legacyFallbackHash(salt + ':' + password), hash.toLowerCase())
  }
  return false
}

export function passwordHashNeedsUpgrade(hash: string): boolean {
  const parsed = parsePbkdf2(hash)
  return !parsed || parsed.iterations !== KDF_ITERATIONS
}

export function minimumPasswordLength(role: UserRole): number {
  return role === 'staff' ? 6 : 8
}

export function passwordPolicyMessage(role: UserRole): string {
  return role === 'staff'
    ? 'PIN/mật khẩu nhân viên tối thiểu 6 ký tự'
    : 'Mật khẩu chủ/quản trị tối thiểu 8 ký tự'
}

export function passwordMeetsPolicy(password: string, role: UserRole): boolean {
  return typeof password === 'string'
    && password.length >= minimumPasswordLength(role)
    && password.length <= 128
    && password.trim().length > 0
}

function validatePassword(password: string, role: UserRole): void {
  if (!passwordMeetsPolicy(password, role)) throw new Error(passwordPolicyMessage(role))
}

function isPrivilegedRole(role: UserRole): boolean {
  return role === 'owner' || role === 'admin'
}

/** Payload hồ sơ gửi cloud: máy khác không bao giờ nhận verifier owner/admin. */
export function userForSync(user: User): User {
  if (!isPrivilegedRole(user.role)) return { ...user }
  return {
    ...user,
    passwordHash: '',
    salt: '',
    passwordNeedsReset: true,
  }
}

function passwordPayloadForSync(user: User): Record<string, unknown> {
  if (isPrivilegedRole(user.role)) {
    return {
      userId: user.id,
      clearVerifier: true,
      passwordNeedsReset: true,
      updatedAt: user.updatedAt,
    }
  }
  return {
    userId: user.id,
    passwordHash: user.passwordHash,
    salt: user.salt,
    passwordNeedsReset: user.passwordNeedsReset ?? false,
    updatedAt: user.updatedAt,
  }
}

function loginMetaKey(username: string): string {
  return LOGIN_META_PREFIX + encodeURIComponent(username).slice(0, 128)
}

function readAttempt(value: unknown): LoginAttemptState {
  if (!value || typeof value !== 'object') return { failures: 0, lastFailedAt: 0, lockedUntil: 0 }
  const row = value as Partial<LoginAttemptState>
  return {
    failures: Number.isSafeInteger(row.failures) && (row.failures ?? 0) > 0 ? row.failures! : 0,
    lastFailedAt: Number.isFinite(row.lastFailedAt) ? Math.max(0, row.lastFailedAt ?? 0) : 0,
    lockedUntil: Number.isFinite(row.lockedUntil) ? Math.max(0, row.lockedUntil ?? 0) : 0,
  }
}

export async function getLoginAttemptState(username: string): Promise<LoginAttemptState> {
  const row = await dbx.meta.get(loginMetaKey(username.trim().toLowerCase()))
  return readAttempt(row?.value)
}

async function assertLoginAllowed(username: string, now = Date.now()): Promise<void> {
  const state = await getLoginAttemptState(username)
  if (state.lockedUntil > now) {
    throw new Error(`Đăng nhập tạm khóa. Thử lại sau ${Math.max(1, Math.ceil((state.lockedUntil - now) / 1000))} giây`)
  }
}

async function recordLoginFailure(username: string, now = Date.now()): Promise<void> {
  const key = loginMetaKey(username)
  await dbx.transaction('rw', dbx.meta, async () => {
    const previous = readAttempt((await dbx.meta.get(key))?.value)
    const stale = now - previous.lastFailedAt > LOGIN_WINDOW_MS
    const failures = (stale ? 0 : previous.failures) + 1
    let lockedUntil = 0
    if (failures >= LOGIN_LOCK_AFTER) {
      const duration = Math.min(LOGIN_MAX_LOCK_MS, LOGIN_BASE_LOCK_MS * (2 ** Math.min(8, failures - LOGIN_LOCK_AFTER)))
      lockedUntil = now + duration
    }
    await dbx.meta.put({ key, value: { failures, lastFailedAt: now, lockedUntil } satisfies LoginAttemptState })
  })
}

async function clearLoginFailures(username: string): Promise<void> {
  await dbx.meta.delete(loginMetaKey(username))
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
  validatePassword(input.password, input.role)
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

async function refreshCredentialAfterLogin(user: User, password: string): Promise<User> {
  const needsUpgrade = passwordHashNeedsUpgrade(user.passwordHash)
  const weakPassword = !passwordMeetsPolicy(password, user.role)
  const needsReset = !!user.passwordNeedsReset || weakPassword
  if (!needsUpgrade && needsReset === !!user.passwordNeedsReset) return user

  const salt = needsUpgrade ? genSalt() : user.salt
  const passwordHash = needsUpgrade ? await hashPassword(password, salt) : user.passwordHash
  let saved: User = { ...user, salt, passwordHash, passwordNeedsReset: needsReset }
  await dbx.transaction('rw', [dbx.users, dbx.meta, dbx.syncQueue, dbx.appliedOps], async () => {
    const cur = await dbx.users.get(user.id)
    if (!cur || cur.deleted || !cur.active) throw new Error('Tài khoản không còn hoạt động')
    // Không ghi đè khi credential đã được đổi trong lúc PBKDF2 đang chạy.
    if (cur.passwordHash !== user.passwordHash || cur.salt !== user.salt) {
      saved = cur
      return
    }
    const op = makeOp(needsUpgrade ? 'user.password' : 'user.upsert', null)
    saved = {
      ...cur,
      salt,
      passwordHash,
      passwordNeedsReset: needsReset,
      updatedAt: Date.now(),
      hlc: op.hlc,
    }
    op.payload = needsUpgrade
      ? passwordPayloadForSync(saved)
      : { user: userForSync(saved) }
    await dbx.users.put(saved)
    await persistOp(op)
  })
  requestFlush()
  return saved
}

export async function login(username: string, password: string): Promise<User> {
  const clean = username.trim().toLowerCase()
  await assertLoginAllowed(clean)
  const u = await dbx.users.where('username').equals(clean)
    .filter((row) => !row.deleted && row.active)
    .first()
  if (!u || !await verifyPassword(password, u.salt, u.passwordHash)) {
    await recordLoginFailure(clean)
    throw new Error('Sai tên đăng nhập hoặc mật khẩu')
  }
  await clearLoginFailures(clean)
  let refreshed = u
  try { refreshed = await refreshCredentialAfterLogin(u, password) } catch { /* đăng nhập vẫn hợp lệ; lần sau thử nâng lại */ }
  recentlyVerifiedUserId = refreshed.id
  return refreshed
}

export async function changePassword(userId: string, newPassword: string): Promise<void> {
  const initial = await dbx.users.get(userId)
  if (!initial || initial.deleted || !initial.active) throw new Error('Không tìm thấy tài khoản đang hoạt động')
  validatePassword(newPassword, initial.role)
  const salt = genSalt()
  const passwordHash = await hashPassword(newPassword, salt)
  const updatedAt = Date.now()
  await dbx.transaction('rw', [dbx.users, dbx.meta, dbx.syncQueue, dbx.appliedOps], async () => {
    const cur = await dbx.users.get(userId)
    if (!cur || cur.deleted || !cur.active) throw new Error('Không tìm thấy tài khoản đang hoạt động')
    validatePassword(newPassword, cur.role)
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
    op.payload = passwordPayloadForSync(next)
    await dbx.users.put(next)
    if (actor?.id === userId) await dbx.meta.put({ key: 'currentUser', value: next.id })
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
    op.payload = { user: userForSync(next) }
    await dbx.users.put(next)
    if (actor.id === userId) await dbx.meta.put({ key: 'currentUser', value: next.id })
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
    op.payload = { user: userForSync(saved) }
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
