import { SettingsPage as CoreSettingsPage } from './SettingsPageCore'
import { LanPrintAgentConfig } from '@/shared/LanPrintAgentConfig'

export function SettingsPage() {
  return (
    <>
      <CoreSettingsPage />
      <LanPrintAgentConfig />
    </>
  )
}
