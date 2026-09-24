// Faculty Register's "Faculty Timeline" tab (src/app/(dashboard)/hod/faculty/
// timeline/page.tsx) - pure functions, no Firestore/React, so the single
// source of truth for "did this faculty member match X during this date
// range" lives in one place instead of being re-derived per filter mode.
import { FACULTY_STATUS_DATE_FIELD, FACULTY_STATUS_DATE_LABELS } from "@/types";
import type { FacultyStatus, FacultyStatusDateField } from "@/types";

// A stored date can be a Firestore Timestamp (has .toDate), the REST API's
// plain {_seconds}/{seconds} shape, or an ISO/date string, depending on where
// it was read from - handles all three, same shapes fmtDate() on the Faculty
// Register pages already tolerates. Exported so the Timeline page's date
// pickers can compute their own min/max bounds (e.g. the earliest Date of
// Joining on record) from the same parsing this file's own filters use -
// never a second, possibly-diverging implementation.
export function toDate(val: unknown): Date | null {
  if (!val) return null;
  if (typeof val === "string") {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const ts = val as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof ts.toDate === "function") return ts.toDate();
  const secs = ts._seconds ?? ts.seconds;
  return typeof secs === "number" ? new Date(secs * 1000) : null;
}

// Whether a single stored date falls within [fromISO, toISO] (either bound
// may be "" - an open end on that side).
function pointInRange(val: unknown, fromISO: string, toISO: string): boolean {
  const d = toDate(val);
  if (!d) return false;
  const from = fromISO ? new Date(fromISO) : null;
  const to = toISO ? new Date(toISO) : null;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export interface FacultyTimelineFacts {
  status?: FacultyStatus | string;
  joiningDate?: unknown;
  resignedDate?: unknown;
  retiredDate?: unknown;
  retainershipDate?: unknown;
}

// Whether this faculty member's active-tenure window overlaps [fromISO, toISO].
// The window starts at Date of Joining and ends at whichever status-date field
// matches their CURRENT status (FACULTY_STATUS_DATE_FIELD - Resigned/Retired/
// Retainership each close it; moving into Retainership closes it too, by
// design, even though Retainership still counts as "active" for
// teaching-assignment purposes elsewhere in the app), or stays open (ongoing,
// counts through today) for every other status. INTERVIEW_DONE never matches
// - they haven't actually joined yet, so there is no real window to overlap.
export function facultyActiveDuringRange(f: FacultyTimelineFacts, fromISO: string, toISO: string): boolean {
  if (f.status === "INTERVIEW_DONE") return false;
  const start = toDate(f.joiningDate);
  if (!start) return false;

  const dateField = f.status ? FACULTY_STATUS_DATE_FIELD[f.status as FacultyStatus] : undefined;
  const end = dateField ? toDate((f as Record<string, unknown>)[dateField]) : null;

  const from = fromISO ? new Date(fromISO) : null;
  const to = toISO ? new Date(toISO) : null;

  if (to && start > to) return false;
  if (from && end && end < from) return false;
  return true;
}

// The Faculty Timeline tab's 5 mutually-exclusive filter modes - "active"
// asks an interval-overlap question (facultyActiveDuringRange above); the
// other four each ask a plain "did this one stored date fall in the range"
// question (pointInRange), reading the exact same fields the Add/Edit
// forms write (FACULTY_STATUS_DATE_FIELD) plus joiningDate. A person's
// Resigned/Retired/Retainership date is checked regardless of their CURRENT
// status (never auto-cleared, see FACULTY_STATUS_DATE_FIELD's own
// doc-comment) - this is a historical-events view, not a live-status one.
export const TIMELINE_FILTER_MODES = [
  "activeDuring", "joinedDuring", "resignedDuring", "retiredDuring", "retainershipDuring",
] as const;
export type TimelineFilterMode = (typeof TIMELINE_FILTER_MODES)[number];

export const TIMELINE_FILTER_LABELS: Record<TimelineFilterMode, string> = {
  activeDuring: "Active during period",
  joinedDuring: "Joined during period",
  resignedDuring: "Resigned during period",
  retiredDuring: "Retired during period",
  retainershipDuring: "Entered Retainership during period",
};

// Which stored date each mode reads (undefined for "activeDuring", which
// reads joiningDate + the status-matched date instead of a single field) -
// used by the Timeline page to render "the date that matched" per row.
export const TIMELINE_FILTER_DATE_FIELD: Partial<Record<TimelineFilterMode, "joiningDate" | FacultyStatusDateField>> = {
  joinedDuring: "joiningDate",
  resignedDuring: "resignedDate",
  retiredDuring: "retiredDate",
  retainershipDuring: "retainershipDate",
};

export const TIMELINE_FILTER_DATE_LABEL: Record<TimelineFilterMode, string> = {
  activeDuring: "Active Period",
  joinedDuring: "Date of Joining",
  resignedDuring: FACULTY_STATUS_DATE_LABELS.resignedDate,
  retiredDuring: FACULTY_STATUS_DATE_LABELS.retiredDate,
  retainershipDuring: FACULTY_STATUS_DATE_LABELS.retainershipDate,
};

export function facultyMatchesTimelineFilter(
  f: FacultyTimelineFacts, mode: TimelineFilterMode, fromISO: string, toISO: string
): boolean {
  if (mode === "activeDuring") return facultyActiveDuringRange(f, fromISO, toISO);
  const dateField = TIMELINE_FILTER_DATE_FIELD[mode];
  return dateField ? pointInRange((f as Record<string, unknown>)[dateField], fromISO, toISO) : false;
}
