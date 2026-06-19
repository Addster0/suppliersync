import { requireSupabase } from "../lib/supabase";

export type RenewalEmailStatus = {
  configured?: boolean;
  usingSandboxSender?: boolean;
  appUrl?: string;
  appUrlIsLocal?: boolean;
  fromEmail?: string;
  deliveryNote?: string;
};

export async function fetchRenewalEmailStatus(): Promise<RenewalEmailStatus | null> {
  const { data, error } = await requireSupabase().functions.invoke("send-renewal-reminders", {
    body: { mode: "status" },
  });

  if (error) throw new Error(error.message);

  const payload = data as RenewalEmailStatus & { error?: string };
  if (payload?.error) throw new Error(payload.error);

  return payload ?? null;
}

export async function setRenewalRemindersEnabled(organizationId: string, enabled: boolean) {
  const { error } = await requireSupabase()
    .from("organizations")
    .update({ renewal_reminders_enabled: enabled })
    .eq("id", organizationId);

  if (error) throw new Error(error.message);
}

export async function setWeeklyDigestEnabled(organizationId: string, enabled: boolean) {
  const { error } = await requireSupabase()
    .from("organizations")
    .update({ weekly_digest_enabled: enabled })
    .eq("id", organizationId);

  if (error) throw new Error(error.message);
}

export async function sendWeeklyDigestTest(organizationId: string) {
  const { data, error } = await requireSupabase().functions.invoke("send-renewal-reminders", {
    body: { organizationId, mode: "test_weekly_digest" },
  });

  if (error) throw new Error(error.message);

  const payload = data as {
    error?: string;
    sent?: boolean;
    recipient?: string;
    itemCount?: number;
    usingSandboxSender?: boolean;
    appUrl?: string;
    resendEmailId?: string | null;
    deliveryNote?: string;
  } | null;
  if (payload?.error) throw new Error(payload.error);

  return payload ?? { sent: false };
}

export async function sendRenewalReminderTest(organizationId: string) {
  const { data, error } = await requireSupabase().functions.invoke("send-renewal-reminders", {
    body: { organizationId, mode: "test" },
  });

  if (error) throw new Error(error.message);

  const payload = data as {
    error?: string;
    sent?: boolean;
    recipient?: string;
    contractCount?: number;
    usingSandboxSender?: boolean;
    appUrl?: string;
    resendEmailId?: string | null;
    deliveryNote?: string;
  } | null;
  if (payload?.error) throw new Error(payload.error);

  return payload ?? { sent: false };
}
