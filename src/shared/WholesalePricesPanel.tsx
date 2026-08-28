/**
 * Bảng giá sỉ — dùng chung web + mobile.
 */
import { useState, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx, getSettings } from '@/core/db'
import { useApp } from '@/core/store'
import { fmt, matchesSearch } from '@/core/format'
import { logError } from '@/core/errorLogger'
import {
  getWholesaleFormula,
  previewWholesalePrice,
  saveWholesaleFormula,
  setProductWholesalePrice,
  wholesaleFormulaLabel,
  wholesaleStats,
} from '@/core/domain/wholesale'
import type { WholesaleFormula } from '@/core/types'
import { ConfirmDialog, Sheet } from '@/shared/components'

type Variant = 'web' | 'mobile'

export function WholesalePricesPanel({ variant, onBack }: { variant: Variant; onBack: () => void }) {
  const showToast = useApp((s) => s.showToast)
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const [query, setQuery] = useState('')
  const [wizardOpen, setWizardOpen] = useState(false)
  const [mode, setMode] = useState<'percent' | 'fixed'>('percent')
  const [value, setValue] = useState(10)
  const [confirmApply, setConfirmApply] = useState(false)
  const [pending, setPending] = useState(false)

  const products = useLiveQuery(
    () => dbx.products.filter((p) => !p.deleted).toArray(),
    [],
    [],
  )

  const cfg = settings.wholesaleFormula
  const stats = useMemo(() => wholesaleStats(products), [products])

  const filtered = useMemo(() => {
    const q = query.trim()
    return products
      .filter((p) => (p.price > 0 || p.wholesalePrice > 0))
      .filter((p) => !q || matchesSearch(p.name + ' ' + p.cat + ' ' + p.barcode, q))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
      .slice(0, 200)
  }, [products, query])

  function openWizard() {
    const c = settings.wholesaleFormula
    setMode(c?.mode === 'fixed' ? 'fixed' : 'percent')
    setValue(c?.value ?? 10)
    setWizardOpen(true)
  }

  async function applyFormula(force: boolean) {
    const formula: WholesaleFormula = { mode, value: Math.max(0, Number(value) || 0) }
    if (!formula.value) {
      showToast('Nhập giá trị giảm', 'bad')
      return
    }
    setPending(true)
    try {
      const n = await saveWholesaleFormula(formula)
      const fresh = await getSettings()
      setSettings(fresh)
      showToast(`Đã áp dụng giá sỉ cho ${n} mặt hàng`, 'ok')
      setWizardOpen(false)
      setConfirmApply(false)
    } catch (e) {
      logError(e, 'wholesale.apply')
      showToast('Không áp dụng được', 'bad')
    } finally {
      setPending(false)
    }
    void force
  }

  async function onWsChange(productId: string, raw: string) {
    const n = Math.max(0, Math.round(Number(raw) || 0))
    try {
      await setProductWholesalePrice(productId, n)
    } catch (e) {
      logError(e, 'wholesale.product')
      showToast('Lỗi khi lưu giá sỉ', 'bad')
    }
  }

  const isWeb = variant === 'web'
  const inputCls = isWeb ? 'web-input' : 'field-input'
  const btnCls = isWeb ? 'web-btn' : 'btn-ghost'
  const btnPri = isWeb ? 'web-btn pri' : 'btn-cta'
  const chipCls = isWeb ? 'web-chip' : 'chip'

  return (
    <div className={isWeb ? 'web-page flex flex-col min-h-0' : 'flex flex-col h-full'}>
      <header className={isWeb ? 'web-ph' : 'app-hdr bordered'}>
        {isWeb ? (
          <>
            <button type="button" className="web-btn" onClick={onBack}>← Quay lại</button>
            <h2>Bảng giá sỉ</h2>
            <button type="button" className="web-btn pri" onClick={openWizard}>
              {cfg ? 'Đổi công thức' : 'Tạo bảng giá'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-back" onClick={onBack} aria-label="Quay lại">←</button>
            <div className="flex-1 min-w-0">
              <div className="font-brand text-[17px] font-medium" style={{ color: 'var(--ink)' }}>Bảng giá sỉ</div>
              <div className="text-[11px]" style={{ color: 'var(--mute)' }}>
                {stats.withWs}/{stats.withRetail} mặt hàng có giá sỉ
              </div>
            </div>
            <button type="button" className="btn-ghost text-xs" onClick={openWizard}>
              {cfg ? 'Công thức' : 'Tạo bảng'}
            </button>
          </>
        )}
      </header>

      <div className={isWeb ? 'px-0 pb-2' : 'px-4 pt-2'}>
        <div
          className={isWeb ? 'web-settings-block' : 'rounded-xl px-3 py-2 mb-2 text-[13px]'}
          style={isWeb ? undefined : { background: 'var(--paper-2)', border: '0.5px solid var(--hair)' }}
        >
          {cfg
            ? `${wholesaleFormulaLabel(cfg)} · ${stats.withWs}/${stats.withRetail} mặt hàng có giá sỉ`
            : 'Chưa có công thức — bấm Tạo bảng giá hoặc nhập giá sỉ từng dòng.'}
        </div>
        <input
          className={isWeb ? 'web-search' : 'field-input text-sm'}
          placeholder="Tìm sản phẩm…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className={`flex-1 overflow-y-auto min-h-0 ${isWeb ? '' : 'px-4 pb-6'}`}>
        {filtered.map((p) => {
          const preview = cfg && p.price > 0 && !p.wholesalePrice
            ? previewWholesalePrice(p.price, cfg)
            : 0
          return (
            <div key={p.id} className={isWeb ? 'web-pc mb-2 items-center' : 'list-row mb-1.5'}>
              <div className="flex-1 min-w-0">
                <div className={isWeb ? 'n' : 'text-sm font-medium truncate'} style={isWeb ? undefined : { color: 'var(--ink)' }}>
                  {p.name}
                </div>
                <div className={isWeb ? 's' : 'text-[11px]'} style={isWeb ? undefined : { color: 'var(--mute)' }}>
                  Lẻ {fmt(p.price)}
                  {p.wholesalePrice > 0 && p.price > p.wholesalePrice
                    ? ` · giảm ${fmt(p.price - p.wholesalePrice)}`
                    : ''}
                </div>
              </div>
              <input
                type="number"
                min={0}
                className={isWeb ? 'web-input' : 'field-input'}
                style={{ width: isWeb ? 120 : 96, flexShrink: 0 }}
                value={p.wholesalePrice || ''}
                placeholder={preview ? String(preview) : '—'}
                onChange={(e) => void onWsChange(p.id, e.target.value)}
              />
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm" style={{ color: 'var(--mute)' }}>Không có sản phẩm phù hợp</div>
        )}
      </div>

      <Sheet open={wizardOpen} onClose={() => setWizardOpen(false)} title={cfg ? 'Đổi công thức giá sỉ' : 'Tạo bảng giá sỉ'}>
        <p className="text-sm mb-3" style={{ color: 'var(--mute)' }}>
          Áp dụng cho tất cả mặt hàng có giá bán lẻ. Đổi giá lẻ sau này sẽ tự cập nhật giá sỉ theo công thức.
        </p>
        <div className="flex gap-2 mb-3">
          <button type="button" className={`${chipCls} flex-1 justify-center ${mode === 'percent' ? (isWeb ? 'on' : '!bg-ink !text-paper') : ''}`} onClick={() => setMode('percent')}>
            Giảm %
          </button>
          <button type="button" className={`${chipCls} flex-1 justify-center ${mode === 'fixed' ? (isWeb ? 'on' : '!bg-ink !text-paper') : ''}`} onClick={() => setMode('fixed')}>
            Giảm tiền
          </button>
        </div>
        <label className="block text-sm mb-3">
          <span className="block mb-1" style={{ color: 'var(--mute)' }}>
            {mode === 'fixed' ? 'Số tiền giảm (đ)' : 'Phần trăm giảm (%)'}
          </span>
          <input className={inputCls} type="number" min={0} value={value} onChange={(e) => setValue(Number(e.target.value) || 0)} />
        </label>
        {products.filter((p) => p.price > 0).slice(0, 3).map((p) => (
          <div key={p.id} className="text-sm flex justify-between gap-2 py-1" style={{ color: 'var(--mute)' }}>
            <span className="truncate">{p.name}</span>
            <span>{fmt(p.price)} → <b style={{ color: 'var(--ink)' }}>{fmt(previewWholesalePrice(p.price, { mode, value }))}</b></span>
          </div>
        ))}
        <button
          type="button"
          className={`${btnPri} w-full mt-4`}
          disabled={pending}
          onClick={() => {
            if (cfg) setConfirmApply(true)
            else void applyFormula(false)
          }}
        >
          {cfg ? 'Áp dụng lại tất cả' : 'Tạo bảng giá'}
        </button>
      </Sheet>

      <ConfirmDialog
        open={confirmApply}
        title="Áp dụng lại công thức?"
        message="Ghi đè giá sỉ hiện tại của tất cả sản phẩm theo công thức mới?"
        confirmLabel="Áp dụng"
        onConfirm={() => void applyFormula(true)}
        onCancel={() => setConfirmApply(false)}
      />
    </div>
  )
}
