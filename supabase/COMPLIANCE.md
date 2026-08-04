# Compliance — SupplierSync

Operational checklist for **suppliersync.org**. Complements the public [Privacy Policy](/privacy), [Terms of Service](/terms), and [DATA_RETENTION.md](./DATA_RETENTION.md).

---

## Subprocessors

SupplierSync uses the following subprocessors to run the Service. Sign data processing agreements (DPAs) in each vendor dashboard where available:

| Provider | Purpose | DPA / privacy |
|----------|---------|---------------|
| **Supabase** | Database, authentication, file storage | [Supabase DPA](https://supabase.com/legal/dpa) — project settings → Legal |
| **Stripe** | Subscription billing | [Stripe DPA](https://stripe.com/legal/dpa) — Dashboard → Settings |
| **Resend** | Transactional email (renewal reminders, digests) | [Resend legal](https://resend.com/legal) |
| **OpenAI** | AI PDF extraction (contract & document scan) | [OpenAI DPA](https://openai.com/policies/data-processing-addendum) — Organization settings |
| **Vercel** | Frontend hosting | [Vercel DPA](https://vercel.com/legal/dpa) |

Keep subprocessors list in sync with `src/lib/legal.ts` (Privacy Policy §4).

---

## OpenAI & AI features

- Contract and document **Scan with AI** sends PDF content to OpenAI's API for field extraction.
- Configure **zero data retention** for API usage in the [OpenAI organization settings](https://platform.openai.com/settings/organization/data-controls) where your plan supports it. Verify periodically.
- Do not upload PHI unless a BAA and appropriate agreements are in place (see HIPAA below).
- First-use disclosure is shown in the app before the first AI extract.

---

## HIPAA positioning (sales & support)

- SupplierSync is **not HIPAA-certified** and does not offer a BAA by default.
- The Service is a clinic **operations** tool for vendor records, contracts, and compliance documents — not an EHR or clinical system.
- **Clinics are responsible** for what they upload and whether use of a third-party SaaS tool is appropriate for their data.
- Direct BAA inquiries to **legal@suppliersync.org** before storing protected health information in the workspace.

---

## GDPR / CCPA — data subject rights

| Right | In-app support |
|-------|----------------|
| **Access / portability** | Workspace owners: Account → **Export workspace data** (JSON download, metadata only — no PDF binaries) |
| **Erasure** | Account → **Delete workspace** (owners) or **Delete my account** (self-service) |
| **Rectification** | Edit profile and clinic records in the app |
| **Restriction / objection** | Contact legal@suppliersync.org |

Deletion removes data from active systems; Supabase backups may retain copies for the backup window (see [DATA_RETENTION.md](./DATA_RETENTION.md)).

---

## Retention & logs

- **`api_usage_log`**: 7-day retention via `purge_old_api_usage_log()` — schedule pg_cron per [DATA_RETENTION.md](./DATA_RETENTION.md).
- **Clinic workspace data**: retained while the workspace exists; purged on owner workspace deletion or account deletion flow.
- **OpenAI**: transient processing only; not stored in app DB.

---

## Related docs

- [DATA_RETENTION.md](./DATA_RETENTION.md)
- [ABUSE_PREVENTION.md](./ABUSE_PREVENTION.md)
- [PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md)
