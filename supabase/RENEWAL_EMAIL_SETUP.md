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

This sets secrets, `APP_URL=https://vendor-prototype.vercel.app`, and redeploys the edge function.

4. In Supabase **SQL Editor**, run migrations **006**, **007**, **008**, and **009** if you have not already.
5. Open **Renewals** → **Send test email** — mail should arrive in that Gmail inbox.

### B. Production (any clinic Gmail)

Resend **sandbox** (`onboarding@resend.dev`) cannot deliver to arbitrary addresses. For real customers:

1. In Resend → **Domains** → add your domain (e.g. `suppliersync.com` or a subdomain).
2. Add the DNS records Resend shows (TXT/MX/CNAME).
3. Set Supabase secret:

```bash
supabase secrets set RENEWAL_FROM_EMAIL="SupplierSync <renewals@yourdomain.com>"
supabase functions deploy send-renewal-reminders
```

4. Send a test from the app to a different Gmail — it should arrive.

---

## 1. Run the migrations

In Supabase → **SQL Editor**, run:

- `supabase/migrations/006_renewal_email_reminders.sql`
- `supabase/migrations/007_sync_profile_email.sql`
- `supabase/migrations/008_document_expiry.sql`
- `supabase/migrations/009_weekly_digest.sql`

## 2. Secrets

| Secret | Example |
|--------|---------|
| `RESEND_API_KEY` | `re_...` |
| `RENEWAL_FROM_EMAIL` | `SupplierSync <renewals@yourdomain.com>` |
| `APP_URL` | `https://vendor-prototype.vercel.app` |
| `CRON_SECRET` | Long random string for daily cron calls |

Or use `./scripts/setup-renewal-email.sh`.

## 3. Deploy the edge function

```bash
supabase functions deploy send-renewal-reminders
```

## 4. Schedule daily sends (optional)

**Contract reminders** (90 / 30 / 7 / due today):

```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/send-renewal-reminders" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "x-cron-secret: YOUR_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"mode":"cron"}'
```

**Weekly action items digest** (Mondays — one email per workspace per week when items exist):

```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/send-renewal-reminders" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "x-cron-secret: YOUR_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"mode":"weekly_cron"}'
```

Schedule `weekly_cron` once per day (e.g. Monday 8am). Orgs with `weekly_digest_enabled = false` are skipped.

## 5. Test from the app

1. Open **Renewals**.
2. Read the yellow banners (sandbox / localhost warnings).
3. Click **Send test email to {your email}**.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Success in app, wrong inbox | Resend sandbox — verify domain or use Resend signup email |
| Links go to localhost | Set `APP_URL` secret to your Vercel URL |
| `RESEND_API_KEY is not configured` | Run setup script or add secret + redeploy |
| `renewal_reminders_enabled does not exist` | Run migration 006 |
| 403 from Resend | Domain not verified, or sandbox recipient mismatch |

The Renewals page now shows **sandbox** and **localhost** warnings before you send.
