import type { ContractExtractResult } from "../api/contractExtract";
import type { ContractRenewalType } from "../types";
import {
  addMonthsToIsoDate,
  computeSuggestedReviewDate,
  subtractDaysFromIsoDate,
} from "./renewals";

function monthsBetweenIsoDates(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  return Math.max(1, months);
}

/** Fill gaps the model often misses so the contract form can be saved. */
export function enrichContractExtractResult(result: ContractExtractResult): ContractExtractResult {
  const enriched: ContractExtractResult = {
    ...result,
    extractHints: [...(result.extractHints ?? [])],
  };

  if (!enriched.name?.trim() && enriched.documentTypeLabel?.trim()) {
    enriched.name = enriched.documentTypeLabel.trim();
  }

  if (enriched.termMonths == null && enriched.startDate && enriched.endDate) {
    enriched.termMonths = monthsBetweenIsoDates(enriched.startDate, enriched.endDate);
  }

  if (!enriched.endDate && enriched.startDate && enriched.termMonths != null && enriched.termMonths > 0) {
    enriched.endDate = addMonthsToIsoDate(enriched.startDate, enriched.termMonths);
  }

  if (!enriched.renewalType) {
    if (enriched.autoRenew === true) {
      enriched.renewalType = "auto_renew";
    } else if (enriched.endDate) {
      enriched.renewalType = "fixed_term";
    } else if (enriched.autoRenew === false) {
      enriched.renewalType = "evergreen";
    }
  }

  if (!enriched.renewalDate) {
    const renewalType = enriched.renewalType;
    if (renewalType === "auto_renew") {
      if (enriched.endDate && enriched.noticePeriodDays != null && enriched.noticePeriodDays >= 0) {
        enriched.renewalDate = subtractDaysFromIsoDate(enriched.endDate, enriched.noticePeriodDays);
      } else if (enriched.startDate && enriched.termMonths != null && enriched.termMonths > 0) {
        enriched.renewalDate = computeSuggestedReviewDate({
          startDate: enriched.startDate,
          termMonths: enriched.termMonths,
          noticePeriodDays: enriched.noticePeriodDays,
        });
      } else if (enriched.endDate) {
        enriched.renewalDate = enriched.endDate;
      }
    } else if (renewalType === "month_to_month" && enriched.startDate) {
      enriched.renewalDate = addMonthsToIsoDate(enriched.startDate, enriched.termMonths ?? 1);
    }
  }

  if (enriched.renewalType === "fixed_term" && !enriched.endDate && enriched.startDate && enriched.termMonths) {
    enriched.endDate = addMonthsToIsoDate(enriched.startDate, enriched.termMonths);
  }

  if (
    !enriched.endDate &&
    enriched.startDate &&
    !enriched.termMonths &&
    enriched.renewalType !== "evergreen" &&
    enriched.renewalType !== "month_to_month"
  ) {
    enriched.termMonths = 12;
    enriched.endDate = addMonthsToIsoDate(enriched.startDate, 12);
    if (!enriched.renewalType) enriched.renewalType = "fixed_term";
    enriched.extractHints?.push("End date estimated as 12 months from start — verify against the PDF.");
  }

  return enriched;
}

export function missingRequiredContractFields(params: {
  name: string;
  startDate: string;
  endDate: string;
  renewalDate: string;
  renewalType: ContractRenewalType;
}): string[] {
  const missing: string[] = [];
  if (!params.name.trim()) missing.push("contract name");
  if (!params.startDate) missing.push("start date");

  switch (params.renewalType) {
    case "fixed_term":
      if (!params.endDate) missing.push("end date");
      break;
    case "auto_renew":
      if (!params.endDate && !params.renewalDate) missing.push("review date or term end");
      break;
    case "month_to_month":
      if (!params.renewalDate) missing.push("review date");
      break;
    default:
      break;
  }

  return missing;
}
