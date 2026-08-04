#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

APP_URL="${APP_URL:-https://suppliersync.org}"
FROM_EMAIL="${SIGNUP_FROM_EMAIL:-${RENEWAL_FROM_EMAIL:-SupplierSync <onboarding@resend.dev>}}"
FOUNDER_EMAIL="${FOUNDER_NOTIFY_EMAIL:-addstero28@gmail.com}"

echo "SupplierSync founder signup notification setup"
echo ""
echo "This enables:"
echo "  1. /app/admin/signups — platform admin signup dashboard"
echo "  2. Email to the founder when a new account is created (not on login)"
echo ""
echo "Prerequisites:"
echo "  - Migration 015_platform_signups.sql applied in Supabase"
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

if [[ -z "${SIGNUP_WEBHOOK_SECRET:-}" ]]; then
  SIGNUP_WEBHOOK_SECRET="$(openssl rand -hex 24 2>/dev/null || uuidgen | tr -d '-')"
  echo "Generated SIGNUP_WEBHOOK_SECRET: ${SIGNUP_WEBHOOK_SECRET}"
fi

EDGE_FUNCTION_URL="${VITE_SUPABASE_URL%/}/functions/v1/notify-founder-signup"

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
  "SIGNUP_WEBHOOK_SECRET=${SIGNUP_WEBHOOK_SECRET}"

echo ""
echo "Deploying notify-founder-signup..."
supabase functions deploy notify-founder-signup

echo ""
echo "Enable the database webhook (run in Supabase SQL editor as postgres):"
cat <<EOF

insert into private.signup_notify_settings (id, edge_function_url, webhook_secret, enabled)
values (
  1,
  '${EDGE_FUNCTION_URL}',
  '${SIGNUP_WEBHOOK_SECRET}',
  true
)
on conflict (id) do update
set
  edge_function_url = excluded.edge_function_url,
  webhook_secret = excluded.webhook_secret,
  enabled = excluded.enabled;

EOF

echo "Done. Next:"
echo "  1. Run the SQL above in Supabase → SQL Editor"
echo "  2. Open Billing → View signups, or go to /app/admin/signups"
echo "  3. Create a test account — you should get an email at ${FOUNDER_EMAIL}"
echo "  4. Resend sandbox (onboarding@resend.dev) only delivers to your Resend account email"
