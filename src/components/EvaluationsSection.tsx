import { FormEvent, useMemo, useState } from "react";
import { addEvaluation, deleteEvaluation } from "../api/vendors";
import {
  EVALUATION_CRITERIA,
  EVALUATION_RECOMMENDATIONS,
  averageCriterionScores,
  computeOverallScore,
  hasScorecard,
  recommendationClass,
  recommendationLabel,
  type EvaluationCriterionId,
  type EvaluationRecommendation,
} from "../lib/evaluations";
import { prettyDate } from "../lib/utils";
import type { Evaluation, Vendor } from "../types";

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="delete" onClick={onClick} aria-label="Delete">
      Delete
    </button>
  );
}

function ScorePicker({
  name,
  value,
  onChange,
  disabled,
}: {
  name: string;
  value: number | undefined;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="score-picker" role="radiogroup" aria-label={name}>
      {[1, 2, 3, 4, 5].map((score) => (
        <label key={score} className={`score-picker-option${value === score ? " is-selected" : ""}`}>
          <input
            type="radio"
            name={name}
            value={score}
            checked={value === score}
            disabled={disabled}
            onChange={() => onChange(score)}
          />
          {score}
        </label>
      ))}
    </div>
  );
}

function CriteriaBars({ criteria }: { criteria: Partial<Record<EvaluationCriterionId, number>> }) {
  return (
    <div className="eval-criteria-bars">
      {EVALUATION_CRITERIA.map((item) => {
        const value = criteria[item.id];
        if (value == null) return null;
        return (
          <div className="eval-criterion-bar" key={item.id}>
            <div className="eval-criterion-bar-head">
              <span>{item.label}</span>
              <strong>{value}/5</strong>
            </div>
            <div className="eval-criterion-track">
              <span className="eval-criterion-fill" style={{ width: `${(value / 5) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function EvaluationsSection({
  vendor,
  organizationId,
  readOnly,
  onChanged,
}: {
  vendor: Vendor;
  organizationId: string;
  readOnly: boolean;
  onChanged: () => Promise<void>;
}) {
  const [criteriaDraft, setCriteriaDraft] = useState<Partial<Record<EvaluationCriterionId, number>>>({});
  const [formError, setFormError] = useState("");

  const scorecardEvaluations = vendor.evaluations.filter((item) => hasScorecard(item.criteria));
  const overallAverage = scorecardEvaluations.length
    ? scorecardEvaluations.reduce((sum, item) => sum + item.score, 0) / scorecardEvaluations.length
    : 0;
  const criterionAverages = useMemo(() => averageCriterionScores(scorecardEvaluations), [scorecardEvaluations]);

  async function handleAddEvaluation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    setFormError("");

    const form = new FormData(event.currentTarget);
    const date = String(form.get("date") || "");
    const reviewerName = String(form.get("reviewerName") || "").trim();
    const recommendation = String(form.get("recommendation") || "acceptable") as EvaluationRecommendation;
    const notes = String(form.get("notes") || "").trim();

    const criteria = { ...criteriaDraft };
    const missing = EVALUATION_CRITERIA.filter((item) => criteria[item.id] == null);
    if (!date) {
      setFormError("Review date is required.");
      return;
    }
    if (missing.length) {
      setFormError(`Rate all ${EVALUATION_CRITERIA.length} criteria (1–5).`);
      return;
    }

    const overall = computeOverallScore(criteria);
    await addEvaluation(organizationId, vendor.id, {
      date,
      score: Math.round(overall),
      criteria,
      recommendation,
      reviewerName,
      notes,
    });
    await onChanged();
    event.currentTarget.reset();
    setCriteriaDraft({});
  }

  return (
    <section className="section">
      <h3>Vendor scorecard</h3>
      <p className="muted small eval-intro">
        Score vendors the way clinics actually review partners — by criteria, renewal decision, and reviewer — not
        just one number.
      </p>

      {scorecardEvaluations.length > 0 ? (
        <div className="eval-summary-grid">
          <div className="card eval-summary-card">
            <p className="label">Overall average</p>
            <strong className="eval-overall-score">{overallAverage.toFixed(1)} / 5</strong>
            <p className="muted small">{scorecardEvaluations.length} review(s) on file</p>
          </div>
          <div className="card eval-summary-card eval-summary-card--wide">
            <p className="label">Average by criterion</p>
            <div className="eval-summary-bars">
              {criterionAverages.map((item) => (
                <div className="eval-summary-bar-row" key={item.id}>
                  <span>{item.label}</span>
                  <strong>{item.average != null ? `${item.average}/5` : "—"}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="notice eval-empty-notice">No scorecard reviews yet. Complete the form below after a vendor review meeting or renewal check-in.</div>
      )}

      {!readOnly && (
        <form className="card eval-form" onSubmit={handleAddEvaluation}>
          <p className="label">New vendor review</p>
          <div className="form-grid eval-form-grid">
            <label>
              Review date
              <input name="date" type="date" required />
            </label>
            <label>
              Reviewed by
              <input name="reviewerName" placeholder="e.g. Office manager" />
            </label>
            <label className="eval-form-full">
              Renewal recommendation
              <select name="recommendation" defaultValue="acceptable">
                {EVALUATION_RECOMMENDATIONS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label} — {item.description}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="eval-criteria-form">
            {EVALUATION_CRITERIA.map((item) => (
              <div className="eval-criteria-row" key={item.id}>
                <div>
                  <strong>{item.label}</strong>
                  <p className="muted small">{item.hint}</p>
                </div>
                <ScorePicker
                  name={`criteria-${item.id}`}
                  value={criteriaDraft[item.id]}
                  onChange={(value) => setCriteriaDraft((current) => ({ ...current, [item.id]: value }))}
                />
              </div>
            ))}
          </div>

          <label className="eval-form-full">
            Summary notes
            <textarea name="notes" placeholder="Issues, wins, renewal conditions, or follow-ups…" rows={3} />
          </label>

          {formError && <p className="form-error">{formError}</p>}
          <button type="submit">Save scorecard review</button>
        </form>
      )}

      {vendor.evaluations.length === 0 && readOnly && (
        <p className="muted small">No evaluations yet.</p>
      )}

      {vendor.evaluations.map((evaluation) => (
        <EvaluationCard
          key={evaluation.id}
          evaluation={evaluation}
          readOnly={readOnly}
          onDelete={async () => {
            await deleteEvaluation(evaluation.id);
            await onChanged();
          }}
        />
      ))}
    </section>
  );
}

function EvaluationCard({
  evaluation,
  readOnly,
  onDelete,
}: {
  evaluation: Evaluation;
  readOnly: boolean;
  onDelete: () => Promise<void>;
}) {
  const legacy = !hasScorecard(evaluation.criteria);

  return (
    <article className="card eval-review-card row">
      <div className="eval-review-body">
        <div className="eval-review-head">
          <div>
            <p className="eyebrow">{prettyDate(evaluation.date)}</p>
            {evaluation.reviewerName && <p className="muted small">Reviewed by {evaluation.reviewerName}</p>}
          </div>
          <span className={recommendationClass(evaluation.recommendation)}>
            {recommendationLabel(evaluation.recommendation)}
          </span>
        </div>

        {legacy ? (
          <p>
            <strong>Legacy score: {evaluation.score}/5</strong>
            {evaluation.notes && <> — {evaluation.notes}</>}
          </p>
        ) : (
          <>
            <p className="eval-overall-inline">
              Overall: <strong>{evaluation.score}/5</strong>
            </p>
            <CriteriaBars criteria={evaluation.criteria} />
            {evaluation.notes && <p className="eval-notes">{evaluation.notes}</p>}
          </>
        )}
      </div>
      {!readOnly && <DeleteButton onClick={() => void onDelete()} />}
    </article>
  );
}
