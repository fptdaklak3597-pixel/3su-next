export * from './db-core'

import {
  dbx,
  exportBackup as exportBackupCore,
  getMeta,
  restoreBackup as restoreBackupCore,
  setCurrentUser as setCurrentUserCore,
  type BackupData as CoreBackupData,
} from './db-core'
import { forgetRecentlyVerifiedUser } from './domain/authTicket'
import type { User } from './types'

export type BackupCredentialPolicy = 'excluded' | 'staff-only' | 'legacy'

export interface BackupData extends CoreBackupData {
  /**
   * excluded: file/auto backup, không chứa bảng user.
   * staff-only: cloud snapshot, verifier owner/admin bị xóa.
   * legacy/undefined: file cũ; importer luôn strip credential trước local restore.
   */
  credentialPolicy?: BackupCredentialPolicy
}

export interface ExportBackupOptions {
  credentialPolicy?: Exclude<BackupCredentialPolicy, 'legacy'>
}

export interface RestoreBackupOptions {
  /** Snapshot thay hồ sơ user; local-file giữ user hiện có trên thiết bị. */
  userMode?: 'snapshot' | 'preserve-local'
}

const LOCAL_RESTORE_RESET_KEYS = [
  'currentUser',
  'cloud:shopId',
  'cloud:role',
  'cloud:uid',
  'cloud:license',
  'sync:lastSeq',
  'sync:lastSnapshotAt',
  'sync:lastSnapshotSeq',
  'sync:poisoned',
  'sync:blocked',
  'sync:appliedGcBeforeMs',
  'device:cloudAt',
]

function privileged(user: User): boolean {
  return user.role === 'owner' || user.role === 'admin'
}

/** Logout hoặc đổi user phải hủy vé đổi mật khẩu của lần login trước. */
export async function setCurrentUser(u: User | null): Promise<void> {
  forgetRecentlyVerifiedUser()
  await setCurrentUserCore(u)
}

/**
 * Owner/admin không nhận hash từ máy khác. Giữ verifier local nếu cùng id.
 */
export function retainLocalPrivilegedVerifier(incoming: User, local?: User | null): User {
  if (!privileged(incoming)) return { ...incoming }
  if (local && local.id === incoming.id && privileged(local) && local.passwordHash && local.salt) {
    return {
      ...incoming,
      passwordHash: local.passwordHash,
      salt: local.salt,
      passwordNeedsReset: local.passwordNeedsReset ?? false,
    }
  }
  return {
    ...incoming,
    passwordHash: '',
    salt: '',
    passwordNeedsReset: true,
  }
}

/** Hồ sơ snapshot không bao giờ mang verifier owner/admin sang thiết bị khác. */
export function userForSnapshot(user: User): User {
  if (!privileged(user)) return { ...user }
  return {
    ...user,
    passwordHash: '',
    salt: '',
    passwordNeedsReset: true,
  }
}

/** File local và auto-backup không được chứa bất kỳ user/password verifier nào. */
export function stripBackupCredentials(data: CoreBackupData | BackupData): BackupData {
  const { users: _users, ...safe } = data
  return {
    ...safe,
    version: Math.max(6, Number.isFinite(data.version) ? data.version : 0),
    credentialPolicy: 'excluded',
    users: undefined,
  }
}

/**
 * Khi snapshot nhận hồ sơ privileged đã redaction, giữ verifier local chỉ nếu
 * cùng stable user ID và cả hai record đều là privileged. Máy mới vẫn nhận hồ
 * sơ bị khóa, không nhận hash từ cloud.
 */
export function mergeSnapshotUsers(localUsers: User[], incomingUsers: User[]): User[] {
  const localById = new Map(localUsers.map((user) => [user.id, user]))
  return incomingUsers.map((incoming) => retainLocalPrivilegedVerifier(incoming, localById.get(incoming.id)))
}

/**
 * Mặc định xuất file an toàn. Cloud snapshot phải yêu cầu staff-only rõ ràng.
 */
export async function exportBackup(options: ExportBackupOptions = {}): Promise<BackupData> {
  const raw = await exportBackupCore()
  const policy = options.credentialPolicy ?? 'excluded'
  if (policy === 'excluded') return stripBackupCredentials(raw)
  return {
    ...raw,
    version: Math.max(6, Number.isFinite(raw.version) ? raw.version : 0),
    credentialPolicy: 'staff-only',
    users: (raw.users ?? []).map(userForSnapshot),
  }
}

/**
 * Restore nền snapshot: thay hồ sơ user nhưng không ghi đè verifier privileged
 * đã được đặt riêng trên chính thiết bị này. Local-file dùng preserve-local.
 */
export async function restoreBackup(
  data: BackupData,
  options: RestoreBackupOptions = {},
): Promise<void> {
  const userMode = options.userMode ?? 'snapshot'
  const localUsers = await dbx.users.toArray()
  const incoming = Array.isArray(data.users) ? data.users : []
  const users = userMode === 'preserve-local'
    ? localUsers
    : mergeSnapshotUsers(localUsers, incoming)
  await restoreBackupCore({ ...data, users })
}

/**
 * Khôi phục file local là nhánh dữ liệu mới nhưng không phải cơ chế chuyển tài
 * khoản. Mọi credential trong file legacy bị bỏ; user hiện có trên máy được giữ.
 */
export async function restoreLocalBackup(data: BackupData): Promise<void> {
  const previousShopId = await getMeta<string | null>('cloud:shopId', null)
  try {
    const { disconnectTransport } = await import('./sync/engine')
    disconnectTransport()
  } catch {
    /* Meta cloud:paused bên dưới vẫn khóa sync nếu transport đã lỗi. */
  }

  const safe = stripBackupCredentials(data)
  await restoreBackup(safe, { userMode: 'preserve-local' })
  await dbx.transaction(
    'rw',
    [
      dbx.syncQueue,
      dbx.appliedOps,
      dbx.meta,
      dbx.commandQueue,
      dbx.commandResults,
      dbx.canonicalEvents,
      dbx.syncConflicts,
    ],
    async () => {
    await dbx.syncQueue.clear()
    await dbx.appliedOps.clear()
    await dbx.commandQueue.clear()
    await dbx.commandResults.clear()
    await dbx.canonicalEvents.clear()
    await dbx.syncConflicts.clear()
    await dbx.meta.bulkDelete(LOCAL_RESTORE_RESET_KEYS)
    await dbx.meta.put({ key: 'cloud:paused', value: true })
    await dbx.meta.put({
      key: 'restore:last',
      value: {
        at: Date.now(),
        credentialPolicy: 'excluded',
        sourceShopId: data.sourceShopId ?? null,
        detachedFromShopId: previousShopId,
      },
    })
  })
}
