# Toh's Sign Partner Portal: Design Spec

Date: 2026-11-19
Source plan: whiteboard https://claude.ai/artifact/7o9xyh285bkSJuy2jNcU9q (Toh's Sign Informatic – 合作伙伴系统)
Repo: https://github.com/Cri3pyOnion/Partnership-Dashboard (private)
Address: https://partners.tohssignlicense.com

## 1. What it is

A private staff dashboard (4–6 users from Transmission, 市场部 and IT) for registering partners, keying in cases, and tracking commission. It also gives each partner a **view-only page with no login**, opened from a private link.

**The partner page is the most important part.** It must be fast on phones, always available, and show a partner only their own safe data.

## 2. Decisions already made (user, 2026-11-19)

| Topic | Decision |
|---|---|
| App or website | Website |
| Hosting | Cloudflare (Workers + static assets, Access, KV, R2), free plan |
| Database / files | Supabase, **new company account**, Singapore region; Free plan first, Pro (US$25/mo) once partners rely on it |
| Repo | `Cri3pyOnion/Partnership-Dashboard` on GitHub |
| Domain | `partners.tohssignlicense.com` |
| Case data | Keyed in by staff in the dashboard (no MIS link) |
| Commission rules | Admin settings, starting from the demo's numbers (§6); changeable anytime |
| Partner access | Private per-partner link, no login, read-only |
| Staff access | Cloudflare Access email one-time code, staff emails only |
| WhatsApp | "Send on WhatsApp" button (wa.me link), staff press send; no paid API |
| Budget | US$0/month to launch; Supabase Pro later |

## 3. Users

- **Partner** (accountant, company secretary, property agent, renovation contractor): opens `/p/<link>` on a phone and sees their cases and commission. Cannot edit anything.
- **Staff** (role `staff`): registers partners, creates and updates cases, uploads documents, sends WhatsApp updates.
- **Admin** (role `admin`, e.g. Joshua): everything staff can do, plus approve partners, mark commission paid, edit settings, and manage the staff list.

## 4. Data

Field names follow the whiteboard's 伙伴登记表, 伙伴名单 and 门户需储存的数据.

**Partner (伙伴)**
- 伙伴编号: `TSP0001`, `TSP0002`, … assigned automatically
- 姓名 Name\*, 电话 Phone\* (+60), 电邮 Email\*
- 税号 TIN: individuals start with `IG`, companies with `C`
- 公司名称 Company, 推荐人 Referral
- 伙伴代码\*: `A1` / `B1` / `C1`
- 填写团队: `Transmission` / `市场部`
- 来源: `上门` / `线上`
- Bank name and bank account: staff-only
- 状态: `待审核` → `活跃` / `不活跃`
- 登记日期, and the private view link

**Case (案件)**
- 案件编号: `TS-YYMM-NNN`, e.g. `TS-2611-014`; the counter restarts each month (Malaysia time)
- Partner, client / business name, client phone (staff-only)
- Licence type, from an editable list: 营业执照, 招牌执照, 清真认证 (JAKIM), SSM 公司注册, 消防证书 (BOMBA)
- Council (free text, e.g. MBPJ, DBKL, MBSJ)
- Status step, missing documents note, submitted date
- Price (our invoice amount, RM), markup (C1 only), invoice number, client paid (yes/no and date), cancelled flag
- Internal notes (staff-only)

**Status steps (fixed order):** `已收件` → `待补文件` → `已递交政府部门` → `实地检查` → `已批准` → `已完成`. A cancelled case shows `已取消`.

**Other records**
- Case documents (SSM, IC, lease, shop photos): **staff-only, never shown to partners**
- Commission: one per case
- Status history
- Link-view log
- Audit log
- Settings

## 5. Partner view page (`/p/<link>`)

**Shows:**
- Partner name, company, 伙伴编号 and 伙伴代码
- Four tiles: 进行中案件, 已完成, plus pending and paid money:
  - A1 / C1: 待发佣金, 已发佣金
  - B1: 待付给 Toh's Sign, 已与 Toh's Sign 结清
- Per case: 案件编号, client name, licence (and council), submitted date, a six-step timeline with the current step, missing documents, the partner's commission or amount owed, and the commission status
- For B1: 此客户由你直接负责 – 请把文件清单转发给客户。
- Monthly totals, the "last updated" time, and a WhatsApp contact button for 市场部

**Never shows:**
- Bank details, IC / SSM / any document, client phone, internal notes
- Other partners, staff names, prices of other cases

**Rules:**
- The link is a 43-character random code that can't be guessed. Staff can **reset** it: the old link stops working at once.
- A link is issued only when a partner is approved (`活跃`). A `不活跃` partner's link keeps working until reset.
- A bad, old or malformed link shows the same plain "链接无效" page and reveals nothing.
- The page is pre-built and stored in Cloudflare KV. If Supabase is slow or paused, the last saved page is still served, with its "更新于" time.
- The page is rebuilt whenever that partner's data changes.
- Search engines must not index it, and it must not send the link to other sites as a referrer.
- Each open is logged (time, country). Logging failures never break the page.
- Mobile-first, Chinese with short English sub-labels (the same style as the 登记表).

## 6. Commission rules (admin settings; defaults from the demo)

- **A1:** fixed referral fee. Default RM100 if the price is below RM1,500, RM150 at RM1,500 or more. Status `待处理` → `可发放` (automatically, once the client has paid) → `已支付` (an admin marks it).
- **C1:** commission = the case markup. The client pays price + markup. Optional markup cap (default: none); a markup above the cap is rejected with `加价超过上限`. Status as A1.
- **B1:** the partner pays Toh's Sign the partner price, default 80% of the price. Status `待付发票` → `已结清` once the partner has paid. Optional setting "collect before submitting" (default off): when on, a B1 case cannot move to `已递交政府部门` until it is `已结清`.
- A cancelled case gets amount 0.
- Once a commission is `已支付`, it never changes again, even if the price or rules change later.
- A partner can change code. Each existing commission keeps the code it was calculated with; new cases use the new code.
- Who can mark `已支付`: admins only (setting; can be widened to staff).

The whiteboard's open questions (待共同决定 1–6) are all settings or covered above, so they don't block the build.

## 7. Staff dashboard (`/admin`)

1. **伙伴**
   - List with search and status filter
   - 登记表 using the demo's fields and checks (phone, email, TIN formats)
   - Partner detail: approve, copy link, send link on WhatsApp, reset link, change code, edit, set 不活跃
2. **案件**
   - List with filters (partner, status, month)
   - New case form
   - Case detail: step buttons, missing documents, price / markup / invoice number / client paid, document upload and download, "send update on WhatsApp"
3. **佣金**
   - Month view by partner and status, and mark 已支付 (admin)
   - Printable monthly statement per partner (browser "save as PDF"), sent on the 1st of each month
4. **报表**
   - Cases and revenue per partner per month
   - Inactive partners (no new case in N days, default 90) for Transmission
5. **设置** (admin)
   - Commission rules, licence-type list, inactive days, staff list (email, name, role, team)

All staff actions are written to the audit log.

## 8. Files

- Private Supabase Storage bucket `case-documents`.
- Uploads and downloads use short-lived signed links made by the server.
- Photos are shrunk in the browser before upload (longest side 1600 px, JPEG quality 0.75).
- PDFs are uploaded as-is. The size limit is 10 MB per file.

## 9. Security

- Staff pages and staff API sit behind Cloudflare Access (one-time email codes, staff emails only). The server also checks the Access token and the staff table.
- The browser never talks to Supabase directly. Only the server holds the Supabase service key. All tables have row-level security turned on with no public policies.
- All text from staff or partners is escaped in every page.

## 10. Backups

- Every night at 02:00 Malaysia time, GitHub Actions dumps the database, compresses it, and uploads it to the private Cloudflare R2 bucket `partner-portal-backups`. Dumps are kept 30 days.
- This replaces the whiteboard's Google Drive idea: R2 is free up to 10 GB and simpler.
- A written restore guide, with one restore test into the dev project before launch.

## 11. Out of scope for this build (later)

- Public online partner-recruitment page (board step 1 线上伙伴线索). Could go on the company WordPress site.
- Partners submitting cases themselves (needs partner login)
- Automatic WhatsApp / email sending
- Link to TSI MIS
- Optional 4-digit PIN on partner links
