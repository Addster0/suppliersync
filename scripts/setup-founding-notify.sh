#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

APP_URL="${APP_URL:-https://suppliersync.org}"
FROM_EMAIL="${SIGNUP_FROM_EMAIL:-${RENEWAL_FROM_EMAIL:-SupplierSync <renewals@suppliersync.org>}}"
FOUNDER_EMAIL="${FOUNDER_NOTIFY_EMAIL:-addstero28@gmail.com}"

echo "SupplierSync founding application notification setup"
echo ""
echo "This enables:"
echo "  1. Email to the founder when a clinic applies for founding pricing"
echo "  2. Email to the applicant when you approve or decline their application"
echo ""
echo "Prerequisites:"
echo "  - Migration 022_founding_application_notify.sql applied in Supabase"
echo "  - Resend API key (same one used for renewal reminders is fine)"
echo "  - Supabase CLI linked to your project (supabase link)"
echo ""

if [[ -z "${VITE_SUPABASE_URL:-}" ]]; then
  if [[ -f .env.local ]]; then
    # shellcheck disable=SC1091
    source .env.local
  fi
fi

if [[ -z "${VITE_SUPABASE_URL:-}" ]]; then
  read -r -p "Paste VITE_SUPABASE_URL (https://xxx.supabase.co): " VITE_SUPABASE_URL
fi

if [[ -z "${RESEND_API_KEY:-}" ]]; then
  read -r -p "Paste RESEND_API_KEY (re_...): " RESEND_API_KEY
fi

if [[ -z "${FOUNDING_WEBHOOK_SECRET:-}" ]]; then
  FOUNDING_WEBHOOK_SECRET="$(openssl rand -hex 24 2>/dev/null || uuidgen | tr -d '-')"
  echo "Generated FOUNDING_WEBHOOK_SECRET: ${FOUNDING_WEBHOOK_SECRET}"
fi

EDGE_FUNCTION_URL="${VITE_SUPABASE_URL%/}/functions/v1/notify-founding-application"

echo ""
echo "Setting Supabase secrets..."
echo "  APP_URL=${APP_URL}"
echo "  FOUNDER_NOTIFY_EMAIL=${FOUNDER_EMAIL}"
echo "  SIGNUP_FROM_EMAIL=${FROM_EMAIL}"

supabase secrets set \
  "RESEND_API_KEY=${RESEND_API_KEY}" \
  "APP_URL=${APP_URL}" \
  "FOUNDER_NOTIFY_EMAIL=${FOUNDER_EMAIL}" \
  "SIGNUP_FROM_EMAIL=${FROM_EMAIL}" \
  "FOUNDING_WEBHOOK_SECRET=${FOUNDING_WEBHOOK_SECRET}"

echo ""
# pg_net invokes this without a JWT; auth is via x-founding-webhook-secret header.
echo "Deploying notify-founding-application (no JWT — pg_net calls without JWT; auth via x-founding-webhook-secret)..."
supabase functions deploy notify-founding-application --no-verify-jwt

echo ""
echo "Enable the database webhook (run in Supabase SQL editor as postgres):"
cat <<EOF

insert into private.founding_notify_settings (id, edge_function_url, webhook_secret, enabled)
values (
  1,
  '${EDGE_FUNCTION_URL}',
  '${FOUNDING_WEBHOOK_SECRET}',
  true
)
on conflict (id) do update
set
  edge_function_url = excluded.edge_function_url,
  webhook_secret = excluded.webhook_secret,
  enabled = excluded.enabled;

EOF

echo "Done. Next:"
echo "  1. Apply migration 022_founding_application_notify.sql if not already applied"
echo "  2. Run the SQL above in Supabase → SQL Editor"
echo "  3. Submit a test founding application — founder email goes to ${FOUNDER_EMAIL}"
echo "  4. Approve or reject it — applicant gets the result email"
echo "  5. Resend sandbox (onboarding@resend.dev) only delivers to your Resend account email"
