# Disaster recovery — SupplierSync

Operational runbook for **suppliersync.org** (Supabase `bvrwyuwwxsruihkxeftm`). Solo-founder scope — not an enterprise DR program. Complements [DATA_RETENTION.md](./DATA_RETENTION.md) and [PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md).

**Verify backup settings in your Supabase dashboard before relying on the numbers below.** Supabase plan features change; this doc uses honest defaults with “check dashboard” where it matters.

---

## Targets (honest defaults)

| Metric | Meaning | SupplierSync default |
|--------|---------|----------------------|
| **RPO** (Recovery Point Objective) | Max data loss if disaster hits now | **Up to ~24 hours** on Free (daily logical backups). **Minutes** on Pro with PITR enabled — confirm under Dashboard → **Database → Backups**. |
| **RTO** (Recovery Time Objective) | Time to get the app back online | **Roughly 2–6 hours** for a solo founder: restore DB, re-run storage + migrations, redeploy edge functions, redeploy Vercel, smoke test. Faster if you have recent runbook practice; slower if secrets or Stripe webhooks need reconfiguration. |

These are planning estimates, not SLAs. There is no on-call team or hot standby.

---

## What Supabase backs up

- **Database** (Postgres schema + row data) — daily logical backups on all paid plans; Free tier includes daily backups with a limited retention window. **Pro** adds optional **Point-in-Time Recovery (PITR)** — restore to a specific minute within the retention window.
- **Auth users** — stored in Postgres; restored with the database backup.
- **Edge function secrets** — stored in Supabase project config, **not** in DB backups. Export or re-enter from your password manager / setup scripts if the project is lost.

**Dashboard:** [Database → Backups](https://supabase.com/dashboard/project/bvrwyuwwxsruihkxeftm/database/backups)

---

## What is NOT backed up (or not auto-restored)

| Asset | Notes |
|-------|-------|
| **Storage bucket `organization-files`** | Uploaded PDFs are **not** restored with a DB backup. After restore, run [STORAGE_SETUP.sql](./STORAGE_SETUP.sql) to recreate the bucket and RLS policies. **File objects themselves are gone** unless you have a separate export or an older Supabase backup that included storage (check dashboard — storage restore is manual). |
| **Edge function code** | Lives in this git repo under `supabase/functions/`. Redeploy after restore (see below). |
| **Vercel frontend** | Redeploy from git; env vars live in Vercel project settings. |
| **Stripe / Resend / OpenAI** | Provider-side data (customers, subscriptions, sent email logs). Stripe subscriptions survive; webhook endpoint URL may need updating if project URL changes. |
| **Local uncommitted code** | **Git is the source of truth.** Push to `main` regularly. Uncommitted work on one machine is not recoverable from Supabase. |
| **pg_cron jobs** | Not always included in restore. Re-schedule `purge-api-usage-log` per [DATA_RETENTION.md](./DATA_RETENTION.md#scheduled-jobs). |
| **Private DB settings** | `private.signup_notify_settings` and `private.founding_notify_settings` — re-run setup scripts if notification webhooks stop firing. |

---

## Post-deletion backup retention

When users delete accounts or workspaces, data is removed from **active** systems immediately (or within a reasonable period). **Encrypted Supabase backups may still contain deleted data until the backup window rotates out.** This is already disclosed in the public Privacy Policy (§8) and [COMPLIANCE.md](./COMPLIANCE.md). You cannot surgically remove one tenant from a backup snapshot — only wait for expiry or restore to a point before deletion if doing a full project recovery.

---

## Restore runbook

Work through in order. Assume total loss of the Supabase project or corrupted database.

### 1. Restore or recreate Supabase project

**Option A — Same project, restore from backup (preferred)**

1. Dashboard → **Database → Backups** → choose backup (or PITR timestamp on Pro).
2. Restore to the existing project or a new project (Supabase docs vary by plan — follow the dashboard wizard).
3. Note the new project ref if you created a fresh project; update all URLs and env vars below.

**Option B — New project from migrations (empty DB, no customer data)**

```bash
npx supabase link --project-ref YOUR_NEW_REF
npx supabase db push --project-ref YOUR_NEW_REF
```

This gives you schema + RLS but **no production data**.

### 2. Re-run critical post-restore SQL

After any DB restore:

1. **Storage bucket** — run [STORAGE_SETUP.sql](./STORAGE_SETUP.sql) Step A then Step B in SQL Editor (bucket is not in DB backups).
2. **pg_cron purge** — schedule `purge-api-usage-log` per [DATA_RETENTION.md](./DATA_RETENTION.md#scheduled-jobs).
3. **Notification webhooks** — if signup/founding emails fail, re-run `./scripts/setup-signup-notify.sh` and `./scripts/setup-founding-notify.sh` (sets `private.*_notify_settings`).

If restore predates recent migrations, apply pending files in `supabase/migrations/` via `npx supabase db push`.

### 3. Restore Supabase edge function secrets

Re-enter from your records (`.env.local` is local-only; production secrets are in Supabase):

| Secret | Used by |
|--------|---------|
| `APP_URL` | Email links, Stripe return URLs |
| `OPENAI_API_KEY` | `extract-contract`, `extract-document` |
| `RESEND_API_KEY` | Email functions |
| `RENEWAL_FROM_EMAIL` | Renewal/digest emails |
| `CRON_SECRET` | `send-renewal-reminders` |
| `STRIPE_SECRET_KEY` | Stripe functions |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` |
| `STRIPE_PRICE_CHARTER` / `_FOUNDING` / `_STANDARD` | `create-checkout-session` |
| `FOUNDER_NOTIFY_EMAIL` | Signup/founding notifications |
| `SIGNUP_WEBHOOK_SECRET` | `notify-founder-signup` |
| `FOUNDING_WEBHOOK_SECRET` | `notify-founding-application` |
| `SIGNUP_FROM_EMAIL` | Notification from-address |

```bash
npx supabase secrets list --project-ref bvrwyuwwxsruihkxeftm   # verify names exist
# Re-set any missing values via setup scripts in ./scripts/ or:
npx supabase secrets set "APP_URL=https://suppliersync.org" --project-ref bvrwyuwwxsruihkxeftm
```

See [HANDOFF.md](../HANDOFF.md) §4 and [.env.example](../.env.example) for the full list.

### 4. Redeploy edge functions

From repo root (project ref `bvrwyuwwxsruihkxeftm`):

```bash
npx supabase functions deploy extract-contract --project-ref bvrwyuwwxsruihkxeftm
npx supabase functions deploy extract-document --project-ref bvrwyuwwxsruihkxeftm
npx supabase functions deploy send-renewal-reminders --project-ref bvrwyuwwxsruihkxeftm
npx supabase functions deploy create-checkout-session --project-ref bvrwyuwwxsruihkxeftm
npx supabase functions deploy create-portal-session --project-ref bvrwyuwwxsruihkxeftm
npx supabase functions deploy stripe-webhook --no-verify-jwt --project-ref bvrwyuwwxsruihkxeftm
npx supabase functions deploy notify-founder-signup --no-verify-jwt --project-ref bvrwyuwwxsruihkxeftm
npx supabase functions deploy notify-founding-application --no-verify-jwt --project-ref bvrwyuwwxsruihkxeftm
npx supabase functions deploy delete-account --project-ref bvrwyuwwxsruihkxeftm
```

If project URL changed, update **Stripe webhook URL** to `https://YOUR-PROJECT.supabase.co/functions/v1/stripe-webhook` and re-run `./scripts/setup-stripe-webhook.sh` if needed.

### 5. Redeploy Vercel frontend

**Vercel env vars** (Dashboard → Project → Settings → Environment Variables):

| Variable | Required |
|----------|----------|
| `VITE_SUPABASE_URL` | Yes |
| `VITE_SUPABASE_ANON_KEY` | Yes |
| `VITE_STRIPE_LINK_CHARTER` / `_FOUNDING` / `_STANDARD` | Optional fallbacks |
| `VITE_STRIPE_CUSTOMER_PORTAL_URL` | Optional legacy |

Redeploy:

```bash
./scripts/deploy-vercel.sh
```

Or trigger a production deploy from the Vercel dashboard (git-connected `main` branch).

### 6. Reconfigure Auth URLs

Dashboard → [Authentication → URL Configuration](https://supabase.com/dashboard/project/bvrwyuwwxsruihkxeftm/auth/url-configuration):

- **Site URL:** `https://suppliersync.org`
- **Redirect URLs:** `https://suppliersync.org/reset-password`, `http://localhost:5173/reset-password`

Full checklist: [PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md).

### 7. Smoke test

Run the [PRODUCTION_SETUP.md §3](./PRODUCTION_SETUP.md#3-smoke-test-checklist) checklist: sign-in, upload document, renewal test email, Stripe checkout, system health panel.

---

## Prevention (low effort)

- **Push to `main`** after every meaningful change — git is your code backup.
- **Export workspace JSON** (Account page) is a customer-facing portability feature, not your DR backup — but encourage charter clinics to export before major migrations.
- **Screenshot or export** Supabase secrets list (names only) and Stripe webhook config once per quarter.
- **Confirm backup retention** in Supabase dashboard when you upgrade/downgrade plan.
- Consider **Pro + PITR** before you have paying clinics you cannot afford to lose 24h of data for.

---

## Related docs

- [DATA_RETENTION.md](./DATA_RETENTION.md) — what we keep and how we purge
- [COMPLIANCE.md](./COMPLIANCE.md) — subprocessors, deletion vs backups
- [PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md) — go-live checklist
- [STORAGE_SETUP.sql](./STORAGE_SETUP.sql) — bucket recreate after restore
