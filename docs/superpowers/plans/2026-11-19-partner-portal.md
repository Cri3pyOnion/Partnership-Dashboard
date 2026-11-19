# Toh's Sign Partner Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a staff dashboard and a no-login, view-only partner page at `partners.tohssignlicense.com`, running on Cloudflare's free plan with Supabase.

**Architecture:**
- One Cloudflare Worker (Hono) serves three things:
  - the server-rendered partner page `/p/:token`, pre-built into KV so it survives a slow or paused database;
  - the staff JSON API `/api/admin/*`;
  - the staff React app `/admin/*` as static assets.
- Cloudflare Access guards `/admin*` and `/api/admin*`, and the Worker re-checks the Access token. Only the Worker talks to Supabase, using the service key.
- A GitHub Actions job backs the database up nightly to R2.

**Tech Stack:**
- TypeScript (strict), Hono 4, Wrangler 4, Cloudflare Workers + static assets + KV + Access + R2
- Supabase (Postgres, Storage) with `@supabase/supabase-js` 2, `jose` 5
- React 18.3.1 + Vite 6 for the staff app
- Vitest 3 + `@cloudflare/vitest-pool-workers` + `@testing-library/react`

**Spec:** `docs/superpowers/specs/2026-11-19-partner-portal-design.md`

## Global Constraints

- Repo: `https://github.com/Cri3pyOnion/Partnership-Dashboard`, branch `main`; one commit per task step marked Commit.
- Node 22 LTS. Every dependency pinned to an exact version at least 2 weeks old when installed.
- Time zone for every date and case-month: `Asia/Kuala_Lumpur`.
- Money is stored as `numeric(10,2)` in RM and shown as `RM 1,800` (`toLocaleString('en-MY')`).
- IDs: partner `TSP` + 4 digits (`TSP0001`); case `TS-YYMM-NNN` (`TS-2611-014`), with the counter reset per month.
- Status steps, exact strings and order: `已收件`, `待补文件`, `已递交政府部门`, `实地检查`, `已批准`, `已完成`. A cancelled case shows `已取消`.
- Commission statuses: A1/C1 `待处理` / `可发放` / `已支付`; B1 `待付发票` / `已结清`.
- Partner statuses: `待审核` / `活跃` / `不活跃`. Teams: `Transmission` / `市场部` / `IT`. Sources: `上门` / `线上`.
- Partner page never contains: bank fields, documents, client phone, internal notes, other partners' data.
- The browser never receives the Supabase URL or keys. Every table has RLS on with no anon/auth policies.
- UI language: Chinese, with short English sub-labels as in the 登记表 demo (`姓名 Name`).
- Two Supabase projects in the new company org: `partner-portal-dev` (tests and previews) and `partner-portal-prod`, both in region `ap-southeast-1` (Singapore).

## Review Focus

1. **Wrong, old or garbage link**: someone types `/p/abc`, an old link after a reset, or another partner's link with one character changed. Expect the same `链接无效` page with status 404, no partner data, and no database call for malformed tokens. *(Task 6 tests)*
2. **Database paused or down**: Supabase Free pauses, or a request fails. Expect partners to still get their last saved page with its `更新于` time; staff see a clear error, never a blank screen. *(Task 6, Task 8 tests)*
3. **Editing a case after commission is paid**: staff change the price, markup or code on a case whose commission is `已支付`. Expect the paid amount and status to stay exactly as they were. *(Task 2, Task 8 tests)*
4. **Names containing `<`, `&` or quotes** (for example `Lim & Co. <Accounting>`) in client, company or note fields. Expect them shown literally on the partner page, statements and dashboard, never run as HTML. *(Task 6, Task 11 tests)*
5. **Two staff creating cases at the same moment, or across a month change at 23:59 / 00:00 MYT.** Expect unique case IDs in the right month's sequence. *(Task 3 smoke test, Task 4 contract test)*

---

## Task 0: Accounts and access (user does these; Claude guides)

No code. Each item ends with something Claude needs, which you put in the repo's secrets or tell Claude.

- [ ] **Cloudflare account** with the company email; on the free plan.
- [ ] **Domain on Cloudflare**: add `tohssignlicense.com` to Cloudflare (free) and change its nameservers at the registrar.
  - *Before switching,* check every existing DNS record has been copied: the `mis` record and the email (MX/TXT) records especially, or MIS and email will break.
  - If the domain is already on Cloudflare, skip this.
- [ ] **Cloudflare Zero Trust** free team (choose a team name, e.g. `tohsign`). It may ask for a card; the free plan charges nothing.
- [ ] **R2** enabled. It may also ask for a card; 10 GB is free.
- [ ] **Supabase**: new organization under the company email; create `partner-portal-dev` and `partner-portal-prod` in Singapore.
- [ ] **GitHub**: confirm `Cri3pyOnion/Partnership-Dashboard` exists and is private. Then add these Actions secrets:
  - `SUPABASE_DB_URL_PROD`
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`
  - `R2_ENDPOINT`
- [ ] **Staff list**: the 4–6 staff emails, plus each person's name, role (`admin` / `staff`) and team.
- [ ] **市场部 WhatsApp number**, shown on the partner page.

---

## Task 1: Repo setup and shared basics

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.jsonc`, `vitest.config.ts`, `.gitignore`, `README.md`
- Create: `src/shared/status.ts`, `src/shared/types.ts`, `src/shared/ids.ts`, `src/shared/validate.ts`, `src/shared/money.ts`
- Test: `test/shared/ids.test.ts`, `test/shared/validate.test.ts`

**Interfaces:**
- Produces:
  - `CASE_STEPS: readonly ['已收件','待补文件','已递交政府部门','实地检查','已批准','已完成']`
  - `type StepIndex = 0|1|2|3|4|5`
  - `STEP_CANCELLED = '已取消'`
  - `type PartnerCode = 'A1'|'B1'|'C1'`
  - `type PartnerStatus = '待审核'|'活跃'|'不活跃'`
  - `type Team = 'Transmission'|'市场部'|'IT'`
  - `type Source = '上门'|'线上'`
  - `type CommissionStatus = '待处理'|'可发放'|'已支付'|'待付发票'|'已结清'`
  - interfaces `Partner`, `Case`, `Commission`, `CommissionRules`, `Settings`, `Staff`. Fields as spec §4, camelCase: `id, name, phone, email, tin, company, code, referralName, filledBy, source, bankName, bankAccount, status, viewToken, registeredAt` / `id, partnerId, clientName, clientPhone, licenceType, council, step, cancelled, missingDocs, submittedAt, price, markup, invoiceNo, clientPaid, clientPaidAt, notesInternal`.
  - `formatPartnerId(n: number): string`
  - `formatCaseId(date: Date, n: number): string` (MYT year/month)
  - `normalizePhone(s: string): string | null` (returns `+60…`)
  - `normalizeTin(s: string): string | null`
  - `isEmail(s: string): boolean`
  - `rm(n: number): string`

- [ ] **Step 1:** Create the repo files.
  - `wrangler.jsonc`:
    - name `partner-portal`, `main: src/worker/index.ts`
    - `assets: { directory: "dist/admin", not_found_handling: "single-page-application", run_worker_first: ["/p/*", "/api/*"] }`
    - KV binding `VIEWS`
    - vars `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `SUPABASE_URL`, `MARKETING_WHATSAPP`
    - secret `SUPABASE_SERVICE_ROLE_KEY` (not committed)
  - Scripts: `dev`, `build` (vite build to `dist/admin`), `test`, `deploy`.
- [ ] **Step 2: Write failing tests**
```ts
expect(formatPartnerId(1)).toBe('TSP0001'); expect(formatPartnerId(123)).toBe('TSP0123');
expect(formatCaseId(new Date('2026-11-03T02:00:00Z'), 14)).toBe('TS-2611-014');
expect(formatCaseId(new Date('2026-11-30T16:30:00Z'), 1)).toBe('TS-2612-001'); // 00:30 MYT on 1 Dec
expect(normalizePhone('+60 12-338 4521')).toBe('+60123384521');
expect(normalizePhone('012-338 4521')).toBe('+60123384521');
expect(normalizePhone('03-1234 5678')).toBeNull();
expect(normalizeTin('ig 2301 9844 050')).toBe('IG23019844050');
expect(normalizeTin('C2584463202')).toBe('C2584463202');
expect(normalizeTin('12345')).toBeNull();
expect(isEmail('weiming@twmaccounting.my')).toBe(true); expect(isEmail('a@b')).toBe(false);
expect(rm(1800)).toBe('RM 1,800'); expect(rm(1440.5)).toBe('RM 1,440.50');
```
- [ ] **Step 3:** Run `npm test`. Expected: FAIL (functions not defined).
- [ ] **Step 4:** Implement the shared files. The rules come from the 登记表 demo:
  - phone: strip a leading `+60` or `0`, then the rest must match `/^1[0-9][0-9 -]{6,10}$/`; return `+60` plus the digits only;
  - TIN: remove spaces, uppercase, then match `/^[A-Z]{1,2}[0-9]{8,12}$/`;
  - email: `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`.
- [ ] **Step 5:** Run `npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `chore: project setup and shared types, ids, validation`.

## Task 2: Commission rules

**Files:**
- Create: `src/shared/commission.ts`
- Test: `test/shared/commission.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - `DEFAULT_RULES: CommissionRules`, equal to `{ A1:{threshold:1500, below:100, above:150}, B1:{partnerPricePercent:80, collectBeforeSubmit:false}, C1:{maxMarkup:null}, paidMarkedBy:'admin' }`
  - `calcCommission(c: Pick<Case,'price'|'markup'|'clientPaid'|'cancelled'>, code: PartnerCode, rules: CommissionRules): { amount: number; basis: string; status: CommissionStatus }`
  - `applyCommission(existing: Commission | null, next: ReturnType<typeof calcCommission>, code: PartnerCode): Commission`. This keeps `existing` unchanged when its status is `已支付`, and keeps the existing `code`.
  - `class ValidationError extends Error`

- [ ] **Step 1: Write failing tests**
```ts
const paid = { clientPaid: true, cancelled: false, markup: null };
expect(calcCommission({ ...paid, price: 1800 }, 'A1', DEFAULT_RULES)).toEqual({ amount: 150, basis: '固定推荐费 (A1)', status: '可发放' });
expect(calcCommission({ ...paid, price: 900, clientPaid: false }, 'A1', DEFAULT_RULES).status).toBe('待处理');
expect(calcCommission({ ...paid, price: 900 }, 'A1', DEFAULT_RULES).amount).toBe(100);
expect(calcCommission({ ...paid, price: 1500 }, 'A1', DEFAULT_RULES).amount).toBe(150);
expect(calcCommission({ ...paid, price: 1800, markup: 300 }, 'C1', DEFAULT_RULES))
  .toEqual({ amount: 300, basis: '在 RM 1,800 上加价（客户支付 RM 2,100）', status: '可发放' });
expect(() => calcCommission({ ...paid, price: 1800, markup: 600 }, 'C1', { ...DEFAULT_RULES, C1: { maxMarkup: 500 } })).toThrow('加价超过上限');
expect(calcCommission({ ...paid, price: 1800 }, 'B1', DEFAULT_RULES))
  .toEqual({ amount: 1440, basis: '伙伴价 = RM 1,800 的 80%', status: '已结清' });
expect(calcCommission({ ...paid, price: 1800, clientPaid: false }, 'B1', DEFAULT_RULES).status).toBe('待付发票');
expect(calcCommission({ ...paid, price: 1800, cancelled: true }, 'A1', DEFAULT_RULES)).toEqual({ amount: 0, basis: '案件已取消', status: '待处理' });
// paid commission frozen
const done = { caseId: 'TS-2609-012', code: 'A1', amount: 150, basis: '固定推荐费 (A1)', status: '已支付' } as Commission;
expect(applyCommission(done, { amount: 100, basis: 'x', status: '可发放' }, 'C1')).toEqual(done);
```
- [ ] **Step 2:** Run `npm test -- commission`. Expected: FAIL.
- [ ] **Step 3:** Implement `calcCommission` and `applyCommission` in `src/shared/commission.ts`. Round B1 amounts to 2 decimals.
- [ ] **Step 4:** Run `npm test -- commission`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: commission rules A1/B1/C1 with frozen paid amounts`.

## Task 3: Database schema

**Files:**
- Create: `supabase/migrations/20261119000001_init.sql`, `supabase/seed.sql`, `supabase/tests/smoke.sql`, `supabase/config.toml` (`npx supabase init`)

**Interfaces:**
- Produces:
  - Tables:
    - `staff(email pk, name, role check ('admin','staff'), team, active)`
    - `partners(id text pk, name, phone, email, tin, company, code, referral_name, filled_by, source, bank_name, bank_account, status, view_token text unique, registered_at date, created_at, updated_at)`
    - `cases(id text pk, partner_id fk, client_name, client_phone, licence_type, council, step smallint check 0–5, cancelled bool, missing_docs, submitted_at date, price numeric(10,2), markup numeric(10,2), invoice_no, client_paid bool, client_paid_at date, notes_internal, created_at, updated_at)`
    - `case_steps_history(id bigserial, case_id, step, changed_at, changed_by)`
    - `case_documents(id uuid, case_id, storage_path, filename, kind, uploaded_by, uploaded_at)`
    - `commissions(case_id pk fk, code, amount, basis, status, paid_at, paid_by, updated_at)`
    - `settings(key pk, value jsonb)` holding `commission_rules`, `licence_types`, `inactive_days`
    - `link_views(id bigserial, partner_id, viewed_at, country)`
    - `audit_log(id bigserial, staff_email, action, entity, entity_id, details jsonb, at)`
  - Functions:
    - `next_partner_id() returns text`, using sequence `partner_seq`
    - `next_case_id(at timestamptz default now()) returns text`, using table `case_counters(yymm text pk, n int)` and `insert … on conflict do update set n = n + 1 returning n`, so concurrent calls never share a number
  - Storage bucket `case-documents` (private).

- [ ] **Step 1: Write the smoke test** `supabase/tests/smoke.sql`. It runs in a transaction and rolls back:
```sql
select next_partner_id() = 'TSP0001';
select next_case_id('2026-11-03 10:00+08') = 'TS-2611-001';
select next_case_id('2026-11-03 10:00+08') = 'TS-2611-002';
select next_case_id('2026-11-30 23:59+08') = 'TS-2611-003';
select next_case_id('2026-12-01 00:00+08') = 'TS-2612-001';
select count(*) = 0 from pg_tables where schemaname='public' and rowsecurity = false;  -- RLS on everywhere
select count(*) = 0 from pg_policies where schemaname='public';                      -- no public policies
```
- [ ] **Step 2:** Run against the dev project: `psql "$SUPABASE_DB_URL_DEV" -v ON_ERROR_STOP=1 -f supabase/tests/smoke.sql`. Expected: FAIL (functions missing).
- [ ] **Step 3:** Write the migration.
  - Use `check` constraints holding the exact status, code, team and source strings from Global Constraints.
  - Run `alter table … enable row level security` on every table.
  - Default settings rows hold `DEFAULT_RULES` from Task 2, `licence_types = ["营业执照","招牌执照","清真认证 (JAKIM)","SSM 公司注册","消防证书 (BOMBA)"]` and `inactive_days = 90`.
  - Apply with `npx supabase db push --db-url "$SUPABASE_DB_URL_DEV"`.
- [ ] **Step 4:** Add `seed.sql`, holding the board's 10 demo partners (`TSP0001`–`TSP0010`) and the 5 demo cases, for the dev project only. Then re-run the smoke test. Expected: every line returns `t`.
- [ ] **Step 5: Commit** `feat: database schema, id functions, RLS, seed`.

## Task 4: Data access layer

**Files:**
- Create: `src/worker/repo.ts` (interface), `src/worker/supabase-repo.ts`, `test/fake-repo.ts`
- Test: `test/repo.contract.ts` (shared cases), `test/repo.fake.test.ts`, `test/repo.supabase.test.ts` (runs only when `SUPABASE_TEST_URL` is set)

**Interfaces:**
- Consumes: Task 1 types, Task 3 schema.
- Produces `interface Repo`:
  - `getStaff(email: string): Promise<Staff | null>`
  - `listPartners(f: { status?: PartnerStatus; q?: string }): Promise<Partner[]>`
  - `getPartner(id: string): Promise<Partner | null>`
  - `getPartnerByToken(token: string): Promise<Partner | null>`
  - `createPartner(input: NewPartner, by: string): Promise<Partner>` (assigns `next_partner_id()`, status `待审核`)
  - `updatePartner(id: string, patch: Partial<Partner>, by: string): Promise<Partner>`
  - `listCases(f: { partnerId?: string; step?: StepIndex; month?: string }): Promise<Case[]>`
  - `getCase(id: string): Promise<Case | null>`
  - `createCase(input: NewCase, by: string): Promise<Case>` (assigns `next_case_id()`, step 0)
  - `updateCase(id: string, patch: Partial<Case>, by: string): Promise<Case>` (writes a history row when `step` changes)
  - `getCommission(caseId: string): Promise<Commission | null>`
  - `listCommissions(f: { partnerId?: string; month?: string }): Promise<Commission[]>`
  - `saveCommission(c: Commission): Promise<void>`
  - `getSettings(): Promise<Settings>`
  - `saveSettings(s: Settings, by: string): Promise<void>`
  - `logLinkView(partnerId: string, country: string | null): Promise<void>`
  - `listLinkViews(partnerId: string, limit: number): Promise<Array<{ viewedAt: string; country: string | null }>>`
  - `listStaff(): Promise<Staff[]>`
  - `saveStaff(s: Staff, by: string): Promise<void>`
  - `listDocuments(caseId: string)`
  - `addDocument(d: NewDocument, by: string)`
  - `audit(by: string, action: string, entity: string, id: string, details?: object): Promise<void>`
  - Both `SupabaseRepo(url, serviceKey)` and `FakeRepo()` implement it.

- [ ] **Step 1:** Write the contract tests as `runRepoContract(make: () => Promise<Repo>)`:
  - `createPartner` returns `TSP0001`, then `TSP0002`, with status `待审核`;
  - `Promise.all` of 5 `createCase` calls returns 5 distinct ids;
  - `updateCase` changing `step` from 0 to 2 adds one history row;
  - `getPartnerByToken('x'.repeat(43))` returns null;
  - `getSettings()` returns the defaults.
- [ ] **Step 2:** Run `npm test -- repo`. Expected: FAIL.
- [ ] **Step 3:** Implement `FakeRepo` (in-memory, using Task 1 `formatCaseId`) and `SupabaseRepo` (supabase-js with `{ auth: { persistSession: false } }`, ids through `rpc('next_partner_id')` / `rpc('next_case_id')`, snake_case ↔ camelCase mapping in one place).
- [ ] **Step 4:** Run `npm test -- repo`, then `SUPABASE_TEST_URL=… SUPABASE_TEST_KEY=… npm test -- repo.supabase` against the dev project. Expected: PASS both.
- [ ] **Step 5: Commit** `feat: repo interface with Supabase and in-memory implementations`.

## Task 5: Staff sign-in check (Cloudflare Access)

**Files:**
- Create: `src/worker/access.ts`, `src/worker/env.ts`
- Test: `test/worker/access.test.ts`

**Interfaces:**
- Consumes: `Repo.getStaff`.
- Produces:
  - `type Env = { VIEWS: KVNamespace; ASSETS: Fetcher; ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string; SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string; MARKETING_WHATSAPP: string }`
  - `requireStaff(opts?: { role?: 'admin'; jwks?: JWTVerifyGetKey }): MiddlewareHandler`. It reads `Cf-Access-Jwt-Assertion`, verifies it with `jose.jwtVerify` (JWKS `https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`, audience `ACCESS_AUD`), loads the active staff member by the token's `email`, and sets `c.var.staff`.

- [ ] **Step 1: Write failing tests.** Generate a local key pair with `jose.generateKeyPair('RS256')` and pass it as `jwks`. Cases:
  - no header → 401;
  - token with the wrong `aud` → 401;
  - expired token → 401;
  - valid token, email not in staff → 403;
  - inactive staff → 403;
  - role `staff` on an admin-only route → 403;
  - valid admin → 200 with `c.var.staff.email`.
- [ ] **Step 2:** Run `npm test -- access`. Expected: FAIL.
- [ ] **Step 3:** Implement `requireStaff`, with the JWKS cached per Worker instance.
- [ ] **Step 4:** Run `npm test -- access`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: verify Cloudflare Access token and staff role`.

## Task 6: Partner view page `/p/:token` (most important)

**Files:**
- Create: `src/worker/token.ts`, `src/worker/view-model.ts`, `src/worker/partner-page.ts`, `src/worker/partner-page.css.ts`, `src/worker/view-cache.ts`, `src/worker/routes/partner-view.ts`, `src/worker/index.ts`
- Test: `test/worker/view-model.test.ts`, `test/worker/partner-page.test.ts`, `test/worker/partner-route.test.ts` (vitest-pool-workers with miniflare KV)

**Interfaces:**
- Consumes: `Repo`, Task 2 `calcCommission`, Task 1 `CASE_STEPS`, `rm`.
- Produces:
  - `newViewToken(): string` (32 random bytes, base64url, 43 chars)
  - `isTokenShape(t: string): boolean` (`/^[A-Za-z0-9_-]{43}$/`)
  - `hashToken(t: string): Promise<string>` (SHA-256 hex)
  - `type PartnerView = { partner: {id,name,company,code}; tiles: {active:number; done:number; pending:number; paid:number; pendingLabel:string; paidLabel:string}; cases: Array<{id, clientName, licence, submittedAt, step: StepIndex | 'cancelled', missingDocs, amount, amountLabel, commissionStatus}>; months: Array<{month, total}>; whatsapp: string }`
  - `buildPartnerView(p: Partner, cases: Case[], comms: Commission[], whatsapp: string): PartnerView`. This is the **only** place partner data is chosen; it copies fields by name and never spreads objects.
  - `renderPartnerPage(v: PartnerView, updatedAt: string): string`
  - `renderInvalidLink(): string`
  - `getPartnerView(env: Env, repo: Repo, token: string): Promise<{ html: string } | null>`. It reads KV `view:${hash}` and, on a miss, builds and stores the page.
  - `refreshPartnerView(env: Env, repo: Repo, partnerId: string): Promise<void>`
  - `dropPartnerView(env: Env, token: string): Promise<void>`

- [ ] **Step 1: Write failing tests**
  - `view-model`:
    - `JSON.stringify(buildPartnerView(...))` must not contain `bankAccount`, the bank number from the fixture, `clientPhone`, `notesInternal` or `storage_path`;
    - B1 labels are `待付给 Toh's Sign` / `已与 Toh's Sign 结清`, and A1 labels are `待发佣金` / `已发佣金`;
    - totals for the 5 demo cases: active 4, done 1.
  - `partner-page`:
    - client name `Lim & Co. <Accounting>` appears as `Lim &amp; Co. &lt;Accounting&gt;`;
    - the page contains `更新于`, all six `CASE_STEPS`, a `wa.me/` link, and `<meta name="robots" content="noindex">`.
  - `partner-route`:
    - `/p/abc` → 404 with `链接无效`, and the repo is never called;
    - an unknown 43-character token → 404 `链接无效`;
    - a valid token → 200 with headers `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, `Cache-Control: private, max-age=60`;
    - a valid token while the repo throws → still 200 from KV;
    - after `dropPartnerView`, the old token → 404;
    - `logLinkView` throwing does not change the 200.
- [ ] **Step 2:** Run `npm test -- partner`. Expected: FAIL.
- [ ] **Step 3:** Implement the page.
  - Inline CSS, no JavaScript needed, mobile-first, under 30 KB.
  - The layout follows the board's 伙伴门户 demo: tiles, case list, per-case timeline, commission line, monthly totals, and a WhatsApp button for 市场部.
  - Escape with one `esc()` helper used for every value.
  - Log views with `ctx.waitUntil`, country from `request.cf.country`.
- [ ] **Step 4:** Run `npm test -- partner`. Expected: PASS.
- [ ] **Step 5:** Run `npx wrangler dev` with the seed data, open `/p/<seeded token>` in the browser pane at phone width (375 px), and check it reads well and shows no horizontal scroll.
- [ ] **Step 6: Commit** `feat: no-login partner view page with KV snapshot`.

## Task 7: Staff API – partners

**Files:**
- Create: `src/worker/routes/admin-partners.ts`, `src/shared/whatsapp.ts`
- Test: `test/worker/admin-partners.test.ts`

**Interfaces:**
- Consumes: `requireStaff`, `Repo`, `newViewToken`, `refreshPartnerView`, `dropPartnerView`, Task 1 validation.
- Produces:
  - Routes:
    - `GET /api/admin/partners?status=&q=`
    - `POST /api/admin/partners` (body: 登记表 fields)
    - `GET /api/admin/partners/:id` → `{ partner, cases, recentViews }` (last 10 link views)
    - `PATCH /api/admin/partners/:id`
    - `POST /api/admin/partners/:id/approve` (admin) → `{ link }`
    - `POST /api/admin/partners/:id/reset-link` → `{ link }`
    - `GET /api/admin/partners/inactive` (no case created in `inactive_days`)
  - Error body: `{ error: string, fields?: Record<string,string> }`
  - `whatsappLink(phone: string, text: string): string` → `https://wa.me/60123384521?text=…`
  - `linkMessage(p: Partner, link: string): string`, e.g. `您好 Tan Wei Ming，这是您的 Toh's Sign 伙伴专属页面（只读）：<link>`

- [ ] **Step 1: Write failing tests**
  - `POST` with phone `03-1234 5678` → 400 `fields.phone = '电话号码格式不正确'`;
  - a missing code → 400 `fields.code = '请选择伙伴代码'`;
  - a valid body → 201 `id: 'TSP0001'`, status `待审核`, an audit row written;
  - approve by role `staff` → 403;
  - approve by admin → status `活跃`, a `link` like `https://partners.tohssignlicense.com/p/[A-Za-z0-9_-]{43}`;
  - reset-link → the new link differs, and the old token now returns 404 on `/p/`;
  - `PATCH` code `A1`→`C1` keeps existing commissions' code;
  - `whatsappLink('+60123384521','hi')` equals `https://wa.me/60123384521?text=hi`.
- [ ] **Step 2:** Run `npm test -- admin-partners`. Expected: FAIL.
- [ ] **Step 3:** Implement the routes. Every write calls `repo.audit` and `refreshPartnerView`.
- [ ] **Step 4:** Run `npm test -- admin-partners`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: staff API for partners, approval and private links`.

## Task 8: Staff API – cases, commissions, settings, reports

**Files:**
- Create: `src/worker/routes/admin-cases.ts`, `src/worker/routes/admin-commissions.ts`, `src/worker/routes/admin-settings.ts`, `src/worker/routes/admin-reports.ts`, `src/worker/recalc.ts`
- Test: `test/worker/admin-cases.test.ts`, `test/worker/admin-commissions.test.ts`, `test/worker/admin-settings.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 5, 6.
- Produces:
  - `recalcCase(repo: Repo, caseId: string): Promise<Commission>`: calculates with the partner's code (or the existing commission's code), applies `applyCommission`, saves, then calls `refreshPartnerView`.
  - Routes:
    - `GET/POST /api/admin/cases`, `GET/PATCH /api/admin/cases/:id`
    - `GET /api/admin/commissions?month=YYYY-MM&partnerId=`
    - `POST /api/admin/commissions/:caseId/mark-paid` (role from `rules.paidMarkedBy`)
    - `GET/PUT /api/admin/settings` (admin)
    - `GET /api/admin/staff`, `PUT /api/admin/staff/:email` (admin). Setting `active: false` removes access at once; an admin cannot deactivate their own account.
    - `GET /api/admin/reports/monthly?month=`, giving per-partner `{ cases, revenue, commission }`
    - `GET /api/admin/statements/:partnerId/:month`, returning JSON for the printable statement
  - A Supabase failure returns 503 `{ error: '数据库暂时无法连接，请稍后再试' }`.

- [ ] **Step 1: Write failing tests**
  - Creating a case for an A1 partner, price 1800 → commission `150 / 待处理`. Then `PATCH clientPaid: true` → `可发放`. Then mark-paid by admin → `已支付` with `paidBy`. Then `PATCH price: 900` → commission still `150 / 已支付`.
  - A C1 case with markup 600 while `maxMarkup` is 500 → 400 `加价超过上限`.
  - A B1 case with `collectBeforeSubmit: true` and status `待付发票`, `PATCH step: 2` → 400 `B1 案件需先结清才能递交`.
  - mark-paid by role `staff` when `paidMarkedBy` is `admin` → 403.
  - `PUT settings` with `A1.threshold: -1` → 400.
  - Saving settings does not change any `已支付` commission.
  - An admin deactivating their own staff row → 400 `不能停用自己的账号`. A deactivated staff member's next request → 403.
  - The repo throwing → 503 with the message above.
  - Any case change → the partner's KV page shows the new step.
- [ ] **Step 2:** Run `npm test -- admin-`. Expected: FAIL.
- [ ] **Step 3:** Implement the routes, with `recalcCase` called after every case write. Reports sum non-cancelled cases by `submittedAt` month (MYT).
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat: staff API for cases, commissions, settings, reports`.

## Task 9: Documents

**Files:**
- Create: `src/worker/routes/admin-documents.ts`, `src/admin/lib/compress-image.ts`
- Test: `test/worker/admin-documents.test.ts`, `test/admin/compress-image.test.ts`

**Interfaces:**
- Produces:
  - Routes:
    - `POST /api/admin/cases/:id/documents/upload-url` (body `{ filename, kind, size, type }`) → `{ uploadUrl, path }` via `storage.from('case-documents').createSignedUploadUrl(path)`, with path `${caseId}/${uuid}-${safeName}`
    - `POST /api/admin/cases/:id/documents` (body `{ path, filename, kind }`)
    - `GET /api/admin/documents/:docId/download` → 302 to a signed URL valid for 60 s
  - `compressImage(file: File, maxSide = 1600, quality = 0.75): Promise<Blob>`: canvas resize; returns PDFs and non-images unchanged.
  - `kind` is one of: `SSM`, `IC`, `租约`, `店面照片`, `其他`.

- [ ] **Step 1: Write failing tests**
  - `size` over 10 MB → 400 `文件不能超过 10 MB`;
  - type `application/x-msdownload` → 400 `只接受图片或 PDF`;
  - filename `../../etc/passwd` → stored path has no `..`;
  - download of a case document → 302 with `Location` containing `token=`;
  - `compressImage` on a 4000×3000 image gives width 1600;
  - a PDF is returned unchanged.
- [ ] **Step 2:** Run `npm test -- documents compress`. Expected: FAIL.
- [ ] **Step 3:** Implement the routes and `compressImage`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS. Then upload one real photo to the dev project and check it is under 500 KB in Storage.
- [ ] **Step 5: Commit** `feat: private case documents with signed links and photo shrinking`.

## Task 10: Staff app – layout and 伙伴 pages

**Files:**
- Create:
  - `vite.config.ts`, `index.html`, `src/admin/main.tsx`, `src/admin/App.tsx`, `src/admin/api.ts`
  - `src/admin/pages/Partners.tsx`, `src/admin/pages/PartnerForm.tsx`, `src/admin/pages/PartnerDetail.tsx`, `src/admin/styles.css`
- Test: `test/admin/PartnerForm.test.tsx`

**Interfaces:**
- Consumes: Task 7 routes, Task 1 validation (shared with the server), `whatsappLink`, `linkMessage`.
- Produces:
  - `api.get/post/patch/put(path, body?)`, which throws `ApiError { status, error, fields }`
  - Hash-free routes: `/admin`, `/admin/partners`, `/admin/partners/new`, `/admin/partners/:id`, `/admin/cases`, `/admin/cases/new`, `/admin/cases/:id`, `/admin/commissions`, `/admin/statements/:partnerId/:month`, `/admin/reports`, `/admin/settings`

- [ ] **Step 1: Write failing tests** for `PartnerForm`:
  - submitting empty shows red on 姓名, 电话, 电邮 and the message `请检查红色栏位 · 请选择伙伴代码`;
  - after filling valid demo data and choosing `C1`, it calls `api.post('/api/admin/partners', …)` with `phone: '+60123384521'` and `filledBy: 'Transmission'`;
  - a 400 `fields.email` from the server is shown under 电邮.
- [ ] **Step 2:** Run `npm test -- PartnerForm`. Expected: FAIL.
- [ ] **Step 3:** Implement the layout and pages.
  - **Layout:** side menu 伙伴 / 案件 / 佣金 / 报表 / 设置, showing the signed-in name.
  - **Partners list:** columns from the board's 伙伴名单, with filter and search.
  - **PartnerForm:** fields and buttons as the 登记表 demo.
  - **PartnerDetail** buttons: 批准, 复制链接, 发送链接 WhatsApp, 重置链接 (with confirm 旧链接将立即失效), 更改代码, 设为不活跃. It also lists the partner's cases and the last 10 link views.
- [ ] **Step 4:** Run `npm test`. Expected: PASS. Then `npm run build && npx wrangler dev` and click through register → approve → copy link → open link in the browser pane.
- [ ] **Step 5: Commit** `feat: staff app shell and partner pages`.

## Task 11: Staff app – 案件, 佣金, 结单, 报表, 设置

**Files:**
- Create: `src/admin/pages/Cases.tsx`, `CaseForm.tsx`, `CaseDetail.tsx`, `Commissions.tsx`, `Statement.tsx`, `Reports.tsx`, `Settings.tsx` (all under `src/admin/pages/`)
- Test: `test/admin/CaseDetail.test.tsx`, `test/admin/Statement.test.tsx`

**Interfaces:**
- Consumes: Task 8 and 9 routes, `compressImage`, `whatsappLink`.
- Produces:
  - `caseUpdateMessage(c: Case, link: string): string`, e.g. `案件 TS-2611-014（Kedai Kopi Ah Seng）进度更新：已递交政府部门。查看：<link>`

- [ ] **Step 1: Write failing tests**
  - `CaseDetail`:
    - shows six step buttons with the current step highlighted;
    - clicking `已批准` calls `PATCH … { step: 4 }`;
    - a server 400 `B1 案件需先结清才能递交` is shown as an error banner;
    - the "发送进度 WhatsApp" link's `href` starts `https://wa.me/`.
  - `Statement`:
    - renders partner `Lim & Co. <Accounting>` literally;
    - shows each case line and a total equal to the sum of amounts;
    - has a `@media print` rule hiding the menu.
- [ ] **Step 2:** Run `npm test -- CaseDetail Statement`. Expected: FAIL.
- [ ] **Step 3:** Implement the pages.
  - **Cases:** list with filters (partner, step, month).
  - **CaseForm:** partner picker, licence type from settings, council, client, price, markup (only when the partner is C1).
  - **CaseDetail:** steps, missing documents, payment fields, documents with upload (compressed), cancel case, WhatsApp update.
  - **Commissions:** month table with totals by status, plus mark 已支付.
  - **Statement:** print-friendly, with a 打印 / 保存为 PDF button.
  - **Reports:** monthly per partner, and the inactive list with WhatsApp buttons for Transmission.
  - **Settings:** commission rules, licence types, inactive days, staff list.
- [ ] **Step 4:** Run `npm test`. Expected: PASS. Then click through create case → change steps → mark client paid → mark 已支付 → print statement, and confirm the partner link shows each change.
- [ ] **Step 5: Commit** `feat: staff pages for cases, commissions, statements, reports, settings`.

## Task 12: Go live – deploy, Access, domain, backups

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/backup.yml`, `scripts/backup.sh`, `docs/restore.md`, `docs/launch-checklist.md`

**Interfaces:**
- Consumes: everything above; Task 0 accounts and secrets.

- [ ] **Step 1: CI.** `ci.yml` runs `npm ci && npm test && npm run build` on every push and PR. Push a branch and check it goes green.
- [ ] **Step 2: Deploy.**
  - In the Cloudflare dashboard, connect the repo with Workers Builds: production on `main`, previews on other branches using dev Supabase vars.
  - Set secret `SUPABASE_SERVICE_ROLE_KEY` (prod), create the KV namespace `VIEWS`, and add the custom domain `partners.tohssignlicense.com`.
  - Check `https://partners.tohssignlicense.com/p/abc` returns the `链接无效` page.
- [ ] **Step 3: Access.**
  - Create a Zero Trust self-hosted application for `partners.tohssignlicense.com/admin*` and `/api/admin*`, with policy: emails in the staff list, login method one-time PIN.
  - Copy its AUD tag into `ACCESS_AUD`.
  - Check: a staff email gets in; any other email is refused; `/p/<link>` still opens with no login.
- [ ] **Step 4: Backups.**
  - `backup.yml` runs on cron `0 18 * * *` (02:00 MYT) and on manual trigger.
  - `scripts/backup.sh` runs `pg_dump --no-owner --format=custom "$SUPABASE_DB_URL_PROD" | gzip > backup-$(date -u +%F).dump.gz`, then `aws s3 cp … s3://partner-portal-backups/ --endpoint-url "$R2_ENDPOINT"`.
  - Add an R2 lifecycle rule to delete objects after 30 days.
  - Run it once by hand and check the file is in R2.
- [ ] **Step 5: Restore test.**
  - Write `docs/restore.md`, then follow it to restore last night's dump into `partner-portal-dev`.
  - Check partner and case counts match prod.
- [ ] **Step 6: Launch checklist** (`docs/launch-checklist.md`), each item ticked before partners get links:
  - real staff list loaded, seed data not in prod;
  - commission settings confirmed with management;
  - 2–3 trial partners have opened their links on their own phones;
  - Supabase Pro decision noted;
  - the board's Google Drive backup note updated to R2.
- [ ] **Step 7: Commit** `chore: CI, nightly backups, restore guide, launch checklist`.
