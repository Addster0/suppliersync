import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  computeWeeklyStats,
  createOutreachLead,
  deleteOutreachLead,
  fetchOutreachActivities,
  fetchOutreachLeads,
  getOverdueFollowUps,
  getTodaysFollowUps,
  logOutreachActivity,
  OUTREACH_STAGE_LABELS,
  OUTREACH_STAGES,
  OUTREACH_WEEKLY_GOALS,
  seedDemoOutreachLeads,
  summarizePipeline,
  todayIso,
  updateOutreachLead,
  type OutreachLeadInput,
} from "../api/outreach";
import { useAuth } from "../contexts/AuthContext";
import { prettyDate } from "../lib/utils";
import type {
  OutreachActivity,
  OutreachActivityType,
  OutreachFit,
  OutreachLead,
  OutreachSource,
  OutreachStage,
} from "../types";

type CrmView = "dashboard" | "pipeline" | "playbook";

const ACTIVITY_LABELS: Record<OutreachActivityType, string> = {
  email: "Email",
  linkedin: "LinkedIn",
  call: "Call",
  meeting: "Meeting",
  note: "Note",
};

const FIT_LABELS: Record<OutreachFit, string> = {
  high: "High fit",
  medium: "Medium fit",
  low: "Low fit",
};

function emptyLeadForm(): OutreachLeadInput {
  return {
    clinicName: "",
    contactName: "",
    role: "",
    email: "",
    phone: "",
    linkedinUrl: "",
    city: "",
    specialty: "",
    source: "other",
    fit: "medium",
    tags: [],
    stage: "research",
    notes: "",
    nextActionDate: null,
    nextActionNote: "",
  };
}

function GoalProgress({ label, current, goal }: { label: string; current: number; goal: number }) {
  const pct = goal > 0 ? Math.min(100, Math.round((current / goal) * 100)) : 0;
  const done = current >= goal;
  return (
    <div className="outreach-goal">
      <div className="outreach-goal-head">
        <span>{label}</span>
        <strong className={done ? "outreach-goal-done" : ""}>
          {current}/{goal}
        </strong>
      </div>
      <div className="outreach-goal-bar" aria-hidden="true">
        <span className={done ? "outreach-goal-fill outreach-goal-fill--done" : "outreach-goal-fill"} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function LeadRowButton({
  lead,
  overdue,
  onClick,
}: {
  lead: OutreachLead;
  overdue?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`outreach-lead-row${overdue ? " outreach-lead-row--overdue" : ""}`} onClick={onClick}>
      <div>
        <strong>{lead.clinicName}</strong>
        {lead.contactName && <span className="muted small"> · {lead.contactName}</span>}
        <p className="muted small outreach-lead-row-meta">
          {OUTREACH_STAGE_LABELS[lead.stage]}
          {lead.city ? ` · ${lead.city}` : ""}
          {lead.nextActionNote ? ` · ${lead.nextActionNote}` : ""}
        </p>
      </div>
      <div className="outreach-lead-row-aside">
        {lead.nextActionDate && (
          <span className={overdue ? "outreach-date overdue" : "outreach-date"}>{prettyDate(lead.nextActionDate)}</span>
        )}
        <span className={`outreach-fit outreach-fit--${lead.fit}`}>{FIT_LABELS[lead.fit]}</span>
      </div>
    </button>
  );
}

function LeadForm({
  value,
  onChange,
  onSubmit,
  submitLabel,
  busy,
}: {
  value: OutreachLeadInput;
  onChange: (next: OutreachLeadInput) => void;
  onSubmit: (event: FormEvent) => void;
  submitLabel: string;
  busy?: boolean;
}) {
  return (
    <form className="form-grid outreach-form" onSubmit={onSubmit}>
      <label>
        Clinic name *
        <input
          required
          value={value.clinicName}
          onChange={(e) => onChange({ ...value, clinicName: e.target.value })}
        />
      </label>
      <label>
        Contact name
        <input value={value.contactName ?? ""} onChange={(e) => onChange({ ...value, contactName: e.target.value })} />
      </label>
      <label>
        Role
        <input value={value.role ?? ""} onChange={(e) => onChange({ ...value, role: e.target.value })} />
      </label>
      <label>
        Email
        <input type="email" value={value.email ?? ""} onChange={(e) => onChange({ ...value, email: e.target.value })} />
      </label>
      <label>
        Phone
        <input value={value.phone ?? ""} onChange={(e) => onChange({ ...value, phone: e.target.value })} />
      </label>
      <label>
        LinkedIn URL
        <input value={value.linkedinUrl ?? ""} onChange={(e) => onChange({ ...value, linkedinUrl: e.target.value })} />
      </label>
      <label>
        City
        <input value={value.city ?? ""} onChange={(e) => onChange({ ...value, city: e.target.value })} />
      </label>
      <label>
        Specialty
        <input value={value.specialty ?? ""} onChange={(e) => onChange({ ...value, specialty: e.target.value })} />
      </label>
      <label>
        Source
        <select value={value.source ?? "other"} onChange={(e) => onChange({ ...value, source: e.target.value as OutreachSource })}>
          <option value="npi">NPI registry</option>
          <option value="google">Google</option>
          <option value="referral">Referral</option>
          <option value="linkedin">LinkedIn</option>
          <option value="conference">Conference</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>
        Fit score
        <select value={value.fit ?? "medium"} onChange={(e) => onChange({ ...value, fit: e.target.value as OutreachFit })}>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </label>
      <label>
        Stage
        <select value={value.stage ?? "research"} onChange={(e) => onChange({ ...value, stage: e.target.value as OutreachStage })}>
          {OUTREACH_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {OUTREACH_STAGE_LABELS[stage]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tags (comma-separated)
        <input
          value={(value.tags ?? []).join(", ")}
          onChange={(e) =>
            onChange({
              ...value,
              tags: e.target.value
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            })
          }
          placeholder="solo, 10 staff, referral"
        />
      </label>
      <label>
        Next action date
        <input
          type="date"
          value={value.nextActionDate ?? ""}
          onChange={(e) => onChange({ ...value, nextActionDate: e.target.value || null })}
        />
      </label>
      <label>
        Next action note
        <input
          value={value.nextActionNote ?? ""}
          onChange={(e) => onChange({ ...value, nextActionNote: e.target.value })}
          placeholder="Follow up on intro email"
        />
      </label>
      <label className="outreach-form-wide">
        Notes
        <textarea value={value.notes ?? ""} onChange={(e) => onChange({ ...value, notes: e.target.value })} />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

export function OutreachPage() {
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const [view, setView] = useState<CrmView>("dashboard");
  const [leads, setLeads] = useState<OutreachLead[]>([]);
  const [activities, setActivities] = useState<OutreachActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stageFilter, setStageFilter] = useState<OutreachStage | "all">("all");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<OutreachLeadInput>(emptyLeadForm);
  const [editForm, setEditForm] = useState<OutreachLeadInput>(emptyLeadForm);
  const [saving, setSaving] = useState(false);
  const [activityType, setActivityType] = useState<OutreachActivityType>("email");
  const [activitySummary, setActivitySummary] = useState("");
  const [leadActivities, setLeadActivities] = useState<OutreachActivity[]>([]);
  const [loadingLeadActivities, setLoadingLeadActivities] = useState(false);

  const reload = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError("");
    try {
      await seedDemoOutreachLeads(userId);
      const [nextLeads, nextActivities] = await Promise.all([
        fetchOutreachLeads(userId),
        fetchOutreachActivities(userId),
      ]);
      setLeads(nextLeads);
      setActivities(nextActivities);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load outreach data.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selectedLead = useMemo(
    () => leads.find((lead) => lead.id === selectedLeadId) ?? null,
    [leads, selectedLeadId]
  );

  useEffect(() => {
    if (!selectedLead) return;
    setEditForm({
      clinicName: selectedLead.clinicName,
      contactName: selectedLead.contactName,
      role: selectedLead.role,
      email: selectedLead.email,
      phone: selectedLead.phone,
      linkedinUrl: selectedLead.linkedinUrl,
      city: selectedLead.city,
      specialty: selectedLead.specialty,
      source: selectedLead.source,
      fit: selectedLead.fit,
      tags: selectedLead.tags,
      stage: selectedLead.stage,
      notes: selectedLead.notes,
      nextActionDate: selectedLead.nextActionDate,
      nextActionNote: selectedLead.nextActionNote,
    });
  }, [selectedLead]);

  useEffect(() => {
    if (!userId || !selectedLeadId) {
      setLeadActivities([]);
      return;
    }
    let cancelled = false;
    setLoadingLeadActivities(true);
    void fetchOutreachActivities(userId, selectedLeadId)
      .then((data) => {
        if (!cancelled) setLeadActivities(data);
      })
      .catch(() => {
        if (!cancelled) setLeadActivities([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingLeadActivities(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, selectedLeadId, activities.length]);

  const pipeline = useMemo(() => summarizePipeline(leads), [leads]);
  const overdue = useMemo(() => getOverdueFollowUps(leads), [leads]);
  const todayFollowUps = useMemo(() => getTodaysFollowUps(leads), [leads]);
  const weeklyStats = useMemo(() => computeWeeklyStats(leads, activities), [leads, activities]);

  const filteredLeads = useMemo(() => {
    if (stageFilter === "all") return leads;
    return leads.filter((lead) => lead.stage === stageFilter);
  }, [leads, stageFilter]);

  const activePipelineCount = useMemo(
    () => leads.filter((l) => !["converted", "not_interested"].includes(l.stage)).length,
    [leads]
  );

  async function handleAddLead(event: FormEvent) {
    event.preventDefault();
    if (!userId) return;
    setSaving(true);
    setError("");
    try {
      await createOutreachLead(userId, addForm);
      setAddForm(emptyLeadForm());
      setShowAddForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add contact.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveLead(event: FormEvent) {
    event.preventDefault();
    if (!userId || !selectedLead) return;
    setSaving(true);
    setError("");
    try {
      await updateOutreachLead(userId, selectedLead.id, editForm);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save contact.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogActivity(event: FormEvent) {
    event.preventDefault();
    if (!userId || !selectedLead || !activitySummary.trim()) return;
    setSaving(true);
    setError("");
    try {
      await logOutreachActivity(userId, selectedLead.id, activityType, activitySummary);
      setActivitySummary("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log activity.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteLead() {
    if (!userId || !selectedLead) return;
    if (!window.confirm(`Remove ${selectedLead.clinicName} from your outreach list?`)) return;
    setSaving(true);
    try {
      await deleteOutreachLead(userId, selectedLead.id);
      setSelectedLeadId(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete contact.");
    } finally {
      setSaving(false);
    }
  }

  function openLead(leadId: string) {
    setSelectedLeadId(leadId);
    setView("pipeline");
  }

  const weekday = new Date().toLocaleDateString("en-US", { weekday: "long" });

  return (
    <main className="shell outreach-shell">
      <section className="content outreach-content">
        <header className="topbar outreach-header">
          <div>
            <p className="eyebrow">Founder outreach</p>
            <h2>Your clinic pipeline</h2>
            <p className="muted">
              {weekday} · {activePipelineCount} active lead{activePipelineCount === 1 ? "" : "s"} · stay consistent before school starts
            </p>
          </div>
          <button type="button" onClick={() => setShowAddForm(true)}>
            + Add contact
          </button>
        </header>

        {error && <div className="banner error">{error}</div>}

        {overdue.length > 0 && (
          <div className="banner outreach-overdue-banner">
            <strong>{overdue.length} overdue follow-up{overdue.length === 1 ? "" : "s"}</strong>
            <span className="muted small"> — tackle these first to rebuild momentum.</span>
          </div>
        )}

        <div className="outreach-view-tabs">
          <button type="button" className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>
            Dashboard
          </button>
          <button type="button" className={view === "pipeline" ? "active" : ""} onClick={() => setView("pipeline")}>
            Pipeline
          </button>
          <button type="button" className={view === "playbook" ? "active" : ""} onClick={() => setView("playbook")}>
            Weekly rhythm
          </button>
        </div>

        {loading ? (
          <p className="muted">Loading outreach CRM…</p>
        ) : (
          <>
            {view === "dashboard" && (
              <div className="outreach-dashboard">
                <div className="info-grid">
                  <article className="card highlight">
                    <p className="label">Overdue follow-ups</p>
                    <strong>{overdue.length}</strong>
                    <p className="muted small">Past due — highest priority</p>
                  </article>
                  <article className="card highlight">
                    <p className="label">Due today</p>
                    <strong>{todayFollowUps.length}</strong>
                    <p className="muted small">{todayIso()}</p>
                  </article>
                  <article className="card">
                    <p className="label">Active pipeline</p>
                    <strong>{activePipelineCount}</strong>
                    <p className="muted small">Excludes converted & not interested</p>
                  </article>
                  <article className="card">
                    <p className="label">Converted</p>
                    <strong>{pipeline.converted}</strong>
                    <p className="muted small">Paying clinics 🎉</p>
                  </article>
                </div>

                <article className="card wide">
                  <p className="eyebrow">This week&apos;s progress</p>
                  <div className="outreach-goals-grid">
                    <GoalProgress label="Clinics researched" current={weeklyStats.researchAdded} goal={OUTREACH_WEEKLY_GOALS.research} />
                    <GoalProgress label="Emails sent" current={weeklyStats.emailsSent} goal={OUTREACH_WEEKLY_GOALS.emails} />
                    <GoalProgress label="LinkedIn touches" current={weeklyStats.linkedinSent} goal={OUTREACH_WEEKLY_GOALS.linkedin} />
                    <GoalProgress
                      label="Calls & meetings"
                      current={weeklyStats.callsAndMeetings}
                      goal={OUTREACH_WEEKLY_GOALS.followUps}
                    />
                  </div>
                </article>

                <div className="outreach-dashboard-columns">
                  <article className="card">
                    <div className="outreach-section-head">
                      <p className="eyebrow">Follow-ups due</p>
                      <span className="muted small">{overdue.length + todayFollowUps.length} need action</span>
                    </div>
                    {overdue.length === 0 && todayFollowUps.length === 0 ? (
                      <p className="muted small">Nothing due today — add next action dates as you outreach.</p>
                    ) : (
                      <div className="outreach-lead-list">
                        {overdue.map((lead) => (
                          <LeadRowButton key={lead.id} lead={lead} overdue onClick={() => openLead(lead.id)} />
                        ))}
                        {todayFollowUps.map((lead) => (
                          <LeadRowButton key={lead.id} lead={lead} onClick={() => openLead(lead.id)} />
                        ))}
                      </div>
                    )}
                  </article>

                  <article className="card">
                    <p className="eyebrow">Pipeline snapshot</p>
                    <div className="outreach-pipeline-grid">
                      {OUTREACH_STAGES.filter((s) => pipeline[s] > 0).map((stage) => (
                        <button
                          key={stage}
                          type="button"
                          className="outreach-pipeline-chip"
                          onClick={() => {
                            setStageFilter(stage);
                            setView("pipeline");
                          }}
                        >
                          <span>{OUTREACH_STAGE_LABELS[stage]}</span>
                          <strong>{pipeline[stage]}</strong>
                        </button>
                      ))}
                      {leads.length === 0 && <p className="muted small">Add your first clinic to start tracking.</p>}
                    </div>
                  </article>
                </div>
              </div>
            )}

            {view === "pipeline" && (
              <div className="outreach-pipeline">
                <div className="outreach-stage-tabs">
                  <button
                    type="button"
                    className={stageFilter === "all" ? "active" : ""}
                    onClick={() => setStageFilter("all")}
                  >
                    All ({leads.length})
                  </button>
                  {OUTREACH_STAGES.map((stage) => (
                    <button
                      key={stage}
                      type="button"
                      className={stageFilter === stage ? "active" : ""}
                      onClick={() => setStageFilter(stage)}
                    >
                      {OUTREACH_STAGE_LABELS[stage]} ({pipeline[stage]})
                    </button>
                  ))}
                </div>

                {filteredLeads.length === 0 ? (
                  <article className="card wide outreach-empty">
                    <p className="eyebrow">No contacts here yet</p>
                    <p className="muted">Add clinics you want to reach — start with 10 from NPI on Monday.</p>
                    <button type="button" onClick={() => setShowAddForm(true)}>
                      Add first contact
                    </button>
                  </article>
                ) : (
                  <div className="outreach-lead-list outreach-lead-list--pipeline">
                    {filteredLeads.map((lead) => (
                      <LeadRowButton
                        key={lead.id}
                        lead={lead}
                        overdue={Boolean(lead.nextActionDate && lead.nextActionDate < todayIso())}
                        onClick={() => setSelectedLeadId(lead.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {view === "playbook" && (
              <div className="outreach-playbook">
                <article className="card wide outreach-playbook-intro">
                  <p className="eyebrow">Weekly rhythm</p>
                  <h3>Simple structure beats motivation</h3>
                  <p className="muted">
                    You have one month before school — block 60–90 minutes on outreach days and follow this cadence.
                    Log every touch here so progress stays visible.
                  </p>
                </article>

                <div className="outreach-playbook-grid">
                  <article className="card outreach-playbook-day">
                    <p className="eyebrow">Monday</p>
                    <h4>Research 10 clinics</h4>
                    <ul className="outreach-playbook-list">
                      <li>Pull from NPI registry or Google — solo & small group practices</li>
                      <li>Note specialty, city, and why they&apos;re a fit</li>
                      <li>Set next action: find contact + draft intro</li>
                    </ul>
                    <GoalProgress label="Added this week" current={weeklyStats.researchAdded} goal={OUTREACH_WEEKLY_GOALS.research} />
                  </article>

                  <article className="card outreach-playbook-day">
                    <p className="eyebrow">Tuesday – Thursday</p>
                    <h4>Send 20 personalized emails</h4>
                    <ul className="outreach-playbook-list">
                      <li>Reference their specialty or a specific pain (renewals, compliance docs)</li>
                      <li>Log each send and move stage to Contacted</li>
                      <li>Schedule follow-up 3–5 days out</li>
                    </ul>
                    <GoalProgress label="Emails logged" current={weeklyStats.emailsSent} goal={OUTREACH_WEEKLY_GOALS.emails} />
                  </article>

                  <article className="card outreach-playbook-day">
                    <p className="eyebrow">Friday</p>
                    <h4>Follow-ups + LinkedIn</h4>
                    <ul className="outreach-playbook-list">
                      <li>Work overdue follow-ups first</li>
                      <li>Send LinkedIn connection requests with a short note</li>
                      <li>Update stages when you get replies</li>
                    </ul>
                    <GoalProgress label="LinkedIn logged" current={weeklyStats.linkedinSent} goal={OUTREACH_WEEKLY_GOALS.linkedin} />
                  </article>
                </div>

                <article className="card wide">
                  <p className="eyebrow">Stage guide</p>
                  <div className="outreach-stage-guide">
                    {OUTREACH_STAGES.map((stage) => (
                      <div key={stage} className="outreach-stage-guide-row">
                        <strong>{OUTREACH_STAGE_LABELS[stage]}</strong>
                        <span className="muted small">
                          {stage === "research" && "Identified, not yet contacted"}
                          {stage === "contacted" && "First outreach sent"}
                          {stage === "replied" && "Got a response — keep momentum"}
                          {stage === "trial" && "Started free trial"}
                          {stage === "founding" && "Applied for founding clinic program"}
                          {stage === "converted" && "Paying customer 🎉"}
                          {stage === "not_interested" && "Said no — archive"}
                          {stage === "nurture" && "Paused — revisit in 30–60 days"}
                        </span>
                      </div>
                    ))}
                  </div>
                </article>
              </div>
            )}
          </>
        )}

        {showAddForm && (
          <div className="outreach-modal-backdrop" onClick={() => setShowAddForm(false)}>
            <div className="outreach-modal card" onClick={(e) => e.stopPropagation()}>
              <div className="outreach-modal-head">
                <h3>Add outreach contact</h3>
                <button type="button" className="secondary" onClick={() => setShowAddForm(false)}>
                  Close
                </button>
              </div>
              <LeadForm value={addForm} onChange={setAddForm} onSubmit={handleAddLead} submitLabel="Add contact" busy={saving} />
            </div>
          </div>
        )}

        {selectedLead && (
          <div className="outreach-modal-backdrop" onClick={() => setSelectedLeadId(null)}>
            <div className="outreach-modal outreach-modal--wide card" onClick={(e) => e.stopPropagation()}>
              <div className="outreach-modal-head">
                <div>
                  <p className="eyebrow">{OUTREACH_STAGE_LABELS[selectedLead.stage]}</p>
                  <h3>{selectedLead.clinicName}</h3>
                </div>
                <button type="button" className="secondary" onClick={() => setSelectedLeadId(null)}>
                  Close
                </button>
              </div>

              <div className="outreach-detail-grid">
                <div>
                  <p className="label">Contact details</p>
                  <LeadForm
                    value={editForm}
                    onChange={setEditForm}
                    onSubmit={handleSaveLead}
                    submitLabel="Save changes"
                    busy={saving}
                  />
                  <button type="button" className="secondary outreach-delete-btn" onClick={() => void handleDeleteLead()} disabled={saving}>
                    Remove contact
                  </button>
                </div>

                <div>
                  <p className="label">Log activity</p>
                  <form className="form-grid outreach-activity-form" onSubmit={handleLogActivity}>
                    <label>
                      Type
                      <select value={activityType} onChange={(e) => setActivityType(e.target.value as OutreachActivityType)}>
                        {(Object.keys(ACTIVITY_LABELS) as OutreachActivityType[]).map((type) => (
                          <option key={type} value={type}>
                            {ACTIVITY_LABELS[type]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="outreach-form-wide">
                      Summary
                      <input
                        required
                        value={activitySummary}
                        onChange={(e) => setActivitySummary(e.target.value)}
                        placeholder="Sent intro email about renewal tracking"
                      />
                    </label>
                    <button type="submit" disabled={saving || !activitySummary.trim()}>
                      Log activity
                    </button>
                  </form>

                  <p className="label outreach-activity-history-label">Activity history</p>
                  {loadingLeadActivities ? (
                    <p className="muted small">Loading…</p>
                  ) : leadActivities.length === 0 ? (
                    <p className="muted small">No activity yet — log your first touch.</p>
                  ) : (
                    <ul className="outreach-activity-list">
                      {leadActivities.map((activity) => (
                        <li key={activity.id}>
                          <strong>{ACTIVITY_LABELS[activity.activityType]}</strong>
                          <span className="muted small"> · {new Date(activity.occurredAt).toLocaleString()}</span>
                          <p>{activity.summary}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
