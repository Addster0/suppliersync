#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

FROM_EMAIL="${VENDOR_EMAIL_FROM:-${RENEWAL_FROM_EMAIL:-SupplierSync <renewals@suppliersync.org>}}"

echo "SupplierSync relationship email setup"
echo ""
echo "This deploys send-vendor-email (CRM emails to vendor contacts)."
echo "It uses the same RESEND_API_KEY as renewal reminders."
echo "For delivery to ANY contact inbox, verify a domain in Resend and set:"
echo "  VENDOR_EMAIL_FROM='SupplierSync <relationships@yourdomain.com>'"
echo "  (or reuse RENEWAL_FROM_EMAIL)"
echo ""

if [[ -z "${RESEND_API_KEY:-}" ]]; then
  read -r -p "Paste RESEND_API_KEY (re_...): " RESEND_API_KEY
fi

echo ""
echo "Setting Supabase secrets..."
echo "  VENDOR_EMAIL_FROM=${FROM_EMAIL}"

supabase secrets set \
  "RESEND_API_KEY=${RESEND_API_KEY}" \
  "VENDOR_EMAIL_FROM=${FROM_EMAIL}"

echo ""
echo "Deploying send-vendor-email..."
supabase functions deploy send-vendor-email

echo ""
echo "Done. Next:"
echo "  1. Run migration 035_vendor_contact_emails.sql in Supabase SQL Editor if not applied"
echo "  2. Open a vendor → Contacts → Email <contact>"
echo "  3. If using onboarding@resend.dev, Resend only delivers to your Resend signup email"
echo "  4. Verify a domain in Resend to deliver to any vendor inbox"
