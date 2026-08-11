# Renewal email reminders

SupplierSync sends digest emails to workspace **owners and admins** when vendor contracts hit reminder windows: **90 days**, **30 days**, **7 days**, and **due today**.

## Fix email delivery today (checklist)

### A. Quick test (same inbox as Resend account)

1. Sign up at [resend.com](https://resend.com) with the **same Gmail** you use in the app.
2. Create an API key.
3. From the project root, run:

```bash
chmod +x scripts/setup-renewal-email.sh
RESEND_API_KEY=re_your_key ./scripts/setup-renewal-email.sh
```

This sets secrets, `APP_URL=https://suppliersync.org`, and redeploys the edge function.

4. In Supabase **SQL Editor**, run migrations **006**, **007**, **008**, and **009** if you have not already.
5. Open **Renewals** → **Send test email** — mail should arrive in that Gmail inbox.

### B. Production (any clinic Gmail / corporate inbox)

Resend **sandbox** (`onboarding@resend.dev`) cannot deliver to arbitrary addresses. For real customers:

1. In Resend → **Domains** → add your domain (e.g. `suppliersync.org`).
2. Add the DNS records Resend shows (DKIM + SPF/MX on the `send` subdomain — see [DNS checklist](#dns-checklist-cloudflare--resend) below).
3. Set Supabase secrets:

```bash
supabase secrets set RENEWAL_FROM_EMAIL="SupplierSync <renewals@suppliersync.org>"
# Optional — defaults to renewals@suppliersync.org from the From address
# supabase secrets set RENEWAL_REPLY_TO="renewals@suppliersync.org"
supabase functions deploy send-renewal-reminders --no-verify-jwt
```

4. Send a test from the app to a different inbox — it should arrive.

---

## DNS checklist (Cloudflare + Resend)

Resend verifies and sends using records on the **`send` subdomain**, not by replacing your apex SPF. Live `suppliersync.org` should look like:

| Record | Name | Value | Status |
|--------|------|-------|--------|
| TXT (DKIM) | `resend._domainkey` | `p=…` (from Resend dashboard) | Required |
| TXT (SPF) | `send` | `v=spf1 include:amazonses.com ~all` | Required — Resend official include |
| MX | `send` | `10 feedback-smtp.us-east-1.amazonses.com` | Required (region may vary) |
| TXT (DMARC) | `_dmarc` | see below | Strongly recommended |
| TXT (apex SPF) | `@` / apex | e.g. Namecheap forwarding `include:spf.efwd…` | Keep as-is for receiving/forwarding |

**Do not replace** apex SPF with Resend’s `include:amazonses.com`. Resend’s SPF belongs on `send`. Apex SPF only authorizes mail that uses the apex as MAIL FROM (e.g. Namecheap forwarding). Adding Amazonses there is optional and can burn SPF’s 10-lookup limit when nested with other includes.

### DMARC edit (recommended — currently incomplete)

Cloudflare → DNS → edit the existing `_dmarc` TXT record:

| Field | Value |
|-------|-------|
| Type | `TXT` |
| Name | `_dmarc` |
| Content | `v=DMARC1; p=none; rua=mailto:renewals@suppliersync.org;` |

Keep `p=none` until you confirm Resend (and any other senders) pass DMARC in real mail headers. Ensure `renewals@suppliersync.org` (or another address you choose for `rua`) actually receives mail via Namecheap forwarding / your inbox provider.

### After DNS changes

1. Wait for propagation (often minutes; up to 48h).
2. In Resend → Domains → confirm the domain stays **Verified**.
3. Open a sent email in Resend → check **Deliverability Insights**.
4. For stubborn corporate recipients (e.g. `@hinet.org`), ask their IT to check quarantine and allowlist `suppliersync.org` — that is outside SupplierSync control.

---

## 1. Run the migrations

In Supabase → **SQL Editor**, run:

- `supabase/migrations/006_renewal_email_reminders.sql`
- `supabase/migrations/007_sync_profile_email.sql`
- `supabase/migrations/008_document_expiry.sql`
- `supabase/migrations/009_weekly_digest.sql` (superseded by 027)
- `supabase/migrations/027_monthly_annual_digest.sql`

## 2. Secrets

| Secret | Example |
|--------|---------|
| `RESEND_API_KEY` | `re_...` |
| `RENEWAL_FROM_EMAIL` | `SupplierSync <renewals@suppliersync.org>` |
| `RENEWAL_REPLY_TO` | `renewals@suppliersync.org` (optional; defaults from From) |
| `APP_URL` | `https://suppliersync.org` |
| `CRON_SECRET` | Long random string for daily cron calls |

Or use `./scripts/setup-renewal-email.sh`.

## 3. Deploy the edge function

```bash
supabase functions deploy send-renewal-reminders
```

## 4. Auto-schedule daily sends (required for production)

SupplierSync uses **pg_cron + pg_net** (same pattern as signup notify) to call the edge function with no human action.

1. Apply migration **036** (`supabase/migrations/036_renewal_reminder_cron.sql`) if not already applied.
2. Deploy the function **without JWT verification** (cron auth is `x-cron-secret` only):

```bash
supabase functions deploy send-renewal-reminders --no-verify-jwt
```

3. Run the one-shot enabler (sets `CRON_SECRET`, deploys, enables DB settings):

```bash
chmod +x scripts/setup-renewal-cron.sh
./scripts/setup-renewal-cron.sh
```

Or set secrets yourself, then enable settings:

```sql
insert into private.renewal_cron_settings (id, edge_function_url, cron_secret, enabled)
values (
  1,
  'https://YOUR_PROJECT.supabase.co/functions/v1/send-renewal-reminders',
  'YOUR_CRON_SECRET',  -- must match edge secret CRON_SECRET
  true
)
on conflict (id) do update
set
  edge_function_url = excluded.edge_function_url,
  cron_secret = excluded.cron_secret,
  enabled = excluded.enabled;
```

### Schedule (UTC — Supabase pg_cron)

| Job name | Cron | Mode | Notes |
|----------|------|------|--------|
| `send-renewal-reminders-daily` | `0 14 * * *` | `cron` | Daily contract windows (90 / 30 / 7 / due today). **14:00 UTC** ≈ 7am PDT / 6am PST. |
| `send-renewal-reminders-monthly-digest` | `5 14 * * *` | `monthly_cron` | Runs daily; edge function sends only on the **1st** (UTC). |
| `send-renewal-reminders-annual-digest` | `10 14 * * *` | `annual_cron` | Runs daily; edge function sends only on **Jan 1** (UTC). |

### Confirm schedule

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname like 'send-renewal-reminders%'
order by jobname;

select enabled,
       edge_function_url is not null as has_url,
       length(cron_secret) as secret_len
from private.renewal_cron_settings;
```

### Manual trigger (debug)

```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/send-renewal-reminders" \
  -H "x-cron-secret: YOUR_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"mode":"cron"}'
```

Same for `monthly_cron` / `annual_cron`. Orgs with `monthly_digest_enabled = false` or `annual_digest_enabled = false` are skipped.

## 5. Test from the app

1. Open **Renewals**.
2. Read the yellow banners (sandbox / localhost warnings).
3. Click **Send test email to {your email}**.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Success in app, wrong inbox | Resend sandbox — verify domain or use Resend signup email |
| Resend shows Delivered, corporate inbox empty | Check recipient quarantine / junk; ask IT to allowlist `suppliersync.org` |
| Links go to localhost | Set `APP_URL` secret to `https://suppliersync.org` |
| `RESEND_API_KEY is not configured` | Run setup script or add secret + redeploy |
| `renewal_reminders_enabled does not exist` | Run migration 006 |
| 403 from Resend | Domain not verified, or sandbox recipient mismatch |

The Renewals page now shows **sandbox** and **localhost** warnings before you send.
