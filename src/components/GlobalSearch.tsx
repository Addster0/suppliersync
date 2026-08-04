import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { searchOrganization } from "../api/vendors";
import {
  clampSearchQuery,
  filterAndRankVendors,
  MAX_SEARCH_QUERY_LENGTH,
  normalizeSearchQuery,
  vendorToSearchResult,
} from "../lib/search";
import type { SearchResult, Vendor } from "../types";

export function GlobalSearch({
  organizationId,
  vendors,
  onSelectVendor,
  onQueryChange,
}: {
  organizationId: string;
  vendors: Vendor[];
  onSelectVendor: (vendorId: string) => void;
  onQueryChange?: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [remoteResults, setRemoteResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const localVendorResults = useMemo(() => {
    const q = normalizeSearchQuery(query);
    if (q.length < 1) return [];
    return filterAndRankVendors(vendors, q).slice(0, 8).map(vendorToSearchResult);
  }, [query, vendors]);

  const remoteWithoutDuplicateVendors = useMemo(() => {
    const localVendorIds = new Set(localVendorResults.map((result) => result.vendorId));
    return remoteResults.filter(
      (result) => result.entityType !== "vendor" || !localVendorIds.has(result.vendorId)
    );
  }, [remoteResults, localVendorResults]);

  const results = useMemo(
    () => [...localVendorResults, ...remoteWithoutDuplicateVendors],
    [localVendorResults, remoteWithoutDuplicateVendors]
  );

  useEffect(() => {
    onQueryChange?.(query);
  }, [query, onQueryChange]);

  useEffect(() => {
    const trimmed = clampSearchQuery(query);
    if (trimmed.length < 2) {
      setRemoteResults([]);
      setError("");
      return;
    }

    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const data = await searchOrganization(organizationId, trimmed);
        setRemoteResults(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Search failed.";
        const hasLocalMatches = filterAndRankVendors(vendors, trimmed).length > 0;
        setError(hasLocalMatches ? "" : message);
        setRemoteResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [query, organizationId]);

  function pickVendor(vendorId: string) {
    onSelectVendor(vendorId);
    setQuery("");
    setRemoteResults([]);
    onQueryChange?.("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const bestVendor = localVendorResults[0] ?? results.find((result) => result.entityType === "vendor");
    if (bestVendor) pickVendor(bestVendor.vendorId);
  }

  const trimmed = query.trim();
  const showEmpty = trimmed.length >= 1 && !loading && results.length === 0 && !error;

  return (
    <div className="global-search card">
      <p className="label">Search workspace</p>
      <input
        type="search"
        placeholder="Vendor name (e.g. Northstar)…"
        value={query}
        maxLength={MAX_SEARCH_QUERY_LENGTH}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Search vendors and workspace records"
      />
      <p className="muted small global-search-hint">Type a vendor name — matching vendors appear instantly. Press Enter to open the top match.</p>
      {loading && trimmed.length >= 2 && <p className="muted small">Searching contacts, contracts, and documents…</p>}
      {error && <p className="form-error">{error}</p>}
      {results.length > 0 && (
        <ul className="search-results">
          {results.map((result) => (
            <li key={`${result.entityType}-${result.entityId}`}>
              <button
                type="button"
                className="search-result-button"
                onClick={() => pickVendor(result.vendorId)}
              >
                <span className={`search-result-type search-result-type--${result.entityType}`}>
                  {result.entityType}
                </span>
                <strong>{result.title}</strong>
                <span className="muted small">
                  {result.entityType === "vendor" ? result.subtitle : result.vendorName}
                  {result.entityType !== "vendor" && result.subtitle ? ` · ${result.subtitle}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {showEmpty && <p className="muted small">No vendors or records match &ldquo;{trimmed}&rdquo;.</p>}
    </div>
  );
}
