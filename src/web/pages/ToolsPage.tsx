/**
 * Công cụ — giữ logic mobile, bọc khung web.
 */
import { ToolsPage } from '@/mobile/pages/ToolsPage'

export function WebToolsPage() {
  return (
    <div className="web-page web-embed">
      <div className="web-ph">
        <h2>Công cụ</h2>
      </div>
      <ToolsPage />
    </div>
  )
}
