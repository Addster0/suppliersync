# Abuse prevention — SupplierSync

What protects **suppliersync.org** (Supabase `bvrwyuwwxsruihkxeftm`) today, what was added in migration `028_abuse_prevention.sql`, and how to deploy.

---

## Platform-managed (Supabase Auth)

These limits apply automatically — no app code required. Configure steady-state values in [Authentication → Rate Limits](https://supabase.com/dashboard/project/bvrwyuwwxsruihkxeftm/auth/rate-limits).

| Operation | Default | Notes |
|-----------|---------|-------|
| Sign-up / sign-in per IP | Configurable (burst ~30 non-configurable) | Token-bucket; burst may allow ~30 requests before steady limit kicks in |
| Password reset / signup email | 60 s between requests per user | Per-user cooldown |
| Email sends (built-in SMTP) | 2 emails/hour project-wide | Use custom SMTP in production for higher throughput |
| OTP / verification | 360–1800/hour | Not used (email+password auth only) |

**App-managed auth:** none beyond using Supabase client SDK. No CAPTCHA configured.

**Recommendation:** Keep default auth rate limits. If sign-up spam appears, tighten **Rate limit for sign-ups and sign-ins** in the dashboard and add custom SMTP + CAPTCHA per [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod).

---

## Already protected (before 028)

| Area | Protection |
|------|------------|
| **CSV import** | 500 rows/file — `MAX_VENDOR_IMPORT_ROWS` in client + `importVendorsFromCsv` server check |
| **File uploads** | 4 MB max — `MAX_FILE_BYTES` client-side; storage has no server-side size cap (rely on client + extract limits) |
| **AI extract payload** | 4 MB base64 max, PDF-only, magic-byte check — edge functions |
| **AI extract auth** | Requires org membership (JWT + `organization_members` lookup) |
| **Search results** | Min 2 chars, max 50 rows, ILIKE escape — `search_organization` |
| **Search debounce** | 250 ms — `GlobalSearch.tsx` |
| **Submit buttons** | `disabled` while busy — import, founding app, setup guide forms |
| **Cron / digests** | `CRON_SECRET` header on `send-renewal-reminders` cron modes |
| **Stripe webhook** | `STRIPE_WEBHOOK_SECRET` signature verification |
| **Signup notify** | `SIGNUP_WEBHOOK_SECRET` via `x-signup-webhook-secret` (pg_net trigger) |
| **Founding notify** | `FOUNDING_WEBHOOK_SECRET` via `x-founding-webhook-secret` (pg_net trigger) |
| **Billing checkout** | Org admin/owner only |
| **Renewal test email** | Org admin/owner only, sends to self |
| **Subscription writes** | RLS `org_has_active_subscription` on tenant tables + storage |
| **Org creation** | Auth required; **was unlimited orgs per user** |

---

## Added in migration 028

| Area | Limit | Mechanism |
|------|-------|-----------|
| **Org creation** | 5 workspaces per account | `create_organization` counts `organization_members` |
| **AI extract** | 30 calls/org/hour | `api_usage_log` + `check_and_log_api_usage` RPC; edge functions call before OpenAI |
| **Search query length** | 100 characters max | `search_organization` + client constant `MAX_SEARCH_QUERY_LENGTH` |

### AI extract rate limit details

- Logged in `public.api_usage_log` (org, endpoint, user, timestamp).
- Enforced in DB so it survives edge-function cold starts (unlike in-memory counters).
- Returns HTTP **429** from edge functions when exceeded.
- Default: **30/hour/org** for `extract-contract` and `extract-document` combined per endpoint name.

To change the cap, update `EXTRACT_MAX_PER_ORG_PER_HOUR` in `supabase/functions/_shared/apiUsageLimit.ts` and/or the RPC default.

Optional cleanup (not automated): delete rows older than 7 days:

```sql
delete from public.api_usage_log where created_at < now() - interval '7 days';
```

See [DATA_RETENTION.md](./DATA_RETENTION.md) for full retention inventory and recommended cron jobs.

---

## Not rate-limited (acceptable for v1)

| Area | Why it's OK |
|------|-------------|
| **create-checkout-session** | Admin-only; Stripe handles payment abuse |
| **create-portal-session** | Admin-only |
| **Storage uploads** | Client 4 MB cap; subscription write gate; no public bucket |
| **Direct DB RPCs** | RLS + org membership on all tenant data |

In-memory per-IP edge limits were **not** added — DB-backed org limits give better protection for OpenAI cost without Redis.

---

## Deploy steps

### 1. Apply migration

```bash
npx supabase db push --project-ref bvrwyuwwxsruihkxeftm
```

Or paste `supabase/migrations/028_abuse_prevention.sql` into the Supabase SQL Editor.

### 2. Redeploy extract edge functions

```bash
npx supabase functions deploy extract-contract --project-ref bvrwyuwwxsruihkxeftm
npx supabase functions deploy extract-document --project-ref bvrwyuwwxsruihkxeftm
```

### 3. Deploy frontend (search length guard)

Standard Vercel deploy after merge — no env changes.

### 4. Verify

- Create 5 workspaces on a test account → 6th should fail with a clear error.
- Upload 31 PDFs with AI extract in one hour → 31st should return rate-limit message.
- Search with 101+ character query → rejected.

---

## Related docs

- [DATA_RETENTION.md](./DATA_RETENTION.md)
- [PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md)
- [RENEWAL_EMAIL_SETUP.md](./RENEWAL_EMAIL_SETUP.md) — `CRON_SECRET`
- [STRIPE_SETUP.md](./STRIPE_SETUP.md) — webhook secret
