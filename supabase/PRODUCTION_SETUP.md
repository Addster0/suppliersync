# Production setup — suppliersync.org

Checklist for going live on **https://suppliersync.org** (Supabase project `bvrwyuwwxsruihkxeftm`).

Work through these in order.

---

## 1. Supabase Auth URL configuration

**Dashboard:** [Authentication → URL Configuration](https://supabase.com/dashboard/project/bvrwyuwwxsruihkxeftm/auth/url-configuration)

| Field | Value |
|-------|-------|
| **Site URL** | `https://suppliersync.org` |

**Redirect URLs** — add each line (keep localhost for local dev):

```
https://suppliersync.org/reset-password
http://localhost:5173/reset-password
```

Optional wildcard (covers future auth callbacks):

```
https://suppliersync.org/**
```

**Notes**

- Password reset uses `redirectTo: window.location.origin + '/reset-password'` — no hardcoded domain in app code.
- Sign-up uses email + password only (no magic links / OTP). `/login` redirect is **not** required unless you add magic-link auth later.

---

## 2. `APP_URL` edge function secret

Used by renewal emails, founding/signup notifications, and Stripe checkout/portal return URLs.

**Already set via CLI** (2026-08-03):

```bash
npx supabase secrets set "APP_URL=https://suppliersync.org" --project-ref bvrwyuwwxsruihkxeftm
```

**Verify:**

```bash
npx supabase secrets list --project-ref bvrwyuwwxsruihkxeftm
```

**Dashboard alternative:** Project → **Edge Functions → Secrets** → set `APP_URL` = `https://suppliersync.org`

**Vercel:** `APP_URL` is **not** a Vite env var — it lives only in Supabase edge function secrets. No Vercel change needed unless you added it manually.

**Redeploy** edge functions after changing secrets (only if links still look wrong):

```bash
npx supabase functions deploy send-renewal-reminders --project-ref bvrwyuwwxsruihkxeftm
npx supabase functions deploy notify-founder-signup --project-ref bvrwyuwwxsruihkxeftm
npx supabase functions deploy notify-founding-application --project-ref bvrwyuwwxsruihkxeftm
npx supabase functions deploy create-checkout-session --project-ref bvrwyuwwxsruihkxeftm
npx supabase functions deploy create-portal-session --project-ref bvrwyuwwxsruihkxeftm
```

---

## 3. Smoke test checklist

Run on **https://suppliersync.org** after steps 1–2.

### Auth

- [ ] **Sign up** — create a test account; confirm you land in the app (no auth errors).
- [ ] **Sign in / sign out** — session persists on refresh.
- [ ] **Password reset** — request reset from `/login`; email link opens `https://suppliersync.org/reset-password` (not localhost or old vercel.app URL); set new password and sign in.

### Documents & storage

- [ ] **System status** (Account or setup panel) — Database, Document storage, and AI extraction show green.
- [ ] **Upload a document** on a vendor — file saves and opens via signed URL.

### Renewals & email

- [ ] Open **Renewals** — no yellow banner about localhost `APP_URL`.
- [ ] **Send test email** — arrives; links in email point to `https://suppliersync.org/...` (not localhost).

### Billing / Stripe

- [ ] **Billing** page loads plan info without errors.
- [ ] **Subscribe** (test mode) — Stripe Checkout opens; success/cancel returns to `https://suppliersync.org`.
- [ ] **Manage billing** (portal) — opens Stripe Customer Portal and returns to the app.

### Founding / notifications (if enabled)

- [ ] Submit a founding application — founder notification email links to `https://suppliersync.org/billing` (or admin panel path in email).

---

## Related docs

- [RENEWAL_EMAIL_SETUP.md](./RENEWAL_EMAIL_SETUP.md)
- [FOUNDING_CLINICS.md](./FOUNDING_CLINICS.md)
- [STRIPE_SETUP.md](./STRIPE_SETUP.md)
- [STORAGE_SETUP.sql](./STORAGE_SETUP.sql)
