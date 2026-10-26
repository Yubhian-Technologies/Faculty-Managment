"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowUp, ArrowDown, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toDate } from "@/lib/utils";
import { allPreviousExperienceEntries, experienceBreakdown } from "@/lib/faculty/experienceCalc";
import { compareDefaultFacultyOrder } from "@/lib/faculty/listOrder";
import { DESIGNATION_LABELS } from "@/types";

// The HOD Faculty register's filter row (Gender / Qualification / Designation / Status pills and the
// Date of Joining / Experience sort arrows), as one reusable piece for the Principal, Vice Principal
// and Management faculty lists. Everything is worked out from the rows the page already loaded.

type Row = Record<string, unknown>;

const ALL = "__all";
const GENDER_OPTIONS = ["Male", "Female"];

// "Inactive" is anyone no longer working here (Resigned or Retired); Ratified / Non-Ratified read the
// ratification status.
const STATUS_OPTIONS = [
  { key: "INTERVIEW_DONE", label: "Interview Done" },
  { key: "ACTIVE", label: "Active" },
  { key: "INACTIVE", label: "Inactive" },
  { key: "RATIFIED", label: "Ratified" },
  { key: "NOT_RATIFIED", label: "Non-Ratified" },
  { key: "RETAINERSHIP", label: "Retainership" },
  { key: "ON_LEAVE", label: "On Leave" },
  { key: "RESIGNED", label: "Resigned" },
  { key: "RETIRED", label: "Retired" },
];

function matchesStatus(f: Row, key: string): boolean {
  if (!key) return true;
  const status = f.status as string | undefined;
  if (key === "INACTIVE") return status === "RESIGNED" || status === "RETIRED";
  if (key === "RATIFIED") return f.ratificationStatus === "Ratified";
  if (key === "NOT_RATIFIED") return f.ratificationStatus === "Not Ratified";
  return status === key;
}

function joiningMillis(f: Row): number {
  return toDate(f.joiningDate as Parameters<typeof toDate>[0])?.getTime() ?? 0;
}

function experienceYears(f: Row): number {
  return experienceBreakdown(
    allPreviousExperienceEntries(f.academicProfile as Parameters<typeof allPreviousExperienceEntries>[0]),
    f.joiningDate as Parameters<typeof experienceBreakdown>[1],
  ).total;
}

type SortState = { key: "joining" | "experience"; dir: "desc" | "asc" } | null;

// Off: a dropdown pill - pick a value and it turns blue (on, combined with the other blue ones).
// On: a blue pill showing the choice; touch it to turn that one filter off.
export function FilterSelect({ label, allLabel, value, options, onChange }: {
  label: string;
  allLabel: string;
  value: string;
  options: { key: string; label: string }[];
  onChange: (value: string) => void;
}) {
  if (value) {
    return (
      <button
        type="button"
        title={`Turn off ${label} filter`}
        aria-label={`${label}: ${options.find((o) => o.key === value)?.label ?? value} - turn off`}
        onClick={() => onChange("")}
        className="flex h-9 items-center gap-2 rounded-full border border-primary bg-primary px-3 text-sm text-primary-foreground"
      >
        {options.find((o) => o.key === value)?.label ?? value}
        <X className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <Select value="" onValueChange={(v) => onChange(v === ALL ? "" : v)}>
      <SelectTrigger className="h-9 w-auto min-w-[8.5rem] gap-2 rounded-full text-sm" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// Up arrow = high to low, down arrow = low to high; clicking the lit arrow again clears the sort.
export function SortPill({ label, active, onChange }: { label: string; active: "desc" | "asc" | null; onChange: (dir: "desc" | "asc" | null) => void }) {
  const arrow = (dir: "desc" | "asc", Icon: typeof ArrowUp, title: string) => (
    <button
      type="button"
      title={title}
      aria-label={`${label}: ${title}`}
      aria-pressed={active === dir}
      onClick={() => onChange(active === dir ? null : dir)}
      className={`rounded p-0.5 transition-colors ${active === dir ? "bg-white text-primary" : active ? "text-primary-foreground/80 hover:bg-white/20" : "text-muted-foreground hover:bg-muted"}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
  return (
    <div className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}>
      <span>{label}</span>
      {arrow("desc", ArrowUp, "High to low")}
      {arrow("asc", ArrowDown, "Low to high")}
    </div>
  );
}

/**
 * Filters + sort for a loaded faculty list. `rows` is the filtered, sorted list to show; `bar` is the
 * pill row to render above the table. With nothing picked the list is ordered most experience first
 * (as on the HOD register) unless `keepOrderWhenUnsorted` is set, which leaves the incoming order.
 * `showStatus: false` for pages that already have their own status tabs.
 */
export function useFacultyListFilters<T extends Row>(
  faculty: T[],
  opts: { showStatus?: boolean; keepOrderWhenUnsorted?: boolean; leading?: ReactNode } = {},
): { rows: T[]; bar: ReactNode; filtersApplied: boolean } {
  const { showStatus = true, keepOrderWhenUnsorted = false, leading } = opts;
  const [statusFilter, setStatusFilter] = useState("");
  const [genderFilter, setGenderFilter] = useState("");
  const [qualFilter, setQualFilter] = useState("");
  const [designationFilter, setDesignationFilter] = useState("");
  const [sort, setSort] = useState<SortState>(null);

  const qualificationOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const f of faculty) {
      const q = (f.highestQualification as string | undefined)?.trim();
      if (q && !byKey.has(q.toLowerCase())) byKey.set(q.toLowerCase(), q);
    }
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b)).map((q) => ({ key: q, label: q }));
  }, [faculty]);
  const activeQual = qualificationOptions.some((o) => o.key.toLowerCase() === qualFilter.toLowerCase()) ? qualFilter : "";

  // Only the designations the list actually holds (stored value -> display label).
  const designationOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const f of faculty) {
      const d = (f.designation as string | undefined)?.trim();
      if (d && !byKey.has(d)) byKey.set(d, DESIGNATION_LABELS[d] ?? d);
    }
    return Array.from(byKey, ([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [faculty]);
  const activeDesignation = designationOptions.some((o) => o.key === designationFilter) ? designationFilter : "";

  const rows = useMemo(() => {
    const filtered = faculty.filter((f) =>
      (!showStatus || matchesStatus(f, statusFilter)) &&
      (!genderFilter || f.gender === genderFilter) &&
      (!activeQual || (f.highestQualification as string | undefined)?.trim().toLowerCase() === activeQual.toLowerCase()) &&
      (!activeDesignation || (f.designation as string | undefined)?.trim() === activeDesignation)
    );
    if (!sort && keepOrderWhenUnsorted) return filtered;
    // Nothing picked: HOD, then Principal, then internal experience, highest first (lib/faculty/listOrder.ts).
    if (!sort) return [...filtered].sort(compareDefaultFacultyOrder);
    const eff = sort;
    const value = eff.key === "joining" ? joiningMillis : experienceYears;
    // Up arrow ("desc") = the most senior first for both columns: the most experience, and so the
    // earliest Date of Joining. Down arrow ("asc") is the reverse.
    const sign = (eff.dir === "desc" ? -1 : 1) * (eff.key === "joining" ? -1 : 1);
    // A person with no value (no joining date / no experience) always goes last, in either direction.
    return [...filtered].sort((a, b) => {
      const va = value(a), vb = value(b);
      if (!va || !vb) return (va ? 0 : 1) - (vb ? 0 : 1);
      return sign * (va - vb);
    });
  }, [faculty, showStatus, statusFilter, genderFilter, activeQual, activeDesignation, sort, keepOrderWhenUnsorted]);

  const filtersApplied = (showStatus && !!statusFilter) || !!genderFilter || !!activeQual || !!activeDesignation || !!sort;

  const bar = (
    <div className="flex gap-2 flex-wrap items-center">
      {leading}
      <button
        type="button"
        onClick={() => { setStatusFilter(""); setGenderFilter(""); setQualFilter(""); setDesignationFilter(""); setSort(null); }}
        className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${!filtersApplied ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"}`}
      >
        All
      </button>
      <FilterSelect label="Gender" allLabel="All Genders" value={genderFilter} options={GENDER_OPTIONS.map((g) => ({ key: g, label: g }))} onChange={setGenderFilter} />
      <FilterSelect label="Qualification" allLabel="All Qualifications" value={activeQual} options={qualificationOptions} onChange={setQualFilter} />
      <FilterSelect label="Designation" allLabel="All Designations" value={activeDesignation} options={designationOptions} onChange={setDesignationFilter} />
      <SortPill label="Date of Joining" active={sort?.key === "joining" ? sort.dir : null} onChange={(dir) => setSort(dir ? { key: "joining", dir } : null)} />
      <SortPill label="Experience" active={sort?.key === "experience" ? sort.dir : null} onChange={(dir) => setSort(dir ? { key: "experience", dir } : null)} />
      {showStatus && (
        <FilterSelect label="Status" allLabel="All Statuses" value={statusFilter} options={STATUS_OPTIONS} onChange={setStatusFilter} />
      )}
    </div>
  );

  return { rows, bar, filtersApplied };
}
