import { useEffect, useState } from "react";
import { getStorageSetupSqlUrl, runSystemHealthChecks, type HealthCheck } from "../lib/health";
import { ORG_STORAGE_BUCKET_SQL, ORG_STORAGE_POLICIES_SQL } from "../lib/storage";
import { useOrganization } from "../contexts/OrganizationContext";

export function SystemHealthPanel() {
  const { canWrite, activeMembership } = useOrganization();
  const [checks, setChecks] = useState<HealthCheck[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const organizationId = activeMembership?.organizationId;

  async function refresh() {
    setRefreshing(true);
    try {
      const results = await runSystemHealthChecks(organizationId);
      setChecks(canWrite ? results : results.filter((check) => check.id !== "storage"));
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [organizationId, canWrite]);

  const allOk = checks?.every((check) => check.ok) ?? false;
  const storageCheck = checks?.find((check) => check.id === "storage");
  const showStorageSql = canWrite && storageCheck && !storageCheck.ok;

  return (
    <article className="card system-health-panel">
      <div className="system-health-panel__head">
        <p className="label">System status</p>
        <button className="secondary" disabled={refreshing} onClick={() => void refresh()} type="button">
          {refreshing ? "Checking…" : "Refresh"}
        </button>
      </div>
      {checks === null ? (
        <p className="muted small">Checking connection…</p>
      ) : (
        <>
          <ul className="system-health-list">
            {checks.map((check) => (
              <li key={check.id} className={check.ok ? "is-ok" : "is-error"}>
                <span className="system-health-marker" aria-hidden="true">
                  {check.ok ? "✓" : "✗"}
                </span>
                <div>
                  <strong>{check.label}</strong>
                  <p className="muted small">{check.detail}</p>
                  {!check.ok && check.fixHref && (
                    <p className="small">
                      <a href={check.fixHref} rel="noreferrer" target="_blank">
                        {check.fixLabel}
                      </a>
                      {check.id === "storage" && (
                        <>
                          {" "}
                          ·{" "}
                          <a href={getStorageSetupSqlUrl()} rel="noreferrer" target="_blank">
                            SQL Editor
                          </a>
                        </>
                      )}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {!allOk && showStorageSql && (
            <details className="system-health-sql">
              <summary>Storage setup SQL</summary>
              <p className="muted small">Run Step A if the bucket is missing; run Step B if uploads fail with permission errors.</p>
              <pre>{ORG_STORAGE_BUCKET_SQL}</pre>
              <pre>{ORG_STORAGE_POLICIES_SQL}</pre>
            </details>
          )}
        </>
      )}
    </article>
  );
}
