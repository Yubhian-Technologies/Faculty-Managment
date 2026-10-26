import { Badge } from "@/components/ui/badge";
import { allPreviousExperienceEntries, formatDurationList, totalYearsOfExperience } from "@/lib/faculty/experienceCalc";
import { researchAreaList } from "@/lib/faculty/researchAreas";
import { DESIGNATION_LABELS, FACULTY_STATUS_LABELS } from "@/types";
import type { Designation, FacultyMember, FacultyStatus } from "@/types";

// Row renderers for the Faculty Register tables. The HOD list
// (hod/faculty/page.tsx) and the Principal/College Admin department list
// (principal/faculty/[deptId]/page.tsx) both render their faculty rows through
// these, so a column shows the same fields, formatted the same way, for both -
// there is no second copy to drift.
//
// Every value is read straight from the facultyMembers document the API
// returns (the full record, identical for every role - see college/faculty
// GET); nothing here is stored or derived anywhere else.

export type FacultyListRow = Record<string, unknown> & FacultyMember;

export const FACULTY_STATUS_VARIANTS: Record<FacultyStatus, "default" | "secondary" | "outline" | "destructive"> = {
  INTERVIEW_DONE: "outline",
  ACTIVE: "default",
  ON_LEAVE: "outline",
  RESIGNED: "secondary",
  RETIRED: "secondary",
  RETAINERSHIP: "default",
};

/** A Firestore Timestamp in any of the shapes it reaches the browser in -> "02 Apr 2026", or "-". */
export function fmtDate(val: unknown): string {
  if (!val) return "-";
  try {
    const ts = val as { toDate?: () => Date; seconds?: number; _seconds?: number } | null;
    const d = typeof ts?.toDate === "function"
      ? ts.toDate()
      : ts?._seconds != null
        ? new Date(ts._seconds * 1000)
        : ts?.seconds != null
          ? new Date(ts.seconds * 1000)
          : null;
    if (!d || isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return "-"; }
}

// INTERVIEW_DONE faculty haven't actually joined yet - their joiningDate is the
// proposed date from the offer letter, so it reads as an expectation, not a fact.
export function joiningLabel(status: unknown): string {
  return status === "INTERVIEW_DONE" ? "Expected to join" : "DOJ";
}

/** "DOJ: 02 Apr 2026" / "Expected to join: 01 Jul 2026". */
export function JoiningLine({ row, className = "text-xs text-muted-foreground" }: { row: FacultyListRow; className?: string }) {
  return <p className={className}>{joiningLabel(row.status)}: {fmtDate(row.joiningDate)}</p>;
}

/** The positions this person holds ("HOD of CSE", "Principal"), when the list asked for them (`?withSeats=1`). */
export function SeatBadges({ row }: { row: FacultyListRow }) {
  const labels = Array.isArray(row.seatLabels) ? (row.seatLabels as string[]) : [];
  if (labels.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 pt-0.5">
      {labels.map((l) => (
        <span key={l} className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">{l}</span>
      ))}
    </div>
  );
}

/** Under a faculty member's designation: their research areas, the ones the filter matched highlighted. Shown only while the filter is on. */
export function ResearchMatchChips({ row }: { row: FacultyListRow }) {
  const matched = Array.isArray(row.researchMatches) ? (row.researchMatches as string[]) : [];
  if (matched.length === 0) return null;
  const all = researchAreaList(row);
  const rest = all.filter((a) => !matched.includes(a));
  const shown = [...matched, ...rest].slice(0, 6);
  return (
    <div className="flex flex-wrap items-center gap-1 pt-1" data-testid="research-chips">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Research:</span>
      {shown.map((a) => (
        <span
          key={a}
          className={matched.includes(a)
            ? "inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900"
            : "inline-flex items-center rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"}
        >
          {a}
        </span>
      ))}
      {all.length > shown.length && <span className="text-[10px] text-muted-foreground">+{all.length - shown.length} more</span>}
    </div>
  );
}

/** Designation, highest qualification, specialization and the Ph.D (awarded) badge. */
export function FacultyDesignationCell({ row }: { row: FacultyListRow }) {
  return (
    <div className="space-y-0.5">
      <p className="text-sm font-medium">{DESIGNATION_LABELS[row.designation as Designation] ?? (row.designation as string)}</p>
      <p className="text-xs text-muted-foreground">{row.highestQualification as string}</p>
      {(row.specialization as string) && (
        <p className="text-xs text-muted-foreground italic">{row.specialization as string}</p>
      )}
      <SeatBadges row={row} />
      <ResearchMatchChips row={row} />
      {row.academicProfile?.phdDetails?.status === "AWARDED" && (
        <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">Ph.D</span>
      )}
    </div>
  );
}

/**
 * Total / Internal / External experience as three colour-coded lines, each "x yrs, y mos, z days" with zero units left out,
 * computed live. Same three numbers, from the same calculation, as the Experience facts on the faculty profile page.
 */
export function FacultyExperienceCell({ row }: { row: FacultyListRow }) {
  // Computed live from Date of Joining + the Academic/Industry/Research
  // Experience entries - the same canonical calc as the Faculty Details page
  // (FacultyProfileHub), not the stored (and only periodically re-saved)
  // totalYearsOfExperience field.
  const previousExperienceEntries = allPreviousExperienceEntries(row.academicProfile);
  const total = totalYearsOfExperience(previousExperienceEntries, row.joiningDate);
  const internal = row.joiningDate != null ? totalYearsOfExperience(undefined, row.joiningDate) : null; // unknown without a joining date
  const external = totalYearsOfExperience(previousExperienceEntries, undefined);
  const none = (d: { years: number; months: number; days: number } | null) => !d || (d.years === 0 && d.months === 0 && d.days === 0);
  const lines = [
    { label: "Total:", value: formatDurationList(total), dot: "bg-primary", strong: true },
    { label: "Internal:", value: internal ? formatDurationList(internal) : "0", dot: "bg-emerald-500", strong: false, empty: none(internal) },
    { label: "External:", value: formatDurationList(external), dot: "bg-amber-500", strong: false, empty: none(external) },
  ];
  return (
    <dl className="grid grid-cols-[auto_auto_1fr] items-center gap-x-2 gap-y-1.5 whitespace-nowrap tabular-nums" data-testid="experience-cell">
      {lines.map((l) => (
        <div key={l.label} className="contents">
          <span className={`h-2 w-2 rounded-full ${l.dot}`} aria-hidden="true" />
          <dt className="text-[11px] font-medium text-muted-foreground">{l.label}</dt>
          <dd className={l.strong ? "text-sm font-semibold text-foreground" : `text-xs ${l.empty ? "text-muted-foreground" : "text-foreground/90"}`}>{l.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const PENDING_RATIFICATION = new Set(["Not Yet Attended", "Attended", "Not Ratified"]);

/** Status badge with the ratification status under it. */
export function FacultyStatusCell({ row }: { row: FacultyListRow }) {
  const ratification = row.ratificationStatus as string | undefined;
  return (
    <div className="space-y-1">
      <Badge variant={FACULTY_STATUS_VARIANTS[row.status as FacultyStatus] ?? "secondary"}>
        {FACULTY_STATUS_LABELS[row.status as FacultyStatus] ?? (row.status as string)}
      </Badge>
      {ratification && (
        // "Ratified" is green; the not-ratified ones (Not Yet Attended / Attended / Not Ratified)
        // are amber. A stray stored value (one live record holds "Not Applicable") is shown
        // as-is but neutral, rather than styled as a pending ratification.
        <p className={`text-[10px] font-medium ${
          ratification === "Ratified" ? "text-green-600" : PENDING_RATIFICATION.has(ratification) ? "text-amber-600" : "text-muted-foreground"
        }`}>
          {ratification}
        </p>
      )}
    </div>
  );
}
