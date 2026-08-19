import { hasPerm } from './auth'
import type { User, UserPerms } from '../types'

/**
 * Policy dùng chung cho route/menu.
 * - DB chưa từng có user: cho phép bootstrap lần đầu.
 * - Dev preview: chỉ dùng khi import.meta.env.DEV ở caller.
 * - Các trường hợp còn lại bắt buộc user hiện tại có quyền.
 */
export function canAccessFeature(
  user: User | null | undefined,
  permission: keyof UserPerms,
  userRecordCount: number,
  devPreview = false,
): boolean {
  if (devPreview || userRecordCount === 0) return true
  return hasPerm(user, permission)
}
