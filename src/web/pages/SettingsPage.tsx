import { WebSettingsPage as CoreWebSettingsPage } from './SettingsPageCore'
import { LanPrintAgentConfig } from '@/shared/LanPrintAgentConfig'

export function WebSettingsPage() {
  return (
    <>
      <CoreWebSettingsPage />
      <LanPrintAgentConfig />
    </>
  )
}
