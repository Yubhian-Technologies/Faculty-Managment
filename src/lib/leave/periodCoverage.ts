import type { Firestore } from "firebase-admin/firestore";
import { isTeachingDesignation } from "@/lib/designations/config";
import { resolveLoginUidForFacultyMember } from "@/lib/faculty/resolveFacultyMemberId";
import { notify } from "@/lib/notify";
import { enumerateWorkingDates, isoDateKey } from "@/lib/leave/dayCounter";
import type { CollegeType, DayOfWeek, FacultyMember, TimetableSlot } from "@/types";
import type { LeaveRequest, PeriodSubstitution } from "@/types/leave";

// ─────────────────────────────────────────────────────────────────────────────
// Bridges the Leave module to the Timetable module (see CLAUDE.md's "College
// Hiring Pipeline" note that these two are otherwise unconnected). Given a
// teaching faculty member and a leave date range, this resolves which of
// their TimetableSlots fall on working days in that range ("required
// periods"), and for each one, who in their own department is free to cover
// it (not already teaching that day/period anywhere, and not themselves on
// approved leave that date).
// ─────────────────────────────────────────────────────────────────────────────

function dayOfWeekFromDate(d: Date): DayOfWeek | null {
  const map: Record<number, DayOfWeek> = { 1: "MON", 2: "TUE", 3: "WED", 4: "THU", 5: "FRI", 6: "SAT" };
  return map[d.getDay()] ?? null; // Sunday (0) never appears - enumerateWorkingDates already excludes it
}

function isDateWithinLeave(req: LeaveRequest, dateISO: string): boolean {
  const from = (req.fromDate as unknown as { toDate(): Date }).toDate();
  const to = (req.toDate as unknown as { toDate(): Date }).toDate();
  return isoDateKey(from) <= dateISO && dateISO <= isoDateKey(to);
}

export interface RequiredPeriod {
  date: string;
  day: DayOfWeek;
  periodNumber: number;
  timetableSlotId: string;
  sectionId: string;
  sectionName?: string;
  courseId?: string;
  subjectId: string;
  subjectName: string;
}

export interface SubstituteCandidate {
  facultyId: string;
  facultyName: string;
}

export interface PeriodCoverageEntry extends RequiredPeriod {
  candidates: SubstituteCandidate[];
}

// Every TimetableSlot this faculty member teaches, expanded across the
// working dates of [fromDate, toDate]. Empty for a non-teaching requester
// (no slots) or a range that happens to fall entirely on non-working days.
async function resolveRequiredPeriods(
  db: Firestore,
  collegeId: string,
  facultyMemberId: string,
  fromDate: Date,
  toDate: Date,
  holidayDates: Set<string>
): Promise<RequiredPeriod[]> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const slotsSnap = await collegeRef.collection("timetableSlots").where("facultyId", "==", facultyMemberId).get();
  if (slotsSnap.empty) return [];
  const slots = slotsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as TimetableSlot);

  const slotsByDay = new Map<DayOfWeek, TimetableSlot[]>();
  for (const s of slots) {
    const arr = slotsByDay.get(s.day) ?? [];
    arr.push(s);
    slotsByDay.set(s.day, arr);
  }

  const workingDates = enumerateWorkingDates(fromDate, toDate, holidayDates);
  const required: RequiredPeriod[] = [];
  for (const date of workingDates) {
    const day = dayOfWeekFromDate(date);
    if (!day) continue;
    const daySlots = slotsByDay.get(day);
    if (!daySlots) continue;
    const dateISO = isoDateKey(date);
    for (const s of daySlots) {
      required.push({
        date: dateISO, day, periodNumber: s.periodNumber, timetableSlotId: s.id,
        sectionId: s.sectionId, courseId: s.courseId, subjectId: s.subjectId, subjectName: s.subjectName,
      });
    }
  }
  if (required.length === 0) return required;

  const sectionIds = Array.from(new Set(required.map((p) => p.sectionId)));
  const sectionSnaps = await Promise.all(sectionIds.map((id) => collegeRef.collection("sections").doc(id).get()));
  const sectionNameById = new Map(
    sectionSnaps.filter((s) => s.exists).map((s) => [s.id, (s.data() as { name?: string } | undefined)?.name])
  );
  for (const p of required) p.sectionName = sectionNameById.get(p.sectionId) ?? undefined;

  return required.sort((a, b) => (a.date === b.date ? a.periodNumber - b.periodNumber : a.date.localeCompare(b.date)));
}

// Resolves required periods plus, per period, which same-department teaching
// faculty (excluding the requester) are actually free to cover it - not
// already teaching that day/period in any section, and not themselves on
// approved leave that date. "Free" is evaluated fresh here (not cached from
// an earlier GET), so a pick made on the apply form can still be rejected at
// submission time if something changed in between (someone else got
// scheduled, or the candidate went on leave themselves).
export async function buildPeriodCoverage(
  db: Firestore,
  collegeId: string,
  facultyMemberId: string,
  department: string,
  fromDate: Date,
  toDate: Date,
  holidayDates: Set<string>
): Promise<PeriodCoverageEntry[]> {
  const required = await resolveRequiredPeriods(db, collegeId, facultyMemberId, fromDate, toDate, holidayDates);
  if (required.length === 0) return [];

  const collegeRef = db.collection("colleges").doc(collegeId);
  const [collegeSnap, deptFacultySnap, allSlotsSnap, leaveSnap] = await Promise.all([
    collegeRef.get(),
    collegeRef.collection("facultyMembers").where("department", "==", department).get(),
    collegeRef.collection("timetableSlots").get(),
    collegeRef.collection("leaveRequests").where("department", "==", department).where("status", "==", "APPROVED").get(),
  ]);

  const collegeType = (collegeSnap.data() as { type?: CollegeType } | undefined)?.type;
  const eligibleFaculty = deptFacultySnap.docs
    .filter((d) => d.id !== facultyMemberId)
    .map((d) => ({ id: d.id, ...d.data() }) as FacultyMember)
    .filter((f) => f.status === "ACTIVE" && isTeachingDesignation(f.designation, collegeType));

  const busyByDayPeriod = new Map<string, Set<string>>();
  for (const doc of allSlotsSnap.docs) {
    const s = doc.data() as TimetableSlot;
    const key = `${s.day}:${s.periodNumber}`;
    let set = busyByDayPeriod.get(key);
    if (!set) { set = new Set(); busyByDayPeriod.set(key, set); }
    set.add(s.facultyId);
  }

  const approvedLeaves = leaveSnap.docs.map((d) => d.data() as LeaveRequest);

  return required.map((period) => {
    const busyFacultyIds = busyByDayPeriod.get(`${period.day}:${period.periodNumber}`) ?? new Set<string>();
    const onLeaveUids = new Set(approvedLeaves.filter((r) => isDateWithinLeave(r, period.date)).map((r) => r.uid));
    const candidates = eligibleFaculty
      .filter((f) => !busyFacultyIds.has(f.id) && !(f.userUid && onLeaveUids.has(f.userUid)))
      .map((f) => ({ facultyId: f.id, facultyName: f.name }))
      .sort((a, b) => a.facultyName.localeCompare(b.facultyName));
    return { ...period, candidates };
  });
}

export interface PeriodSubstitutionInput {
  date: string;
  timetableSlotId: string;
  substituteFacultyId: string;
}

export type ValidatePeriodSubstitutionsResult =
  | { ok: true; resolved: PeriodSubstitution[] }
  | { ok: false; error: string };

// "FULL": every required period must have a submitted, valid pick (standard
// leave types - the requester's own submission, see applications/route.ts
// POST). "PARTIAL": submitted picks are optional and may cover any subset of
// the required periods (an "Other" request's HOD adjustment, see
// applications/[id]/route.ts PATCH) - anything not picked is simply left
// uncovered for the HOD/Principal to sort out manually.
export async function validatePeriodSubstitutions(params: {
  db: Firestore;
  collegeId: string;
  facultyMemberId: string;
  department: string;
  fromDate: Date;
  toDate: Date;
  holidayDates: Set<string>;
  submitted: PeriodSubstitutionInput[];
  mode: "FULL" | "PARTIAL";
}): Promise<ValidatePeriodSubstitutionsResult> {
  const { db, collegeId, facultyMemberId, department, fromDate, toDate, holidayDates, submitted, mode } = params;
  const coverage = await buildPeriodCoverage(db, collegeId, facultyMemberId, department, fromDate, toDate, holidayDates);

  if (mode === "FULL" && coverage.length > 0 && submitted.length !== coverage.length) {
    return { ok: false, error: `Select a substitute for all ${coverage.length} affected period(s) before submitting.` };
  }

  const byKey = new Map(coverage.map((p) => [`${p.date}|${p.timetableSlotId}`, p]));
  const resolved: PeriodSubstitution[] = [];
  const seenKeys = new Set<string>();
  for (const sub of submitted) {
    const key = `${sub.date}|${sub.timetableSlotId}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const period = byKey.get(key);
    if (!period) return { ok: false, error: "One of the selected periods is not part of this leave request." };
    const candidate = period.candidates.find((c) => c.facultyId === sub.substituteFacultyId);
    if (!candidate) {
      return {
        ok: false,
        error: `No eligible substitute matches your selection for ${period.subjectName} on ${period.date} (period ${period.periodNumber}) - they may already be teaching then or are on leave.`,
      };
    }
    resolved.push({
      date: period.date, day: period.day, periodNumber: period.periodNumber, timetableSlotId: period.timetableSlotId,
      sectionId: period.sectionId, sectionName: period.sectionName, courseId: period.courseId,
      subjectId: period.subjectId, subjectName: period.subjectName,
      substituteFacultyId: candidate.facultyId, substituteFacultyName: candidate.facultyName,
      assignedBy: mode === "FULL" ? "APPLICANT" : "HOD",
    });
  }

  if (mode === "FULL" && resolved.length !== coverage.length) {
    return { ok: false, error: "Select a substitute for every affected period before submitting." };
  }

  return { ok: true, resolved };
}

export interface DateSubstitution {
  timetableSlotId: string;
  day: DayOfWeek;
  periodNumber: number;
  sectionName?: string;
  subjectName: string;
  substituteFacultyId: string;
  substituteFacultyName: string;
  requesterUid: string;
  requesterName: string;
}

// Every PeriodSubstitution active on a specific date - i.e. from an APPROVED
// leave request whose periodSubstitutions include that exact date - across
// the whole college. Used by timetable read surfaces (section view, class
// leader view, a faculty's own Teaching Load grid) to show who's actually
// covering a period that day instead of the regular weekly assignment. Since
// a TimetableSlot only ever has one fixed weekday, a caller can key results
// by `timetableSlotId` to override "who teaches this" and/or filter by
// `substituteFacultyId` to find what a given faculty member is covering.
export async function getActiveSubstitutionsForDate(
  db: Firestore,
  collegeId: string,
  dateISO: string
): Promise<DateSubstitution[]> {
  const snap = await db.collection("colleges").doc(collegeId).collection("leaveRequests")
    .where("status", "==", "APPROVED").get();
  const out: DateSubstitution[] = [];
  for (const doc of snap.docs) {
    const r = doc.data() as LeaveRequest;
    if (!r.periodSubstitutions?.length) continue;
    for (const p of r.periodSubstitutions) {
      if (p.date !== dateISO) continue;
      out.push({
        timetableSlotId: p.timetableSlotId, day: p.day, periodNumber: p.periodNumber,
        sectionName: p.sectionName, subjectName: p.subjectName,
        substituteFacultyId: p.substituteFacultyId, substituteFacultyName: p.substituteFacultyName,
        requesterUid: r.uid, requesterName: r.employeeName,
      });
    }
  }
  return out;
}

// Notifies each assigned substitute once - called only when a leave request
// reaches a final APPROVED status (see applications/[id]/route.ts and
// decideFinalStage.ts), never on a tentative HOD forward that might still be
// rejected by the Principal.
export async function notifySubstitutes(db: Firestore, collegeId: string, req: LeaveRequest): Promise<void> {
  if (!req.periodSubstitutions?.length) return;

  const byFaculty = new Map<string, PeriodSubstitution[]>();
  for (const p of req.periodSubstitutions) {
    const arr = byFaculty.get(p.substituteFacultyId) ?? [];
    arr.push(p);
    byFaculty.set(p.substituteFacultyId, arr);
  }

  for (const [facultyId, periods] of byFaculty) {
    const uid = await resolveLoginUidForFacultyMember(db, collegeId, facultyId);
    if (!uid || uid === facultyId) continue; // not provisioned with a login yet - nothing to notify
    const shown = periods.slice(0, 3).map((p) => `${p.subjectName} (${p.day} P${p.periodNumber}, ${p.date})`).join("; ");
    const rest = periods.length > 3 ? ` and ${periods.length - 3} more` : "";
    await notify(
      db, collegeId, uid, "SUBSTITUTE_ASSIGNED", "You're covering a class",
      `${req.employeeName} is on approved leave and you've been assigned to cover: ${shown}${rest}.`,
      "/panel/teaching"
    );
  }
}
