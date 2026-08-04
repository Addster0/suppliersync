#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_REF="${SUPABASE_PROJECT_REF:-bvrwyuwwxsruihkxeftm}"
APP_URL="${APP_URL:-https://suppliersync.org}"

if [[ -f .env.local ]]; then
  # shellcheck disable=SC1091
  set -a
  source .env.local
  set +a
fi

if [[ -n "${VITE_SUPABASE_URL:-}" ]]; then
  url_ref="${VITE_SUPABASE_URL#https://}"
  url_ref="${url_ref%%.*}"
  if [[ -n "$url_ref" && "$url_ref" != "your-project-ref" ]]; then
    PROJECT_REF="$url_ref"
  fi
fi

SUPABASE_CMD=(npx supabase)
if command -v supabase >/dev/null 2>&1; then
  SUPABASE_CMD=(supabase)
fi

WEBHOOK_URL="https://${PROJECT_REF}.supabase.co/functions/v1/stripe-webhook"

echo "SupplierSync Stripe billing setup"
echo ""
echo "Project: ${PROJECT_REF}"
echo "Webhook URL (register in Stripe Dashboard):"
echo "  ${WEBHOOK_URL}"
echo ""
echo "Required Stripe Dashboard steps:"
echo "  1. Products → create recurring prices (test mode OK):"
echo "       Charter \$49/mo  → copy price_... → STRIPE_PRICE_CHARTER"
echo "       Founding \$79/mo → copy price_... → STRIPE_PRICE_FOUNDING"
echo "       Standard \$119/mo → copy price_... → STRIPE_PRICE_STANDARD"
echo "  2. Developers → Webhooks → Add endpoint:"
echo "       URL: ${WEBHOOK_URL}"
echo "       Events: checkout.session.completed, customer.subscription.updated,"
echo "               customer.subscription.deleted, invoice.payment_failed"
echo "  3. Customer portal (Settings → Billing → Customer portal) — enable cancel/update"
echo ""
echo "Payment Links (VITE_STRIPE_LINK_*) are optional fallbacks."
echo "Checkout uses create-checkout-session with organization_id metadata."
echo ""

if [[ -z "${STRIPE_SECRET_KEY:-}" ]]; then
  read -r -p "Paste STRIPE_SECRET_KEY (sk_test_... or sk_live_...): " STRIPE_SECRET_KEY
fi

if [[ -z "${STRIPE_WEBHOOK_SECRET:-}" ]]; then
  echo ""
  echo "Create the webhook endpoint in Stripe first, then paste the signing secret (whsec_...)."
  read -r -p "Paste STRIPE_WEBHOOK_SECRET (whsec_...): " STRIPE_WEBHOOK_SECRET
fi

if [[ -z "${STRIPE_PRICE_CHARTER:-}" ]]; then
  read -r -p "Paste STRIPE_PRICE_CHARTER (price_..., optional): " STRIPE_PRICE_CHARTER
fi

if [[ -z "${STRIPE_PRICE_FOUNDING:-}" ]]; then
  read -r -p "Paste STRIPE_PRICE_FOUNDING (price_...): " STRIPE_PRICE_FOUNDING
fi

if [[ -z "${STRIPE_PRICE_STANDARD:-}" ]]; then
  read -r -p "Paste STRIPE_PRICE_STANDARD (price_...): " STRIPE_PRICE_STANDARD
fi

if [[ -z "${STRIPE_SECRET_KEY:-}" || -z "${STRIPE_WEBHOOK_SECRET:-}" ]]; then
  echo "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required."
  exit 1
fi

if [[ -z "${STRIPE_PRICE_FOUNDING:-}" && -z "${STRIPE_PRICE_STANDARD:-}" ]]; then
  echo "At least STRIPE_PRICE_FOUNDING or STRIPE_PRICE_STANDARD is required."
  exit 1
fi

SECRETS=(
  "STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}"
  "STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}"
  "APP_URL=${APP_URL}"
)

if [[ -n "${STRIPE_PRICE_CHARTER:-}" ]]; then
  SECRETS+=("STRIPE_PRICE_CHARTER=${STRIPE_PRICE_CHARTER}")
fi
if [[ -n "${STRIPE_PRICE_FOUNDING:-}" ]]; then
  SECRETS+=("STRIPE_PRICE_FOUNDING=${STRIPE_PRICE_FOUNDING}")
fi
if [[ -n "${STRIPE_PRICE_STANDARD:-}" ]]; then
  SECRETS+=("STRIPE_PRICE_STANDARD=${STRIPE_PRICE_STANDARD}")
fi

echo ""
echo "Setting Supabase secrets on ${PROJECT_REF}..."
"${SUPABASE_CMD[@]}" secrets set "${SECRETS[@]}" --project-ref "${PROJECT_REF}"

echo ""
echo "Deploying stripe-webhook (no JWT — Stripe calls this directly)..."
"${SUPABASE_CMD[@]}" functions deploy stripe-webhook --no-verify-jwt --project-ref "${PROJECT_REF}"

echo ""
echo "Deploying create-checkout-session..."
"${SUPABASE_CMD[@]}" functions deploy create-checkout-session --project-ref "${PROJECT_REF}"

echo ""
echo "Deploying create-portal-session..."
"${SUPABASE_CMD[@]}" functions deploy create-portal-session --project-ref "${PROJECT_REF}"

echo ""
echo "Apply migration 021_protect_org_billing_fields.sql in Supabase SQL Editor"
echo "(or run: supabase db push --project-ref ${PROJECT_REF})"
echo ""
echo "Test flow:"
echo "  1. Sign in → Billing → Subscribe (redirects to Stripe Checkout)"
echo "  2. Pay with test card 4242 4242 4242 4242"
echo "  3. Return to /app/billing?checkout=success — status should flip to active"
echo "  4. Stripe Dashboard → Webhooks → confirm events delivered"
echo ""
echo "Done."
