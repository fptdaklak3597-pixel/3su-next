/**
 * Cài đặt web — layout sidebar + panel, nhóm rõ ràng.
 * Giữ nguyên toàn bộ nghiệp vụ; chỉ sắp lại UI.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Store, SlidersHorizontal, Printer, Cloud, UserRound, Database,
  ChevronRight,
} from 'lucide-react'
import { useApp } from '@/core/store'
import { exportBackup, restoreLocalBackup, setCurrentUser, wipeAll, type BackupData } from '@/core/db'
import { getAutoBackups, parseRestoreFile } from '@/core/domain/trial'
import { payQrSrc } from '@/core/domain/vietqr'
import { textQrSrc } from '@/core/browser/textQr'
import { saveSettingsSynced, saveShopSynced } from '@/core/domain/settings'
import { ROLE_LABEL } from '@/core/domain/auth'
import { exportErrorLogText, logError } from '@/core/errorLogger'
import { apiBase, saveApiBaseOverride } from '@/core/sync/cloud'
import { isFirebaseConfigured } from '@/core/sync/firebase'
import { ConfirmDialog } from '@/shared/components'
import { dispatchTestPrint, printResultToast } from '@/core/browser/printQueue'
import { PrintStatusLine } from '@/shared/PrintStatus'
import { useDisplayMode, useInstallPrompt } from '@/shared/pwa'
import type { Settings } from '@/core/types'

type Sec = 'shop' | 'ops' | 'print' | 'sync' | 'account' | 'data'

const SECTIONS: { id: Sec; label: string; hint: string; icon: ReactNode }[] = [
  { id: 'shop', label: 'Cửa hàng', hint: 'Tên, SĐT, địa chỉ', icon: <Store size={16} /> },
  { id: 'ops', label: 'Vận hành', hint: 'Tồn kho, HSD, giao diện', icon: <SlidersHorizontal size={16} /> },
  { id: 'print', label: 'In & thanh toán', hint: 'Máy in, VietQR, STK', icon: <Printer size={16} /> },
  { id: 'sync', label: 'Đồng bộ', hint: 'Cùng email = chung dữ liệu', icon: <Cloud size={16} /> },
  { id: 'account', label: 'Tài khoản', hint: 'Nhân viên & cloud', icon: <UserRound size={16} /> },
  { id: 'data', label: 'Dữ liệu', hint: 'Sao lưu, khôi phục, xóa', icon: <Database size={16} /> },
]

export function WebSettingsPage() {
  const navigate = useNavigate()
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const shop = useApp((s) => s.shop)
  const setShop = useApp((s) => s.setShop)
  const showToast = useApp((s) => s.showToast)
  const sync = useApp((s) => s.sync)
  const user = useApp((s) => s.user)
  const setUser = useApp((s) => s.setUser)
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)
  const fileRef = useRef<HTMLInputElement>(null)
  const [sec, setSec] = useState<Sec>('shop')
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState<BackupData | null>(null)
  const [name, setName] = useState(shop.name)
  const [phone, setPhone] = useState(shop.phone)
  const [address, setAddress] = useState(shop.address)
  const [apiUrl, setApiUrl] = useState(apiBase())
  const [autoBackups, setAutoBackups] = useState<Awaited<ReturnType<typeof getAutoBackups>>>([])
  const { canInstall, installed, promptInstall } = useInstallPrompt()
  const displayMode = useDisplayMode()
  const qrFileRef = useRef<HTMLInputElement>(null)
  const isStandalone = displayMode === 'standalone' || installed

  useEffect(() => { void getAutoBackups().then(setAutoBackups) }, [])
  useEffect(() => {
    setName(shop.name)
    setPhone(shop.phone)
    setAddress(shop.address)
  }, [shop.name, shop.phone, shop.address])

  async function patchSettings(patch: Partial<Settings>) {
    const next = { ...settings, ...patch }
    setSettings(next)
    try { await saveSettingsSynced(next) } catch (e) { logError(e, 'settings.save') }
  }

  async function patchPrinter(patch: Partial<Settings['printer']>) {
    await patchSettings({ printer: { ...settings.printer, ...patch } })
  }

  async function handleSaveShop() {
    const next = { name: name.trim() || shop.name, phone: phone.trim(), address: address.trim() }
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

  const syncText = sync.status === 'ok' ? 'Đã nối' : sync.status === 'syncing' ? 'Đang sync' : sync.status === 'error' ? 'Lỗi' : 'Sẵn sàng'
  const active = SECTIONS.find((s) => s.id === sec)!

  return (
    <div className="web-page web-settings">
      <div className="web-ph">
        <div>
          <h2>Cài đặt</h2>
          <p className="web-sub" style={{ margin: '4px 0 0' }}>
            Đồng bộ: <strong>{syncText}</strong>
            {apiBase() ? ` · API ${apiBase()}` : ' · chưa cấu hình Worker'}
          </p>
        </div>
      </div>

      <div className="web-settings-layout">
        {/* Sidebar nhóm */}
        <nav className="web-settings-nav" aria-label="Nhóm cài đặt">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`web-settings-nav-item ${sec === s.id ? 'on' : ''}`}
              onClick={() => setSec(s.id)}
            >
              <span className="web-settings-nav-ico">{s.icon}</span>
              <span className="web-settings-nav-text">
                <strong>{s.label}</strong>
                <em>{s.hint}</em>
              </span>
              <ChevronRight size={14} className="web-settings-nav-chev" />
            </button>
          ))}
        </nav>

        {/* Panel nội dung */}
        <div className="web-settings-panel">
          <div className="web-settings-panel-h">
            <h3>{active.label}</h3>
            <p>{active.hint}</p>
          </div>

          {sec === 'shop' && (
            <div className="web-settings-body">
              <label className="web-s-field">
                <span>Tên cửa hàng</span>
                <input className="web-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Cửa hàng của tôi" />
              </label>
              <label className="web-s-field">
                <span>Số điện thoại</span>
                <input className="web-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="090..." />
              </label>
              <label className="web-s-field">
                <span>Địa chỉ</span>
                <input className="web-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Số nhà, đường, quận..." />
              </label>
              <div className="web-settings-actions">
                <button type="button" className="web-btn pri" onClick={handleSaveShop}>Lưu thông tin</button>
              </div>
            </div>
          )}

          {sec === 'ops' && (
            <div className="web-settings-body">
              <div className="web-settings-row2">
                <label className="web-s-field">
                  <span>Ngưỡng tồn thấp</span>
                  <input className="web-input" type="number" value={settings.lowStock} onChange={(e) => void patchSettings({ lowStock: Number(e.target.value) || 0 })} />
                </label>
                <label className="web-s-field">
                  <span>Cảnh báo HSD (ngày)</span>
                  <input className="web-input" type="number" value={settings.hsdWarnDays} onChange={(e) => void patchSettings({ hsdWarnDays: Number(e.target.value) || 0 })} />
                </label>
              </div>

              <div className="web-settings-checks">
                <label className="web-s-check">
                  <input type="checkbox" checked={settings.soundOn} onChange={() => void patchSettings({ soundOn: !settings.soundOn })} />
                  <span>Âm thanh khi bán</span>
                </label>
                <label className="web-s-check">
                  <input type="checkbox" checked={settings.celebrateOnSale} onChange={() => void patchSettings({ celebrateOnSale: !settings.celebrateOnSale })} />
                  <span>Hiệu ứng mừng khi bán</span>
                </label>
                <label className="web-s-check">
                  <input type="checkbox" checked={settings.showCostInCart} onChange={() => void patchSettings({ showCostInCart: !settings.showCostInCart })} />
                  <span>Hiện giá vốn trong giỏ</span>
                </label>
                <label className="web-s-check">
                  <input type="checkbox" checked={settings.allowNegativeStock !== false} onChange={() => void patchSettings({ allowNegativeStock: settings.allowNegativeStock === false })} />
                  <span>Cho phép bán khi hết hàng</span>
                </label>
              </div>

              <div className="web-settings-block">
                <div className="web-settings-block-t">Giao diện</div>
                <div className="web-chips">
                  {(['light', 'dark', 'system'] as const).map((t) => (
                    <button key={t} type="button" className={`web-chip ${theme === t ? 'on' : ''}`} onClick={() => { setTheme(t); void patchSettings({ theme: t }) }}>
                      {t === 'light' ? 'Sáng' : t === 'dark' ? 'Tối' : 'Hệ thống'}
                    </button>
                  ))}
                </div>
                <label className="web-s-check" style={{ marginTop: 10 }}>
                  <input type="checkbox" checked={settings.largeText === true} onChange={() => void patchSettings({ largeText: !settings.largeText })} />
                  <span>Chữ lớn (dễ đọc hơn)</span>
                </label>
              </div>
            </div>
          )}

          {sec === 'print' && (
            <div className="web-settings-body">
              <div className="web-settings-block">
                <div className="web-settings-block-t">Khổ giấy in</div>
                <div className="web-chips">
                  {([58, 80] as const).map((w) => (
                    <button key={w} type="button" className={`web-chip ${settings.printer.width === w ? 'on' : ''}`} onClick={() => void patchPrinter({ width: w })}>
                      {w}mm
                    </button>
                  ))}
                </div>
              </div>

              <label className="web-s-field">
                <span>Cỡ chữ phiếu ({settings.printer.fontSize || 12})</span>
                <input type="range" min={8} max={14} value={settings.printer.fontSize || 12} onChange={(e) => void patchPrinter({ fontSize: Number(e.target.value) })} />
              </label>

              <PrintStatusLine />

              <div className="web-settings-checks">
                <label className="web-s-check">
                  <input type="checkbox" checked={settings.printer.autoPrintAfterSale} onChange={() => void patchPrinter({ autoPrintAfterSale: !settings.printer.autoPrintAfterSale })} />
                  <span>In luôn trên máy này (khi máy tính tắt)</span>
                </label>
                <label className="web-s-check">
                  <input type="checkbox" checked={settings.printer.showLogo !== false} onChange={() => void patchPrinter({ showLogo: !settings.printer.showLogo })} />
                  <span>In tên shop trên phiếu</span>
                </label>
              </div>

              <div className="web-settings-row2">
                <label className="web-s-field">
                  <span>Tiêu đề hóa đơn</span>
                  <input
                    className="web-input"
                    value={settings.printer.templateHeader}
                    placeholder="PHIẾU BÁN HÀNG"
                    onChange={(e) => void patchPrinter({ templateHeader: e.target.value })}
                  />
                </label>
                <label className="web-s-field">
                  <span>Lời chào cuối hóa đơn</span>
                  <input
                    className="web-input"
                    value={settings.printer.templateFooter}
                    placeholder="Cảm ơn quý khách!"
                    onChange={(e) => void patchPrinter({ templateFooter: e.target.value })}
                  />
                </label>
              </div>

              <div className="web-settings-actions">
                <button type="button" className="web-btn pri" onClick={() => navigate('/may-in')}>Mở Máy in</button>
                <button type="button" className="web-btn" onClick={async () => {
                  const r = await dispatchTestPrint(shop.name, settings.printer)
                  const t = printResultToast(r)
                  showToast(t.text, t.kind)
                }}>In thử</button>
              </div>

              <div className="web-settings-block">
                <div className="web-settings-block-t">Tài khoản nhận VietQR</div>
                <div className="web-settings-row2">
                  <label className="web-s-field">
                    <span>Mã NH (BIN)</span>
                    <input className="web-input" placeholder="VCB hoặc 970436" value={settings.bankBin} onChange={(e) => void patchSettings({ bankBin: e.target.value })} />
                  </label>
                  <label className="web-s-field">
                    <span>Số tài khoản</span>
                    <input className="web-input" placeholder="Số TK" value={settings.bankAccount} onChange={(e) => void patchSettings({ bankAccount: e.target.value })} />
                  </label>
                </div>
                <label className="web-s-field">
                  <span>Tên chủ tài khoản</span>
                  <input className="web-input" placeholder="NGUYEN VAN A" value={settings.bankAccountName} onChange={(e) => void patchSettings({ bankAccountName: e.target.value })} />
                </label>
                <div className="web-settings-qr-row">
                  {payQrSrc(settings, 10000, '3SU xem truoc') ? (
                    <div className="web-settings-qr">
                      <img src={payQrSrc(settings, 10000, '3SU xem truoc')!} alt="VietQR xem trước" />
                      <span>VietQR xem trước (10.000đ)</span>
                    </div>
                  ) : (
                    <p className="web-sub">Điền đủ BIN + STK để hiện QR thanh toán.</p>
                  )}
                  <div className="web-settings-qr">
                    <img src={textQrSrc(`${window.location.origin}/may-in`)} alt="QR Máy in" />
                    <span>QR mở trang Máy in</span>
                  </div>
                </div>
              </div>

              <div className="web-settings-block">
                <div className="web-settings-block-t">Ảnh QR tĩnh (khi chưa có STK)</div>
                {settings.transferQr ? (
                  <div className="web-settings-qr-row">
                    <div className="web-settings-qr">
                      <img src={settings.transferQr} alt="QR chuyển khoản" />
                      <span>Ảnh đã tải</span>
                    </div>
                    <div className="web-settings-actions">
                      <button type="button" className="web-btn" onClick={() => qrFileRef.current?.click()}>Đổi ảnh</button>
                      <button type="button" className="web-btn" onClick={() => void patchSettings({ transferQr: '' })}>Xóa ảnh</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="web-btn" onClick={() => qrFileRef.current?.click()}>Tải ảnh QR chuyển khoản</button>
                )}
                <input
                  ref={qrFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (!file) return
                    if (!file.type.startsWith('image/')) { showToast('Chọn file ảnh', 'bad'); return }
                    const reader = new FileReader()
                    reader.onload = () => {
                      void patchSettings({ transferQr: String(reader.result) })
                      showToast('✓ Đã cập nhật QR', 'ok')
                    }
                    reader.readAsDataURL(file)
                  }}
                />
                <label className="web-s-field">
                  <span>Ghi chú QR</span>
                  <input
                    className="web-input"
                    placeholder="VD: Vietcombank 123456789"
                    value={settings.transferQrNote}
                    onChange={(e) => void patchSettings({ transferQrNote: e.target.value })}
                  />
                </label>
              </div>
            </div>
          )}

          {sec === 'sync' && (
            <div className="web-settings-body">
              <div className="web-settings-status">
                <div>
                  <strong>Firebase</strong>
                  <span>{isFirebaseConfigured() ? 'Đã cấu hình' : 'Thiếu cấu hình'}</span>
                </div>
                <div>
                  <strong>Máy chủ</strong>
                  <span>{apiBase() || 'Chưa có'}</span>
                </div>
                <div>
                  <strong>Trạng thái</strong>
                  <span>{syncText}</span>
                </div>
              </div>
              <p className="web-sub">
                Chủ cửa hàng: cùng email trên mọi máy. Máy mới hoặc nhân viên: vào <strong>Tài khoản</strong>, nhập mã một lần bằng Gmail của họ.
              </p>
              <div className="web-settings-actions">
                <button type="button" className="web-btn pri" onClick={() => navigate('/tai-khoan')}>Tài khoản cloud</button>
              </div>
              <details className="web-settings-block">
                <summary className="web-settings-block-t" style={{ cursor: 'pointer' }}>Nâng cao — địa chỉ máy chủ</summary>
                <label className="web-s-field" style={{ marginTop: 10 }}>
                  <span>Địa chỉ Worker (để trống = dùng bản build)</span>
                  <input className="web-input" placeholder="https://…" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
                </label>
                <div className="web-settings-actions">
                  <button type="button" className="web-btn" onClick={async () => {
                    await saveApiBaseOverride(apiUrl)
                    showToast('Đã lưu địa chỉ đồng bộ', 'ok')
                  }}>Lưu địa chỉ</button>
                </div>
              </details>
            </div>
          )}

          {sec === 'account' && (
            <div className="web-settings-body">
              <div className="web-settings-block">
                <div className="web-settings-block-t">Nhân viên trên máy này</div>
                {user ? (
                  <>
                    <p className="web-settings-userline">
                      <strong>{user.name}</strong>
                      <span>@{user.username}</span>
                      <span className="web-badge">{ROLE_LABEL[user.role]}</span>
                    </p>
                    <div className="web-settings-actions">
                      <button type="button" className="web-btn" onClick={async () => {
                        await setCurrentUser(null)
                        setUser(null)
                        showToast('Đã đăng xuất', 'ok')
                        navigate('/')
                      }}>Đăng xuất nhân viên</button>
                      <button type="button" className="web-btn" onClick={() => navigate('/nguoi-dung')}>Quản lý người dùng</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="web-sub">Chưa có nhân viên đăng nhập trên máy. Tạo tài khoản nếu cần PIN ca làm.</p>
                    <div className="web-settings-actions">
                      <button type="button" className="web-btn" onClick={() => navigate('/nguoi-dung')}>Mở Người dùng</button>
                    </div>
                  </>
                )}
              </div>

              <div className="web-settings-block">
                <div className="web-settings-block-t">Tài khoản cloud</div>
                <p className="web-sub">Google / email để in từ điện thoại và đồng bộ máy khác.</p>
                <div className="web-settings-actions">
                  <button type="button" className="web-btn pri" onClick={() => navigate('/tai-khoan')}>Đăng nhập / Đăng ký cloud</button>
                </div>
              </div>
            </div>
          )}

          {sec === 'data' && (
            <div className="web-settings-body">
              {!isStandalone && (
                <div className="web-settings-block">
                  <div className="web-settings-block-t">Cài lên máy</div>
                  <p className="web-sub">
                    {canInstall ? 'Cài 3SU như phần mềm — lần sau mở từ màn hình chính.' : 'Mở bằng Chrome rồi thêm ra màn hình chính (Cài ứng dụng).'}
                  </p>
                  <div className="web-settings-actions">
                    <button type="button" className="web-btn pri" disabled={!canInstall} onClick={() => void promptInstall()}>
                      Cài đặt ứng dụng
                    </button>
                  </div>
                </div>
              )}
              <div className="web-settings-block">
                <div className="web-settings-block-t">Sao lưu & khôi phục</div>
                <div className="web-settings-actions">
                  <button type="button" className="web-btn pri" onClick={handleExport}>Xuất sao lưu JSON</button>
                  <button type="button" className="web-btn" onClick={() => fileRef.current?.click()}>Khôi phục từ file</button>
                  <button type="button" className="web-btn" onClick={async () => {
                    const text = exportErrorLogText()
                    try {
                      await navigator.clipboard.writeText(text)
                      showToast('Đã chép log lỗi', 'ok')
                    } catch {
                      showToast(text.slice(0, 80), 'ok')
                    }
                  }}>Chép log lỗi</button>
                </div>
                <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={handleFile} />
              </div>

              {autoBackups.length > 0 && (
                <div className="web-settings-block">
                  <div className="web-settings-block-t">Sao lưu tự động (3 bản gần nhất)</div>
                  <div className="web-settings-backup-list">
                    {autoBackups.map((b) => (
                      <button key={b.date} type="button" className="web-btn" onClick={() => setConfirmRestore(b.data)}>
                        Khôi phục {b.date.slice(0, 16).replace('T', ' ')}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="web-settings-danger">
                <div>
                  <strong>Vùng nguy hiểm</strong>
                  <p>Xóa toàn bộ dữ liệu trên máy này. Không hoàn tác được — hãy sao lưu trước.</p>
                </div>
                <button type="button" className="web-btn danger" onClick={() => setConfirmWipe(true)}>Xóa toàn bộ</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmWipe}
        title="Xóa toàn bộ dữ liệu?"
        message="Không hoàn tác được. Hãy sao lưu trước."
        confirmLabel="Xóa tất cả"
        danger
        onConfirm={async () => {
          try {
            await wipeAll()
            showToast('Đã xóa toàn bộ dữ liệu', 'ok')
            setTimeout(() => window.location.reload(), 800)
          } catch (e) {
            logError(e, 'backup.wipe')
            showToast('Lỗi khi xóa', 'bad')
          }
        }}
        onCancel={() => setConfirmWipe(false)}
      />
      <ConfirmDialog
        open={!!confirmRestore}
        title="Khôi phục sao lưu?"
        message={`File có ${confirmRestore?.products.length ?? 0} sản phẩm, ${confirmRestore?.sales.length ?? 0} đơn. Dữ liệu hiện tại sẽ bị thay.`}
        confirmLabel="Khôi phục"
        danger
        onConfirm={async () => {
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
        }}
        onCancel={() => setConfirmRestore(null)}
      />
    </div>
  )
}
