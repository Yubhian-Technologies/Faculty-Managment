export const dynamic = "force-dynamic";

import { effectiveLabBatch, loadLabBatchModes } from "@/lib/students/labBatchMode";
import { NextResponse } from "next/server";
import { passwordChangeRequired, passwordChangeRequiredResponse } from "@/lib/students/passwordGate";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { findOwnStudent, isLiveAcademicYear, loadOwnSectionContext, slotVisibleToStudent } from "@/lib/students/ownContext";
import { getActiveSubstitutionsForDates } from "@/lib/leave/periodCoverage";
import { matchesCurrentSemester } from "@/lib/college/semester";
import { istDateKey, istDayOfWeek } from "@/lib/attendance/istTime";
import { formatAcademicShortNotation } from "@/lib/academic/format";
import { buildTimetableColumns } from "@/lib/timetable/gridModel";
import type { DayOfWeek, TimetableSlot } from "@/types";

const UNLINKED_MESSAGE =
  "Your login is not linked to a student record yet. Please contact your College Office.";

const DAY_BY_INDEX: Record<number, DayOfWeek> = { 1: "MON", 2: "TUE", 3: "WED", 4: "THU", 5: "FRI", 6: "SAT" };

// The dashboard's one call: who the student is and what is on today. Replaces
// the old /me + /me/timetable pair, which sent back the whole student record,
// every department, every subject of the course and the whole week's slots just
// to paint a list of today's periods. Reads here: the student, their section,
// course + timing, today's slots for that one section, today's substitutions,
// and the handful of subjects those slots name.
export async function GET() {
  try {
    const session = await requireCollegeMember("STUDENT");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const found = await findOwnStudent(db, session.collegeId, session.uid);
    if (!found.ok) {
      return NextResponse.json({ student: null, message: UNLINKED_MESSAGE });
    }
    if (passwordChangeRequired(found.student)) return passwordChangeRequiredResponse();
    const ctx = await loadOwnSectionContext(db, session.collegeId, found.student);
    const { student, section, course, timing } = ctx;

    const now = new Date();
    const today = istDateKey(now);
    const day = DAY_BY_INDEX[istDayOfWeek(now)] ?? null; // Sunday has no timetable
    const base = {
      student: { name: student.name, rollNumber: student.rollNumber },
      date: today,
      day,
      hasSection: Boolean(section),
    };
    if (!section || !timing || !day) {
      return NextResponse.json({ ...base, className: "", periods: [], hasTiming: Boolean(timing) });
    }

    const slotsSnap = await collegeRef
      .collection("timetableSlots")
      .where("sectionId", "==", section.id)
      .where("day", "==", day)
      .get();
    const liveSlots = slotsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as TimetableSlot & { id: string })
      .filter((s) => isLiveAcademicYear(s, ctx.academicYear) && matchesCurrentSemester(s.semester, ctx.currentSemester));
    // A lab the section's faculty incharge set to "no batch" is for the whole section, so every
    // student sees it; otherwise a split lab period is shown only to its own batch.
    const labModes = await loadLabBatchModes(db, session.collegeId, liveSlots.map((s) => ({ sectionId: section.id, subjectId: s.subjectId })));
    const slots = liveSlots.filter((s) =>
      slotVisibleToStudent({ labBatch: effectiveLabBatch(s.labBatch, labModes, section.id, s.subjectId, s.facultyId) }, student.labBatch));

    // A substitution belongs to one calendar date - only today's applies to today's list.
    const subs = slots.length > 0 ? await getActiveSubstitutionsForDates(db, session.collegeId, [today]) : [];
    const subBySlot = new Map(subs.filter((s) => s.date === today).map((s) => [s.timetableSlotId, s]));

    const subjectIds = Array.from(new Set(slots.map((s) => s.subjectId).filter(Boolean)));
    const subjectRefs = subjectIds.map((id) => collegeRef.collection("subjects").doc(id));
    const subjectSnaps = subjectRefs.length > 0 ? await db.getAll(...subjectRefs) : [];
    const shortCodeById = new Map(
      subjectSnaps.map((s) => {
        const d = s.data() as { shortCode?: string; code?: string } | undefined;
        return [s.id, d?.shortCode || d?.code || ""] as const;
      })
    );

    const timeByPeriod = new Map(
      buildTimetableColumns(timing).flatMap((c) => (c.kind === "period" ? [[c.periodNumber, c] as const] : []))
    );

    const rows = slots
      .sort((a, b) => a.periodNumber - b.periodNumber)
      .map((s) => {
        const sub = subBySlot.get(s.id);
        const col = timeByPeriod.get(s.periodNumber);
        return {
          id: s.id,
          periodNumber: s.periodNumber,
          startTime: col?.startTime ?? "",
          endTime: col?.endTime ?? "",
          code: shortCodeById.get(s.subjectId) || s.subjectName,
          subjectName: s.subjectName,
          faculty: sub?.substituteFacultyName || s.facultyName || "",
          isSubstitute: Boolean(sub),
          room: s.classroom ?? "",
          labBatch: effectiveLabBatch(s.labBatch, labModes, section.id, s.subjectId, s.facultyId) ?? "",
          subjectId: s.subjectId,
        };
      });
    // Faculty of one subject in the same period show as one entry: the subject once, every faculty listed.
    const merged = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const key = `${r.periodNumber}_${r.subjectId}`;
      const have = merged.get(key);
      if (!have) { merged.set(key, { ...r }); continue; }
      const join = (a: string, b: string) => Array.from(new Set([...a.split(", "), ...b.split(", ")].filter(Boolean))).join(", ");
      have.faculty = join(have.faculty, r.faculty);
      have.labBatch = join(have.labBatch, r.labBatch);
      have.room = have.room || r.room;
      have.isSubstitute = have.isSubstitute || r.isSubstitute;
    }
    const periods = Array.from(merged.values()).map(({ subjectId: _subjectId, ...rest }) => { void _subjectId; return rest; });

    return NextResponse.json({
      ...base,
      hasTiming: true,
      className: formatAcademicShortNotation({
        year: section.year,
        courseName: course?.name,
        courseCode: course?.code,
        sectionName: section.name,
      }),
      periods,
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student/me/today GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
