# SupplierSync — Agent Handoff Document

> **Purpose:** Paste this file (or section 10) into a **new Cursor chat** so the next agent can continue without re-discovering context.  
> **Last updated:** 2026-08-03  
> **Workspace:** `/Users/addieoswin/Downloads/vendor-prototype`  
> **Do not commit secrets.** Reference locations only.

---

## 1. Product & user context

| Item | Detail |
|------|--------|
| **Product** | SupplierSync — B2B SaaS for independent medical clinics to manage vendors, contracts, compliance docs, renewals, and spend |
| **Founder** | Adele (Adele Stero) — solo founder, early pilot stage, no paying customers yet |
| **Production URL** | https://suppliersync.org |
| **Contact emails in product** | `legal@suppliersync.org`, `renewals@suppliersync.org` (Resend) |
| **Platform admin** | `addstero28@gmail.com` (see migration `010_founding_applications.sql` — RPC `is_platform_admin_for_client`) |
| **Pricing** | Charter $49/mo (manual), Founding $79/mo (5 slots, apply + approve), Standard $119/mo |
| **Trial** | 14 days (`trial_ends_at` on organizations, migration 013) |
| **Terms version** | `2026-08-03` — forced acceptance gate before app access (`src/lib/legal.ts`) |

**User's immediate context:** Production smoke test passed (auth, docs, renewal emails, Stripe test checkout). Terms gate deployed and working. Demo/Loom prep hit contract AI read issues — **`.docx` files do not AI-scan**; only PDFs. User may still need latest frontend deployed if "Scan with AI" button missing on production.

---

## 2. Current production state (what works)

Verified working on **https://suppliersync.org** (Aug 3, 2026 session):

- [x] Custom domain `suppliersync.org` on Vercel
- [x] Supabase Auth — sign up, sign in, sign out, password reset → `/reset-password`
- [x] `APP_URL=https://suppliersync.org` in Supabase edge function secrets
- [x] Document upload + in-app viewing (signed URLs)
- [x] Renewal email test — links point to production (not localhost)
- [x] Stripe **test mode** checkout + customer portal via edge functions
- [x] Terms acceptance gate — migration **011** applied; users must accept `2026-08-03` terms
- [x] System health panel (Account page, platform admin only) — DB, storage, AI extraction status

**Likely working but unverified in this session:**

- Migrations **013–022** (user was told to verify; only 011 confirmed)
- Founding application email notifications (migration 022 + `./scripts/setup-founding-notify.sh`)
- Signup founder notifications (migration 015 + `./scripts/setup-signup-notify.sh`)
- Outreach CRM at `/outreach` (platform admin only)
- Contract AI extraction on **PDF** uploads (edge function deployed; user had issues with `.docx`)

**Not done / partial:**

- RLS-level subscription enforcement (UI blocks expired trials; API may still allow writes)
- Stripe **live** mode
- `www.suppliersync.org` → apex redirect
- Team invites (signup footer says "future update")
- Git: large uncommitted local work not pushed

---

## 3. Architecture quick reference

### Stack

- **Frontend:** React 19 + TypeScript + Vite + React Router 7
- **Backend:** Supabase (Postgres, Auth, Storage, Edge Functions)
- **Hosting:** Vercel (`vercel.json` — SPA rewrites to `index.html`)
- **Email:** Resend (renewal reminders, founding/signup notifications)
- **Payments:** Stripe (checkout + portal + webhook via edge functions)
- **AI:** OpenAI `gpt-4o-mini` in `extract-contract` and `extract-document` edge functions

### Key paths

| Area | Path |
|------|------|
| App entry / routing / gates | `src/App.tsx` |
| Vendor workspace (contracts, docs, spend) | `src/VendorWorkspace.tsx` |
| Auth + terms gate pages | `src/pages/AuthPages.tsx` |
| Legal content | `src/lib/legal.ts`, `src/pages/LegalPages.tsx` |
| Billing / Stripe UI | `src/pages/BillingPage.tsx`, `src/api/billing.ts` |
| Renewals | `src/pages/RenewalsPage.tsx`, `src/lib/renewals.ts` |
| Contract AI client | `src/api/contractExtract.ts` |
| Document AI client | `src/api/documentExtract.ts`, `src/lib/documentTypes.ts` |
| Storage / signed URLs | `src/lib/storage.ts` |
| Health checks | `src/lib/health.ts`, `src/components/SystemHealthPanel.tsx` |
| Subscription logic (UI) | `src/lib/stripe.ts` |
| Supabase client | `src/lib/supabase.ts` |
| Types | `src/types/index.ts` |
| Migrations | `supabase/migrations/` (001–022) |
| Edge functions | `supabase/functions/` |
| Deploy script | `scripts/deploy-vercel.sh` |
| Production checklist | `supabase/PRODUCTION_SETUP.md` |

### Routes

| Path | Purpose |
|------|---------|
| `/` | Marketing home |
| `/login`, `/signup`, `/forgot-password`, `/reset-password` | Auth |
| `/terms`, `/privacy` | Legal |
| `/app` | Main vendor workspace |
| `/app/renewals` | Renewal dashboard |
| `/app/billing` | Plans + Stripe (exempt from subscription block) |
| `/app/account` | Profile, renewal email override, system health |
| `/app/admin/signups` | Platform signup list (admin) |
| `/outreach` | Founder CRM (admin only) |

### Supabase project

- **Project ref:** `bvrwyuwwxsruihkxeftm`
- **Dashboard:** https://supabase.com/dashboard/project/bvrwyuwwxsruihkxeftm
- **API URL:** `https://bvrwyuwwxsruihkxeftm.supabase.co`

### Vercel project

- **Project name:** `vendor-prototype` (`.vercel/project.json`)
- **Project ID:** `prj_jbEBtphWwVoAVTVKvZg6gNgpX849`
- **Deploy:** `./scripts/deploy-vercel.sh` (reads `.env.local`, builds, `npx vercel deploy --prod`)
- **Build env vars passed at deploy:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optional Stripe payment link fallbacks

### Edge functions (8)

| Function | Purpose | JWT |
|----------|---------|-----|
| `extract-contract` | PDF contract → dates, value, renewal terms | Yes (user session) |
| `extract-document` | PDF docs → type, spend, compliance tags | Yes |
| `send-renewal-reminders` | Cron/manual renewal + digest emails | CRON_SECRET header |
| `create-checkout-session` | Stripe Checkout with org metadata | Yes |
| `create-portal-session` | Stripe Customer Portal | Yes |
| `stripe-webhook` | Subscription lifecycle updates | Stripe signature (no JWT) |
| `notify-founder-signup` | Email on new auth signup | Webhook secret |
| `notify-founding-application` | Email on founding apply/approve/decline | Webhook secret |

---

## 4. Secrets & config (where — NOT values)

### Local only (never commit)

| File | Contains |
|------|----------|
| `.env.local` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optional `VITE_STRIPE_LINK_*`, `VITE_STRIPE_CUSTOMER_PORTAL_URL` |
| `.env.example` | Documented template — safe to commit |

Restart `npm run dev` after changing Vite env vars.

### Supabase Edge Function secrets

Set via Dashboard → **Edge Functions → Secrets** or `npx supabase secrets set ... --project-ref bvrwyuwwxsruihkxeftm`.

| Secret | Used by | Setup script |
|--------|---------|--------------|
| `APP_URL` | All email/checkout return URLs | `setup-renewal-email.sh`, `setup-stripe-webhook.sh`, etc. |
| `OPENAI_API_KEY` | `extract-contract`, `extract-document` | `./scripts/setup-contract-extract.sh` |
| `RESEND_API_KEY` | Email functions | `./scripts/setup-renewal-email.sh` |
| `RENEWAL_FROM_EMAIL` | Renewal emails | `./scripts/setup-renewal-email.sh` |
| `CRON_SECRET` | `send-renewal-reminders` | `./scripts/setup-renewal-email.sh` |
| `STRIPE_SECRET_KEY` | Stripe functions | `./scripts/setup-stripe-webhook.sh` |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` | `./scripts/setup-stripe-webhook.sh` |
| `STRIPE_PRICE_CHARTER` / `_FOUNDING` / `_STANDARD` | `create-checkout-session` | `./scripts/setup-stripe-webhook.sh` |
| `FOUNDER_NOTIFY_EMAIL` | Signup/founding notifications | `setup-signup-notify.sh`, `setup-founding-notify.sh` |
| `SIGNUP_WEBHOOK_SECRET` | DB → `notify-founder-signup` | `./scripts/setup-signup-notify.sh` |
| `FOUNDING_WEBHOOK_SECRET` | DB → `notify-founding-application` | `./scripts/setup-founding-notify.sh` |
| `SIGNUP_FROM_EMAIL` | Notification from-address | setup scripts |

**Verify secrets (names only):** `npx supabase secrets list --project-ref bvrwyuwwxsruihkxeftm`

### Database-private settings (not edge secrets)

Migrations 015 and 022 create `private.signup_notify_settings` and `private.founding_notify_settings` — enabled via SQL snippets printed by setup scripts after edge function deploy.

---

## 5. Deploy & migration runbook

### Deploy frontend to production

```bash
cd /Users/addieoswin/Downloads/vendor-prototype
./scripts/deploy-vercel.sh
```

Requires `.env.local` with Supabase keys. Alternative: Vercel dashboard redeploy (only if Git-connected branch has the changes).

### Deploy a single edge function

```bash
npx supabase functions deploy extract-contract --project-ref bvrwyuwwxsruihkxeftm
```

Or use the setup scripts (they set secrets + deploy).

### Migrations 011–022 summary

| # | File | Purpose |
|---|------|---------|
| 011 | `011_terms_acceptance.sql` | `profiles.terms_accepted_at`, `terms_version` — **confirmed applied** |
| 012 | `012_vendor_address_notes_locked.sql` | Vendor address + locked notes |
| 013 | `013_trial_period.sql` | `organizations.trial_ends_at`, 14-day trial on create |
| 014 | `014_outreach_crm.sql` | Outreach CRM tables (founder pipeline) |
| 015 | `015_platform_signups.sql` | Signup tracking + notify webhook |
| 016 | `016_storage_bucket.sql` | `organization-files` bucket + RLS policies |
| 017 | `017_contract_vendor_org_match.sql` | Contract/vendor org integrity trigger |
| 018 | `018_contract_renewal_terms.sql` | `renewal_type`, `notice_period_days`, nullable `end_date` |
| 019 | `019_contract_renewal_handled.sql` | `renewal_handled_at`, `renewal_handled_note` |
| 020 | `020_renewal_notification_email.sql` | `profiles.renewal_notification_email` |
| 021 | `021_protect_org_billing_fields.sql` | Trigger blocks client-side billing field tampering |
| 022 | `022_founding_application_notify.sql` | Founding application email webhooks |

### Verify migrations applied

Run in **Supabase → SQL Editor**:

```sql
-- 011 (confirmed)
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
  and column_name in ('terms_accepted_at', 'terms_version');

-- 013
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'organizations'
  and column_name = 'trial_ends_at';

-- 018
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'contracts'
  and column_name in ('renewal_type', 'notice_period_days', 'term_months');

-- 019
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'contracts'
  and column_name in ('renewal_handled_at', 'renewal_handled_note');

-- 020
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
  and column_name = 'renewal_notification_email';

-- 016 storage bucket
select id from storage.buckets where id = 'organization-files';
```

If any return 0 rows, paste and run the corresponding file from `supabase/migrations/`.

**CLI alternative (if linked):** `npx supabase db push --linked` or `npx supabase migration list --linked`

### Storage setup (if uploads fail)

```bash
./scripts/setup-storage.sh   # prints SQL to run
# Or run supabase/STORAGE_SETUP.sql in SQL Editor (Step A bucket + Step B policies)
./scripts/check-storage.sh   # local probe
```

### AI extraction setup

```bash
./scripts/setup-contract-extract.sh    # OPENAI_API_KEY + deploy extract-contract
./scripts/setup-document-extract.sh    # deploy extract-document
./scripts/check-contract-extract.sh    # verify configured:true
```

### Stripe setup

See `supabase/STRIPE_SETUP.md` and `./scripts/setup-stripe-webhook.sh`.

---

## 6. Recent work completed (Aug 3, 2026 session)

1. **Production domain & auth** — `suppliersync.org`, Supabase Site URL + redirect URLs, password reset verified
2. **`APP_URL` secret** — set to production URL for all edge functions
3. **Production smoke test** — auth, storage, renewal emails, Stripe test checkout — all passed
4. **Terms of Service update** — content in `src/lib/legal.ts`, version `2026-08-03`
5. **Terms acceptance gate** — blocks `/app` until accepted; signup + existing users prompted; migration 011 applied
6. **Contract AI debugging** — root cause for demo issues: **PDF-only** extraction; `.docx` cannot be read by OpenAI vision path
7. **Contract form UX fix (local, may need deploy)** — restored visible **"Scan with AI"** button in `VendorWorkspace.tsx`:
   - Enabled for PDF attachments
   - Disabled (with tooltip) for non-PDF — shows info message: *"AI can only read PDF contracts. Export Word or other files to PDF…"*
   - PDFs also auto-scan on file select
8. **`parseFlexibleDate` fix** in `extract-contract` edge function (deployed during session)
9. **Loom demo script** provided (~3 min walkthrough: vendors → upload → renewals → CTA)
10. **`supabase/PRODUCTION_SETUP.md`** created as live checklist

### Git state (critical)

```
Branch: main (ahead of origin/main by 1 commit)
Latest commit: 768a208 "Fix in-app document viewing for contracts and uploads."
Uncommitted: ~36 modified files + many untracked (migrations 013–022, edge functions, billing, outreach, health panel, setup scripts, etc.)
```

**The bulk of production features exist only locally.** User has NOT committed/pushed. Deploy via `deploy-vercel.sh` uses local build (works), but Git backup is missing.

---

## 7. Known bugs / gotchas

### Contract AI = PDF only (by design, not a bug)

- `extractContractFromPdf()` and `extractDocumentFromPdf()` reject non-PDF (`src/api/contractExtract.ts`, `src/api/documentExtract.ts`)
- Edge functions send PDF bytes to OpenAI — no `.docx` parser
- **User symptom:** Attached `.docx` → empty dates, "Scan with AI" button **disabled** (not gone in latest code)
- **Demo fix:** Export contract to PDF before upload, or use `scripts/fixtures/sample-contract.pdf`

### "Scan with AI" button missing on production

If production still shows old UI without the button, **redeploy frontend:**

```bash
./scripts/deploy-vercel.sh
```

Latest local code always shows the button; non-PDF gets disabled state + info banner.

### Resend email delivery

- `onboarding@resend.dev` (default in setup script) only delivers to the Resend account owner's email
- For clinic Gmail delivery, verify domain in Resend and set `RENEWAL_FROM_EMAIL=SupplierSync <renewals@suppliersync.org>`

### Subscription enforcement gap

- `App.tsx` → `AuthenticatedGate` blocks UI when trial expired / inactive (except `/app/billing` and `/app/account`)
- **No RLS policies** yet to block direct API writes when subscription inactive — flagged as pre-customer priority

### Storage after Supabase restore

Buckets may not restore — run migration 016 or `STORAGE_SETUP.sql`. Symptom: uploads fail, health panel shows storage ✗.

### Platform admin

Outreach, admin signups, system health, founding approval — gated by `is_platform_admin_for_client` RPC (founder email in migration 010).

### `.vercel/`, `Beta`, `vendor prototype`

- `.vercel/project.json` — local Vercel link (do not commit secrets)
- `Beta` and `vendor prototype` — empty placeholder files/dirs, not product code

---

## 8. Open todos (prioritized)

### P0 — Before first paying clinic

1. **RLS subscription enforcement** — Postgres policies to block writes when `subscription_status` not active/trialing; align with `isSubscriptionActive()` in `src/lib/stripe.ts`
2. **Verify migrations 013–022** — SQL checks in section 5; apply any missing
3. **Commit + push local work** — large uncommitted diff; user must explicitly ask agent to commit
4. **Redeploy if contract AI UX stale** — `./scripts/deploy-vercel.sh` after confirming PDF demo file ready

### P1 — Before public launch

5. **Stripe live mode** — duplicate products/prices, live webhook, swap Supabase Stripe secrets (`supabase/STRIPE_SETUP.md` §7)
6. **Resend domain verification** — send from `@suppliersync.org` to any recipient
7. **Legal email consistency** — already `legal@suppliersync.org` in `src/lib/legal.ts`; ensure Resend/DNS can receive replies when needed

### P2 — Polish

8. **`www` redirect** — Cloudflare (or Vercel) rule: `www.suppliersync.org` → `suppliersync.org`
9. **Team invites** — not built; signup says "future update"; marketing mentions team roles
10. **`.docx` support** — would need server-side conversion (not planned); improve UX copy if users keep hitting this

---

## 9. How to test key flows

### Auth + terms

1. https://suppliersync.org/signup → create account
2. Should see terms acceptance before app (if not already accepted `2026-08-03`)
3. `/login` → sign out → password reset → `/reset-password`

### Contract AI (PDF)

```bash
./scripts/check-contract-extract.sh   # expect configured:true
```

1. Sign in → open vendor → **Contracts** tab
2. Attach **PDF** (not `.docx`) — should auto-scan OR click **Scan with AI**
3. Verify name, start/end dates, value pre-fill
4. Click **Add Contract** to save
5. Account → System status (admin) → AI extraction should be green

### Document upload + viewing

1. Vendor → Documents tab → upload PDF/image
2. Click file link → in-app viewer opens (signed URL)
3. If fail: Account → System status → storage check; run storage setup

### Renewals + email

1. `/app/renewals` — no yellow "localhost APP_URL" banner
2. Send test email → links go to `https://suppliersync.org/...`
3. Mark renewal handled → drops from urgent list

### Billing (Stripe test)

1. `/app/billing` → Subscribe
2. Card `4242 4242 4242 4242` → return to `?checkout=success`
3. Manage billing → Stripe portal → return to app
4. Supabase: `organizations.subscription_status = active`

### Founding application (admin)

1. Sign in as platform admin
2. Billing → submit/approve founding application
3. If migration 022 + notify setup done → emails fire

### Demo / Loom script (3 min)

1. Hook — clinic vendor chaos / renewals slipping
2. Login → vendor list → open vendor (docs, contracts)
3. Upload **PDF** contract → AI fill dates (hero: not `.docx`)
4. Renewals page → upcoming → mark handled
5. CTA — founding clinics, `renewals@suppliersync.org`

Sample vendors: use "Load sample data" in app (`src/lib/sampleVendors.ts` — Northstar Supply Co., Brightline Services).

---

## 10. "Start here" prompt for new chat

Copy everything below into a new Cursor chat:

---

**Context:** I'm Adele, founder of SupplierSync. Read `HANDOFF.md` at the repo root first — it has full production state, architecture, secrets locations, and open todos.

**Workspace:** `/Users/addieoswin/Downloads/vendor-prototype`  
**Production:** https://suppliersync.org  
**Supabase project:** `bvrwyuwwxsruihkxeftm`

**Current priority:** [FILL IN — e.g. "Deploy latest contract AI UX and verify PDF scan works on production" OR "Implement RLS subscription enforcement" OR "Verify migrations 013–022 and commit local work"]

**Known issue from last session:** Contract AI extraction is **PDF-only**. User tried `.docx` during demo — scan button appears disabled (or missing if old deploy). Fix for demo = use PDF. Latest code has visible "Scan with AI" button in `VendorWorkspace.tsx`.

**Constraints:**
- Do NOT commit unless I explicitly ask
- Do NOT print or commit secret values
- Deploy frontend via `./scripts/deploy-vercel.sh`
- Supabase secrets via setup scripts or dashboard

**What I need you to do:** [DESCRIBE TASK]

---

## Quick command reference

```bash
# Dev
npm run dev

# Deploy production
./scripts/deploy-vercel.sh

# Check AI extraction
./scripts/check-contract-extract.sh

# Check storage
./scripts/check-storage.sh

# Deploy contract AI
./scripts/setup-contract-extract.sh

# Deploy Stripe
./scripts/setup-stripe-webhook.sh

# Deploy renewal emails
./scripts/setup-renewal-email.sh

# Supabase secrets list (names only)
npx supabase secrets list --project-ref bvrwyuwwxsruihkxeftm

# Edge function logs
npx supabase functions logs extract-contract --project-ref bvrwyuwwxsruihkxeftm
```

## Related docs in repo

- `supabase/PRODUCTION_SETUP.md` — auth URL + smoke test checklist
- `supabase/STRIPE_SETUP.md` — billing setup
- `supabase/RENEWAL_EMAIL_SETUP.md` — renewal cron + Resend
- `supabase/FOUNDING_CLINICS.md` — founding program + notifications
- `supabase/STORAGE_SETUP.sql` — manual storage fix
- `.env.example` — all env var documentation
