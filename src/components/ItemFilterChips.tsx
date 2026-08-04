export type ItemFilterOption<T extends string> = {
  value: T;
  label: string;
  count?: number;
};

export function ItemFilterChips<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ItemFilterOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="item-filter-chips" role="tablist" aria-label="Filter items">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={`item-filter-chip${value === option.value ? " is-selected" : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined ? ` (${option.count})` : ""}
        </button>
      ))}
    </div>
  );
}

export function LifecycleBadge({ lifecycle }: { lifecycle: "new" | "expired" }) {
  return (
    <span className={`badge lifecycle-badge lifecycle-badge--${lifecycle}`}>
      {lifecycle === "new" ? "New" : "Expired"}
    </span>
  );
}
