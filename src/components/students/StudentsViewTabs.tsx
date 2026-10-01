"use client";

// The one tab strip every Students page uses (College Office, Principal, HOD).
// Pill size, spacing, typography and radius live here only, so switching tabs
// can change nothing but which pill is active.

interface StudentsViewTabsProps<K extends string> {
  tabs: readonly { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
}

export function StudentsViewTabs<K extends string>({ tabs, value, onChange }: StudentsViewTabsProps<K>) {
  return (
    <div className="flex shrink-0 items-center gap-1.5" role="tablist" aria-label="Students views">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            value === t.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
