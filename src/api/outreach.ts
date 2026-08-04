import { requireSupabase } from "../lib/supabase";
import type {
  OutreachActivity,
  OutreachActivityType,
  OutreachFit,
  OutreachLead,
  OutreachPipelineSummary,
  OutreachSource,
  OutreachStage,
  OutreachWeeklyStats,
} from "../types";

export const OUTREACH_STAGES: OutreachStage[] = [
  "research",
  "contacted",
  "replied",
  "trial",
  "founding",
  "converted",
  "not_interested",
  "nurture",
];

export const OUTREACH_STAGE_LABELS: Record<OutreachStage, string> = {
  research: "Research",
  contacted: "Contacted",
  replied: "Replied",
  trial: "Trial",
  founding: "Founding",
  converted: "Converted",
  not_interested: "Not interested",
  nurture: "Nurture",
};

export const OUTREACH_WEEKLY_GOALS = {
  research: 10,
  emails: 20,
  linkedin: 10,
  followUps: 5,
};

type LeadRow = {
  id: string;
  clinic_name: string;
  contact_name: string;
  role: string;
  email: string;
  phone: string;
  linkedin_url: string;
  city: string;
  specialty: string;
  source: OutreachSource;
  fit: OutreachFit;
  tags: string[] | null;
  stage: OutreachStage;
  notes: string;
  next_action_date: string | null;
  next_action_note: string;
  created_at: string;
  updated_at: string;
};

type ActivityRow = {
  id: string;
  lead_id: string;
  activity_type: OutreachActivityType;
  summary: string;
  occurred_at: string;
  created_at: string;
};

function mapLead(row: LeadRow): OutreachLead {
  return {
    id: row.id,
    clinicName: row.clinic_name,
    contactName: row.contact_name,
    role: row.role,
    email: row.email,
    phone: row.phone,
    linkedinUrl: row.linkedin_url,
    city: row.city,
    specialty: row.specialty,
    source: row.source,
    fit: row.fit,
    tags: row.tags ?? [],
    stage: row.stage,
    notes: row.notes,
    nextActionDate: row.next_action_date,
    nextActionNote: row.next_action_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapActivity(row: ActivityRow): OutreachActivity {
  return {
    id: row.id,
    leadId: row.lead_id,
    activityType: row.activity_type,
    summary: row.summary,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function startOfWeekIso() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString();
}

export type OutreachLeadInput = {
  clinicName: string;
  contactName?: string;
  role?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  city?: string;
  specialty?: string;
  source?: OutreachSource;
  fit?: OutreachFit;
  tags?: string[];
  stage?: OutreachStage;
  notes?: string;
  nextActionDate?: string | null;
  nextActionNote?: string;
};

function leadToRow(userId: string, input: OutreachLeadInput) {
  return {
    user_id: userId,
    clinic_name: input.clinicName.trim(),
    contact_name: input.contactName?.trim() ?? "",
    role: input.role?.trim() ?? "",
    email: input.email?.trim() ?? "",
    phone: input.phone?.trim() ?? "",
    linkedin_url: input.linkedinUrl?.trim() ?? "",
    city: input.city?.trim() ?? "",
    specialty: input.specialty?.trim() ?? "",
    source: input.source ?? "other",
    fit: input.fit ?? "medium",
    tags: input.tags ?? [],
    stage: input.stage ?? "research",
    notes: input.notes?.trim() ?? "",
    next_action_date: input.nextActionDate || null,
    next_action_note: input.nextActionNote?.trim() ?? "",
  };
}

export async function fetchOutreachLeads(userId: string): Promise<OutreachLead[]> {
  const { data, error } = await requireSupabase()
    .from("outreach_leads")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data as LeadRow[]).map(mapLead);
}

export async function fetchOutreachActivities(userId: string, leadId?: string): Promise<OutreachActivity[]> {
  let query = requireSupabase()
    .from("outreach_activities")
    .select("*")
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false });

  if (leadId) {
    query = query.eq("lead_id", leadId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as ActivityRow[]).map(mapActivity);
}

export async function createOutreachLead(userId: string, input: OutreachLeadInput): Promise<OutreachLead> {
  const { data, error } = await requireSupabase()
    .from("outreach_leads")
    .insert(leadToRow(userId, input))
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapLead(data as LeadRow);
}

export async function updateOutreachLead(
  userId: string,
  leadId: string,
  input: Partial<OutreachLeadInput>
): Promise<OutreachLead> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.clinicName !== undefined) patch.clinic_name = input.clinicName.trim();
  if (input.contactName !== undefined) patch.contact_name = input.contactName.trim();
  if (input.role !== undefined) patch.role = input.role.trim();
  if (input.email !== undefined) patch.email = input.email.trim();
  if (input.phone !== undefined) patch.phone = input.phone.trim();
  if (input.linkedinUrl !== undefined) patch.linkedin_url = input.linkedinUrl.trim();
  if (input.city !== undefined) patch.city = input.city.trim();
  if (input.specialty !== undefined) patch.specialty = input.specialty.trim();
  if (input.source !== undefined) patch.source = input.source;
  if (input.fit !== undefined) patch.fit = input.fit;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (input.stage !== undefined) patch.stage = input.stage;
  if (input.notes !== undefined) patch.notes = input.notes.trim();
  if (input.nextActionDate !== undefined) patch.next_action_date = input.nextActionDate || null;
  if (input.nextActionNote !== undefined) patch.next_action_note = input.nextActionNote.trim();

  const { data, error } = await requireSupabase()
    .from("outreach_leads")
    .update(patch)
    .eq("user_id", userId)
    .eq("id", leadId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapLead(data as LeadRow);
}

export async function deleteOutreachLead(userId: string, leadId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("outreach_leads")
    .delete()
    .eq("user_id", userId)
    .eq("id", leadId);

  if (error) throw new Error(error.message);
}

export async function logOutreachActivity(
  userId: string,
  leadId: string,
  activityType: OutreachActivityType,
  summary: string,
  occurredAt?: string
): Promise<OutreachActivity> {
  const { data, error } = await requireSupabase()
    .from("outreach_activities")
    .insert({
      user_id: userId,
      lead_id: leadId,
      activity_type: activityType,
      summary: summary.trim(),
      occurred_at: occurredAt ?? new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapActivity(data as ActivityRow);
}

export function summarizePipeline(leads: OutreachLead[]): OutreachPipelineSummary {
  const summary = Object.fromEntries(OUTREACH_STAGES.map((stage) => [stage, 0])) as OutreachPipelineSummary;
  for (const lead of leads) {
    summary[lead.stage] += 1;
  }
  return summary;
}

export function getFollowUpLeads(leads: OutreachLead[], includeToday = true) {
  const today = todayIso();
  return leads
    .filter((lead) => lead.nextActionDate && (includeToday ? lead.nextActionDate <= today : lead.nextActionDate < today))
    .sort((a, b) => (a.nextActionDate ?? "").localeCompare(b.nextActionDate ?? ""));
}

export function getOverdueFollowUps(leads: OutreachLead[]) {
  const today = todayIso();
  return leads.filter((lead) => lead.nextActionDate && lead.nextActionDate < today);
}

export function getTodaysFollowUps(leads: OutreachLead[]) {
  const today = todayIso();
  return leads.filter((lead) => lead.nextActionDate === today);
}

export function computeWeeklyStats(leads: OutreachLead[], activities: OutreachActivity[]): OutreachWeeklyStats {
  const weekStart = startOfWeekIso();
  const weekActivities = activities.filter((a) => a.occurredAt >= weekStart);
  const weekLeads = leads.filter((l) => l.createdAt >= weekStart);

  return {
    researchAdded: weekLeads.length,
    emailsSent: weekActivities.filter((a) => a.activityType === "email").length,
    linkedinSent: weekActivities.filter((a) => a.activityType === "linkedin").length,
    callsAndMeetings: weekActivities.filter((a) => a.activityType === "call" || a.activityType === "meeting").length,
    totalActivities: weekActivities.length,
  };
}

export async function seedDemoOutreachLeads(userId: string): Promise<void> {
  const existing = await fetchOutreachLeads(userId);
  if (existing.length > 0) return;

  const today = new Date();
  const daysFromNow = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const daysAgo = (n: number) => daysFromNow(-n);

  const lead1 = await createOutreachLead(userId, {
    clinicName: "Northside Family Medicine",
    contactName: "Dr. Sarah Chen",
    role: "Owner / Medical Director",
    email: "schen@northsidefm.example",
    city: "Portland, OR",
    specialty: "Family Medicine",
    source: "npi",
    fit: "high",
    stage: "research",
    tags: ["solo", "8 staff"],
    notes: "Solo practice, ~8 staff. Still using spreadsheets for vendor renewals.",
    nextActionDate: daysFromNow(1),
    nextActionNote: "Find LinkedIn & draft personalized intro",
  });

  const lead2 = await createOutreachLead(userId, {
    clinicName: "Summit Pediatrics",
    contactName: "Maria Okonkwo",
    role: "Office Manager",
    email: "m.okonkwo@summitped.example",
    phone: "(503) 555-0142",
    city: "Seattle, WA",
    specialty: "Pediatrics",
    source: "referral",
    fit: "high",
    stage: "contacted",
    tags: ["referral", "15 staff"],
    notes: "Referred by Dr. Patel. Sent intro email Tuesday — waiting on reply.",
    nextActionDate: daysAgo(1),
    nextActionNote: "Follow up on intro email",
  });

  await logOutreachActivity(userId, lead2.id, "email", "Sent personalized intro — vendor renewal pain point");
  await logOutreachActivity(userId, lead1.id, "note", "Added from NPI registry — high fit solo clinic");
}

export { todayIso };
