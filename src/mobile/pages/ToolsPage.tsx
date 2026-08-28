/**
 * 3SU Next — Công cụ (Tools)
 * Port từ 30-tools-units.js + 18a-pricing.js: quy đổi đơn vị, quy tắc giá.
 */
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { dbx } from '@/core/db'
import { useApp } from '@/core/store'
import { fmt } from '@/core/format'
import { logError } from '@/core/errorLogger'
import { unitsFor, convertPriceByUnit, breakdownQty } from '@/core/domain/units'
import {
  createPricingRule, togglePricingRule, deletePricingRule, applyPricingRule,
} from '@/core/domain/pricing'
import { addNote, deleteNote, filterNotes, sortNotes, toggleNoteDone, toggleNotePin, updateNote, type NoteFilterSeg } from '@/core/domain/notes'
import { runReadinessCheck, type ReadinessResult } from '@/core/domain/readiness'
import { Sheet, ConfirmDialog, EmptyState } from '@/shared/components'
import { ChevronLeft, Plus, Trash2, Ruler, Tags, StickyNote, ShieldCheck, Pin, Check, Pencil } from 'lucide-react'
import type { Product, PricingRule, Note, NoteType } from '@/core/types'

export function ToolsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'units' | 'pricing' | 'notes'>('units')

  return (
    <div className="flex flex-col h-full">
      {!embedded && (
      <header className="app-hdr bordered">
        <button className="btn-back" onClick={() => navigate('/them')}>
          <ChevronLeft size={20} />
        </button>
        <div className="font-brand text-[17px] font-medium flex-1 text-center" style={{ color: 'var(--ink)' }}>Công cụ</div>
        <div className="w-9" />
      </header>
      )}

      <div className="px-4 pt-3 pb-2 flex gap-2">
        <button className="chip flex-1 justify-center" style={tab === 'units' ? { background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' } : {}} onClick={() => setTab('units')}>
          <Ruler size={13} /> Đơn vị
        </button>
        <button className="chip flex-1 justify-center" style={tab === 'pricing' ? { background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' } : {}} onClick={() => setTab('pricing')}>
          <Tags size={13} /> Quy tắc giá
        </button>
        <button className="chip flex-1 justify-center" style={tab === 'notes' ? { background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' } : {}} onClick={() => setTab('notes')}>
          <StickyNote size={13} /> Ghi chú
        </button>
      </div>

      {tab === 'units' ? <UnitTools /> : tab === 'pricing' ? <PricingTools /> : <NotesTools />}
    </div>
  )
}

/* ─── Công cụ đơn vị ─── */
function UnitTools() {
  const [productId, setProductId] = useState('')
  const [basePrice, setBasePrice] = useState(0)
  const [qty, setQty] = useState(0)

  const products = useLiveQuery(() => dbx.products.filter((p) => !p.deleted).toArray(), [], [] as Product[])
  const product = products.find((p) => p.id === productId)
  const units = useMemo(() => (product ? unitsFor(product) : []), [product])

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 pb-6 max-w-[520px] mx-auto w-full">
      <select className="field-input mb-3" value={productId} onChange={(e) => { setProductId(e.target.value); const p = products.find((x) => x.id === e.target.value); setBasePrice(p?.price ?? 0) }}>
        <option value="">— Chọn sản phẩm —</option>
        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      {product && (
        <>
          <label className="flex flex-col gap-1.5 mb-3">
            <span className="text-xs" style={{ color: 'var(--mute)' }}>Giá đơn vị gốc ({product.unit})</span>
            <input className="field-input" type="number" inputMode="numeric" value={basePrice || ''} onChange={(e) => setBasePrice(Number(e.target.value) || 0)} />
          </label>

          <div className="section-label">Bảng quy đổi giá</div>
          <div className="card p-1 mb-4">
            {units.map((u) => (
              <div key={u.n} className="flex items-center justify-between px-3 py-2.5" style={{ borderBottom: '0.5px solid var(--hair-2)' }}>
                <div>
                  <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{u.n}</span>
                  <span className="text-[11px] ml-2" style={{ color: 'var(--mute)' }}>= {u.r} {product.unit}</span>
                </div>
                <span className="text-sm font-medium" style={{ color: 'var(--up)' }}>{fmt(convertPriceByUnit(basePrice, u))}</span>
              </div>
            ))}
          </div>

          <div className="section-label">Phân rã số lượng</div>
          <label className="flex flex-col gap-1.5 mb-2">
            <span className="text-xs" style={{ color: 'var(--mute)' }}>Tổng số lượng ({product.unit})</span>
            <input className="field-input" type="number" inputMode="numeric" value={qty || ''} onChange={(e) => setQty(Number(e.target.value) || 0)} />
          </label>
          {qty > 0 && (
            <div className="card p-3 text-sm" style={{ color: 'var(--ink-2)' }}>
              {Object.entries(breakdownQty(qty, units)).map(([n, c]) => (
                <span key={n} className="inline-block mr-3 mb-1">
                  <b style={{ color: 'var(--ink)' }}>{c}</b> {n}
                </span>
              ))}
            </div>
          )}
        </>
      )}
      {!product && <EmptyState icon="📐" title="Chọn sản phẩm" sub="Để xem bảng quy đổi đơn vị và giá" />}
    </div>
  )
}

/* ─── Quy tắc giá ─── */
function PricingTools() {
  const showToast = useApp((s) => s.showToast)
  const [showAdd, setShowAdd] = useState(false)
  const [delTarget, setDelTarget] = useState<PricingRule | null>(null)
  const [form, setForm] = useState({ name: '', cat: '', marginPct: 20, roundTo: 1000 })
  const [testCost, setTestCost] = useState(0)

  const rules = useLiveQuery(() => dbx.pricingRules.filter((r) => !r.deleted).toArray(), [], [] as PricingRule[])

  async function handleAdd() {
    try {
      await createPricingRule(form)
      showToast('✓ Đã thêm quy tắc', 'ok')
      setForm({ name: '', cat: '', marginPct: 20, roundTo: 1000 })
      setShowAdd(false)
    } catch (e) {
      logError(e, 'pricing.create')
      showToast(e instanceof Error ? e.message : 'Lỗi', 'bad')
    }
  }

  async function handleDelete() {
    if (!delTarget) return
    await deletePricingRule(delTarget.id)
    showToast('Đã xóa quy tắc', 'ok')
    setDelTarget(null)
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 pb-6 max-w-[520px] mx-auto w-full">
      <button className="btn-ghost w-full mb-3 flex items-center justify-center gap-2" onClick={() => setShowAdd(true)}>
        <Plus size={16} /> Thêm quy tắc giá
      </button>

      {rules.map((r) => (
        <div key={r.id} className="list-row">
          <button className="flex-1 min-w-0 text-left" onClick={() => togglePricingRule(r.id)}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{r.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ color: r.active ? 'var(--up)' : 'var(--mute)', background: 'var(--paper-2)' }}>
                {r.active ? 'Bật' : 'Tắt'}
              </span>
            </div>
            <div className="text-[11px]" style={{ color: 'var(--mute)' }}>
              {r.cat ? `Danh mục "${r.cat}"` : 'Tất cả danh mục'} · lời {r.marginPct}% · tròn {fmt(r.roundTo)}
            </div>
          </button>
          <button className="ml-2 p-1.5" onClick={() => setDelTarget(r)} aria-label="Xóa" style={{ color: 'var(--mute-2)' }}>
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      {rules.length === 0 && <EmptyState icon="🏷️" title="Chưa có quy tắc giá" sub="Tự động gợi ý giá bán theo biên lợi nhuận" />}

      {rules.length > 0 && (
        <>
          <div className="section-label mt-4">Thử tính giá</div>
          <div className="card p-3">
            <label className="flex flex-col gap-1.5 mb-3">
              <span className="text-xs" style={{ color: 'var(--mute)' }}>Giá vốn</span>
              <input className="field-input" type="number" inputMode="numeric" value={testCost || ''} onChange={(e) => setTestCost(Number(e.target.value) || 0)} />
            </label>
            {testCost > 0 && rules.filter((r) => r.active).map((r) => (
              <div key={r.id} className="flex justify-between text-sm py-1" style={{ borderBottom: '0.5px solid var(--hair-2)' }}>
                <span style={{ color: 'var(--mute)' }}>{r.name}</span>
                <span className="font-medium" style={{ color: 'var(--up)' }}>{fmt(applyPricingRule(testCost, r))}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <Sheet open={showAdd} onClose={() => setShowAdd(false)} title="Thêm quy tắc giá">
        <div className="flex flex-col gap-3">
          <input className="field-input" placeholder="Tên quy tắc *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="field-input" placeholder="Danh mục (để trống = tất cả)" value={form.cat} onChange={(e) => setForm({ ...form, cat: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs" style={{ color: 'var(--mute)' }}>Biên lợi nhuận (%)</span>
              <input className="field-input" type="number" inputMode="numeric" value={form.marginPct || ''} onChange={(e) => setForm({ ...form, marginPct: Number(e.target.value) || 0 })} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs" style={{ color: 'var(--mute)' }}>Làm tròn đến</span>
              <input className="field-input" type="number" inputMode="numeric" value={form.roundTo || ''} onChange={(e) => setForm({ ...form, roundTo: Number(e.target.value) || 0 })} />
            </label>
          </div>
          <p className="text-[11px]" style={{ color: 'var(--mute)' }}>
            Ví dụ: vốn 8.000đ, lời 25%, tròn 1.000đ → giá bán {fmt(applyPricingRule(8000, { ...form, id: '', active: true }))}
          </p>
          <button className="btn-cta" onClick={handleAdd}>Thêm quy tắc</button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={!!delTarget}
        title="Xóa quy tắc?"
        message={`Xóa quy tắc "${delTarget?.name}"?`}
        confirmLabel="Xóa"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  )
}

/* ─── Ghi chú nhanh ─── */
const NOTE_TYPES: { v: NoteType; label: string }[] = [
  { v: 'todo', label: 'Việc' },
  { v: 'idea', label: 'Ý tưởng' },
  { v: 'note', label: 'Ghi chú' },
]

const NOTE_SEGS: { v: NoteFilterSeg; label: string }[] = [
  { v: 'all', label: 'Tất cả' },
  { v: 'open', label: 'Chưa xong' },
  { v: 'done', label: 'Đã xong' },
  { v: 'pinned', label: 'Ghim' },
]

function NotesTools() {
  const showToast = useApp((s) => s.showToast)
  const shop = useApp((s) => s.shop)
  const settings = useApp((s) => s.settings)
  const [text, setText] = useState('')
  const [type, setType] = useState<NoteType>('todo')
  const [seg, setSeg] = useState<NoteFilterSeg>('all')
  const [query, setQuery] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editType, setEditType] = useState<NoteType>('note')
  const [delTarget, setDelTarget] = useState<Note | null>(null)
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [adding, setAdding] = useState(false)

  const notes = useLiveQuery(() => dbx.notes.filter((n) => !n.deleted).toArray(), [], [] as Note[])
  const sorted = useMemo(
    () => sortNotes(filterNotes(notes, { query, seg })),
    [notes, query, seg],
  )

  async function handleAdd() {
    if (!text.trim() || adding) { if (!text.trim()) showToast('Nhập nội dung ghi chú', 'bad'); return }
    setAdding(true)
    try {
      await addNote(text, type)
      setText('')
      showToast('✓ Đã thêm ghi chú', 'ok')
    } catch (e) {
      logError(e, 'notes.add')
      showToast('Lỗi khi lưu ghi chú', 'bad')
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete() {
    if (!delTarget) return
    try {
      await deleteNote(delTarget.id)
      if (editId === delTarget.id) setEditId(null)
      showToast('Đã xóa ghi chú', 'ok')
    } catch (e) {
      logError(e, 'notes.delete')
      showToast('Không xóa được', 'bad')
    } finally {
      setDelTarget(null)
    }
  }

  async function handleSaveEdit() {
    if (!editId || !editText.trim()) return
    try {
      await updateNote(editId, { text: editText, type: editType })
      setEditId(null)
      showToast('Đã lưu', 'ok')
    } catch (e) {
      logError(e, 'notes.update')
      showToast('Không lưu được', 'bad')
    }
  }

  async function handleCheck() {
    setChecking(true)
    try {
      const res = await runReadinessCheck(shop, settings)
      setReadiness(res)
    } catch (e) {
      logError(e, 'readiness.check')
      showToast('Lỗi khi kiểm tra', 'bad')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 pb-6 max-w-[520px] mx-auto w-full">
      <div className="card p-3 mb-3">
        <textarea
          className="field-input resize-none"
          rows={3}
          placeholder="Ghi nhanh: việc cần làm, ý tưởng…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void handleAdd()
            }
          }}
        />
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <div className="flex gap-1.5 flex-1 flex-wrap">
            {NOTE_TYPES.map((t) => (
              <button
                key={t.v}
                className="chip !text-[11px]"
                style={type === t.v ? { background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' } : {}}
                onClick={() => setType(t.v)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button className="btn-cta !w-auto !px-4" disabled={adding} onClick={() => void handleAdd()}>
            <Plus size={15} /> {adding ? '…' : 'Thêm'}
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 mb-2 overflow-x-auto pb-0.5">
        {NOTE_SEGS.map((s) => (
          <button
            key={s.v}
            className="chip !text-[11px] shrink-0"
            style={seg === s.v ? { background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' } : {}}
            onClick={() => setSeg(s.v)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <input
        className="field-input mb-3 text-sm"
        placeholder="Tìm ghi chú…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="flex flex-col gap-2">
        {sorted.map((n) => (
          <div key={n.id} className="card p-3" style={n.done ? { opacity: 0.55 } : {}}>
            {editId === n.id ? (
              <div className="flex flex-col gap-2">
                <textarea
                  className="field-input resize-none text-sm"
                  rows={3}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  autoFocus
                />
                <div className="flex gap-1.5 flex-wrap">
                  {NOTE_TYPES.map((t) => (
                    <button
                      key={t.v}
                      className="chip !text-[11px]"
                      style={editType === t.v ? { background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' } : {}}
                      onClick={() => setEditType(t.v)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 justify-end">
                  <button className="btn-ghost !w-auto !px-3" onClick={() => setEditId(null)}>Hủy</button>
                  <button className="btn-cta !w-auto !px-3" onClick={() => void handleSaveEdit()}>Lưu</button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <button
                  className="mt-0.5 shrink-0 w-5 h-5 rounded-full border flex items-center justify-center"
                  style={{
                    borderColor: n.done ? 'var(--up)' : 'var(--hair-2)',
                    background: n.done ? 'var(--up)' : 'transparent',
                  }}
                  onClick={() => void toggleNoteDone(n.id)}
                  aria-label="Đánh dấu xong"
                >
                  {n.done && <Check size={12} color="#fff" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div
                    className="text-sm whitespace-pre-wrap break-words"
                    style={{ color: 'var(--ink)', textDecoration: n.done ? 'line-through' : 'none' }}
                  >
                    {n.text}
                  </div>
                  <div className="text-[10.5px] mt-1" style={{ color: 'var(--mute)' }}>
                    {NOTE_TYPES.find((t) => t.v === n.type)?.label} · {new Date(n.date).toLocaleString('vi-VN')}
                  </div>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button className="p-1" onClick={() => void toggleNotePin(n.id)} aria-label="Ghim">
                    <Pin size={14} style={{ color: n.pinned ? 'var(--gold)' : 'var(--mute-2)' }} fill={n.pinned ? 'var(--gold)' : 'none'} />
                  </button>
                  <button
                    className="p-1"
                    onClick={() => { setEditId(n.id); setEditText(n.text); setEditType(n.type) }}
                    aria-label="Sửa"
                  >
                    <Pencil size={14} style={{ color: 'var(--mute-2)' }} />
                  </button>
                  <button className="p-1" onClick={() => setDelTarget(n)} aria-label="Xóa">
                    <Trash2 size={14} style={{ color: 'var(--mute-2)' }} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {sorted.length === 0 && (
          <EmptyState
            icon="📝"
            title={notes.length === 0 ? 'Chưa có ghi chú' : 'Không khớp bộ lọc'}
            sub={notes.length === 0 ? 'Ghi nhanh việc cần làm, ý tưởng kinh doanh' : 'Thử đổi lọc hoặc từ khóa'}
          />
        )}
      </div>

      <button
        className="btn-ghost w-full mt-4 flex items-center justify-center gap-2"
        onClick={() => void handleCheck()}
        disabled={checking}
      >
        <ShieldCheck size={16} /> {checking ? 'Đang kiểm tra…' : 'Kiểm tra sẵn sàng'}
      </button>

      <Sheet open={!!readiness} onClose={() => setReadiness(null)} title="Kiểm tra sẵn sàng">
        {readiness && (
          <div className="flex flex-col gap-2">
            <p className="text-sm mb-1" style={{ color: 'var(--mute)' }}>
              {readiness.okCount}/{readiness.total} mục ổn định cho bản dùng thật.
            </p>
            {readiness.rows.map((r) => (
              <div key={r.title} className="list-row">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium flex items-center gap-1.5" style={{ color: r.ok ? 'var(--up)' : 'var(--down)' }}>
                    {r.ok ? '✓' : '!'} <span style={{ color: 'var(--ink)' }}>{r.title}</span>
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--mute)' }}>{r.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={!!delTarget}
        title="Xóa ghi chú?"
        message="Ghi chú sẽ bị xóa vĩnh viễn."
        confirmLabel="Xóa"
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  )
}
