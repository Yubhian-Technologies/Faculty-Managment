export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { passwordChangeRequired, passwordChangeRequiredResponse } from "@/lib/students/passwordGate";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { findCurrentSectionDoc } from "@/lib/students/findCurrentSectionDoc";
import { getActiveSubstitutionsForDates, currentWeekDateKeys } from "@/lib/leave/periodCoverage";
import { getSectionTimetableData } from "@/lib/students/sectionTimetableData";
import { resolveCurrentSemester, matchesCurrentSemester } from "@/lib/college/semester";
import { DEFAULT_TIMETABLE_RULES } from "@/types";
import type {
  Course,
  CourseYearTiming,
  Department,
  Section,
  StudentRecord,
  Subject,
  TimetableSlot,
  TeachingAssignment,
  TimetableRules,
} from "@/types";

// Student's own weekly timetable - same shape/logic as
// api/college/class-leader/timetable/route.ts, except the section is
// resolved from the student's OWN roster record (findCurrentSectionDoc)
// instead of a login-bound sectionId, since a student login is tied to one
// specific StudentRecord, not a rotating class-rep seat. Never a client-
// supplied sectionId - strictly the caller's own current section.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("STUDENT");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const { searchParams } = new URL(request.url);

    const weekParam = searchParams.get("week");
    const semesterParam = searchParams.get("semester");
    const requestedSemester = semesterParam != null && semesterParam !== "" ? Number(semesterParam) : null;

    const emptyResponse = {
      course: null,
      section: null,
      timing: null,
      slots: [],
      assignments: [],
      subjects: [],
      resolvedSemester: null,
      availableSemesters: [],
      workingDays: DEFAULT_TIMETABLE_RULES.workingDays,
      departments: [],
    };

    const studentSnap = await collegeRef.collection("students").where("uid", "==", session.uid).limit(1).get();
    if (studentSnap.empty) {
      return NextResponse.json(emptyResponse);
    }
    const studentDoc = studentSnap.docs[0];
    const student = { ...(studentDoc.data() as StudentRecord), id: studentDoc.id };
    if (passwordChangeRequired(student)) return passwordChangeRequiredResponse();

    const sectionDoc = await findCurrentSectionDoc(db, session.collegeId, student);
    if (!sectionDoc) {
      return NextResponse.json(emptyResponse);
    }
    const section = { id: sectionDoc.id, ...sectionDoc.data() } as Section;

    // Section-level data (not per student) - shared across the section's students, see sectionTimetableData.ts.
    const { course, timing, departments, timetableRules, slots: sectionSlots, assignments: sectionAssignments, subjects } =
      await getSectionTimetableData(db, session.collegeId, section);

    const configuredSemesters = (timing?.semesters ?? []).map((s) => s.semester);
    const validRequestedSemester =
      requestedSemester != null && Number.isFinite(requestedSemester) &&
      (configuredSemesters.length === 0 || configuredSemesters.includes(requestedSemester))
        ? requestedSemester
        : null;
    const currentSemester = validRequestedSemester != null ? validRequestedSemester : resolveCurrentSemester(timing);

    const subjectMap = new Map<string, Subject>(subjects.map((sub) => [sub.id, sub]));

    const rawSlots = sectionSlots
      .filter((s) => matchesCurrentSemester(s.semester, currentSemester))
      .map((s) => {
        const sub = s.subjectId ? subjectMap.get(s.subjectId) : undefined;
        return { ...s, subjectCode: sub?.code, shortCode: sub?.shortCode, subjectType: sub?.type };
      });

    const assignments = sectionAssignments
      .filter((a) => {
        if (a.isPast) return false;
        const sem = a.timetableSemester ?? a.semester;
        if (sem != null && currentSemester != null) return matchesCurrentSemester(sem, currentSemester);
        return true;
      })
      .map((a) => {
        const sub = a.subjectId ? subjectMap.get(a.subjectId) : undefined;
        return { ...a, shortCode: a.shortCode || sub?.shortCode, subjectType: a.subjectType || sub?.type };
      });

    const substitutions = await getActiveSubstitutionsForDates(
      db,
      session.collegeId,
      currentWeekDateKeys(weekParam ?? undefined)
    );
    const substitutionBySlotId = new Map(substitutions.map((s) => [s.timetableSlotId, s]));
    const slots = rawSlots.map((s) => {
      const sub = substitutionBySlotId.get(s.id);
      return sub
        ? {
            ...s,
            substituteFacultyId: sub.substituteFacultyId,
            substituteFacultyName: sub.substituteFacultyName,
            substituteForName: sub.requesterName,
            substituteDate: sub.date,
          }
        : s;
    });

    return NextResponse.json({
      course,
      section,
      timing,
      slots,
      assignments,
      subjects: Array.from(subjectMap.values()),
      resolvedSemester: currentSemester,
      availableSemesters: timing?.semesters ?? [],
      workingDays: timetableRules.workingDays,
      departments,
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student/me/timetable GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
