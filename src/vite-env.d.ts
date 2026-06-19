/// <reference types="vite/client" />

declare module "*.png" {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_STRIPE_LINK_CHARTER?: string;
  readonly VITE_STRIPE_LINK_FOUNDING?: string;
  readonly VITE_STRIPE_LINK_STANDARD?: string;
  readonly VITE_STRIPE_LINK_STARTER?: string;
  readonly VITE_STRIPE_LINK_PRO?: string;
  readonly VITE_STRIPE_LINK_BUSINESS?: string;
  readonly VITE_STRIPE_CUSTOMER_PORTAL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
