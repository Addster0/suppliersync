import { fetchContractExtractStatus } from "../api/contractExtract";
import {
  checkOrgStorageConfigured,
  getSupabaseEdgeSecretsUrl,
  getSupabaseSqlEditorUrl,
  getSupabaseStorageBucketsUrl,
  probeOrgStorage,
} from "./storage";
import { checkSupabaseReachable } from "./supabase";

export type HealthCheck = {
  id: "supabase" | "storage" | "contract_extract";
  label: string;
  ok: boolean;
  detail: string;
  fixHref?: string;
  fixLabel?: string;
};

export async function runSystemHealthChecks(organizationId?: string): Promise<HealthCheck[]> {
  const [supabaseOk, storageProbe, extractStatus] = await Promise.all([
    checkSupabaseReachable(),
    probeOrgStorage(organizationId),
    fetchContractExtractStatus(),
  ]);

  const storageOk = storageProbe.status === "ok";
  const extractOk = extractStatus.reachable !== false && extractStatus.configured;

  return [
    {
      id: "supabase",
      label: "Database & sign-in",
      ok: supabaseOk,
      detail: supabaseOk
        ? "Your Supabase project is online and reachable."
        : "Cannot reach Supabase. Confirm the project is active and env keys match the restored project.",
    },
    {
      id: "storage",
      label: "Document storage",
      ok: storageOk,
      detail: storageProbe.detail,
      fixHref: storageOk
        ? undefined
        : storageProbe.status === "policy_error"
          ? getSupabaseSqlEditorUrl()
          : getSupabaseStorageBucketsUrl(),
      fixLabel: storageOk
        ? undefined
        : storageProbe.status === "policy_error"
          ? "Open SQL Editor (Step B)"
          : "Open Supabase Storage",
    },
    {
      id: "contract_extract",
      label: "AI contract extraction",
      ok: extractOk,
      detail: extractOk
        ? "OpenAI is configured — PDF contracts can pre-fill details on the Contracts tab."
        : extractStatus.reachable === false
          ? extractStatus.error ??
            "Cannot reach the extract-contract edge function. Deploy it with ./scripts/setup-contract-extract.sh."
          : extractStatus.error ??
            "Add OPENAI_API_KEY to Supabase edge function secrets (./scripts/setup-contract-extract.sh).",
      fixHref: extractOk ? undefined : getSupabaseEdgeSecretsUrl(),
      fixLabel: extractOk ? undefined : "Open Edge Function secrets",
    },
  ];
}

export async function isOrgStorageHealthy(organizationId?: string): Promise<boolean> {
  return checkOrgStorageConfigured(organizationId);
}

export function getStorageSetupSqlUrl() {
  return getSupabaseSqlEditorUrl();
}
