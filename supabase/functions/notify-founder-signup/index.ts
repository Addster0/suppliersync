import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-signup-webhook-secret",
};

type SignupPayload = {
  userId?: string;
  email?: string;
  fullName?: string;
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

function buildEmailHtml(params: {
  email: string;
  fullName: string;
  createdAt: string;
  adminUrl: string;
}) {
  const nameLine = params.fullName
    ? `<p style="margin:0 0 8px;"><strong>Name:</strong> ${escapeHtml(params.fullName)}</p>`
    : "";

  return `<!DOCTYPE html>
<html>
<body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#111827;max-width:560px;">
  <h2 style="margin:0 0 16px;">New SupplierSync signup</h2>
  <p style="margin:0 0 16px;">Someone just created an account.</p>
  ${nameLine}
  <p style="margin:0 0 8px;"><strong>Email:</strong> ${escapeHtml(params.email)}</p>
  <p style="margin:0 0 16px;"><strong>Signed up:</strong> ${escapeHtml(formatTimestamp(params.createdAt))}</p>
  <p style="margin:0;">
    <a href="${escapeHtml(params.adminUrl)}" style="color:#2563eb;">View all signups</a>
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

  const webhookSecret = Deno.env.get("SIGNUP_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return jsonResponse(
      {
        error:
          "SIGNUP_WEBHOOK_SECRET is not configured on the edge function. Run scripts/setup-signup-notify.sh.",
      },
      500
    );
  }

  const providedSecret = req.headers.get("x-signup-webhook-secret");
  if (providedSecret !== webhookSecret) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  let payload: SignupPayload;
  try {
    payload = (await req.json()) as SignupPayload;
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const email = payload.email?.trim();
  const createdAt = payload.createdAt?.trim();
  if (!email || !createdAt) {
    return jsonResponse({ error: "email and createdAt are required." }, 400);
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail =
    Deno.env.get("SIGNUP_FROM_EMAIL") ??
    Deno.env.get("RENEWAL_FROM_EMAIL") ??
    "SupplierSync <onboarding@resend.dev>";
  const founderEmail = Deno.env.get("FOUNDER_NOTIFY_EMAIL") ?? "addstero28@gmail.com";
  const appUrl = Deno.env.get("APP_URL") ?? "https://suppliersync.org";
  const adminUrl = `${appUrl.replace(/\/$/, "")}/app/admin/signups`;

  if (!resendKey) {
    return jsonResponse(
      {
        error:
          "RESEND_API_KEY is not configured. Reuse the key from renewal email setup or add it in Supabase secrets.",
      },
      500
    );
  }

  const fullName = payload.fullName?.trim() ?? "";
  const subject = fullName
    ? `New signup: ${fullName} (${email})`
    : `New signup: ${email}`;

  try {
    const sendResult = await sendViaResend({
      resendKey,
      fromEmail,
      toEmail: founderEmail,
      subject,
      html: buildEmailHtml({ email, fullName, createdAt, adminUrl }),
    });

    return jsonResponse({
      ok: true,
      resendEmailId: sendResult.id ?? null,
      notified: founderEmail,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email send failed.";
    return jsonResponse({ error: message }, 502);
  }
});
