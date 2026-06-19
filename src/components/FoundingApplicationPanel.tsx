import { FormEvent, useEffect, useState } from "react";
import {
  fetchMyFoundingApplication,
  fetchPendingFoundingApplications,
  reviewFoundingApplication,
  submitFoundingApplication,
  type FoundingApplication,
  type PendingFoundingApplication,
} from "../api/foundingApplication";
import {
  fetchFoundingProgramStatus,
  formatMonthlyPrice,
  FOUNDING_PRICE_CENTS,
  type FoundingProgramStatus,
} from "../lib/stripe";

const APPLICANT_ROLES = [
  "Owner / physician",
  "Office manager",
  "Practice administrator",
  "Operations / COO",
  "Other",
] as const;

type Props = {
  organizationId: string;
  organizationName: string;
  isFounding: boolean;
  canManage: boolean;
  onApproved: () => Promise<void>;
};

export function FoundingApplicationSection({
  organizationId,
  organizationName,
  isFounding,
  canManage,
  onApproved,
}: Props) {
  const [program, setProgram] = useState<FoundingProgramStatus | null>(null);
  const [application, setApplication] = useState<FoundingApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([fetchFoundingProgramStatus(), fetchMyFoundingApplication(organizationId)])
      .then(([status, app]) => {
        if (cancelled) return;
        setProgram(status);
        setApplication(app);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Founding application load failed:", err);
          setProgram(null);
          setApplication(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  if (loading || isFounding) return null;

  if (!program) {
    return (
      <div className="card founding-apply-card">
        <p className="label">Founding clinic pricing</p>
        <p className="muted small">
          Could not load founding slot availability. Refresh the page, or subscribe at standard pricing below.
        </p>
      </div>
    );
  }

  const slotsFull = program.slotsRemaining <= 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;

    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setMessage("");
    setError("");

    try {
      await submitFoundingApplication({
        organizationId,
        clinicName: String(form.get("clinicName") || organizationName),
        website: String(form.get("website") || ""),
        applicantRole: String(form.get("applicantRole") || ""),
        note: String(form.get("note") || ""),
      });
      const app = await fetchMyFoundingApplication(organizationId);
      setApplication(app);
      setMessage("Application submitted. We'll review within 1 business day.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit application.");
    } finally {
      setSubmitting(false);
    }
  }

  if (application?.status === "pending") {
    return (
      <div className="card founding-apply-card">
        <p className="label">Founding clinic application</p>
        <strong>Pending review</strong>
        <p className="muted small">
          We received your application for {formatMonthlyPrice(program.foundingPriceCents)} locked pricing. You'll get
          email when approved — then subscribe at the founding rate below.
        </p>
        <p className="muted small">
          {program.slotsRemaining} founding slot{program.slotsRemaining === 1 ? "" : "s"} still available.
        </p>
      </div>
    );
  }

  if (application?.status === "approved") {
    return (
      <div className="card founding-apply-card founding-apply-card--approved">
        <p className="label">Founding clinic application</p>
        <strong>Approved — founding rate unlocked</strong>
        <p className="muted small">
          Subscribe at {formatMonthlyPrice(FOUNDING_PRICE_CENTS)}/mo below. This price stays locked while you remain
          subscribed.
        </p>
      </div>
    );
  }

  if (application?.status === "rejected") {
    if (slotsFull || !canManage) {
      return (
        <div className="card founding-apply-card">
          <p className="label">Founding clinic application</p>
          <strong>Not approved for founding rate</strong>
          <p className="muted small">
            You can still subscribe at standard pricing. Contact support if you believe this was a mistake.
          </p>
        </div>
      );
    }
    // fall through to application form so they can re-apply
  } else if (slotsFull && !application) {
    return (
      <div className="card founding-apply-card">
        <p className="label">Founding clinic pricing</p>
        <strong>All {program.maxSlots} founding slots are claimed</strong>
        <p className="muted small">
          New clinics can subscribe at standard pricing ({formatMonthlyPrice(program.standardPriceCents)}/mo) below.
          Founding slots open again only if a founding clinic cancels — contact us if you have questions.
        </p>
      </div>
    );
  }

  if (!canManage) return null;

  return (
    <div className="card founding-apply-card">
      {application?.status === "rejected" && (
        <div className="banner founding-apply-banner">
          Previous application was not approved. You can submit again with more detail.
        </div>
      )}
      <p className="label">Apply for founding clinic pricing</p>
      <h3>{formatMonthlyPrice(program.foundingPriceCents)}/mo — locked for life</h3>
      <p className="muted small">
        {program.slotsRemaining} of {program.maxSlots} founding slots left. Real clinics only — we review each
        application before unlocking the lower rate.
      </p>

      <form className="founding-apply-form" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          Clinic / practice name
          <input defaultValue={organizationName} name="clinicName" required />
        </label>
        <label>
          Website (optional)
          <input name="website" placeholder="https://yourclinic.com" type="url" />
        </label>
        <label>
          Your role
          <select name="applicantRole" required defaultValue="">
            <option disabled value="">
              Select role…
            </option>
            {APPLICANT_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
        <label>
          Brief note
          <textarea
            name="note"
            placeholder="Tell us about your clinic — location, specialty, why you're trying SupplierSync…"
            required
            rows={4}
          />
        </label>
        <button disabled={submitting} type="submit">
          {submitting ? "Submitting…" : "Submit application"}
        </button>
      </form>

      {message && <div className="banner success founding-apply-banner">{message}</div>}
      {error && <div className="banner error founding-apply-banner">{error}</div>}
    </div>
  );
}

export function FoundingApplicationAdminPanel({
  onReviewed,
}: {
  onReviewed: () => Promise<void>;
}) {
  const [applications, setApplications] = useState<PendingFoundingApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setApplications(await fetchPendingFoundingApplications());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load applications.");
      setApplications([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleReview(applicationId: string, approve: boolean) {
    setBusyId(applicationId);
    setError("");
    try {
      await reviewFoundingApplication(applicationId, approve);
      await load();
      await onReviewed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="card founding-admin-card">
        <p className="muted small">Loading founding applications…</p>
      </div>
    );
  }

  if (applications.length === 0) {
    return (
      <div className="card founding-admin-card">
        <p className="label">Founding applications (admin)</p>
        <p className="muted small">No pending applications.</p>
      </div>
    );
  }

  return (
    <div className="card founding-admin-card">
      <p className="label">Founding applications (admin)</p>
      <p className="muted small">Review pending clinics before unlocking founding pricing.</p>
      {error && <div className="banner error">{error}</div>}
      <ul className="founding-admin-list">
        {applications.map((app) => (
          <li className="founding-admin-item" key={app.id}>
            <div>
              <strong>{app.clinicName}</strong>
              <p className="muted small">
                Workspace: {app.organizationName} · {app.submitterEmail}
              </p>
              <p className="muted small">
                Role: {app.applicantRole}
                {app.website ? ` · ${app.website}` : ""}
              </p>
              <p className="founding-admin-note">{app.note}</p>
            </div>
            <div className="founding-admin-actions">
              <button
                disabled={busyId === app.id}
                onClick={() => void handleReview(app.id, true)}
                type="button"
              >
                Approve
              </button>
              <button
                className="secondary"
                disabled={busyId === app.id}
                onClick={() => void handleReview(app.id, false)}
                type="button"
              >
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
