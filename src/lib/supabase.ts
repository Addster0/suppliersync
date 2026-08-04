import { createClient, SupabaseClient } from "@supabase/supabase-js";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export type SupabaseConfigIssue = "missing" | "invalid_url" | "invalid_anon_key";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

function isPlaceholder(value: string) {
  return /your-project|your-anon-key|example/i.test(value);
}

function isValidAnonKey(key: string): boolean {
  if (key.length < 20) return false;

  // Legacy anon JWT from Project Settings → API (three dot-separated segments)
  if (key.startsWith("eyJ")) {
    const segments = key.split(".");
    return segments.length === 3 && segments.every((s) => s.length > 0) && key.length >= 100;
  }

  // New publishable key from Project Settings → API (sb_publishable_… or sb_pub…)
  if (key.startsWith("sb_pub")) {
    return key.length >= 40 && /^sb_pub[a-zA-Z0-9_-]+$/.test(key);
  }

  return false;
}

export function getSupabaseConfigIssues(): SupabaseConfigIssue[] {
  if (!supabaseUrl?.trim() || !supabaseAnonKey?.trim()) {
    return ["missing"];
  }

  const issues: SupabaseConfigIssue[] = [];
  const url = supabaseUrl.trim();
  const key = supabaseAnonKey.trim();

  if (
    isPlaceholder(url) ||
    !url.startsWith("https://") ||
    !/\.supabase\.co\/?$/.test(url.replace(/\/$/, ""))
  ) {
    issues.push("invalid_url");
  }

  if (isPlaceholder(key) || !isValidAnonKey(key)) {
    issues.push("invalid_anon_key");
  }

  return issues;
}

export const supabaseConfigIssues = getSupabaseConfigIssues();
export const isSupabaseConfigValid = isSupabaseConfigured && supabaseConfigIssues.length === 0;

export const supabase: SupabaseClient | null = isSupabaseConfigValid
  ? createClient(supabaseUrl!.trim(), supabaseAnonKey!.trim())
  : null;

export async function checkSupabaseReachable(): Promise<boolean> {
  if (!isSupabaseConfigValid || !supabaseUrl || !supabaseAnonKey) return false;

  try {
    const response = await fetch(`${supabaseUrl.trim()}/auth/v1/health`, {
      headers: { apikey: supabaseAnonKey.trim() },
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function formatSupabaseAuthError(error: unknown): string {
  if (error instanceof TypeError || (error instanceof Error && /failed to fetch/i.test(error.message))) {
    return "Cannot reach Supabase. Check that your project is active in the Supabase dashboard, VITE_SUPABASE_URL is correct, and restart the dev server after updating .env.local.";
  }

  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "Sign in failed. Please try again.";
}

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and add your project keys."
    );
  }
  return supabase;
}

/** Where Supabase sends users after they click the password-reset link in email. */
export function getPasswordResetRedirectUrl(): string {
  return `${window.location.origin}/reset-password`;
}

/*
 * Supabase Dashboard → Authentication → URL Configuration:
 * - Site URL: https://suppliersync.org (production)
 * - Redirect URLs (add each environment):
 *     https://suppliersync.org/reset-password
 *     http://localhost:5173/reset-password
 */
