#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env.local ]]; then
  echo "Missing .env.local — copy .env.example and add your Supabase keys."
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env.local
set +a

if [[ -z "${VITE_SUPABASE_URL:-}" || -z "${VITE_SUPABASE_ANON_KEY:-}" ]]; then
  echo "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env.local"
  exit 1
fi

echo "Building..."
npm run build

echo "Deploying to Vercel production..."
npx vercel deploy --prod --yes \
  --build-env "VITE_SUPABASE_URL=${VITE_SUPABASE_URL}" \
  --build-env "VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}" \
  ${VITE_STRIPE_LINK_CHARTER:+--build-env "VITE_STRIPE_LINK_CHARTER=${VITE_STRIPE_LINK_CHARTER}"} \
  ${VITE_STRIPE_LINK_FOUNDING:+--build-env "VITE_STRIPE_LINK_FOUNDING=${VITE_STRIPE_LINK_FOUNDING}"} \
  ${VITE_STRIPE_LINK_STANDARD:+--build-env "VITE_STRIPE_LINK_STANDARD=${VITE_STRIPE_LINK_STANDARD}"} \
  ${VITE_STRIPE_CUSTOMER_PORTAL_URL:+--build-env "VITE_STRIPE_CUSTOMER_PORTAL_URL=${VITE_STRIPE_CUSTOMER_PORTAL_URL}"}
