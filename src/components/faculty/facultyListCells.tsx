import { Badge } from "@/components/ui/badge";
import { allPreviousExperienceEntries, totalYearsOfExperience } from "@/lib/faculty/experienceCalc";
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
  return status === "INTERVIEW_DONE" ? "Expected to join" : "Joined";
}

/** "Joined: 02 Apr 2026" / "Expected to join: 01 Jul 2026". */
export function JoiningLine({ row, className = "text-xs text-muted-foreground" }: { row: FacultyListRow; className?: string }) {
  return <p className={className}>{joiningLabel(row.status)}: {fmtDate(row.joiningDate)}</p>;
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
      {row.academicProfile?.phdDetails?.status === "AWARDED" && (
        <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">Ph.D</span>
      )}
    </div>
  );
}

/** Total / internal / external years of experience, computed live. */
export function FacultyExperienceCell({ row }: { row: FacultyListRow }) {
  // Computed live from Date of Joining + the Academic/Industry/Research
  // Experience entries - the same canonical calc as the Faculty Details page
  // (FacultyProfileHub), not the stored (and only periodically re-saved)
  // totalYearsOfExperience field.
  const previousExperienceEntries = allPreviousExperienceEntries(row.academicProfile);
  const totalYears = totalYearsOfExperience(previousExperienceEntries, row.joiningDate).years;
  const internalYears = totalYearsOfExperience(undefined, row.joiningDate).years;
  const externalYears = totalYearsOfExperience(previousExperienceEntries, undefined).years;
  return (
    <div className="space-y-0.5">
      <p className="text-sm font-medium">{totalYears} yrs</p>
      {row.joiningDate != null && (
        <p className="text-xs text-muted-foreground">Int: {internalYears} · Ext: {externalYears}</p>
      )}
    </div>
  );
}

/** Status badge with the ratification status under it. */
export function FacultyStatusCell({ row }: { row: FacultyListRow }) {
  const ratification = row.ratificationStatus as string | undefined;
  return (
    <div className="space-y-1">
      <Badge variant={FACULTY_STATUS_VARIANTS[row.status as FacultyStatus] ?? "secondary"}>
        {FACULTY_STATUS_LABELS[row.status as FacultyStatus] ?? (row.status as string)}
      </Badge>
      {ratification && (
        // "Ratified" / "Not Ratified" are the two statuses the app writes. A
        // stray stored value (one live record holds "Not Applicable") is shown
        // as-is but neutral, rather than styled as a pending ratification.
        <p className={`text-[10px] font-medium ${
          ratification === "Ratified" ? "text-green-600" : ratification === "Not Ratified" ? "text-amber-600" : "text-muted-foreground"
        }`}>
          {ratification}
        </p>
      )}
    </div>
  );
}
