# Data retention — SupplierSync

Operational retention reference for **suppliersync.org** (Supabase `bvrwyuwwxsruihkxeftm`). Complements the public [Privacy Policy](/privacy) (section 6) and internal [ABUSE_PREVENTION.md](./ABUSE_PREVENTION.md).

This document describes **current behavior**, not aspirational policy. Update it when retention logic changes.

---

## Summary

| Data class | Default retention | Purge mechanism |
|------------|-------------------|-----------------|
| Clinic workspace data (vendors, contacts, contracts, documents, spend, notes) | While workspace exists | User deletes records in app; owner can delete workspace from Account |
| User account (`auth.users`, `profiles`) | Until deleted | Self-service via Account → Delete my account (edge function + RPC) |
| `api_usage_log` | **7 days** | `purge_old_api_usage_log()` — schedule via pg_cron (see below) |
| `renewal_reminder_log` | Indefinite (dedupe keys) | CASCADE when org or contract deleted |
| `workspace_digest_log` | Indefinite (one row per org/week) | CASCADE when org deleted |
| Storage (`organization-files` bucket) | Until object removed | Removed on vendor/document/contract delete and workspace/account deletion |
| Resend (email provider) | Per [Resend data policy](https://resend.com/legal/privacy-policy) | Provider-managed |
| Stripe (billing) | Per [Stripe retention](https://stripe.com/privacy) | Provider-managed; cancel subscription via portal |
| OpenAI (AI extract) | Per [OpenAI API data usage](https://openai.com/policies/api-data-usage-policies) | PDF sent transiently for extraction; not stored in app DB |
| Supabase backups | Per Supabase project settings | Point-in-time / daily backups may retain deleted data for backup window |

---

## Per-table notes

### Identity & membership

- **`auth.users`** — email, password hash, `raw_user_meta_data` (full name, terms acceptance timestamps).
- **`profiles`** — email (synced from auth), full_name, terms_accepted_at/version, renewal_notification_email.
- **`organization_members`** — links users to workspaces; CASCADE when profile or org deleted.
- **`organizations`** — clinic name, plan, Stripe IDs, digest/reminder toggles. Deleted via owner self-service (Account → Delete workspace) or sole-owner account deletion.

### Clinic data (tenant-scoped, RLS by org membership)

All reference `organizations(id) ON DELETE CASCADE` unless noted:

- `vendors` — name, category, notes, address
- `contacts` — name, email, phone, role
- `contracts` — titles, dates, values, file metadata (`file_url` → storage)
- `documents` — titles, file metadata
- `vendor_spend_snapshots` — descriptions, amounts, notes
- `vendor_evaluations` — reviewer_name, notes, criteria JSON
- `vendor_experiments` — title, description

### Platform / founder ops (not clinic-customer PII in the GDPR sense, but personal data)

- **`founding_applications`** — clinic_name, website, applicant_role, note, submitter user FK; CASCADE on org/user delete.
- **`outreach_leads` / `outreach_activities`** — founder CRM (contact names, emails, phones, LinkedIn); user-scoped; CASCADE when profile deleted.
- **`list_platform_signups` RPC** — reads all profiles; platform admin only (`is_platform_admin()`).

### Operational logs

- **`api_usage_log`** — org_id, endpoint, user_id, created_at. Comment in migration 028: *"Rows older than 7 days can be purged by cron."* Purge via `purge_old_api_usage_log()` (migration 029); schedule daily with pg_cron (see [Scheduled jobs](#scheduled-jobs)).

- **`renewal_reminder_log`** — org_id, contract_id, reminder_window, sent_at. Dedupes sends; grows ~4 rows/contract/lifetime.
- **`workspace_digest_log`** — org_id, digest_week, sent_at. One row per org per digest week.

---

## Storage bucket: `organization-files`

Path pattern: `{organization_id}/{vendor_id}/{timestamp}-{filename}`

- Private bucket; access via RLS on `storage.objects` (org membership).
- Upload rollback on failed DB insert removes the object.
- **Deleting a vendor** removes all objects under `{org_id}/{vendor_id}/`.
- **Deleting a document or contract** removes the `sb://` object referenced by `file_url` (DB delete succeeds even if storage delete fails; errors are logged).
- **Deleting a workspace** (owner, Account page) sweeps `{org_id}/` then calls `delete_organization` RPC.
- **Deleting an account** sweeps sole-owner workspace prefixes, then `delete_my_account` RPC + `auth.admin.deleteUser` via `delete-account` edge function.

To list orphans (legacy rows deleted before storage cleanup shipped):

```sql
-- Example: documents with sb:// paths (run cleanup separately via storage API or dashboard)
select id, file_url from public.documents where file_url like 'sb://%';
```

---

## Account & workspace deletion

| Action | Supported? | Effect |
|--------|------------|--------|
| Sign out | Yes | Session cleared only |
| Delete vendor / contact / document / contract | Yes | DB CASCADE for child rows; storage cleaned for vendor prefix or file URL |
| Delete outreach lead | Yes | User-scoped CRM |
| Delete workspace (owner) | **Yes** | Account → Danger zone; storage sweep + `delete_organization` RPC |
| Delete user account (self-service) | **Yes** | Account → Danger zone; `delete-account` edge function |
| Delete `auth.users` (admin) | Manual | Same as self-service or Supabase Auth admin API |

Self-service account deletion flow:

1. User confirms on Account page → `delete-account` edge function (JWT).
2. For each sole-owner workspace: remove `organization-files` prefix `{org_id}/`.
3. `delete_my_account()` RPC — removes profile, memberships, sole-owner orgs (CASCADE tenant data).
4. `auth.admin.deleteUser` — removes auth record.

Blockers: owning a workspace with other members (transfer ownership or delete workspace first). Cancel Stripe subscription via billing portal before deleting if applicable.

---

## Scheduled jobs

### `api_usage_log` purge (migrations 028 + 029)

Requires migration **028** (`api_usage_log` table) and **029** (`purge_old_api_usage_log()`). Function deletes rows older than 7 days and returns deleted row count. Granted to `service_role` only (pg_cron runs as `postgres` and can call it).

**One-time setup** (Supabase Dashboard → SQL Editor):

1. Verify `public.api_usage_log` and `public.purge_old_api_usage_log()` exist (if migration 028 missing, apply `028_abuse_prevention.sql` first).
2. Enable **pg_cron** (Dashboard → Database → Extensions, or `create extension if not exists pg_cron;`).
3. Schedule daily at 03:00 UTC:

```sql
select cron.schedule(
  'purge-api-usage-log',
  '0 3 * * *',
  $$select public.purge_old_api_usage_log()$$
);
```

4. Confirm row in `cron.job` where `jobname = 'purge-api-usage-log'`.

**Manual test** (SQL Editor):

```sql
select public.purge_old_api_usage_log();
```

### Optional (not implemented)

1. **Storage orphan sweep** — monthly job comparing DB `file_url` references to bucket objects (legacy orphans only).
2. **Digest/reminder log archival** — low volume; CASCADE on org delete is sufficient for v1.

Use Supabase [pg_cron](https://supabase.com/docs/guides/database/extensions/pg_cron) or an external cron hitting a secured edge function.

---

## Legal alignment

Public promises (`src/lib/legal.ts`):

- **Retention (§8):** Active while workspace is active; short-lived operational logs; delete on self-service account/workspace deletion.
- **Your choices (§9):** Profile update in app; workspace export (JSON) and self-service delete for owners; account deletion for users.
- **Subprocessors (§5):** Supabase, Stripe, Resend, OpenAI, Vercel — see [COMPLIANCE.md](./COMPLIANCE.md) for DPA checklist.

---

## Related docs

- [COMPLIANCE.md](./COMPLIANCE.md) — subprocessors, HIPAA positioning, GDPR/CCPA rights

- [ABUSE_PREVENTION.md](./ABUSE_PREVENTION.md) — `api_usage_log` 7-day purge note
- [PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md)
- [STRIPE_SETUP.md](./STRIPE_SETUP.md)
- [RENEWAL_EMAIL_SETUP.md](./RENEWAL_EMAIL_SETUP.md)
