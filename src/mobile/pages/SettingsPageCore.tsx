/**
 * 3SU Next — Cài đặt (Settings)
 * Port từ 19a-settings.js: thông tin shop, vận hành, giao diện, máy in,
 * QR chuyển khoản, sao lưu / khôi phục, cài app.
 */
import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '@/core/store'
import { exportBackup, getSettings, restoreLocalBackup, wipeAll, setCurrentUser, type BackupData } from '@/core/db'
import {
  getAutoBackups,
  parseRestoreFile,
  getLastFileBackupAt,
  markFileBackupExported,
  shouldRemindExport,
  exportRemindDays,
} from '@/core/domain/trial'
import { payQrSrc } from '@/core/domain/vietqr'
import { saveSettingsSynced, saveShopSynced } from '@/core/domain/settings'
import { exportErrorLogText, logError } from '@/core/errorLogger'
import { useInstallPrompt, useDisplayMode } from '@/shared/pwa'
import { ConfirmDialog } from '@/shared/components'
import { SyncDiagnosticsPanel } from '@/shared/SyncDiagnosticsPanel'
import { AiSettingsPanel } from '@/shared/AiSettingsPanel'
import { ROLE_LABEL } from '@/core/domain/auth'
import {
  Store, SlidersHorizontal, Palette, Printer, QrCode,
  Download, Upload, Trash2, Smartphone, RefreshCw, LogOut, UserCircle2, Cloud,
} from 'lucide-react'
import { dispatchTestPrint, printResultToast } from '@/core/browser/printQueue'
import { PrintStatusLine } from '@/shared/PrintStatus'
import type { Settings } from '@/core/types'

export function SettingsPage() {
  const navigate = useNavigate()
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const shop = useApp((s) => s.shop)
  const setShop = useApp((s) => s.setShop)
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)
  const showToast = useApp((s) => s.showToast)
  const sync = useApp((s) => s.sync)
  const user = useApp((s) => s.user)
  const setUser = useApp((s) => s.setUser)

  const { canInstall, installed, promptInstall } = useInstallPrompt()
  const displayMode = useDisplayMode()
  const fileRef = useRef<HTMLInputElement>(null)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState<BackupData | null>(null)
  const [autoBackups, setAutoBackups] = useState<Awaited<ReturnType<typeof getAutoBackups>>>([])
  const [lastFileBackupAt, setLastFileBackupAt] = useState<number | null>(null)

  useEffect(() => {
    void getAutoBackups().then(setAutoBackups)
    void getLastFileBackupAt().then(setLastFileBackupAt)
  }, [])

  async function patchSettings(patch: Partial<Settings>) {
    const next = { ...settings, ...patch }
    setSettings(next)
    try {
      await saveSettingsSynced(next)
    } catch (e) {
      const fresh = await getSettings()
      setSettings(fresh)
      logError(e, 'settings.save')
      showToast('Không lưu được cài đặt', 'bad')
    }
  }
  async function patchPrinter(patch: Partial<Settings['printer']>) {
    await patchSettings({ printer: { ...settings.printer, ...patch } })
  }

  async function handleSaveShop(name: string, phone: string, address: string) {
    const next = { name, phone, address }
    setShop(next)
    await saveShopSynced(next)
    showToast('✓ Đã lưu thông tin shop', 'ok')
  }

  async function handleExport() {
    try {
      const data = await exportBackup()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `3su-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      await markFileBackupExported()
      setLastFileBackupAt(Date.now())
      showToast('✓ Đã xuất sao lưu', 'ok')
    } catch (e) {
      logError(e, 'backup.export')
      showToast('Lỗi khi sao lưu', 'bad')
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        setConfirmRestore(parseRestoreFile(String(reader.result)))
      } catch (err) {
        logError(err, 'backup.parse')
        showToast('File sao lưu không hợp lệ', 'bad')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  async function handleRestore() {
    if (!confirmRestore) return
    try {
      await restoreLocalBackup(confirmRestore)
      showToast('✓ Đã khôi phục dữ liệu', 'ok')
      setTimeout(() => window.location.reload(), 800)
    } catch (e) {
      logError(e, 'backup.restore')
      showToast('Lỗi khi khôi phục', 'bad')
    } finally {
      setConfirmRestore(null)
    }
  }

  async function handleWipe() {
    try {
      await wipeAll()
      showToast('Đã xóa toàn bộ dữ liệu', 'ok')
      setTimeout(() => window.location.reload(), 800)
    } catch (e) {
      logError(e, 'backup.wipe')
      showToast('Lỗi khi xóa', 'bad')
    }
  }

  const isStandalone = displayMode === 'standalone' || installed

  async function handleLogout() {
    await setCurrentUser(null)
    setUser(null)
    showToast('Đã đăng xuất', 'ok')
    navigate('/')
  }

  return (
    <div className="flex flex-col h-full">
      <header className="app-hdr bordered">
        <div>
          <div className="font-brand text-[17px] font-medium" style={{ color: 'var(--ink)' }}>Cài đặt</div>
          <div className="text-[11px]" style={{ color: 'var(--mute)' }}>
            Đồng bộ: {sync.status === 'ok' ? '✓' : sync.status === 'syncing' ? 'đang sync…' : sync.status}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-10 max-w-[520px] mx-auto w-full">
        {/* Cài app */}
        {!isStandalone && (
          <button className="card w-full p-4 mt-4 flex items-center gap-3 text-left" onClick={() => void promptInstall()}>
            <Smartphone size={20} style={{ color: 'var(--gold)' }} />
            <div className="flex-1">
              <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Cài đặt ứng dụng</div>
              <div className="text-[11.5px]" style={{ color: 'var(--mute)' }}>
                {canInstall ? 'Chạm để cài lên màn hình chính' : 'Mở bằng Chrome/Safari để cài đặt'}
              </div>
            </div>
          </button>
        )}

        {/* Tài khoản */}
        {user && (
          <Section icon={<UserCircle2 size={15} />} title="Tài khoản">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-base font-brand font-medium" style={{ background: 'var(--paper-2)', color: 'var(--ink-2)' }}>
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{user.name}</div>
                <div className="text-[11px]" style={{ color: 'var(--mute)' }}>@{user.username} · {ROLE_LABEL[user.role]}</div>
              </div>
            </div>
            <button className="btn-ghost flex items-center justify-center gap-2" onClick={() => navigate('/nguoi-dung')}>Quản lý người dùng</button>
            <button className="btn-ghost flex items-center justify-center gap-2 mt-2" style={{ color: 'var(--down)' }} onClick={handleLogout}>
              <LogOut size={15} /> Đăng xuất
            </button>
          </Section>
        )}

        {/* Thông tin shop */}
        <Section icon={<Store size={15} />} title="Thông tin cửa hàng">
          <ShopForm initial={shop} onSave={handleSaveShop} />
        </Section>

        {/* Vận hành */}
        <Section icon={<SlidersHorizontal size={15} />} title="Vận hành">
          <NumRow label="Ngưỡng tồn kho thấp" value={settings.lowStock} onChange={(v) => patchSettings({ lowStock: v })} />
          <NumRow label="Cảnh báo HSD (ngày)" value={settings.hsdWarnDays} onChange={(v) => patchSettings({ hsdWarnDays: v })} />
          <ToggleRow label="Âm thanh khi bán" on={settings.soundOn} onToggle={() => patchSettings({ soundOn: !settings.soundOn })} />
          <ToggleRow label="Hiệu ứng mừng khi bán" on={settings.celebrateOnSale} onToggle={() => patchSettings({ celebrateOnSale: !settings.celebrateOnSale })} />
          <ToggleRow label="Hiện giá vốn trong giỏ" on={settings.showCostInCart} onToggle={() => patchSettings({ showCostInCart: !settings.showCostInCart })} />
          <ToggleRow label="Không bán khi hết hàng" on={settings.allowNegativeStock === false} onToggle={() => patchSettings({ allowNegativeStock: settings.allowNegativeStock === false })} />
        </Section>

        {/* Giao diện */}
        <Section icon={<Palette size={15} />} title="Giao diện">
          <div className="grid grid-cols-3 gap-2">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <button
                key={t}
                className="py-2.5 rounded-xl text-sm font-medium transition-all"
                style={theme === t
                  ? { background: 'var(--ink)', color: 'var(--paper)' }
                  : { background: 'var(--paper-2)', color: 'var(--mute)', border: '0.5px solid var(--hair)' }}
                onClick={() => { setTheme(t); void patchSettings({ theme: t }) }}
              >
                {t === 'light' ? 'Sáng' : t === 'dark' ? 'Tối' : 'Hệ thống'}
              </button>
            ))}
          </div>
          <ToggleRow label="Chữ lớn (dễ đọc hơn)" on={settings.largeText === true} onToggle={() => patchSettings({ largeText: !settings.largeText })} />
        </Section>

        {/* QR chuyển khoản */}
        <Section icon={<QrCode size={15} />} title="QR chuyển khoản">
          <QrEditor settings={settings} onPatch={patchSettings} showToast={showToast} />
        </Section>

        {/* Máy in */}
        <Section icon={<Printer size={15} />} title="Máy in hóa đơn">
          <div className="flex gap-2 mb-3">
            {([58, 80] as const).map((w) => (
              <button
                key={w}
                className="chip flex-1 justify-center"
                style={settings.printer.width === w ? { background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' } : {}}
                onClick={() => patchPrinter({ width: w })}
              >
                Khổ {w}mm
              </button>
            ))}
          </div>
          <PrintStatusLine />
          <p className="text-[13px] mt-2 mb-3" style={{ color: 'var(--mute)', lineHeight: 1.45 }}>
            Trên máy tính mở 3SU, bấm <b>Máy in</b>, đăng nhập cùng tài khoản, đừng tắt trang đó. Bán hàng trên điện thoại sẽ in ra.
          </p>
          <ToggleRow label="In luôn trên điện thoại (khi máy tính tắt)" on={settings.printer.autoPrintAfterSale} onToggle={() => patchPrinter({ autoPrintAfterSale: !settings.printer.autoPrintAfterSale })} />
          <ToggleRow label="In tên shop trên phiếu" on={settings.printer.showLogo !== false} onToggle={() => patchPrinter({ showLogo: !settings.printer.showLogo })} />
          <label className="flex flex-col gap-1.5 mt-3">
            <span className="text-xs" style={{ color: 'var(--mute)' }}>Cỡ chữ phiếu ({settings.printer.fontSize || 12})</span>
            <input type="range" min={8} max={14} value={settings.printer.fontSize || 12} onChange={(e) => void patchPrinter({ fontSize: Number(e.target.value) })} />
          </label>
          <button
            className="btn-ghost w-full mt-3"
            onClick={async () => {
              const r = await dispatchTestPrint(shop.name, settings.printer)
              const t = printResultToast(r)
              showToast(t.text, t.kind)
            }}
          >
            In thử
          </button>
          <label className="flex flex-col gap-1.5 mt-3">
            <span className="text-xs" style={{ color: 'var(--mute)' }}>Tiêu đề hóa đơn</span>
            <input
              className="field-input text-sm"
              value={settings.printer.templateHeader}
              placeholder="PHIẾU BÁN HÀNG"
              onChange={(e) => patchPrinter({ templateHeader: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1.5 mt-3">
            <span className="text-xs" style={{ color: 'var(--mute)' }}>Lời chào cuối hóa đơn</span>
            <input
              className="field-input text-sm"
              value={settings.printer.templateFooter}
              onChange={(e) => patchPrinter({ templateFooter: e.target.value })}
            />
          </label>
        </Section>

        {/* Đồng bộ */}
        <Section icon={<Cloud size={15} />} title="Đồng bộ">
          <p className="text-xs mb-2" style={{ color: 'var(--mute)' }}>
            Op thiếu dependency sẽ hiện ở đây. Bỏ qua nếu chắc chắn không cần áp lại.
          </p>
          <SyncDiagnosticsPanel variant="mobile" />
        </Section>

        <AiSettingsPanel variant="mobile" />

        {/* Dữ liệu */}
        <Section icon={<Download size={15} />} title="Dữ liệu">
          <div className="flex flex-col gap-2">
            {shouldRemindExport(lastFileBackupAt ?? (autoBackups[0] ? Date.parse(autoBackups[0].date) : null)) && (
              <p className="text-sm" style={{ color: 'var(--bad)' }}>
                Đã {exportRemindDays(lastFileBackupAt ?? Date.parse(autoBackups[0]!.date))} ngày chưa xuất backup ra file.
              </p>
            )}
            <button className="btn-ghost flex items-center justify-center gap-2" onClick={handleExport}>
              <Download size={15} /> Xuất sao lưu (JSON)
            </button>
            <button className="btn-ghost flex items-center justify-center gap-2" onClick={() => fileRef.current?.click()}>
              <Upload size={15} /> Khôi phục từ sao lưu
            </button>
            <button className="btn-ghost flex items-center justify-center gap-2" onClick={async () => {
              try {
                await navigator.clipboard.writeText(exportErrorLogText())
                showToast('Đã chép log lỗi', 'ok')
              } catch {
                showToast('Không chép được log', 'bad')
              }
            }}>Chép log lỗi</button>
            {autoBackups.map((b) => (
              <button key={b.date} className="btn-ghost text-sm" onClick={() => setConfirmRestore(b.data)}>
                Khôi phục tự động {b.date.slice(0, 16).replace('T', ' ')}
              </button>
            ))}
            <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={handleFile} />
            <button className="btn-danger flex items-center justify-center gap-2" onClick={() => setConfirmWipe(true)}>
              <Trash2 size={15} /> Xóa toàn bộ dữ liệu
            </button>
          </div>
        </Section>

        <div className="text-center text-[11px] mt-6 flex items-center justify-center gap-1.5" style={{ color: 'var(--mute-2)' }}>
          <RefreshCw size={11} /> 3SU Next v4.0 · dữ liệu lưu trên máy
        </div>
      </div>

      <ConfirmDialog
        open={confirmWipe}
        title="Xóa toàn bộ dữ liệu?"
        message="Hành động này không thể hoàn tác. Tất cả sản phẩm, đơn hàng, khách hàng sẽ bị xóa vĩnh viễn. Hãy sao lưu trước khi tiếp tục."
        confirmLabel="Xóa tất cả"
        danger
        onConfirm={handleWipe}
        onCancel={() => setConfirmWipe(false)}
      />

      <ConfirmDialog
        open={!!confirmRestore}
        title="Khôi phục sao lưu?"
        message={`File có ${confirmRestore?.products.length ?? 0} sản phẩm, ${confirmRestore?.sales.length ?? 0} đơn hàng. Dữ liệu hiện tại sẽ bị thay thế hoàn toàn.`}
        confirmLabel="Khôi phục"
        danger
        onConfirm={handleRestore}
        onCancel={() => setConfirmRestore(null)}
      />
    </div>
  )
}

/* ─── Sub-components ─── */
function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="section-label flex items-center gap-2">
        <span style={{ color: 'var(--gold)' }}>{icon}</span> {title}
      </div>
      <div className="card p-4">{children}</div>
    </div>
  )
}

function ToggleRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <label className="flex items-center justify-between py-2.5 cursor-pointer" onClick={onToggle} style={{ borderBottom: '0.5px solid var(--hair-2)' }}>
      <span className="text-sm" style={{ color: 'var(--ink-2)' }}>{label}</span>
      <span className="w-10 h-6 rounded-full relative transition-colors flex-shrink-0" style={{ background: on ? 'var(--up)' : 'var(--hair)' }}>
        <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all" style={{ left: on ? 18 : 2 }} />
      </span>
    </label>
  )
}

function NumRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center justify-between py-2.5" style={{ borderBottom: '0.5px solid var(--hair-2)' }}>
      <span className="text-sm" style={{ color: 'var(--ink-2)' }}>{label}</span>
      <input
        className="field-input !py-1.5 !px-3 w-20 text-center text-sm"
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </label>
  )
}

function ShopForm({ initial, onSave }: {
  initial: { name: string; phone: string; address: string }
  onSave: (name: string, phone: string, address: string) => void
}) {
  const [name, setName] = useState(initial.name)
  const [phone, setPhone] = useState(initial.phone)
  const [address, setAddress] = useState(initial.address)
  const dirty = name !== initial.name || phone !== initial.phone || address !== initial.address
  return (
    <div className="flex flex-col gap-2.5">
      <input className="field-input text-sm" placeholder="Tên cửa hàng" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="field-input text-sm" placeholder="Số điện thoại" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <input className="field-input text-sm" placeholder="Địa chỉ" value={address} onChange={(e) => setAddress(e.target.value)} />
      {dirty && (
        <button className="btn-cta !min-h-[44px] !py-2.5 text-sm" onClick={() => onSave(name.trim() || initial.name, phone.trim(), address.trim())}>
          Lưu thông tin
        </button>
      )}
    </div>
  )
}

function QrEditor({ settings, onPatch, showToast }: {
  settings: Settings
  onPatch: (p: Partial<Settings>) => Promise<void>
  showToast: (msg: string, kind?: 'ok' | 'bad') => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  function handleQrFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { showToast('Chọn file ảnh', 'bad'); return }
    const reader = new FileReader()
    reader.onload = () => {
      void onPatch({ transferQr: String(reader.result) })
      showToast('✓ Đã cập nhật QR', 'ok')
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div className="flex flex-col gap-3">
      {settings.transferQr ? (
        <div className="flex items-center gap-3">
          <img src={settings.transferQr} alt="QR chuyển khoản" className="w-20 h-20 rounded-xl object-cover" style={{ border: '0.5px solid var(--hair)' }} />
          <div className="flex flex-col gap-1.5 flex-1">
            <button className="btn-ghost text-sm" onClick={() => fileRef.current?.click()}>Đổi ảnh QR</button>
            <button className="btn-ghost text-sm" style={{ color: 'var(--down)' }} onClick={() => onPatch({ transferQr: '' })}>Xóa QR</button>
          </div>
        </div>
      ) : (
        <button className="btn-ghost flex items-center justify-center gap-2" onClick={() => fileRef.current?.click()}>
          <QrCode size={15} /> Tải ảnh QR chuyển khoản
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleQrFile} />
      <input
        className="field-input text-sm"
        placeholder="Ghi chú (VD: Vietcombank 123456789)"
        value={settings.transferQrNote}
        onChange={(e) => onPatch({ transferQrNote: e.target.value })}
      />
      <div className="text-[11px] mt-1" style={{ color: 'var(--mute)' }}>
        VietQR động — điền STK để QR đổi theo số tiền lúc thu / thanh toán
      </div>
      <input
        className="field-input text-sm"
        placeholder="Mã NH (VCB hoặc 970436)"
        value={settings.bankBin}
        onChange={(e) => onPatch({ bankBin: e.target.value })}
      />
      <input
        className="field-input text-sm"
        placeholder="Số tài khoản"
        value={settings.bankAccount}
        onChange={(e) => onPatch({ bankAccount: e.target.value })}
      />
      <input
        className="field-input text-sm"
        placeholder="Tên chủ tài khoản"
        value={settings.bankAccountName}
        onChange={(e) => onPatch({ bankAccountName: e.target.value })}
      />
      {payQrSrc(settings, 10000, '3SU xem truoc') && (
        <img src={payQrSrc(settings, 10000, '3SU xem truoc')!} alt="VietQR xem trước" className="mx-auto max-w-[140px] rounded-lg mt-2" />
      )}
    </div>
  )
}
