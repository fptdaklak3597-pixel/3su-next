/**
 * 3SU Next — kiểu dữ liệu seed (payload nằm ở /seed-500.json để khỏi nhồi bundle chính).
 */
export interface SeedItem {
  name: string
  price: number
  cost: number
  unit: string
  cat: string
  emoji: string
}
