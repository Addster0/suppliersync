# Stripe billing setup (SupplierSync)

Checkout attaches each workspace via `organization_id` metadata. Payment Links alone cannot do this — use **Subscribe** on Billing (calls `create-checkout-session`).

## 1. Stripe products (test mode OK)

In [Stripe Dashboard → Products](https://dashboard.stripe.com/test/products), create three recurring prices:

| Plan | Amount | Supabase secret |
|------|--------|-----------------|
| Charter partner | $49/mo | `STRIPE_PRICE_CHARTER` |
| Founding clinic | $79/mo | `STRIPE_PRICE_FOUNDING` |
| Clinic workspace | $119/mo | `STRIPE_PRICE_STANDARD` |

Copy each **Price ID** (`price_...`).

## 2. Webhook endpoint

**URL:** `https://bvrwyuwwxsruihkxeftm.supabase.co/functions/v1/stripe-webhook`

In Stripe → **Developers → Webhooks → Add endpoint**, subscribe to:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

Copy the **Signing secret** (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`.

## 3. Supabase secrets & deploy

```bash
./scripts/setup-stripe-webhook.sh
```

Prompts for `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and price IDs. Deploys:

- `stripe-webhook` (no JWT — Stripe calls directly)
- `create-checkout-session`
- `create-portal-session`

Apply billing column protection (if not already applied):

```bash
npx supabase db query --file supabase/migrations/021_protect_org_billing_fields.sql --linked
```

## 4. Customer portal

Stripe → **Settings → Billing → Customer portal** — enable update payment method, invoices, and cancel.

The app opens a per-customer portal session via `create-portal-session` (requires `stripe_customer_id` after first checkout).

Optional legacy static link: `VITE_STRIPE_CUSTOMER_PORTAL_URL` in `.env.local`.

## 5. Frontend env (optional fallbacks)

Payment Links in `.env.local` are **optional** — they cannot attach `organization_id`. Prefer **Subscribe** on Billing.

```env
VITE_STRIPE_LINK_CHARTER=...
VITE_STRIPE_LINK_FOUNDING=...
VITE_STRIPE_LINK_STANDARD=...
```

## 6. Test flow

1. Sign in as org owner → **Billing → Subscribe**
2. Stripe test card: `4242 4242 4242 4242`, any future expiry, any CVC
3. Return to `/app/billing?checkout=success` — page polls until `subscription_status = active`
4. Confirm in Supabase: `organizations.subscription_status`, `stripe_customer_id`, `stripe_subscription_id`
5. Stripe → Webhooks → endpoint → recent deliveries should be `200`

## 7. Live mode later

Duplicate products/prices in live mode, create a live webhook endpoint (same URL/events), and set live `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` in Supabase secrets. Toggle Stripe Dashboard to live when ready.
