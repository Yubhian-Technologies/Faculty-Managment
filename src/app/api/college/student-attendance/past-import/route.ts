export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { istDateKey } from "@/lib/attendance/istTime";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";
import { fetchSectionStudents } from "@/lib/students/sectionRoster";
import { sortStudentsForList } from "@/lib/students/listOrder";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { makeLiveSlotPredicate } from "@/lib/timetable/liveSlots";
import { loadTimingLookup } from "@/lib/timetable/facultyOverlap";
import { loadClassCalendar } from "@/lib/studentAttendance/heldDenominator";
import { dayNameOf } from "@/lib/studentAttendance/expectedPeriods";
import { noClassReason } from "@/lib/studentAttendance/classDay";
import { loadAcademicYearConfig, windowForAcademicYear } from "@/lib/studentAttendance/academicYearWindow";
import { applyOnDutyToEntries, loadOnDutyDay, presentCountOf } from "@/lib/studentAttendance/onDuty";
import { applyTallyDeltaInTx } from "@/lib/studentAttendance/dayTally";
import type { ImportMark } from "@/lib/studentAttendance/pastImportGrid";
import type { DayOfWeek, FacultyMember, Section, StudentAttendanceEntry, TeachingAssignment } from "@/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DATES = 7; // per request: ~7 days x ~8 periods of sessions, written WRITE_CONCURRENCY at a time (the page chunks)
const WRITE_CONCURRENCY = 8;
const MAX_STUDENTS = 400;
const IMPORT_REASON = "Bulk import of past attendance (whole-day P/A applied to every period)";

interface Body {
  sectionId?: string;
  dates?: string[];
  students?: { roll?: string; marks?: (ImportMark | null)[] }[];
  apply?: boolean;
  runId?: string;
}

interface DayReport {
  date: string;
  status: "READY" | "SKIPPED";
  reason?: string;
  periods: number;
  created: number;
  alreadyPosted: number;
  skippedPeriods: string[];
  /** "P1 Maths - Dr X" per period that will be (or was) created, so the Office can see what the timetable maps to. */
  detail: string[];
  /** Set when some of this weekday's slots were published after the date - the subject/faculty may not be what ran then. */
  timetableNote?: string;
}

// College Office "Import past attendance" for ONE section: each student's whole-day P or A becomes a SUBMITTED
// session for every timetable period the section has that weekday (subject and faculty from the slot's teaching
// assignment), exactly the document the Department Office correction flow writes - so reports, the student
// dashboard tally and on-duty handling all treat it as ordinary attendance. A period that already has a session
// is never touched. `apply: false` returns the same report without writing anything.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");
    const body = (await readJsonBody(request)) as Body;
    const apply = body.apply === true;
    const dates = body.dates ?? [];
    const rows = body.students ?? [];
    if (!body.sectionId || dates.length === 0 || dates.length > MAX_DATES || rows.length === 0 || rows.length > MAX_STUDENTS) {
      return NextResponse.json({ error: `sectionId, 1-${MAX_DATES} dates and 1-${MAX_STUDENTS} students are required` }, { status: 400 });
    }
    if (dates.some((d) => typeof d !== "string" || !DATE_RE.test(d)) || new Set(dates).size !== dates.length) {
      return NextResponse.json({ error: "dates must be unique YYYY-MM-DD values" }, { status: 400 });
    }
    if (rows.some((r) => !r.roll || !Array.isArray(r.marks) || r.marks.length !== dates.length || r.marks.some((m) => m !== null && m !== "PRESENT" && m !== "ABSENT"))) {
      return NextResponse.json({ error: "Each student needs a roll and one PRESENT / ABSENT / null mark per date" }, { status: 400 });
    }
    if (apply && !body.runId) return NextResponse.json({ error: "runId is required to apply" }, { status: 400 });

    const db = getAdminDb();
    const collegeId = session.collegeId;
    const collegeRef = db.collection("colleges").doc(collegeId);

    const sectionSnap = await collegeRef.collection("sections").doc(body.sectionId).get();
    if (!sectionSnap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    const section = sectionSnap.data() as Section;

    const now = new Date();
    const today = istDateKey(now);
    const academicYear = await resolveCollegeAcademicYear(db, collegeId, now);
    const yearCfg = await loadAcademicYearConfig(db, collegeId, now);
    const yearWindow = windowForAcademicYear(yearCfg.currentLabel, yearCfg);
    const sorted = [...dates].sort();
    const calendar = await loadClassCalendar(db, collegeId, sorted[0], sorted[sorted.length - 1]);

    // Roll -> student for the whole section; the file's rows are matched on it.
    const sectionIdentity = { department: section.department, sectionName: section.name, year: section.year, courseId: section.courseId };
    const roster = sortStudentsForList(await fetchSectionStudents(collegeRef, sectionIdentity));
    const byRoll = new Map(roster.map((s) => [(s.rollNumber ?? "").trim().toUpperCase(), s]));
    const unmatchedRolls = rows.filter((r) => !byRoll.has(r.roll!.trim().toUpperCase())).map((r) => r.roll!);
    const markOf = new Map<string, (ImportMark | null)[]>();
    for (const r of rows) {
      const st = byRoll.get(r.roll!.trim().toUpperCase());
      if (st) markOf.set(st.id, r.marks!);
    }
    const studentById = new Map(roster.map((s) => [s.id, s]));
    const notInFile = roster.filter((s) => !markOf.has(s.id)).map((s) => s.rollNumber);

    // The section's published timetable, read as it is now (same liveness rule the not-posted report uses).
    const [slotsSnap, { lookup }] = await Promise.all([
      collegeRef.collection("timetableSlots").where("sectionId", "==", body.sectionId).get(),
      loadTimingLookup(db, collegeId, [{ courseId: section.courseId, year: section.year }]),
    ]);
    const isLive = makeLiveSlotPredicate(lookup, academicYear, { now });
    type Slot = { assignmentId: string; subjectId: string; day: DayOfWeek; periodNumber: number; subjectName?: string; semester?: number | null; courseId: string; year: number; academicYear?: string | null; createdAt?: { toDate(): Date }; effectiveDate?: string };
    const slots = slotsSnap.docs.map((d) => d.data() as Slot).filter((s) => isLive(s));

    const assignmentCache = new Map<string, TeachingAssignment | null>();
    const facultyCache = new Map<string, FacultyMember | null>();
    const loadAssignment = async (id: string) => {
      if (!assignmentCache.has(id)) {
        const snap = await collegeRef.collection("teachingAssignments").doc(id).get();
        assignmentCache.set(id, snap.exists ? (snap.data() as TeachingAssignment) : null);
      }
      return assignmentCache.get(id)!;
    };
    const loadFaculty = async (id: string) => {
      if (!facultyCache.has(id)) {
        const snap = await collegeRef.collection("facultyMembers").doc(id).get();
        facultyCache.set(id, snap.exists ? (snap.data() as FacultyMember) : null);
      }
      return facultyCache.get(id)!;
    };
    const reports: DayReport[] = [];
    for (const date of sorted) {
      const idx = dates.indexOf(date);
      const report: DayReport = { date, status: "READY", periods: 0, created: 0, alreadyPosted: 0, skippedPeriods: [], detail: [] };
      reports.push(report);
      const skip = (reason: string) => { report.status = "SKIPPED"; report.reason = reason; };

      if (date > today) { skip("Future date"); continue; }
      if (yearWindow && (date < yearWindow.from || date > yearWindow.to)) { skip(`Outside the current academic year (${yearWindow.label})`); continue; }
      const closed = noClassReason({ dateISO: date, ...calendar });
      if (closed) { skip(closed); continue; }
      const day = dayNameOf(date);
      const daySlots = slots.filter((s) => s.day === day);
      if (daySlots.length === 0) { skip("No timetable periods for this weekday"); continue; }
      // The timetable's own "w.e.f." date when it has one (a timetable published on 10 Oct that is effective from
      // 24 Aug applies from 24 Aug); otherwise the day it was published.
      const newer = daySlots.filter((s) => (s.effectiveDate ?? (s.createdAt ? istDateKey(s.createdAt.toDate()) : "")) > date);
      if (newer.length > 0) {
        const from = newer.map((s) => s.effectiveDate ?? (s.createdAt ? istDateKey(s.createdAt.toDate()) : "")).sort()[0];
        report.timetableNote = `The timetable for ${newer.length} of ${daySlots.length} period(s) took effect on ${from}, after this date - check the subjects below`;
      }
      // Every mark in the file is saved - the register is the record - including marks dated before the student's
      // joining/admission date, which no longer cuts attendance off anywhere (joiningDate.ts).
      const marked = [...markOf].filter(([, marks]) => marks[idx] != null);
      if (marked.length === 0) { skip("No P/A in the file for this date"); continue; }

      const onDuty = await loadOnDutyDay(db, collegeId, date);
      const planned: { ref: FirebaseFirestore.DocumentReference; doc: Record<string, unknown> }[] = [];
      // One timetable cell = one period = one session for the WHOLE section, whatever lab batches or how many faculty
      // share it: the register has a single P/A per student per day, so the total and subject-wise held counts must be
      // the same for every student. (Batch-wise sessions are a later step.) Two faculty on the same subject in one
      // period (a shared lab) are recorded once, under the first assignment; two different subjects in one period
      // cannot be told apart without batches, so that period is reported and not written.
      const byPeriod = new Map<number, Slot[]>();
      for (const slot of daySlots) byPeriod.set(slot.periodNumber, [...(byPeriod.get(slot.periodNumber) ?? []), slot]);
      for (const [period, group] of [...byPeriod].sort((a, b) => a[0] - b[0])) {
        const label = `P${period}`;
        const subjectIds = new Set(group.map((g) => g.subjectId));
        if (subjectIds.size > 1) {
          report.skippedPeriods.push(`${label}: ${[...new Set(group.map((g) => g.subjectName ?? g.subjectId))].join(" and ")} at the same time for the same students - cannot be told apart without lab batches, not recorded`);
          continue;
        }
        const usable: { slot: Slot; assignment: TeachingAssignment; faculty: FacultyMember }[] = [];
        for (const slot of [...group].sort((a, b) => a.assignmentId.localeCompare(b.assignmentId))) {
          const assignment = await loadAssignment(slot.assignmentId);
          if (!assignment || assignment.isPast) continue;
          const faculty = await loadFaculty(assignment.facultyId);
          if (faculty) usable.push({ slot, assignment, faculty });
        }
        if (usable.length === 0) { report.skippedPeriods.push(`${label}: teaching assignment or faculty not found`); continue; }
        const { slot, assignment, faculty } = usable[0];
        const alsoTaughtBy = usable.slice(1).map((u) => u.assignment.facultyName ?? facultyDisplayName(u.faculty));
        const entries: StudentAttendanceEntry[] = marked.map(([studentId, marks]) => {
          const st = studentById.get(studentId)!;
          return { studentId, rollNumber: st.rollNumber, name: st.name, status: marks[idx]! };
        });
        const finalEntries = applyOnDutyToEntries(entries, onDuty, slot.periodNumber);
        const semester = slot.semester ?? assignment.timetableSemester;
        report.detail.push(`${label} ${assignment.subjectName} - ${assignment.facultyName ?? facultyDisplayName(faculty)}${alsoTaughtBy.length ? ` (also ${alsoTaughtBy.join(", ")} - counted once)` : ""}`);
        planned.push({
          ref: collegeRef.collection("studentAttendance").doc(`${slot.assignmentId}_${date}_${slot.periodNumber}`),
          doc: {
            collegeId, department: section.department, assignmentId: slot.assignmentId, sectionId: body.sectionId,
            sectionName: section.name, year: section.year, ...(semester != null ? { semester } : {}),
            academicYear, subjectId: assignment.subjectId, subjectName: assignment.subjectName, subjectCode: assignment.subjectCode,
            facultyId: faculty.userUid ?? assignment.facultyId, facultyName: assignment.facultyName ?? facultyDisplayName(faculty),
            date, periodNumber: slot.periodNumber,
            status: "SUBMITTED", entries: finalEntries, totalStudents: finalEntries.length, presentCount: presentCountOf(finalEntries),
            // submittedAt stays empty on purpose: a stamp of the import time would read as a LATE posting against
            // the faculty (periodAttendanceStatus.ts); no timestamp is treated as "don't penalize".
            classNotes: alsoTaughtBy.length ? `Imported past attendance - shared period, also taken by ${alsoTaughtBy.join(", ")}` : "Imported past attendance",
            submittedAt: null, postedBy: "OFFICE",
            correctedByUid: session.uid, correctionReason: IMPORT_REASON, ...(body.runId ? { importRunId: body.runId } : {}),
            createdAt: now, updatedAt: now,
          },
        });
      }
      report.periods = planned.length;
      const existing = planned.length ? await db.getAll(...planned.map((p) => p.ref)) : [];
      const fresh = planned.filter((_, i) => !existing[i].exists);
      report.alreadyPosted = planned.length - fresh.length;
      report.created = fresh.length;
      if (!apply) continue;

      report.created = 0;
      for (let i = 0; i < fresh.length; i += WRITE_CONCURRENCY) {
        const results = await Promise.all(fresh.slice(i, i + WRITE_CONCURRENCY).map(async (p) => {
          // The session and its tally increments are one atomic batch. create() fails if the period was posted
          // meanwhile (ALREADY_EXISTS), so nothing is ever overwritten - and no read round trip is needed.
          const batch = db.batch();
          batch.create(p.ref, p.doc);
          applyTallyDeltaInTx(batch, db, collegeId, null, p.doc as never);
          try {
            await batch.commit();
            return true;
          } catch (err) {
            if ((err as { code?: number }).code === 6) return false;
            throw err;
          }
        }));
        for (const wrote of results) if (wrote) report.created++; else report.alreadyPosted++;
      }
    }

    if (apply) {
      const actor = (await collegeRef.collection("users").doc(session.uid).get()).data() as { name?: string } | undefined;
      await writeAuditLogSafe(db, collegeId, {
        action: "STUDENT_ATTENDANCE_PAST_IMPORT",
        performedBy: session.uid,
        performedByName: actor?.name,
        targetId: body.sectionId,
        details: {
          runId: body.runId, department: section.department, section: section.name, year: section.year,
          dates: sorted, created: reports.reduce((n, r) => n + r.created, 0), alreadyPosted: reports.reduce((n, r) => n + r.alreadyPosted, 0),
          skippedDays: reports.filter((r) => r.status === "SKIPPED").map((r) => `${r.date}: ${r.reason}`),
        },
      });
    }

    return NextResponse.json({
      applied: apply,
      days: reports,
      unmatchedRolls,
      rosterNotInFile: notInFile,
      totals: { created: reports.reduce((n, r) => n + r.created, 0), alreadyPosted: reports.reduce((n, r) => n + r.alreadyPosted, 0) },
    });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student-attendance/past-import POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
