# Admin Control Room — Design

Date: 2026-08-19  
Status: approved in conversation (shell + fleet + detail). Awaiting spec file review.  
Scope: rebuild `3su-next` admin Vite app (port 5192) to match the dark control-room mockups. No new Worker endpoints this pass.

## Goal

Admin looks like the three mockups (Tổng quan, Đội shop, Chi tiết) and only shows numbers the current `/v1/admin/shops` APIs already return. Missing mockup fields are omitted or shown as `—`, never invented.

## Non-goals

- New D1 tables or Worker routes (no audit log, no device presence, no global ops/day rollup).
- Fake heatmap / fake “máy online” / fake “op hôm nay”.
- CSV export, row ⋮ menu, mời thành viên, email/online per member.
- Putting admin inside the seller POS nav.
- Changing license gate, usage tracker, or login credentials.

## Visual

- Dark navy shell: page `#0B1220`, cards `#111827`, borders `#1F2937`, text `#E5E7EB` / mute `#94A3B8`.
- Accents: sống `#10B981`, chậm / premium / hạn gần `#F59E0B`, khoá / nguy hiểm `#F43F5E`, gói trial `#64748B`, owner chip `#8B5CF6`.
- Login keeps username/password; restyle to the same dark gate (no new auth).
- Desktop-first. No new icon library required; lucide-react is already in `3su-next` if needed.

## Routes

| Path | Screen |
| --- | --- |
| `/` | Tổng quan (dashboard) |
| `/shops` | Đội shop (fleet) |
| `/shops/:id` | Chi tiết (current `/:id` moves here) |
| `/alerts` | Cảnh báo — derived from the same shop list |
| `/log` | Nhật ký — empty state only |

Old `/ :id` redirects to `/shops/:id`.

## Shell

- Top bar: brand `3SU Control`, search “Tìm shop, Gmail, SĐT…”, clock `dd/MM HH:mm` Asia/Ho_Chi_Minh, `admin` + Đăng xuất.
- Search filters the in-memory shop list (name, shopId, ownerEmail, ownerUid, phone). On `/` and `/shops` it filters the table. Submitting on other pages navigates to `/shops?q=`.
- Sidebar: Tổng quan, Đội shop, Cảnh báo (badge = alert count), Nhật ký.
- One `GET /v1/admin/shops` load in a small admin store/context; pages share it. Refresh button on fleet refetches.

## Shared derived fields

Computed on the client from `AdminShop`. No server change.

**Health** (`sống` | `chậm` | `offline` | `khoá`):

- `status === 'locked'` → `khoá`
- else `lastOpAt` within 1 hour → `sống`
- else `lastOpAt` within 24 hours → `chậm`
- else → `offline`

**Expiring soon:** `status` not `locked`, `expiresAt != null`, and days left in `[0, 7]`.

**Alert row** (for `/alerts` and sidebar count):

- last sync older than 48 hours (or never), and not locked
- trial/active with days left in `[0, 7]`
- `status === 'expired'`
- `status === 'locked'`

A shop can match more than one reason: one table row per shop, reasons stacked in that row.

**License bar (detail):**

- Unlimited (`expiresAt == null`): label `Không hạn`, no fill bar.
- Otherwise: `usedDays = floor((now - createdAt) / 1d)`, `totalDays = max(1, ceil((expiresAt - createdAt) / 1d))`, `leftDays = ceil((expiresAt - now) / 1d)`. Bar fill = `usedDays / totalDays` clamped 0–1. Copy: `Đã dùng {used} / {total} ngày` and `Hết hạn {date} · còn {n} ngày` (or `đã hết` if `leftDays < 0`).

**Usage column (list):** primary `fmtDuration(todaySeconds)`; secondary `Đã mở {n} ngày` from `createdAt`.

## Tổng quan `/`

- Four KPI cards from the loaded list: tổng cửa hàng; số `sống`; số sắp hết hạn; số `locked`.
- No 7-day “lượt đồng bộ” chart (API cannot supply it).
- Replacement block: top 8 shops by `todaySeconds` descending, name + duration. Empty: `Chưa có giờ dùng hôm nay`.
- Compact table: same columns as fleet, first 10 shops by `updatedAt` already returned by API (`ORDER BY updated_at DESC`). Row click → `/shops/:id`.

## Đội shop `/shops`

Columns:

1. Cửa hàng — name + shopId
2. Liên hệ — ownerEmail (or uid) + phone
3. Gói — `plan` badge
4. Tình trạng — health pill
5. Sử dụng — hôm nay + đã mở
6. Thời hạn — `còn N ngày` / `Không hạn` / `đã hết` + remaining-time bar (green if >7, amber if ≤7, gray if expired/unlimited)
7. Sync cuối — relative time; red if age ≥ 48h or missing

Left (or toolbar) filters: Tất cả / Sống / Chậm / Offline / Khoá / Sắp hết — counts from the current list. Combine with search (AND).

Actions: Làm mới. No CSV. No ⋮.

## Chi tiết `/shops/:id`

`GET /v1/admin/shops/:id` (already includes `usage[]` and `members`).

- Breadcrumb `← Đội shop`.
- Title: name or `(chưa đặt tên)`, health badge, shopId + copy.
- **Thông tin cửa hàng:** Gmail, SĐT, địa chỉ, UID chủ + copy, member count.
- **Giấy phép:** plan badge, license bar, expiry line, `+1 / +3 / +6 / +12` tháng (existing `extend`), Khoá (reason optional) / Mở khoá.
- **Hoạt động:** Sync cuối; giờ dùng hôm nay; TB/ngày and tổng 30 ngày if present. No “máy đang online”, no “op hôm nay”.
- **Heatmap 14 ngày:** one row of 14 cells, oldest on the left, today on the right. Intensity from that day’s `usage.seconds` (0 = empty cell, else scale to amber). Days with no usage row = 0. Title under cell: `dd/MM`. Hover title: date + `fmtDuration`.
- **Thành viên:** UID, vai trò (`owner` → Chủ sở hữu, else Nhân viên), ngày tham gia. No email, online, invite, ⋮.
- No nhật ký block on this page.

## Cảnh báo `/alerts` and Nhật ký `/log`

- Alerts: table of shops matching alert rules, reason text, link to detail.
- Log: copy `Chưa ghi nhật ký admin.` No fake entries.

## Files (implementation boundary)

Stay inside `3su-next/src/admin/` plus this spec. Reuse `api.ts` helpers (`fmtDuration`, `fmtAgo`, `daysLeft`, `daysUsed`, extend/lock). Restyle `admin.css` (or split `admin-dark.css`) — do not change seller `web/` / `mobile/` CSS.

Suggested split (not a mandate if a file stays small):

- `layout.tsx` — shell, sidebar, search, clock
- `health.ts` — health + alerts + license bar math (unit-testable)
- `Dashboard.tsx`, `ShopList.tsx`, `ShopDetail.tsx`, `Alerts.tsx`, `Log.tsx`
- `App.tsx` — routes + session + shared shop list

## Testing

- Unit tests for `health.ts`: locked wins over lastOp; 1h/24h/48h boundaries; unlimited license bar; expiring-soon at 0 and 7 days.
- Manual: login `admin` / `admin1234` on `localhost:5192`, walk 5 routes, extend/lock still work, search filters, heatmap empty vs after POS usage.

## Open decisions (resolved)

- Theme: dark control-room, not light 3SU web.
- Data honesty: no placeholders that look like real metrics.
- Usage: show **today’s hours** plus days-since-open (not days-only as in the fleet mockup).
- Nhật ký nav stays, page is empty.
