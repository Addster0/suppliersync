export const EVALUATION_CRITERIA = [
  {
    id: "quality",
    label: "Service quality",
    hint: "Meets your clinic's operational and clinical needs",
  },
  {
    id: "responsiveness",
    label: "Responsiveness",
    hint: "Communication, follow-through, and issue resolution",
  },
  {
    id: "value",
    label: "Value for money",
    hint: "Pricing fair for the service delivered",
  },
  {
    id: "compliance",
    label: "Compliance & documentation",
    hint: "BAAs, COIs, insurance, and paperwork on file",
  },
  {
    id: "reliability",
    label: "Reliability",
    hint: "On-time delivery, uptime, and SLA adherence",
  },
] as const;

export type EvaluationCriterionId = (typeof EVALUATION_CRITERIA)[number]["id"];

export type EvaluationCriteria = Partial<Record<EvaluationCriterionId, number>>;

export type EvaluationRecommendation = "preferred" | "acceptable" | "under_review" | "do_not_renew";

export const EVALUATION_RECOMMENDATIONS: {
  id: EvaluationRecommendation;
  label: string;
  description: string;
}[] = [
  { id: "preferred", label: "Preferred vendor", description: "Renew — strong partner" },
  { id: "acceptable", label: "Acceptable", description: "Keep — meets expectations" },
  { id: "under_review", label: "Under review", description: "Issues to resolve before renewal" },
  { id: "do_not_renew", label: "Do not renew", description: "Replace or exit at next term" },
];

export function computeOverallScore(criteria: EvaluationCriteria) {
  const values = EVALUATION_CRITERIA.map((item) => criteria[item.id]).filter(
    (value): value is number => typeof value === "number" && value >= 1 && value <= 5
  );
  if (!values.length) return 0;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round(avg * 10) / 10;
}

export function recommendationLabel(recommendation: EvaluationRecommendation) {
  return EVALUATION_RECOMMENDATIONS.find((item) => item.id === recommendation)?.label ?? recommendation;
}

export function recommendationClass(recommendation: EvaluationRecommendation) {
  return `eval-recommendation eval-recommendation--${recommendation}`;
}

export function parseCriteria(raw: unknown): EvaluationCriteria {
  if (!raw || typeof raw !== "object") return {};
  const parsed = raw as Record<string, unknown>;
  const criteria: EvaluationCriteria = {};
  for (const item of EVALUATION_CRITERIA) {
    const value = parsed[item.id];
    if (typeof value === "number" && value >= 1 && value <= 5) {
      criteria[item.id] = value;
    }
  }
  return criteria;
}

export function hasScorecard(criteria: EvaluationCriteria) {
  return EVALUATION_CRITERIA.some((item) => criteria[item.id] != null);
}

export function averageCriterionScores(evaluations: { criteria: EvaluationCriteria }[]) {
  const totals: Partial<Record<EvaluationCriterionId, { sum: number; count: number }>> = {};
  for (const evaluation of evaluations) {
    for (const item of EVALUATION_CRITERIA) {
      const value = evaluation.criteria[item.id];
      if (value == null) continue;
      const bucket = totals[item.id] ?? { sum: 0, count: 0 };
      bucket.sum += value;
      bucket.count += 1;
      totals[item.id] = bucket;
    }
  }
  return EVALUATION_CRITERIA.map((item) => {
    const bucket = totals[item.id];
    if (!bucket?.count) return { id: item.id, label: item.label, average: null as number | null };
    return {
      id: item.id,
      label: item.label,
      average: Math.round((bucket.sum / bucket.count) * 10) / 10,
    };
  });
}
