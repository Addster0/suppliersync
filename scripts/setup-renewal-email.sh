#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

APP_URL="${APP_URL:-https://suppliersync.org}"
FROM_EMAIL="${RENEWAL_FROM_EMAIL:-SupplierSync <renewals@suppliersync.org>}"

echo "SupplierSync renewal email setup"
echo ""
echo "Before running this script, create a Resend API key at https://resend.com/api-keys"
echo "For Gmail delivery to ANY clinic inbox, verify a domain in Resend and set:"
echo "  RENEWAL_FROM_EMAIL='SupplierSync <renewals@yourdomain.com>'"
echo ""

if [[ -z "${RESEND_API_KEY:-}" ]]; then
  read -r -p "Paste RESEND_API_KEY (re_...): " RESEND_API_KEY
fi

if [[ -z "${CRON_SECRET:-}" ]]; then
  CRON_SECRET="$(openssl rand -hex 24 2>/dev/null || uuidgen | tr -d '-')"
  echo "Generated CRON_SECRET: ${CRON_SECRET}"
  echo "Save this for your daily cron job."
fi

echo ""
echo "Setting Supabase secrets..."
echo "  APP_URL=${APP_URL}"
echo "  RENEWAL_FROM_EMAIL=${FROM_EMAIL}"

supabase secrets set \
  "RESEND_API_KEY=${RESEND_API_KEY}" \
  "APP_URL=${APP_URL}" \
  "RENEWAL_FROM_EMAIL=${FROM_EMAIL}" \
  "CRON_SECRET=${CRON_SECRET}"

if [[ -n "${RENEWAL_REPLY_TO:-}" ]]; then
  echo "  RENEWAL_REPLY_TO=${RENEWAL_REPLY_TO}"
  supabase secrets set "RENEWAL_REPLY_TO=${RENEWAL_REPLY_TO}"
fi

echo ""
# pg_net cron invokes this without a JWT; auth is via x-cron-secret header.
echo "Deploying send-renewal-reminders (no JWT — pg_cron/pg_net; auth via x-cron-secret)..."
supabase functions deploy send-renewal-reminders --no-verify-jwt

echo ""
echo "Done. Next:"
echo "  1. Run migration 006 + 007 (+ 036 for auto-cron) in Supabase SQL Editor if not done yet"
echo "  2. Enable auto-scheduling: ./scripts/setup-renewal-cron.sh"
echo "  3. Open Renewals in the app and send a test email"
echo "  4. If using onboarding@resend.dev, Resend only delivers to your Resend signup email"
echo "  5. Verify a domain in Resend to deliver to any clinic Gmail"
