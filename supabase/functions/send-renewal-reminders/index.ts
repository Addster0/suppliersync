import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type ReminderWindow = "90_days" | "30_days" | "7_days" | "due_today";

const REMINDER_WINDOWS: { key: ReminderWindow; offsetDays: number; label: string }[] = [
  { key: "90_days", offsetDays: 90, label: "90 days out" },
  { key: "30_days", offsetDays: 30, label: "30 days out" },
  { key: "7_days", offsetDays: 7, label: "7 days out" },
  { key: "due_today", offsetDays: 0, label: "due today" },
];

type ContractRow = {
  id: string;
  title: string;
  end_date: string;
  value: number;
  vendor_id: string;
  vendors: { name: string } | { name: string }[] | null;
};

type ReminderLine = {
  contractId: string;
  contractName: string;
  vendorName: string;
  vendorId: string;
  endDate: string;
  value: number;
  window: ReminderWindow;
  windowLabel: string;
  daysUntilEnd: number;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function formatDate(isoDate: string) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatDateForQuery(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysUntilEnd(endDate: string) {
  const end = new Date(`${endDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function vendorNameFromRow(vendors: ContractRow["vendors"]) {
  if (!vendors) return null;
  return Array.isArray(vendors) ? vendors[0]?.name : vendors.name;
}

function buildRenewalsUrl(appUrl: string, vendorId: string) {
  return `${appUrl.replace(/\/$/, "")}/app?vendor=${vendorId}&tab=contracts`;
}

function buildEmailHtml(params: {
  orgName: string;
  lines: ReminderLine[];
  appUrl: string;
  isTest: boolean;
}) {
  const { orgName, lines, appUrl, isTest } = params;
  const renewalsUrl = `${appUrl.replace(/\/$/, "")}/app/renewals`;
  const testBanner = isTest
    ? `<p style="margin:0 0 16px;padding:12px 14px;background:#fef3c7;border-radius:8px;color:#92400e;font-size:14px;">
        This is a test email — automated reminders use the same format.
      </p>`
    : "";

  const rows = lines
    .map((line) => {
      const daysLabel =
        line.daysUntilEnd < 0
          ? `Expired ${Math.abs(line.daysUntilEnd)} day${Math.abs(line.daysUntilEnd) === 1 ? "" : "s"} ago`
          : line.daysUntilEnd === 0
            ? "Ends today"
            : `Ends in ${line.daysUntilEnd} days`;

      return `<tr>
        <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
          <strong style="color:#172033;">${escapeHtml(line.vendorName)}</strong><br>
          <span style="color:#475569;font-size:14px;">${escapeHtml(line.contractName)}</span><br>
          <span style="color:#64748b;font-size:13px;">${formatDate(line.endDate)} · ${daysLabel} · ${formatCurrency(line.value)}</span><br>
          <a href="${buildRenewalsUrl(appUrl, line.vendorId)}" style="color:#1d4ed8;font-size:13px;">View contract</a>
        </td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#eef2f7;font-family:Inter,Segoe UI,sans-serif;">
  <div style="max-width:560px;margin:24px auto;padding:24px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#1d4ed8;">SupplierSync</p>
    <h1 style="margin:0 0 12px;font-size:22px;color:#172033;">Contract renewals for ${escapeHtml(orgName)}</h1>
    ${testBanner}
    <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.5;">
      ${lines.length} contract${lines.length === 1 ? "" : "s"} need attention. Review deadlines before notice periods or auto-renewals pass.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    <p style="margin:24px 0 0;">
      <a href="${renewalsUrl}" style="display:inline-block;padding:12px 18px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:700;font-size:14px;">
        Open renewals dashboard
      </a>
    </p>
    <p style="margin:20px 0 0;color:#94a3b8;font-size:12px;line-height:1.5;">
      Workspace owners and admins receive these reminders at 90, 30, and 7 days before end date, and on the due date.
    </p>
  </div>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function sendEmail(params: {
  resendKey: string;
  fromEmail: string;
  to: string[];
  subject: string;
  html: string;
  replyTo?: string;
}) {
  const payload: Record<string, unknown> = {
    from: params.fromEmail,
    to: params.to,
    subject: params.subject,
    html: params.html,
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
        `Resend test mode only delivers to the email on your Resend account, not ${params.to.join(", ")}. ` +
          "Sign into resend.com with that inbox, or verify your own domain and set RENEWAL_FROM_EMAIL."
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

function isSandboxSender(fromEmail: string) {
  return fromEmail.includes("resend.dev");
}

function isLocalAppUrl(appUrl: string) {
  try {
    const hostname = new URL(appUrl).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return true;
  }
}

function emailDeliveryNote(fromEmail: string) {
  if (isSandboxSender(fromEmail)) {
    return "Resend sandbox sender: mail only delivers to the email on your Resend account. Verify a domain and set RENEWAL_FROM_EMAIL to send to any clinic inbox.";
  }
  return "Production sender configured — reminders can deliver to workspace owners and admins.";
}

async function getAdminEmails(
  admin: ReturnType<typeof createClient>,
  organizationId: string
) {
  const { data, error } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .in("role", ["owner", "admin"]);

  if (error) throw new Error(error.message);

  const emails: string[] = [];

  for (const row of data ?? []) {
    const { data: authData, error: authError } = await admin.auth.admin.getUserById(row.user_id);
    if (!authError && authData.user?.email) {
      emails.push(authData.user.email);
    }
  }

  return [...new Set(emails)];
}

async function fetchContractsForTest(admin: ReturnType<typeof createClient>, organizationId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rangeStart = new Date(today);
  rangeStart.setDate(rangeStart.getDate() - 30);

  const rangeEnd = new Date(today);
  rangeEnd.setDate(rangeEnd.getDate() + 90);

  const { data, error } = await admin
    .from("contracts")
    .select("id, title, end_date, value, vendor_id, vendors ( name )")
    .eq("organization_id", organizationId)
    .gte("end_date", formatDateForQuery(rangeStart))
    .lte("end_date", formatDateForQuery(rangeEnd))
    .order("end_date", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as ContractRow[];
}

async function fetchContractsForWindow(
  admin: ReturnType<typeof createClient>,
  organizationId: string,
  endDate: string,
  window: ReminderWindow
) {
  const { data, error } = await admin
    .from("contracts")
    .select("id, title, end_date, value, vendor_id, vendors ( name )")
    .eq("organization_id", organizationId)
    .eq("end_date", endDate);

  if (error) throw new Error(error.message);

  const contracts = (data ?? []) as ContractRow[];
  if (contracts.length === 0) return [] as ReminderLine[];

  const contractIds = contracts.map((row) => row.id);
  const { data: logs, error: logError } = await admin
    .from("renewal_reminder_log")
    .select("contract_id")
    .eq("organization_id", organizationId)
    .eq("reminder_window", window)
    .in("contract_id", contractIds);

  if (logError) throw new Error(logError.message);

  const sentIds = new Set((logs ?? []).map((row) => row.contract_id));
  const windowMeta = REMINDER_WINDOWS.find((item) => item.key === window)!;

  return contracts.flatMap((row) => {
    if (sentIds.has(row.id)) return [];
    const vendorName = vendorNameFromRow(row.vendors);
    if (!vendorName) return [];

    return [
      {
        contractId: row.id,
        contractName: row.title,
        vendorName,
        vendorId: row.vendor_id,
        endDate: row.end_date,
        value: Number(row.value),
        window,
        windowLabel: windowMeta.label,
        daysUntilEnd: daysUntilEnd(row.end_date),
      },
    ];
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("RENEWAL_FROM_EMAIL") ?? "SupplierSync <onboarding@resend.dev>";
    const appUrl = Deno.env.get("APP_URL") ?? "http://localhost:5173";
    const cronSecret = Deno.env.get("CRON_SECRET");

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "Missing Supabase environment variables." }, 500);
    }

    if (!resendKey) {
      return jsonResponse(
        {
          error:
            "RESEND_API_KEY is not configured on the edge function. Add it in Supabase → Edge Functions → Secrets.",
        },
        503
      );
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    const mode = typeof body.mode === "string" ? body.mode : "cron";

    if (mode === "status") {
      return jsonResponse({
        configured: Boolean(resendKey),
        usingSandboxSender: isSandboxSender(fromEmail),
        appUrl,
        appUrlIsLocal: isLocalAppUrl(appUrl),
        fromEmail,
        deliveryNote: emailDeliveryNote(fromEmail),
      });
    }

    if (mode === "test") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Unauthorized." }, 401);
      }

      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
        global: { headers: { Authorization: authHeader } },
      });

      const {
        data: { user },
        error: userError,
      } = await userClient.auth.getUser();

      if (userError || !user) {
        return jsonResponse({ error: "Unauthorized." }, 401);
      }

      const organizationId = body.organizationId as string | undefined;
      if (!organizationId) {
        return jsonResponse({ error: "organizationId is required." }, 400);
      }

      const { data: membership, error: membershipError } = await admin
        .from("organization_members")
        .select("role")
        .eq("organization_id", organizationId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (membershipError) {
        return jsonResponse({ error: membershipError.message }, 500);
      }

      if (!membership || !["owner", "admin"].includes(membership.role)) {
        return jsonResponse({ error: "Only workspace owners and admins can send test emails." }, 403);
      }

      const { data: org, error: orgError } = await admin
        .from("organizations")
        .select("name")
        .eq("id", organizationId)
        .maybeSingle();

      if (orgError || !org) {
        return jsonResponse({ error: orgError?.message ?? "Organization not found." }, 404);
      }

      const recipientEmail = user.email?.trim();
      if (!recipientEmail) {
        return jsonResponse({ error: "Could not find your email address." }, 400);
      }

      const contracts = await fetchContractsForTest(admin, organizationId);
      const lines: ReminderLine[] = contracts.flatMap((row) => {
        const vendorName = vendorNameFromRow(row.vendors);
        if (!vendorName) return [];

        const days = daysUntilEnd(row.end_date);
        const window: ReminderWindow =
          days === 0 ? "due_today" : days === 7 ? "7_days" : days === 30 ? "30_days" : "90_days";

        return [
          {
            contractId: row.id,
            contractName: row.title,
            vendorName,
            vendorId: row.vendor_id,
            endDate: row.end_date,
            value: Number(row.value),
            window,
            windowLabel: "preview",
            daysUntilEnd: days,
          },
        ];
      });

      const html = buildEmailHtml({
        orgName: org.name,
        lines,
        appUrl,
        isTest: true,
      });

      const sendResult = await sendEmail({
        resendKey,
        fromEmail,
        to: [recipientEmail],
        subject: `[Test] SupplierSync renewals — ${org.name}`,
        html,
        replyTo: recipientEmail,
      });

      return jsonResponse({
        sent: true,
        recipient: recipientEmail,
        contractCount: lines.length,
        usingSandboxSender: isSandboxSender(fromEmail),
        appUrl,
        resendEmailId: sendResult.id,
        deliveryNote: emailDeliveryNote(fromEmail),
      });
    }

    if (mode === "cron") {
      const providedSecret = req.headers.get("x-cron-secret");
      if (!cronSecret || providedSecret !== cronSecret) {
        return jsonResponse({ error: "Invalid cron secret." }, 401);
      }

      const { data: orgs, error: orgsError } = await admin
        .from("organizations")
        .select("id, name")
        .eq("renewal_reminders_enabled", true);

      if (orgsError) {
        return jsonResponse({ error: orgsError.message }, 500);
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let emailsSent = 0;
      let contractsNotified = 0;

      for (const org of orgs ?? []) {
        const lines: ReminderLine[] = [];

        for (const window of REMINDER_WINDOWS) {
          const target = new Date(today);
          target.setDate(target.getDate() + window.offsetDays);
          const targetDate = formatDateForQuery(target);
          const matches = await fetchContractsForWindow(admin, org.id, targetDate, window.key);
          lines.push(...matches);
        }

        if (lines.length === 0) continue;

        const recipients = await getAdminEmails(admin, org.id);
        if (recipients.length === 0) continue;

        const html = buildEmailHtml({
          orgName: org.name,
          lines,
          appUrl,
          isTest: false,
        });

        await sendEmail({
          resendKey,
          fromEmail,
          to: recipients,
          subject: `SupplierSync renewals — ${org.name}`,
          html,
          replyTo: recipients[0],
        });

        const logRows = lines.map((line) => ({
          organization_id: org.id,
          contract_id: line.contractId,
          reminder_window: line.window,
        }));

        const { error: logError } = await admin.from("renewal_reminder_log").insert(logRows);
        if (logError) {
          console.error("Failed to log reminders", org.id, logError.message);
        }

        emailsSent += 1;
        contractsNotified += lines.length;
      }

      return jsonResponse({
        sent: true,
        organizationsEmailed: emailsSent,
        contractsNotified,
      });
    }

    type DigestSeverity = "critical" | "warning" | "info";

    type DigestItem = {
      severity: DigestSeverity;
      title: string;
      detail: string;
    };

    const COMPLIANCE_LABELS: Record<string, string> = {
      coi: "Certificate of insurance (COI)",
      w9: "W-9 / tax form",
      license: "Business license",
      general: "General document",
    };

    function digestWeekMonday(date: Date) {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      const day = d.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      d.setDate(d.getDate() + diff);
      return formatDateForQuery(d);
    }

    function renewalUrgency(days: number): "overdue" | "soon" | "upcoming" | null {
      if (days < 0) return "overdue";
      if (days <= 30) return "soon";
      if (days <= 90) return "upcoming";
      return null;
    }

    async function fetchDigestItems(
      admin: ReturnType<typeof createClient>,
      organizationId: string
    ): Promise<DigestItem[]> {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const rangeStart = new Date(today);
      rangeStart.setDate(rangeStart.getDate() - 30);
      const rangeEnd = new Date(today);
      rangeEnd.setDate(rangeEnd.getDate() + 90);

      const { data: contracts, error: contractsError } = await admin
        .from("contracts")
        .select("id, title, end_date, vendor_id, vendors ( name )")
        .eq("organization_id", organizationId)
        .gte("end_date", formatDateForQuery(rangeStart))
        .lte("end_date", formatDateForQuery(rangeEnd));

      if (contractsError) throw new Error(contractsError.message);

      const items: DigestItem[] = [];
      const listedContractIds = new Set<string>();

      for (const row of contracts ?? []) {
        const vendorName = vendorNameFromRow(row.vendors as ContractRow["vendors"]);
        if (!vendorName) continue;
        const days = daysUntilEnd(row.end_date);
        const urgency = renewalUrgency(days);
        if (urgency === "overdue" || urgency === "soon") {
          listedContractIds.add(row.id);
          items.push({
            severity: urgency === "overdue" ? "critical" : "warning",
            title: urgency === "overdue" ? "Contract overdue" : "Renewal due soon",
            detail: `${row.title} · ${vendorName} · ${row.end_date}`,
          });
        }
      }

      const { data: vendors, error: vendorsError } = await admin
        .from("vendors")
        .select(
          `
          id,
          name,
          status,
          contacts ( id ),
          documents ( id, doc_type, expires_at ),
          contracts ( id, title, end_date )
        `
        )
        .eq("organization_id", organizationId);

      if (vendorsError) throw new Error(vendorsError.message);

      for (const vendor of vendors ?? []) {
        if (vendor.status === "active" && (vendor.contacts ?? []).length === 0) {
          items.push({
            severity: "warning",
            title: "No contact on file",
            detail: `${vendor.name} — add a phone or email before you need them.`,
          });
        }

        if (vendor.status !== "active") continue;

        const docTypes = new Set(
          (vendor.documents ?? []).map((doc: { doc_type: string }) => doc.doc_type)
        );
        for (const docType of ["coi", "w9"]) {
          if (!docTypes.has(docType)) {
            items.push({
              severity: "info",
              title: `Missing ${COMPLIANCE_LABELS[docType] ?? docType}`,
              detail: `${vendor.name} — upload to Documents for compliance tracking.`,
            });
          }
        }

        for (const doc of vendor.documents ?? []) {
          if (!doc.expires_at || doc.doc_type === "general") continue;
          const expiry = new Date(`${doc.expires_at}T00:00:00`);
          if (expiry < today) {
            items.push({
              severity: "critical",
              title: "Compliance document expired",
              detail: `${vendor.name} · ${COMPLIANCE_LABELS[doc.doc_type] ?? doc.doc_type} expired ${doc.expires_at}`,
            });
          }
        }

        for (const contract of vendor.contracts ?? []) {
          if (!contract.end_date || listedContractIds.has(contract.id)) continue;
          const days = daysUntilEnd(contract.end_date);
          const urgency = renewalUrgency(days);
          if (urgency === "upcoming" && days <= 60) {
            items.push({
              severity: "info",
              title: "Upcoming contract end",
              detail: `${contract.title} · ${vendor.name} · ends ${contract.end_date}`,
            });
          }
        }
      }

      const severityOrder: Record<DigestSeverity, number> = {
        critical: 0,
        warning: 1,
        info: 2,
      };

      return items.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
    }

    function buildDigestEmailHtml(params: {
      orgName: string;
      items: DigestItem[];
      appUrl: string;
      isTest: boolean;
    }) {
      const { orgName, items, appUrl, isTest } = params;
      const renewalsUrl = `${appUrl.replace(/\/$/, "")}/app/renewals#needs-attention`;
      const testBanner = isTest
        ? `<p style="margin:0 0 16px;padding:12px 14px;background:#fef3c7;border-radius:8px;color:#92400e;font-size:14px;">
            This is a test email — your weekly digest uses the same format.
          </p>`
        : "";

      const rows = items
        .slice(0, 20)
        .map((item) => {
          const color =
            item.severity === "critical" ? "#b91c1c" : item.severity === "warning" ? "#b45309" : "#1d4ed8";
          return `<tr>
            <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
              <span style="display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;color:${color};">${escapeHtml(item.severity)}</span><br>
              <strong style="color:#172033;">${escapeHtml(item.title)}</strong><br>
              <span style="color:#64748b;font-size:14px;">${escapeHtml(item.detail)}</span>
            </td>
          </tr>`;
        })
        .join("");

      const overflow =
        items.length > 20
          ? `<p style="margin:12px 0 0;color:#64748b;font-size:14px;">…and ${items.length - 20} more items in the app.</p>`
          : "";

      return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#eef2f7;font-family:Inter,Segoe UI,sans-serif;">
  <div style="max-width:560px;margin:24px auto;padding:24px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#1d4ed8;">SupplierSync</p>
    <h1 style="margin:0 0 12px;font-size:22px;color:#172033;">Weekly action items — ${escapeHtml(orgName)}</h1>
    ${testBanner}
    <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.5;">
      ${items.length} item${items.length === 1 ? "" : "s"} need attention this week — renewals, compliance gaps, and missing contacts.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    ${overflow}
    <p style="margin:24px 0 0;">
      <a href="${renewalsUrl}" style="display:inline-block;padding:12px 18px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:700;font-size:14px;">
        Open action items
      </a>
    </p>
    <p style="margin:20px 0 0;color:#94a3b8;font-size:12px;line-height:1.5;">
      Sent every Monday to workspace owners and admins when weekly digest is enabled.
    </p>
  </div>
</body>
</html>`;
    }

    async function authorizeOrgAdmin(
      admin: ReturnType<typeof createClient>,
      req: Request,
      organizationId: string | undefined
    ) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return { error: jsonResponse({ error: "Unauthorized." }, 401) };
      }

      const userClient = createClient(supabaseUrl!, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
        global: { headers: { Authorization: authHeader } },
      });

      const {
        data: { user },
        error: userError,
      } = await userClient.auth.getUser();

      if (userError || !user) {
        return { error: jsonResponse({ error: "Unauthorized." }, 401) };
      }

      if (!organizationId) {
        return { error: jsonResponse({ error: "organizationId is required." }, 400) };
      }

      const { data: membership, error: membershipError } = await admin
        .from("organization_members")
        .select("role")
        .eq("organization_id", organizationId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (membershipError) {
        return { error: jsonResponse({ error: membershipError.message }, 500) };
      }

      if (!membership || !["owner", "admin"].includes(membership.role)) {
        return {
          error: jsonResponse(
            { error: "Only workspace owners and admins can send test emails." },
            403
          ),
        };
      }

      return { user };
    }

    if (mode === "test_weekly_digest") {
      const organizationId = body.organizationId as string | undefined;
      const auth = await authorizeOrgAdmin(admin, req, organizationId);
      if (auth.error) return auth.error;
      const user = auth.user!;

      const { data: org, error: orgError } = await admin
        .from("organizations")
        .select("name")
        .eq("id", organizationId!)
        .maybeSingle();

      if (orgError || !org) {
        return jsonResponse({ error: orgError?.message ?? "Organization not found." }, 404);
      }

      const recipientEmail = user.email?.trim();
      if (!recipientEmail) {
        return jsonResponse({ error: "Could not find your email address." }, 400);
      }

      const items = await fetchDigestItems(admin, organizationId!);
      const html = buildDigestEmailHtml({
        orgName: org.name,
        items,
        appUrl,
        isTest: true,
      });

      const sendResult = await sendEmail({
        resendKey,
        fromEmail,
        to: [recipientEmail],
        subject: `[Test] SupplierSync weekly digest — ${org.name}`,
        html,
        replyTo: recipientEmail,
      });

      return jsonResponse({
        sent: true,
        recipient: recipientEmail,
        itemCount: items.length,
        usingSandboxSender: isSandboxSender(fromEmail),
        appUrl,
        resendEmailId: sendResult.id,
        deliveryNote: emailDeliveryNote(fromEmail),
      });
    }

    if (mode === "weekly_cron") {
      const providedSecret = req.headers.get("x-cron-secret");
      if (!cronSecret || providedSecret !== cronSecret) {
        return jsonResponse({ error: "Invalid cron secret." }, 401);
      }

      const digestWeek = digestWeekMonday(new Date());
      const { data: orgs, error: orgsError } = await admin
        .from("organizations")
        .select("id, name")
        .eq("weekly_digest_enabled", true);

      if (orgsError) {
        return jsonResponse({ error: orgsError.message }, 500);
      }

      let emailsSent = 0;
      let itemsNotified = 0;

      for (const org of orgs ?? []) {
        const { data: existingLog, error: logLookupError } = await admin
          .from("workspace_digest_log")
          .select("id")
          .eq("organization_id", org.id)
          .eq("digest_week", digestWeek)
          .maybeSingle();

        if (logLookupError) throw new Error(logLookupError.message);
        if (existingLog) continue;

        const items = await fetchDigestItems(admin, org.id);
        if (items.length === 0) continue;

        const recipients = await getAdminEmails(admin, org.id);
        if (recipients.length === 0) continue;

        const html = buildDigestEmailHtml({
          orgName: org.name,
          items,
          appUrl,
          isTest: false,
        });

        await sendEmail({
          resendKey,
          fromEmail,
          to: recipients,
          subject: `SupplierSync weekly digest — ${org.name}`,
          html,
          replyTo: recipients[0],
        });

        const { error: logError } = await admin.from("workspace_digest_log").insert({
          organization_id: org.id,
          digest_week: digestWeek,
        });
        if (logError) {
          console.error("Failed to log weekly digest", org.id, logError.message);
        }

        emailsSent += 1;
        itemsNotified += items.length;
      }

      return jsonResponse({
        sent: true,
        organizationsEmailed: emailsSent,
        itemsNotified,
        digestWeek,
      });
    }

    return jsonResponse({ error: "Unknown mode. Use test, cron, test_weekly_digest, or weekly_cron." }, 400);
  } catch (error) {
    console.error(error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      500
    );
  }
});
