/**
 * Công cụ — giữ logic mobile, bọc khung web.
 */
import { ToolsPage } from '@/mobile/pages/ToolsPage'

export function WebToolsPage() {
  return (
    <div className="web-page web-embed">
      <ToolsPage embedded />
    </div>
  )
}
