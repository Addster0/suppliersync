import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireAuthenticatedUser } from "../_shared/requireAuthenticated.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_SUBJECT_LEN = 500;
const MAX_BODY_LEN = 20000;
const MAX_SENDS_PER_ORG_PER_HOUR = 30;
const WRITE_ROLES = new Set(["owner", "admin", "member"]);

type SendPayload = {
  mode?: "status" | "send";
  organizationId?: string;
  vendorId?: string;
  contactId?: string;
  subject?: string;
  body?: string;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isSandboxSender(fromEmail: string) {
  return fromEmail.includes("resend.dev");
}

function emailDeliveryNote(fromEmail: string) {
  if (isSandboxSender(fromEmail)) {
    return "Resend sandbox sender: mail only delivers to the email on your Resend account. Verify a domain and set VENDOR_EMAIL_FROM (or RENEWAL_FROM_EMAIL) to send to any contact inbox.";
  }
  return "Production sender configured — relationship emails can deliver to vendor contacts.";
}

function resolveFromEmail() {
  return (
    Deno.env.get("VENDOR_EMAIL_FROM")?.trim() ||
    Deno.env.get("RENEWAL_FROM_EMAIL")?.trim() ||
    "SupplierSync <renewals@suppliersync.org>"
  );
}

function notConfiguredMessage() {
  return (
    "Add RESEND_API_KEY to Supabase edge function secrets to enable relationship email. " +
    "Run ./scripts/setup-vendor-email.sh (reuses the same Resend key as renewal reminders)."
  );
}

function plainTextToHtml(body: string) {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p style="margin:0 0 14px;color:#334155;font-size:15px;line-height:1.55;">${escapeHtml(block).replaceAll("\n", "<br>")}</p>`)
    .join("");

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#eef2f7;font-family:Inter,Segoe UI,sans-serif;">
  <div style="max-width:560px;margin:24px auto;padding:24px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;">
    <p style="margin:0 0 16px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#1d4ed8;">SupplierSync</p>
    ${paragraphs || `<p style="margin:0;color:#334155;font-size:15px;line-height:1.55;">${escapeHtml(body)}</p>`}
  </div>
</body>
</html>`;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function htmlToPlainText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h1>/gi, "\n\n")
    .replace(/<\/h2>/gi, "\n\n")
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function sendViaResend(params: {
  resendKey: string;
  fromEmail: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}) {
  const payload: Record<string, unknown> = {
    from: params.fromEmail,
    to: [params.to],
    subject: params.subject,
    html: params.html,
    text: htmlToPlainText(params.html),
  };

  if (params.replyTo?.trim()) {
    payload.reply_to = params.replyTo.trim();
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const detail = await response.text();

  if (!response.ok) {
    let message = detail;
    try {
      const parsed = JSON.parse(detail) as { message?: string };
      if (parsed.message) message = parsed.message;
    } catch {
      // Keep raw response text when Resend does not return JSON.
    }

    if (response.status === 403 && params.fromEmail.includes("resend.dev")) {
      throw new Error(
        `Resend test mode only delivers to the email on your Resend account, not ${params.to}. ` +
          "Verify your domain and set VENDOR_EMAIL_FROM (or RENEWAL_FROM_EMAIL).",
      );
    }

    throw new Error(`Resend error (${response.status}): ${message}`);
  }

  try {
    const parsed = JSON.parse(detail) as { id?: string };
    return { id: parsed.id ?? null };
  } catch {
    return { id: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  let body: SendPayload;
  try {
    body = (await req.json()) as SendPayload;
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const mode = body.mode ?? "send";
  const resendKey = Deno.env.get("RESEND_API_KEY")?.trim() ?? "";
  const fromEmail = resolveFromEmail();

  if (mode === "status") {
    const auth = await requireAuthenticatedUser(req, corsHeaders, jsonResponse);
    if ("error" in auth && auth.error) return auth.error;

    return jsonResponse({
      configured: Boolean(resendKey),
      usingSandboxSender: isSandboxSender(fromEmail),
      fromEmail,
      deliveryNote: emailDeliveryNote(fromEmail),
      error: resendKey ? undefined : notConfiguredMessage(),
    });
  }

  if (mode !== "send") {
    return jsonResponse({ error: "Unknown mode." }, 400);
  }

  const auth = await requireAuthenticatedUser(req, corsHeaders, jsonResponse);
  if ("error" in auth && auth.error) return auth.error;
  const user = auth.user;

  if (!resendKey) {
    return jsonResponse({ configured: false, error: notConfiguredMessage() }, 503);
  }

  const organizationId = body.organizationId?.trim();
  const vendorId = body.vendorId?.trim();
  const contactId = body.contactId?.trim();
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const bodyText = typeof body.body === "string" ? body.body.trim() : "";

  if (!organizationId || !vendorId || !contactId) {
    return jsonResponse(
      { error: "organizationId, vendorId, and contactId are required." },
      400,
    );
  }

  if (!subject) {
    return jsonResponse({ error: "Subject is required." }, 400);
  }
  if (subject.length > MAX_SUBJECT_LEN) {
    return jsonResponse({ error: `Subject must be ${MAX_SUBJECT_LEN} characters or fewer.` }, 400);
  }
  if (!bodyText) {
    return jsonResponse({ error: "Message body is required." }, 400);
  }
  if (bodyText.length > MAX_BODY_LEN) {
    return jsonResponse({ error: `Message body must be ${MAX_BODY_LEN} characters or fewer.` }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Supabase environment is not configured." }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: membership, error: membershipError } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    return jsonResponse({ error: membershipError.message }, 500);
  }

  if (!membership || !WRITE_ROLES.has(membership.role)) {
    return jsonResponse(
      { error: "You do not have permission to send relationship emails in this workspace." },
      403,
    );
  }

  const { data: hasSubscription, error: subError } = await admin.rpc(
    "org_has_active_subscription",
    { org_id: organizationId },
  );

  if (subError) {
    return jsonResponse({ error: subError.message }, 500);
  }

  if (!hasSubscription) {
    return jsonResponse(
      { error: "An active subscription or trial is required to send relationship emails." },
      403,
    );
  }

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount, error: rateError } = await admin
    .from("vendor_email_messages")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("status", "sent")
    .gt("sent_at", since);

  if (rateError) {
    const lower = rateError.message.toLowerCase();
    if (!lower.includes("does not exist")) {
      return jsonResponse({ error: rateError.message }, 500);
    }
  } else if ((recentCount ?? 0) >= MAX_SENDS_PER_ORG_PER_HOUR) {
    return jsonResponse(
      {
        error: `Rate limit exceeded: ${MAX_SENDS_PER_ORG_PER_HOUR} relationship emails per hour for this workspace. Try again later.`,
      },
      429,
    );
  }

  const { data: contact, error: contactError } = await admin
    .from("contacts")
    .select("id, name, email, vendor_id, organization_id")
    .eq("id", contactId)
    .eq("organization_id", organizationId)
    .eq("vendor_id", vendorId)
    .maybeSingle();

  if (contactError) {
    return jsonResponse({ error: contactError.message }, 500);
  }

  if (!contact) {
    return jsonResponse({ error: "Contact not found in this workspace." }, 404);
  }

  const toEmail = String(contact.email ?? "").trim();
  if (!toEmail || !isValidEmail(toEmail)) {
    return jsonResponse({ error: "This contact does not have a valid email address." }, 400);
  }

  const { data: vendor, error: vendorError } = await admin
    .from("vendors")
    .select("id, name")
    .eq("id", vendorId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (vendorError) {
    return jsonResponse({ error: vendorError.message }, 500);
  }
  if (!vendor) {
    return jsonResponse({ error: "Vendor not found in this workspace." }, 404);
  }

  const replyTo = user.email?.trim() || undefined;

  try {
    const result = await sendViaResend({
      resendKey,
      fromEmail,
      to: toEmail,
      subject,
      html: plainTextToHtml(bodyText),
      replyTo,
    });

    const { data: row, error: insertError } = await admin
      .from("vendor_email_messages")
      .insert({
        organization_id: organizationId,
        vendor_id: vendorId,
        contact_id: contactId,
        to_email: toEmail,
        to_name: String(contact.name ?? ""),
        subject,
        body_text: bodyText,
        status: "sent",
        resend_email_id: result.id,
        sent_by: user.id,
      })
      .select("id, sent_at, resend_email_id")
      .single();

    if (insertError) {
      return jsonResponse(
        {
          sent: true,
          warning:
            "Email was sent, but the activity log could not be saved. Run migration 035_vendor_contact_emails.sql.",
          resendEmailId: result.id,
          to: toEmail,
          error: insertError.message,
        },
        200,
      );
    }

    return jsonResponse({
      sent: true,
      configured: true,
      id: row.id,
      sentAt: row.sent_at,
      resendEmailId: row.resend_email_id ?? result.id,
      to: toEmail,
      toName: contact.name,
      vendorName: vendor.name,
      usingSandboxSender: isSandboxSender(fromEmail),
      fromEmail,
      deliveryNote: emailDeliveryNote(fromEmail),
      replyTo: replyTo ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send email.";

    await admin.from("vendor_email_messages").insert({
      organization_id: organizationId,
      vendor_id: vendorId,
      contact_id: contactId,
      to_email: toEmail,
      to_name: String(contact.name ?? ""),
      subject,
      body_text: bodyText,
      status: "failed",
      error_message: message.slice(0, 1000),
      sent_by: user.id,
    });

    return jsonResponse({ sent: false, error: message }, 502);
  }
});
