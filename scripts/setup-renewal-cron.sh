#!/usr/bin/env bash
# Enable pg_cron → pg_net auto-scheduling for send-renewal-reminders.
# Does not overwrite RESEND_API_KEY / RENEWAL_FROM_EMAIL.
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_REF="${SUPABASE_PROJECT_REF:-bvrwyuwwxsruihkxeftm}"

if [[ -f .env.local ]]; then
  # shellcheck disable=SC1091
  set -a
  source .env.local
  set +a
fi

SUPABASE_URL="${VITE_SUPABASE_URL:-https://${PROJECT_REF}.supabase.co}"
EDGE_FUNCTION_URL="${SUPABASE_URL%/}/functions/v1/send-renewal-reminders"

echo "SupplierSync renewal reminder cron setup"
echo "  Project: ${PROJECT_REF}"
echo "  Edge URL: ${EDGE_FUNCTION_URL}"
echo ""

# CRON_SECRET must match between edge env and private.renewal_cron_settings.
# Plaintext cannot be read back from Supabase secrets — pass CRON_SECRET=... to reuse,
# otherwise rotate (safe; Resend secrets are never touched).
if [[ -z "${CRON_SECRET:-}" ]]; then
  CRON_SECRET="$(openssl rand -hex 24 2>/dev/null || uuidgen | tr -d '-')"
  echo "Generated new CRON_SECRET (rotating edge + DB settings)."
  echo "Save a copy if you also call the function manually: ${CRON_SECRET}"
else
  echo "Using CRON_SECRET from environment (will sync to edge + DB)."
fi

echo "Setting CRON_SECRET on edge function secrets (Resend untouched)..."
npx supabase secrets set "CRON_SECRET=${CRON_SECRET}" --project-ref "${PROJECT_REF}"

echo ""
echo "Deploying send-renewal-reminders with --no-verify-jwt"
echo "(pg_net has no JWT; auth is x-cron-secret)..."
npx supabase functions deploy send-renewal-reminders --no-verify-jwt --project-ref "${PROJECT_REF}"

echo ""
echo "Applying migration 036 (pg_cron jobs) if needed..."
npx supabase db query --linked -f supabase/migrations/036_renewal_reminder_cron.sql

# Escape single quotes for SQL literal
SQL_SECRET="${CRON_SECRET//\'/\'\'}"
SQL_URL="${EDGE_FUNCTION_URL//\'/\'\'}"

echo ""
echo "Enabling private.renewal_cron_settings..."
npx supabase db query --linked "$(cat <<EOF
insert into private.renewal_cron_settings (id, edge_function_url, cron_secret, enabled)
values (
  1,
  '${SQL_URL}',
  '${SQL_SECRET}',
  true
)
on conflict (id) do update
set
  edge_function_url = excluded.edge_function_url,
  cron_secret = excluded.cron_secret,
  enabled = excluded.enabled;

select jobid, jobname, schedule, active
from cron.job
where jobname like 'send-renewal-reminders%'
order by jobname;
EOF
)"

echo ""
echo "Done. Jobs run daily in UTC:"
echo "  send-renewal-reminders-daily           0 14 * * *   (14:00 UTC)"
echo "  send-renewal-reminders-monthly-digest  5 14 * * *   (self-gates to 1st)"
echo "  send-renewal-reminders-annual-digest  10 14 * * *   (self-gates to Jan 1)"
echo ""
echo "Confirm anytime:"
echo "  select jobid, jobname, schedule, active from cron.job where jobname like 'send-renewal-reminders%';"
echo "  select enabled, edge_function_url is not null as has_url, length(cron_secret) as secret_len from private.renewal_cron_settings;"
