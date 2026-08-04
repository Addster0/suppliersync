import { useEffect, useState } from "react";
import { fetchIsPlatformAdmin } from "../api/foundingApplication";
import {
  getSupabaseSqlEditorUrl,
  getSupabaseStorageBucketsUrl,
  ORG_STORAGE_BUCKET_SQL,
  ORG_STORAGE_POLICIES_SQL,
  probeOrgStorage,
  type OrgStorageStatus,
} from "../lib/storage";
import { useAuth } from "../contexts/AuthContext";
import { useOrganization } from "../contexts/OrganizationContext";

export function StorageSetupBanner() {
  const { session, loading: authLoading } = useAuth();
  const { canWrite, activeMembership } = useOrganization();
  const [status, setStatus] = useState<OrgStorageStatus | null>(null);
  const [detail, setDetail] = useState("");
  const [copied, setCopied] = useState<"bucket" | "policies" | null>(null);
  const [expanded, setExpanded] = useState<"bucket" | "policies" | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  const organizationId = activeMembership?.organizationId;

  useEffect(() => {
    void fetchIsPlatformAdmin().then(setIsPlatformAdmin);
  }, []);

  useEffect(() => {
    if (authLoading || !session || !canWrite) return;

    let cancelled = false;
    void probeOrgStorage(organizationId).then((result) => {
      if (!cancelled) {
        setStatus(result.status);
        setDetail(result.detail);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authLoading, session, canWrite, organizationId]);

  if (!canWrite || status === null || status === "ok" || status === "not_signed_in") return null;

  async function copySql(which: "bucket" | "policies") {
    const text = which === "bucket" ? ORG_STORAGE_BUCKET_SQL : ORG_STORAGE_POLICIES_SQL;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 2500);
    } catch {
      setExpanded(which);
    }
  }

  async function recheck() {
    const result = await probeOrgStorage(organizationId);
    setStatus(result.status);
    setDetail(result.detail);
  }

  const needsBucket = status === "missing_bucket";
  const needsPolicies = status === "policy_error" || status === "unknown";

  if (!isPlatformAdmin) {
    return (
      <div className="banner error storage-setup-banner">
        <div className="storage-setup-banner__head">
          <strong>Document uploads temporarily unavailable</strong>
          <p className="storage-setup-banner__lead">
            File attachments are not available right now. You can still add vendors, contracts, and renewals
            manually — contact support if this continues.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="banner error storage-setup-banner">
      <div className="storage-setup-banner__head">
        <strong>
          {needsBucket
            ? "Document storage is not configured"
            : "Document storage needs access policies"}
        </strong>
        <p className="storage-setup-banner__lead">{detail}</p>
      </div>

      <div className="storage-setup-banner__steps">
        {needsBucket && (
          <p className="storage-setup-banner__lead">
            <strong>Option 1 — Dashboard:</strong>{" "}
            <a href={getSupabaseStorageBucketsUrl()} target="_blank" rel="noreferrer">
              Storage → New bucket
            </a>
            , name it <code>organization-files</code>, set <strong>Private</strong>, then click{" "}
            <strong>Check again</strong>.
          </p>
        )}
        {needsPolicies && (
          <p className="storage-setup-banner__lead">
            The bucket exists but uploads are blocked — usually the INSERT policies from Step B are missing or
            don&apos;t match the app (they must use <code>is_org_member</code> / <code>can_write_org</code> on the
            first folder in each file path). Run the policies SQL below, then click <strong>Check again</strong>.
          </p>
        )}
        <p className="storage-setup-banner__lead">
          <strong>SQL setup:</strong> Open{" "}
          <a href={getSupabaseSqlEditorUrl()} target="_blank" rel="noreferrer">
            SQL Editor
          </a>
          {needsBucket ? " — run Step A first, then Step B if uploads fail with permission errors." : " — run Step B."}
        </p>
        <div className="storage-setup-banner__actions">
          {needsBucket && (
            <>
              <button
                type="button"
                className="secondary"
                onClick={() => setExpanded((v) => (v === "bucket" ? null : "bucket"))}
              >
                {expanded === "bucket" ? "Hide Step A SQL" : "Show Step A SQL"}
              </button>
              <button type="button" className="secondary" onClick={() => void copySql("bucket")}>
                {copied === "bucket" ? "Copied!" : "Copy Step A"}
              </button>
            </>
          )}
          <button
            type="button"
            className="secondary"
            onClick={() => setExpanded((v) => (v === "policies" ? null : "policies"))}
          >
            {expanded === "policies" ? "Hide Step B SQL" : "Show Step B SQL"}
          </button>
          <button type="button" className="secondary" onClick={() => void copySql("policies")}>
            {copied === "policies" ? "Copied!" : "Copy Step B"}
          </button>
          <button type="button" className="secondary" onClick={() => void recheck()}>
            Check again
          </button>
        </div>
        {expanded === "bucket" && (
          <pre className="storage-setup-banner__sql" aria-label="Step A — bucket SQL">
            {ORG_STORAGE_BUCKET_SQL}
          </pre>
        )}
        {expanded === "policies" && (
          <pre className="storage-setup-banner__sql" aria-label="Step B — policies SQL">
            {ORG_STORAGE_POLICIES_SQL}
          </pre>
        )}
      </div>
    </div>
  );
}
