#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

APP_URL="${APP_URL:-https://vendor-prototype.vercel.app}"
FROM_EMAIL="${RENEWAL_FROM_EMAIL:-SupplierSync <onboarding@resend.dev>}"

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

echo ""
echo "Deploying send-renewal-reminders..."
supabase functions deploy send-renewal-reminders

echo ""
echo "Done. Next:"
echo "  1. Run migration 006 + 007 in Supabase SQL Editor if not done yet"
echo "  2. Open Renewals in the app and send a test email"
echo "  3. If using onboarding@resend.dev, Resend only delivers to your Resend signup email"
echo "  4. Verify a domain in Resend to deliver to any clinic Gmail"
