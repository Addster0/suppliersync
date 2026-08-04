import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
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
  const [activeIndex, setActiveIndex] = useState(-1);

  const listboxId = useId();
  const statusId = useId();

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
    setActiveIndex(-1);
  }, [results]);

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
  }, [query, organizationId, vendors]);

  function pickVendor(vendorId: string) {
    onSelectVendor(vendorId);
    setQuery("");
    setRemoteResults([]);
    setActiveIndex(-1);
    onQueryChange?.("");
  }

  function pickResult(result: SearchResult) {
    pickVendor(result.vendorId);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      if (results.length === 0) return;
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      if (results.length === 0) return;
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }

    if (event.key === "Escape") {
      setQuery("");
      setRemoteResults([]);
      setActiveIndex(-1);
      onQueryChange?.("");
      return;
    }

    if (event.key !== "Enter") return;
    event.preventDefault();
    if (activeIndex >= 0 && results[activeIndex]) {
      pickResult(results[activeIndex]);
      return;
    }
    const bestVendor = localVendorResults[0] ?? results.find((result) => result.entityType === "vendor");
    if (bestVendor) pickVendor(bestVendor.vendorId);
  }

  const trimmed = query.trim();
  const showEmpty = trimmed.length >= 1 && !loading && results.length === 0 && !error;
  const listExpanded = results.length > 0;

  const statusMessage = loading && trimmed.length >= 2
    ? "Searching contacts, contracts, and documents…"
    : error
      ? error
      : showEmpty
        ? `No vendors or records match "${trimmed}".`
        : results.length > 0
          ? `${results.length} result${results.length === 1 ? "" : "s"} available. Use arrow keys to browse.`
          : "";

  return (
    <div className="global-search card">
      <label className="label" htmlFor={`${listboxId}-input`}>
        Search workspace
      </label>
      <input
        id={`${listboxId}-input`}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listExpanded}
        aria-controls={listExpanded ? listboxId : undefined}
        aria-activedescendant={
          listExpanded && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
        }
        aria-describedby={statusMessage ? statusId : undefined}
        placeholder="Vendor name (e.g. Northstar)…"
        value={query}
        maxLength={MAX_SEARCH_QUERY_LENGTH}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
      />
      <p className="muted small global-search-hint">
        Type a vendor name — matching vendors appear instantly. Press Enter to open the top match.
      </p>
      <p className="sr-only" id={statusId} role="status" aria-live="polite" aria-atomic="true">
        {statusMessage}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {results.length > 0 && (
        <ul className="search-results" id={listboxId} role="listbox" aria-label="Search results">
          {results.map((result, index) => (
            <li
              key={`${result.entityType}-${result.entityId}`}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
            >
              <button
                type="button"
                className={`search-result-button${index === activeIndex ? " is-active" : ""}`}
                onClick={() => pickResult(result)}
                onMouseEnter={() => setActiveIndex(index)}
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
      {showEmpty && (
        <p className="muted small" role="status" aria-live="polite">
          No vendors or records match &ldquo;{trimmed}&rdquo;.
        </p>
      )}
    </div>
  );
}
