# SupplierSync — Security

Pre-deploy hardening and weekly audit process for Alpha.

## Architecture

Security boundary = **Supabase RLS + edge function auth**, not React route guards.
The anon key is public by design; never put the service role key in the frontend.

## Weekly audit

```bash
npm run audit:security
```

Then in Cursor: **`/weekly-security-audit`** or **`/audit-security`**

Reports land in `security-reports/audit-YYYY-MM-DD.txt`.

## Pre-deploy checklist

### Database (Supabase SQL Editor)

- [ ] Run pending migrations, especially `030_platform_admins.sql` and `031_storage_hardening.sql`
- [ ] Auth → **Confirm email** enabled
- [ ] Add platform admins: `insert into platform_admins (user_id) select id from auth.users where email = 'you@example.com';`

### Edge functions

Redeploy after security changes:

```bash
supabase functions deploy extract-contract extract-document send-renewal-reminders
supabase functions deploy notify-founder-signup notify-founding-application
```

### Vercel

- [ ] Security headers in `vercel.json` (CSP, HSTS, X-Frame-Options)
- [ ] `VITE_*` env vars set; no service role in build env

### Code hygiene

- [ ] No `supabase/.temp/` tracked in git
- [ ] No `.env` / `recovery-codes.txt` tracked
- [ ] Dependencies pinned in `package.json` (no `"latest"`)

## What we fixed (Aug 2026)

- Platform admin via `platform_admins` table (not hardcoded email in SQL)
- Auth required on edge function `mode: status` probes
- Timing-safe webhook secret comparison
- Vercel security headers + CSP
- Storage bucket file size + MIME allowlist (4 MB)
- PDF iframe sandbox without `allow-scripts`
- Static Stripe Payment Link fallback disabled in production
- Pinned npm dependencies

## Still manual / dashboard

- Enable CAPTCHA on signup if abused
- Run `gitleaks` / `semgrep` in CI when ready
- Confirm subscription should block storage **reads** for inactive orgs (product decision)
