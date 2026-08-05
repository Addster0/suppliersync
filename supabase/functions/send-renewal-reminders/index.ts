import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildDigestReportData,
  buildDigestReportHtml,
  digestPeriodForType,
  shouldRunScheduledDigest,
  type DigestPeriodType,
} from "./digestReport.ts";

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

type ContractRenewalType = "fixed_term" | "auto_renew" | "month_to_month" | "evergreen";

type ContractRow = {
  id: string;
  title: string;
  end_date: string | null;
  renewal_date: string | null;
  renewal_type: ContractRenewalType;
  notice_period_days: number | null;
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

function subtractDaysFromIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() - days);
  return formatDateForQuery(date);
}

function getContractActionDate(row: Pick<
  ContractRow,
  "renewal_type" | "end_date" | "renewal_date" | "notice_period_days"
>): string | null {
  if (row.renewal_date) return row.renewal_date;
  if (row.renewal_type === "auto_renew" && row.end_date && row.notice_period_days) {
    return subtractDaysFromIsoDate(row.end_date, row.notice_period_days);
  }
  return row.end_date;
}

function contractMatchesActionDate(row: ContractRow, targetDate: string): boolean {
  return getContractActionDate(row) === targetDate;
}

const CONTRACT_SELECT =
  "id, title, end_date, renewal_date, renewal_type, notice_period_days, value, vendor_id, vendors ( name )";

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

function resolveNotificationEmail(
  renewalNotificationEmail: string | null | undefined,
  authEmail: string | null | undefined
) {
  const override = renewalNotificationEmail?.trim();
  if (override) return override;
  return authEmail?.trim() ?? "";
}

async function getProfileNotificationEmail(
  admin: ReturnType<typeof createClient>,
  userId: string
) {
  const { data, error } = await admin
    .from("profiles")
    .select("renewal_notification_email")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.renewal_notification_email ?? null;
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

  const userIds = (data ?? []).map((row) => row.user_id);
  if (userIds.length === 0) return [] as string[];

  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id, renewal_notification_email")
    .in("id", userIds);

  if (profileError) throw new Error(profileError.message);

  const profileMap = new Map(
    (profiles ?? []).map((row) => [row.id, row.renewal_notification_email as string | null])
  );

  const emails: string[] = [];

  for (const userId of userIds) {
    const override = profileMap.get(userId);
    if (override?.trim()) {
      emails.push(override.trim());
      continue;
    }

    const { data: authData, error: authError } = await admin.auth.admin.getUserById(userId);
    const authEmail = !authError ? authData.user?.email : null;
    const resolved = resolveNotificationEmail(null, authEmail);
    if (resolved) emails.push(resolved);
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

  const startIso = formatDateForQuery(rangeStart);
  const endIso = formatDateForQuery(rangeEnd);

  const { data, error } = await admin
    .from("contracts")
    .select(CONTRACT_SELECT)
    .eq("organization_id", organizationId)
    .is("renewal_handled_at", null)
    .or(
      `and(end_date.gte.${startIso},end_date.lte.${endIso}),and(renewal_date.gte.${startIso},renewal_date.lte.${endIso})`
    )
    .order("end_date", { ascending: true, nullsFirst: false });

  if (error) throw new Error(error.message);

  return (data ?? []).filter((row) => {
    const actionDate = getContractActionDate(row as ContractRow);
    return actionDate && actionDate >= startIso && actionDate <= endIso;
  }) as ContractRow[];
}

async function fetchContractsForWindow(
  admin: ReturnType<typeof createClient>,
  organizationId: string,
  endDate: string,
  window: ReminderWindow
) {
  const { data, error } = await admin
    .from("contracts")
    .select(CONTRACT_SELECT)
    .eq("organization_id", organizationId)
    .is("renewal_handled_at", null)
    .or(`end_date.eq.${endDate},renewal_date.eq.${endDate}`);

  if (error) throw new Error(error.message);

  const contracts = ((data ?? []) as ContractRow[]).filter((row) =>
    contractMatchesActionDate(row, endDate)
  );
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
        endDate: getContractActionDate(row)!,
        value: Number(row.value),
        window,
        windowLabel: windowMeta.label,
        daysUntilEnd: daysUntilEnd(getContractActionDate(row)!),
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
    const fromEmail = Deno.env.get("RENEWAL_FROM_EMAIL") ?? "SupplierSync <renewals@suppliersync.org>";
    const appUrl = Deno.env.get("APP_URL") ?? "https://suppliersync.org";
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

      const profileOverride = await getProfileNotificationEmail(admin, user.id);
      const recipientEmail = resolveNotificationEmail(profileOverride, user.email);
      if (!recipientEmail) {
        return jsonResponse({ error: "Could not find your email address." }, 400);
      }

      const contracts = await fetchContractsForTest(admin, organizationId);
      const lines: ReminderLine[] = contracts.flatMap((row) => {
        const vendorName = vendorNameFromRow(row.vendors);
        if (!vendorName) return [];

        const actionDate = getContractActionDate(row);
        if (!actionDate) return [];

        const days = daysUntilEnd(actionDate);
        const window: ReminderWindow =
          days === 0 ? "due_today" : days === 7 ? "7_days" : days === 30 ? "30_days" : "90_days";

        return [
          {
            contractId: row.id,
            contractName: row.title,
            vendorName,
            vendorId: row.vendor_id,
            endDate: actionDate,
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

    async function fetchDigestReportForOrg(
      admin: ReturnType<typeof createClient>,
      organizationId: string,
      orgName: string,
      periodType: DigestPeriodType
    ) {
      const { data: vendors, error: vendorsError } = await admin
        .from("vendors")
        .select("id, name, category")
        .eq("organization_id", organizationId);

      if (vendorsError) throw new Error(vendorsError.message);

      const vendorIds = (vendors ?? []).map((row) => row.id);

      const { data: spendRows, error: spendError } =
        vendorIds.length > 0
          ? await admin
              .from("vendor_spend_snapshots")
              .select("entry_date, amount, entry_type, vendor_id")
              .eq("organization_id", organizationId)
              .in("vendor_id", vendorIds)
          : { data: [], error: null };

      if (spendError) throw new Error(spendError.message);

      const { data: evaluationRows, error: evaluationError } =
        vendorIds.length > 0
          ? await admin
              .from("vendor_evaluations")
              .select("vendor_id, eval_date, score, criteria")
              .eq("organization_id", organizationId)
              .in("vendor_id", vendorIds)
          : { data: [], error: null };

      if (evaluationError) throw new Error(evaluationError.message);

      return buildDigestReportData({
        orgName,
        periodType,
        vendors: vendors ?? [],
        spendEntries: spendRows ?? [],
        evaluations: evaluationRows ?? [],
      });
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

    async function sendDigestTest(
      admin: ReturnType<typeof createClient>,
      req: Request,
      organizationId: string | undefined,
      periodType: DigestPeriodType
    ) {
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

      const profileOverride = await getProfileNotificationEmail(admin, user.id);
      const recipientEmail = resolveNotificationEmail(profileOverride, user.email);
      if (!recipientEmail) {
        return jsonResponse({ error: "Could not find your email address." }, 400);
      }

      const reportData = await fetchDigestReportForOrg(admin, organizationId!, org.name, periodType);
      const html = buildDigestReportHtml({
        data: reportData,
        appUrl,
        isTest: true,
      });

      const label = periodType === "monthly" ? "monthly report" : "annual report";
      const sendResult = await sendEmail({
        resendKey,
        fromEmail,
        to: [recipientEmail],
        subject: `[Test] SupplierSync ${label} — ${org.name}`,
        html,
        replyTo: recipientEmail,
      });

      return jsonResponse({
        sent: true,
        recipient: recipientEmail,
        periodType,
        periodLabel: reportData.periodLabel,
        vendorCount: reportData.vendorCount,
        usingSandboxSender: isSandboxSender(fromEmail),
        appUrl,
        resendEmailId: sendResult.id,
        deliveryNote: emailDeliveryNote(fromEmail),
      });
    }

    if (mode === "test_monthly_digest") {
      return await sendDigestTest(admin, req, body.organizationId as string | undefined, "monthly");
    }

    if (mode === "test_annual_digest") {
      return await sendDigestTest(admin, req, body.organizationId as string | undefined, "annual");
    }

    async function runDigestCron(periodType: DigestPeriodType) {
      const providedSecret = req.headers.get("x-cron-secret");
      if (!cronSecret || providedSecret !== cronSecret) {
        return jsonResponse({ error: "Invalid cron secret." }, 401);
      }

      if (!shouldRunScheduledDigest(periodType)) {
        return jsonResponse({
          sent: false,
          skipped: true,
          reason: `Not scheduled for ${periodType} digest today.`,
        });
      }

      const enabledColumn =
        periodType === "monthly" ? "monthly_digest_enabled" : "annual_digest_enabled";

      const { data: orgs, error: orgsError } = await admin
        .from("organizations")
        .select("id, name")
        .eq(enabledColumn, true);

      if (orgsError) {
        return jsonResponse({ error: orgsError.message }, 500);
      }

      const digestPeriod = digestPeriodForType(periodType).digestPeriod;
      let emailsSent = 0;

      for (const org of orgs ?? []) {
        const { data: existingLog, error: logLookupError } = await admin
          .from("workspace_digest_log")
          .select("id")
          .eq("organization_id", org.id)
          .eq("digest_type", periodType)
          .eq("digest_period", digestPeriod)
          .maybeSingle();

        if (logLookupError) throw new Error(logLookupError.message);
        if (existingLog) continue;

        const reportData = await fetchDigestReportForOrg(admin, org.id, org.name, periodType);
        if (!reportData.hasData) continue;

        const recipients = await getAdminEmails(admin, org.id);
        if (recipients.length === 0) continue;

        const html = buildDigestReportHtml({
          data: reportData,
          appUrl,
          isTest: false,
        });

        const label = periodType === "monthly" ? "monthly report" : "annual report";
        await sendEmail({
          resendKey,
          fromEmail,
          to: recipients,
          subject: `SupplierSync ${label} — ${org.name}`,
          html,
          replyTo: recipients[0],
        });

        const { error: logError } = await admin.from("workspace_digest_log").insert({
          organization_id: org.id,
          digest_type: periodType,
          digest_period: digestPeriod,
        });
        if (logError) {
          console.error(`Failed to log ${periodType} digest`, org.id, logError.message);
        }

        emailsSent += 1;
      }

      return jsonResponse({
        sent: true,
        organizationsEmailed: emailsSent,
        digestType: periodType,
        digestPeriod,
      });
    }

    if (mode === "monthly_cron") {
      return await runDigestCron("monthly");
    }

    if (mode === "annual_cron") {
      return await runDigestCron("annual");
    }

    return jsonResponse(
      {
        error:
          "Unknown mode. Use test, cron, test_monthly_digest, test_annual_digest, monthly_cron, or annual_cron.",
      },
      400
    );
  } catch (error) {
    console.error(error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      500
    );
  }
});
