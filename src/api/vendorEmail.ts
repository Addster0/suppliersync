import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";
import { requireSupabase } from "../lib/supabase";
import type { VendorEmailMessage } from "../types";

export type VendorEmailStatus = {
  configured: boolean;
  reachable?: boolean;
  usingSandboxSender?: boolean;
  fromEmail?: string;
  deliveryNote?: string;
  error?: string;
};

export type SendVendorContactEmailInput = {
  organizationId: string;
  vendorId: string;
  contactId: string;
  subject: string;
  body: string;
};

export type SendVendorContactEmailResult = {
  sent: boolean;
  id?: string;
  sentAt?: string;
  resendEmailId?: string | null;
  to?: string;
  toName?: string;
  vendorName?: string;
  usingSandboxSender?: boolean;
  fromEmail?: string;
  deliveryNote?: string;
  replyTo?: string | null;
  warning?: string;
  error?: string;
  configured?: boolean;
};

function errorFromInvokePayload(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as { error?: string; message?: string };
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  return null;
}

async function functionInvokeErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError && error.context instanceof Response) {
    try {
      const payload = (await error.context.clone().json()) as { error?: string; message?: string };
      if (typeof payload?.error === "string" && payload.error.trim()) {
        return payload.error;
      }
      if (typeof payload?.message === "string" && payload.message.trim()) {
        return payload.message;
      }
    } catch {
      // Response body was not JSON.
    }

    if (error.context.status === 404) {
      return "Relationship email is not deployed. Run ./scripts/setup-vendor-email.sh.";
    }
    if (error.context.status === 401) {
      return "Sign in again to send relationship emails.";
    }
    if (error.context.status === 403) {
      return "You do not have permission to send relationship emails in this workspace.";
    }
  }

  if (error instanceof FunctionsFetchError) {
    return "Cannot reach Supabase edge functions. Check your connection and try again.";
  }

  if (error instanceof FunctionsRelayError) {
    return "Supabase could not run the email function. Try again in a moment.";
  }

  if (error instanceof Error && error.message !== "Edge Function returned a non-2xx status code") {
    return error.message;
  }

  return "Relationship email request failed.";
}

export async function fetchVendorEmailStatus(): Promise<VendorEmailStatus> {
  const { data, error } = await requireSupabase().functions.invoke("send-vendor-email", {
    body: { mode: "status" },
  });

  if (error) {
    const payloadMessage = errorFromInvokePayload(data);
    return {
      configured: false,
      reachable: false,
      error: payloadMessage ?? (await functionInvokeErrorMessage(error)),
    };
  }

  const payload = (data ?? {}) as VendorEmailStatus & { error?: string };
  return {
    configured: Boolean(payload.configured),
    reachable: true,
    usingSandboxSender: payload.usingSandboxSender,
    fromEmail: payload.fromEmail,
    deliveryNote: payload.deliveryNote,
    error: payload.configured ? undefined : payload.error,
  };
}

export async function sendVendorContactEmail(
  input: SendVendorContactEmailInput
): Promise<SendVendorContactEmailResult> {
  const { data, error } = await requireSupabase().functions.invoke("send-vendor-email", {
    body: {
      mode: "send",
      organizationId: input.organizationId,
      vendorId: input.vendorId,
      contactId: input.contactId,
      subject: input.subject,
      body: input.body,
    },
  });

  if (error) {
    const payloadMessage = errorFromInvokePayload(data);
    throw new Error(payloadMessage ?? (await functionInvokeErrorMessage(error)));
  }

  const payload = (data ?? {}) as SendVendorContactEmailResult;
  if (payload.error && !payload.sent) {
    throw new Error(payload.error);
  }

  return payload;
}

function mapEmailRow(row: {
  id: string;
  contact_id: string | null;
  to_email: string;
  to_name: string;
  subject: string;
  body_text: string;
  status: "sent" | "failed";
  error_message: string | null;
  resend_email_id: string | null;
  sent_by: string;
  sent_at: string;
}): VendorEmailMessage {
  return {
    id: row.id,
    contactId: row.contact_id,
    toEmail: row.to_email,
    toName: row.to_name ?? "",
    subject: row.subject,
    bodyText: row.body_text,
    status: row.status,
    errorMessage: row.error_message,
    resendEmailId: row.resend_email_id,
    sentBy: row.sent_by,
    sentAt: row.sent_at,
  };
}

export function vendorEmailSetupHintFromError(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes("vendor_email_messages") &&
    (lower.includes("does not exist") || lower.includes("schema cache") || lower.includes("could not find"))
  ) {
    return " Run migration 035_vendor_contact_emails.sql in the Supabase SQL editor.";
  }
  return "";
}

export async function fetchVendorEmailMessages(
  organizationId: string,
  vendorId: string
): Promise<VendorEmailMessage[]> {
  const { data, error } = await requireSupabase()
    .from("vendor_email_messages")
    .select(
      "id, contact_id, to_email, to_name, subject, body_text, status, error_message, resend_email_id, sent_by, sent_at"
    )
    .eq("organization_id", organizationId)
    .eq("vendor_id", vendorId)
    .order("sent_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(error.message + vendorEmailSetupHintFromError(error.message));
  }

  return (data ?? []).map(mapEmailRow);
}
