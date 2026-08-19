/**
 * Panel auth — ảnh kho thật + card Phiếu nhập thật của app nổi phía trên.
 * Thông điệp: app đọc hoá đơn → hàng vào kho (kho là ảnh, phiếu nhập là UI app).
 */
const ROWS = [
  { name: 'Mì tôm thùng', qty: 12, cost: '118.000', match: 'Mì tôm (thùng)' },
  { name: 'Sữa tươi 1L', qty: 24, cost: '28.500', match: 'Sữa tươi 1L' },
  { name: 'Nước suối thùng', qty: 8, cost: '52.000', match: 'Nước suối (thùng)' },
  { name: 'Dầu ăn 5L', qty: 6, cost: '185.000', match: '' },
]

export function AuthStage() {
  return (
    <div className="auth-stage" aria-hidden="true">
      <img
        className="auth-stage-art"
        src="/auth-stage.webp?v=mau"
        alt=""
        draggable={false}
      />
      <div className="auth-stage-card">
        <div className="asc-head">
          <span className="asc-title">Phiếu nhập</span>
          <span className="asc-sub">Số HĐ 0000847 · Minh An</span>
        </div>
        <div className="asc-section">Dòng hàng (4) · 1 mới</div>
        <div className="asc-rows">
          {ROWS.map((r, i) => (
            <div className="asc-row" key={i} style={{ animationDelay: `${i * 0.5 + 0.3}s` }}>
              <div className="asc-row-name">{r.name}</div>
              <div className={`asc-match${r.match ? ' on' : ''}`}>
                {r.match ? `Khớp: ${r.match}` : 'Tạo sản phẩm mới'}
              </div>
              <div className="asc-row-grid">
                <span><i>SL</i><b>{r.qty}</b></span>
                <span><i>Giá vốn</i><b>{r.cost}</b></span>
                <span><i>Giá bán</i><b>{r.cost}</b></span>
              </div>
            </div>
          ))}
        </div>
        <div className="asc-foot">
          <span className="asc-total">Tổng tiền nhập <b>4.182.000</b></span>
          <span className="asc-save">Lưu phiếu nhập</span>
        </div>
      </div>
    </div>
  )
}
