import type { Firestore } from "firebase-admin/firestore";
import { defaultPeriodTimings } from "@/lib/timetable/buildGrid";
import type { CourseYearTiming, FacultyAssignmentRequest, PeriodTiming } from "@/types";

// A lending department's busyPeriods declaration (see
// FacultyAssignmentRequest.busyPeriods) never becomes a real TimetableSlot, so
// every path that writes a placement into a section has to consult it
// explicitly: the draft editor (via loadTimetableContext), publish, and the
// manual pin route. This is the one place that turns a declaration into
// "DAY:period" cells in the REQUESTING section's own period numbering.

type BusyEntry = { day: string; period: number; year?: number };

const toMinutes = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const periodsOf = (timing: CourseYearTiming): PeriodTiming[] =>
  timing.periods && timing.periods.length > 0 ? timing.periods : defaultPeriodTimings(timing);

/**
 * Expands one request's declared-busy entries into cells of the requesting
 * section's own period numbering. An entry with no `year` (declared before
 * years were stored) or for the section's own year is used as-is. An entry
 * declared against a DIFFERENT year is mapped by clock time - P3 of one year
 * is not the same hour as P3 of another - onto every section period it
 * overlaps; when either year's timing is unknown it falls back to the same
 * period number, the pre-existing behaviour.
 */
export function expandDeclaredBusy(
  busyPeriods: BusyEntry[] | undefined,
  sectionYear: number,
  sectionTiming: CourseYearTiming | null,
  timingForYear: (year: number) => CourseYearTiming | null,
): Set<string> {
  const cells = new Set<string>();
  for (const bp of busyPeriods ?? []) {
    const sameNumber = () => cells.add(`${bp.day}:${bp.period}`);
    if (bp.year == null || Number(bp.year) === Number(sectionYear) || !sectionTiming) { sameNumber(); continue; }
    const srcTiming = timingForYear(Number(bp.year));
    const src = srcTiming ? periodsOf(srcTiming).find((p) => p.period === bp.period) : undefined;
    const srcStart = src ? toMinutes(src.startTime) : null;
    const srcEnd = src ? toMinutes(src.endTime) : null;
    if (srcStart == null || srcEnd == null) { sameNumber(); continue; }
    for (const p of periodsOf(sectionTiming)) {
      const start = toMinutes(p.startTime);
      const end = toMinutes(p.endTime);
      if (start == null || end == null) continue;
      if (start < srcEnd && srcStart < end) cells.add(`${bp.day}:${p.period}`);
    }
  }
  return cells;
}

/** facultyId -> declared-busy cells, for one section's ALLOCATED requests. */
export function declaredBusyByFaculty(
  requests: Pick<FacultyAssignmentRequest, "allocatedFacultyId" | "busyPeriods">[],
  sectionYear: number,
  sectionTiming: CourseYearTiming | null,
  timingForYear: (year: number) => CourseYearTiming | null,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const req of requests) {
    if (!req.allocatedFacultyId || !req.busyPeriods?.length) continue;
    const cells = expandDeclaredBusy(req.busyPeriods, sectionYear, sectionTiming, timingForYear);
    const existing = out.get(req.allocatedFacultyId) ?? new Set<string>();
    for (const c of cells) existing.add(c);
    out.set(req.allocatedFacultyId, existing);
  }
  return out;
}

/**
 * Standalone loader for routes that don't build a full TimetableContext
 * (publish, the manual pin route). Fetches only the timings it needs.
 */
export async function loadDeclaredBusyForSection(
  db: Firestore,
  collegeId: string,
  section: { id: string; courseId: string; year: number },
): Promise<Map<string, Set<string>>> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const reqSnap = await collegeRef.collection("facultyAssignmentRequests")
    .where("sectionId", "==", section.id).where("status", "==", "ALLOCATED").get();
  const requests = reqSnap.docs.map((d) => d.data() as FacultyAssignmentRequest).filter((r) => r.busyPeriods?.length);
  if (requests.length === 0) return new Map();

  const years = new Set<number>([Number(section.year)]);
  for (const r of requests) for (const bp of r.busyPeriods ?? []) if (bp.year != null) years.add(Number(bp.year));
  const timings = new Map<number, CourseYearTiming | null>();
  await Promise.all(Array.from(years).map(async (y) => {
    const snap = await collegeRef.collection("courseYearTimings").doc(`${section.courseId}_year${y}`).get();
    timings.set(y, snap.exists ? (snap.data() as CourseYearTiming) : null);
  }));
  return declaredBusyByFaculty(requests, Number(section.year), timings.get(Number(section.year)) ?? null, (y) => timings.get(y) ?? null);
}

/** Landing page a requester should be sent to, by their own role - the requester can be an HOD or a Timetable Incharge. */
export function requesterTimetableLink(
  role: string | undefined,
  r: { courseId: string; year: number; sectionId: string },
): string {
  const tail = `${r.courseId}/${r.year}/${r.sectionId}`;
  if (role === "PANEL_MEMBER") return `/panel/timetable-incharge/${tail}`;
  if (role === "COLLEGE_STAFF") return `/college-staff/timetable-incharge/${tail}`;
  return `/hod/timetable/${tail}`;
}

export function requesterRequestsLink(role: string | undefined): string {
  if (role === "PANEL_MEMBER") return "/panel/assignment-requests";
  if (role === "COLLEGE_STAFF") return "/college-staff/assignment-requests";
  return "/hod/assignment-requests";
}

/** The requester's role, read from their college profile; undefined when it can't be resolved (callers fall back to the HOD paths). */
export async function loadUserRole(db: Firestore, collegeId: string, uid: string): Promise<string | undefined> {
  const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
  const d = snap.data() as { role?: string; realRole?: string } | undefined;
  return d?.realRole ?? d?.role;
}
