import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { secretsEqual } from "../_shared/secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-founding-webhook-secret",
};

type FoundingEvent = "new_application" | "approved" | "declined";

type FoundingPayload = {
  event?: FoundingEvent;
  applicationId?: string;
  clinicName?: string;
  organizationName?: string;
  submitterEmail?: string;
  applicantRole?: string;
  website?: string;
  note?: string;
  createdAt?: string;
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

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function buildNewApplicationHtml(params: {
  clinicName: string;
  organizationName: string;
  submitterEmail: string;
  applicantRole: string;
  website: string;
  note: string;
  createdAt: string;
  adminUrl: string;
}) {
  const websiteLine = params.website
    ? `<p style="margin:0 0 8px;"><strong>Website:</strong> ${escapeHtml(params.website)}</p>`
    : "";
  const noteBlock = params.note
    ? `<p style="margin:16px 0 0;padding:12px;background:#f3f4f6;border-radius:6px;"><strong>Note:</strong><br>${escapeHtml(params.note).replaceAll("\n", "<br>")}</p>`
    : "";

  return `<!DOCTYPE html>
<html>
<body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#111827;max-width:560px;">
  <h2 style="margin:0 0 16px;">New founding clinic application</h2>
  <p style="margin:0 0 16px;">A clinic applied for founding pricing (${escapeHtml(formatTimestamp(params.createdAt))}).</p>
  <p style="margin:0 0 8px;"><strong>Clinic:</strong> ${escapeHtml(params.clinicName)}</p>
  <p style="margin:0 0 8px;"><strong>Workspace:</strong> ${escapeHtml(params.organizationName)}</p>
  <p style="margin:0 0 8px;"><strong>Email:</strong> ${escapeHtml(params.submitterEmail)}</p>
  <p style="margin:0 0 8px;"><strong>Role:</strong> ${escapeHtml(params.applicantRole)}</p>
  ${websiteLine}
  ${noteBlock}
  <p style="margin:24px 0 0;">
    <a href="${escapeHtml(params.adminUrl)}" style="color:#2563eb;">Review on Billing page</a>
  </p>
</body>
</html>`;
}

function buildApprovedHtml(params: { clinicName: string; billingUrl: string }) {
  return `<!DOCTYPE html>
<html>
<body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#111827;max-width:560px;">
  <h2 style="margin:0 0 16px;">Founding clinic application approved</h2>
  <p style="margin:0 0 16px;">
    Great news — <strong>${escapeHtml(params.clinicName)}</strong> is approved for SupplierSync founding clinic pricing.
  </p>
  <p style="margin:0 0 16px;">
    Subscribe at the locked founding rate of <strong>$79/mo</strong> on your Billing page. This price stays locked while you remain subscribed.
  </p>
  <p style="margin:0;">
    <a href="${escapeHtml(params.billingUrl)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Go to Billing</a>
  </p>
  <p style="margin:24px 0 0;color:#6b7280;font-size:14px;">
    If the button does not work, open: ${escapeHtml(params.billingUrl)}
  </p>
</body>
</html>`;
}

function buildDeclinedHtml(params: { clinicName: string; billingUrl: string }) {
  return `<!DOCTYPE html>
<html>
<body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#111827;max-width:560px;">
  <h2 style="margin:0 0 16px;">Founding clinic application update</h2>
  <p style="margin:0 0 16px;">
    Thank you for applying for founding pricing for <strong>${escapeHtml(params.clinicName)}</strong>.
  </p>
  <p style="margin:0 0 16px;">
    We were not able to approve this workspace for the founding rate at this time. You can still subscribe at standard pricing on Billing whenever you are ready.
  </p>
  <p style="margin:0;">
    <a href="${escapeHtml(params.billingUrl)}" style="color:#2563eb;">Open Billing</a>
  </p>
</body>
</html>`;
}

async function sendViaResend(params: {
  resendKey: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  html: string;
}) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: params.fromEmail,
      to: [params.toEmail],
      subject: params.subject,
      html: params.html,
    }),
  });

  if (!response.ok) {
    let message = await response.text();
    try {
      const parsed = JSON.parse(message) as { message?: string };
      message = parsed.message ?? message;
    } catch {
      // Keep raw response text when Resend does not return JSON.
    }
    throw new Error(`Resend error (${response.status}): ${message}`);
  }

  return (await response.json()) as { id?: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const webhookSecret = Deno.env.get("FOUNDING_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return jsonResponse(
      {
        error:
          "FOUNDING_WEBHOOK_SECRET is not configured on the edge function. Run scripts/setup-founding-notify.sh.",
      },
      500
    );
  }

  const providedSecret = req.headers.get("x-founding-webhook-secret");
  if (!secretsEqual(providedSecret, webhookSecret)) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  let payload: FoundingPayload;
  try {
    payload = (await req.json()) as FoundingPayload;
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const event = payload.event;
  const clinicName = payload.clinicName?.trim();
  const organizationName = payload.organizationName?.trim();
  const submitterEmail = payload.submitterEmail?.trim();

  if (!event || !clinicName || !submitterEmail) {
    return jsonResponse(
      { error: "event, clinicName, and submitterEmail are required." },
      400
    );
  }

  if (event !== "new_application" && event !== "approved" && event !== "declined") {
    return jsonResponse({ error: "Invalid event type." }, 400);
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail =
    Deno.env.get("SIGNUP_FROM_EMAIL") ??
    Deno.env.get("RENEWAL_FROM_EMAIL") ??
    "SupplierSync <renewals@suppliersync.org>";
  const founderEmail = Deno.env.get("FOUNDER_NOTIFY_EMAIL") ?? "addstero28@gmail.com";
  const appUrl = Deno.env.get("APP_URL") ?? "https://suppliersync.org";
  const billingUrl = `${appUrl.replace(/\/$/, "")}/app/account?section=billing`;
  const adminUrl = billingUrl;

  if (!resendKey) {
    return jsonResponse(
      {
        error:
          "RESEND_API_KEY is not configured. Reuse the key from renewal email setup or add it in Supabase secrets.",
      },
      500
    );
  }

  let subject: string;
  let html: string;
  let toEmail: string;

  if (event === "new_application") {
    const applicantRole = payload.applicantRole?.trim();
    const createdAt = payload.createdAt?.trim();
    if (!organizationName || !applicantRole || !createdAt) {
      return jsonResponse(
        {
          error:
            "organizationName, applicantRole, and createdAt are required for new_application.",
        },
        400
      );
    }

    subject = `Founding application: ${clinicName}`;
    toEmail = founderEmail;
    html = buildNewApplicationHtml({
      clinicName,
      organizationName,
      submitterEmail,
      applicantRole,
      website: payload.website?.trim() ?? "",
      note: payload.note?.trim() ?? "",
      createdAt,
      adminUrl,
    });
  } else if (event === "approved") {
    subject = "Your SupplierSync founding clinic application is approved";
    toEmail = submitterEmail;
    html = buildApprovedHtml({ clinicName, billingUrl });
  } else {
    subject = "Update on your SupplierSync founding clinic application";
    toEmail = submitterEmail;
    html = buildDeclinedHtml({ clinicName, billingUrl });
  }

  try {
    const sendResult = await sendViaResend({
      resendKey,
      fromEmail,
      toEmail,
      subject,
      html,
    });

    return jsonResponse({
      ok: true,
      event,
      resendEmailId: sendResult.id ?? null,
      notified: toEmail,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email send failed.";
    return jsonResponse({ error: message }, 502);
  }
});
