export const dynamic = "force-dynamic";

import { effectiveLabBatch, loadLabBatchModes } from "@/lib/students/labBatchMode";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { checkFacultyPeriodWindow, periodWindowMessage } from "@/lib/timetable/currentPeriod";
import { resolveSubstituteSlotsForDate } from "@/lib/leave/periodCoverage";
import { checkAllocatedAccess } from "@/lib/studentAttendance/labAllocation";
import { facultyActiveOn, loadLabWindows } from "@/lib/students/labFacultyWindow";
import { getNoClassReason } from "@/lib/studentAttendance/classDay";
import { applyOnDutyToEntries, loadOnDutyDay, presentCountOf } from "@/lib/studentAttendance/onDuty";
import { fetchSectionStudentsCached } from "@/lib/students/sectionRosterCache";
import { sortStudentsForList } from "@/lib/students/listOrder";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import type { FacultyMember, Section, StudentAttendanceEntry, StudentAttendanceSession, TeachingAssignment } from "@/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER");
    const body = (await readJsonBody(request)) as { assignmentId?: string; date?: string; periodNumber?: number };
    const assignmentId = body.assignmentId?.trim();
    const date = body.date?.trim();

    if (!assignmentId || !date || !DATE_RE.test(date)) {
      return NextResponse.json({ error: "assignmentId and a valid date (YYYY-MM-DD) are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // No attendance on a day the college isn't teaching (holiday, summer
    // break, a day outside its configured working days).
    // The three independent first reads run together; their results are then
    // checked in the original order.
    const [closedReason, assignmentSnap, facultyMemberId] = await Promise.all([
      getNoClassReason(db, session.collegeId, date),
      collegeRef.collection("teachingAssignments").doc(assignmentId).get(),
      resolveFacultyMemberId(db, session.collegeId, session.uid),
    ]);
    if (closedReason) {
      return NextResponse.json({ error: `No classes today - ${closedReason}.` }, { status: 403 });
    }

    // Only load a subject this faculty member is currently (not historically)
    // assigned to teach — prevents loading an arbitrary assignment's roster.
    if (!assignmentSnap.exists) {
      return NextResponse.json({ error: "Teaching assignment not found" }, { status: 404 });
    }
    const assignment = assignmentSnap.data() as TeachingAssignment;
    // teachingAssignments.facultyId is the facultyMembers doc id, not the
    // login uid (see resolveFacultyMemberId) — resolve before comparing.
    if (assignment.isPast) {
      return NextResponse.json({ error: "You are not assigned to teach this subject" }, { status: 403 });
    }
    // Not the assignment's own faculty - only other legitimate path is an
    // approved leave substitute covering this exact slot on this exact date
    // (see resolveSubstituteSlotsForDate's own doc-comment - the
    // substitution is never written onto the assignment/slot doc itself, so
    // it has to be resolved fresh here).
    let substituteFor: { originalFacultyId: string; originalFacultyName: string } | null = null;
    if (assignment.facultyId !== facultyMemberId) {
      const substituted = await resolveSubstituteSlotsForDate(db, session.collegeId, facultyMemberId, date, { fresh: true });
      if (substituted.size > 0) {
        const assignmentSlotsSnap = await collegeRef.collection("timetableSlots")
          .where("assignmentId", "==", assignmentId).get();
        const matched = assignmentSlotsSnap.docs.find((d) => substituted.has(d.id));
        if (matched) substituteFor = substituted.get(matched.id) ?? null;
      }
      if (!substituteFor) {
        return NextResponse.json({ error: "You are not assigned to teach this subject" }, { status: 403 });
      }
    }

    // Two independent teachingAssignments shapes (see TeachingAssignment):
    // course/section-scoped ones link to a real Section doc; semester-scoped
    // ones (HOD's "Teaching Assignments" page) only carry a free-text section
    // name, with no Section doc and no course "year" to resolve. Department,
    // section name and year are read from the SECTION DOC itself whenever one
    // exists - the canonical record - rather than the assignment's own
    // (denormalized, can drift after a section is edited) copies, so this
    // roster query can never disagree with the Faculty Attendance Report's
    // section-tile count, which resolves the same way (see
    // lib/students/sectionRoster.ts).
    let sectionId: string | undefined;
    let department: string;
    let sectionName: string;
    let year: number | undefined;
    let courseId: string | undefined;
    // Which of the two independent TeachingAssignment shapes' own semester
    // field actually applies - course/section-scoped rows carry
    // `timetableSemester` (CourseYearTiming-derived); the legacy semester-
    // scoped shape carries `semester` directly (see TeachingAssignment's own
    // doc-comments, types/teaching.ts). Stamped onto the attendance session
    // below so Section Attendance Report's own semester filter - which
    // already reads StudentAttendanceSession.semester - has something real
    // to filter on, instead of every session being permanently unscoped.
    const semester = assignment.sectionId ? assignment.timetableSemester : assignment.semester;

    if (assignment.sectionId) {
      const sectionSnap = await collegeRef.collection("sections").doc(assignment.sectionId).get();
      if (!sectionSnap.exists) {
        return NextResponse.json({ error: "Section not found" }, { status: 404 });
      }
      const section = sectionSnap.data() as Section;
      sectionId = assignment.sectionId;
      department = section.department;
      sectionName = section.name;
      year = section.year;
      courseId = section.courseId;
    } else {
      const sec = assignment.section?.trim();
      if (!sec) {
        return NextResponse.json({ error: "This assignment has no section configured — contact your HOD to fix the teaching assignment" }, { status: 400 });
      }
      department = assignment.department;
      sectionName = sec;
    }

    const now = new Date();

    // Resolved BEFORE the session doc id is built (not after) because the id
    // itself is keyed by period number - see below. Also gates everything
    // past this point (creating a session, or reconciling a DRAFT's roster)
    // on the PUBLISHED timetable actually having this faculty member
    // teaching this exact assignment right now, same as before. Mirrors the
    // check the PATCH route re-runs before actually saving marks, so a
    // request can't be replayed/crafted for a period that hasn't started yet
    // or has already ended.
    const requestedPeriod = Number.isInteger(body.periodNumber) ? body.periodNumber : undefined;
    let windowCheck = await checkFacultyPeriodWindow(db, session.collegeId, facultyMemberId, assignmentId, date, now, requestedPeriod);
    // Not inside its own period window: an HOD/Incharge may have opened this lab
    // assignment for the faculty on this date (see lib/studentAttendance/labAllocation.ts).
    let viaAllocation = false;
    if (!windowCheck.ok) {
      const allocated = await checkAllocatedAccess(db, session.collegeId, facultyMemberId, assignmentId, date, requestedPeriod);
      if (allocated.ok) { windowCheck = allocated; viaAllocation = true; }
    }
    if (!windowCheck.ok) {
      return NextResponse.json({ error: periodWindowMessage(windowCheck) }, { status: 403 });
    }
    // A lab's faculty take it on their own dates (set by the section's faculty incharge); a
    // covering substitute or an HOD allocation is not bound by them.
    if (!viaAllocation && !substituteFor) {
      const windows = await loadLabWindows(db, session.collegeId, [{ sectionId, subjectId: assignment.subjectId }]);
      if (!facultyActiveOn(windows, sectionId, assignment.subjectId, assignment.facultyId, date)) {
        return NextResponse.json({ error: "This lab is not yours on this date - the section's faculty incharge set your teaching dates for it." }, { status: 403 });
      }
    }
    const periodNumber = windowCheck.slot.periodNumber;

    // One session per (assignment, date, period) — NOT just (assignment,
    // date). The same faculty/section/subject can occupy consecutive
    // TimetableSlot periods on the same day (e.g. Period 1 then Period 2 of
    // the same assignment); each must be its own independent attendance
    // record, never carried forward or shared, so the period number
    // resolved above (the published timetable's own identifier for "which
    // class session this is") is part of the id itself. A doc saved before
    // this field existed sits at the old `${assignmentId}_${date}` id, which
    // is simply never looked up again - orphaned, not migrated, same as
    // this codebase's other doc-id scheme changes.
    const id = `${assignmentId}_${date}_${periodNumber}`;
    const ref = collegeRef.collection("studentAttendance").doc(id);

    // A split lab period (TimetableSlot.labBatch set) only rosters the
    // students carrying the matching StudentRecord.labBatch - each batch's
    // own faculty marks only their own half of the section (see
    // sectionRoster.ts). An ordinary period has no labBatch, so this is a
    // no-op and the roster is the whole section.
    // ...unless the section's faculty incharge set this lab to "no batch" - then the whole section attends together.
    const labBatch = effectiveLabBatch(
      windowCheck.slot.labBatch, await loadLabBatchModes(db, session.collegeId, [{ sectionId, subjectId: assignment.subjectId }]),
      sectionId, assignment.subjectId, assignment.facultyId,
    );

    // Resolve the roster BEFORE starting the transaction: the DRAFT-reconcile
    // branch (existing status === DRAFT) merges the incoming student list into
    // the stored entries, and the shape below also maps over it, so both have
    // to see it outside the transaction (tx.get cannot query).
    // sortStudentsForList, not rollNumber.localeCompare: a student imported
    // without a roll number sorts last by name instead of throwing here and
    // making the whole class impossible to take attendance for.
    // Roster, academic year and the on-duty day are independent reads: fetched
    // together (the roster is the long pole, the other two ride along for free).
    const [rosterDocs, academicYear, onDutyDay] = await Promise.all([
      fetchSectionStudentsCached(collegeRef, { department, sectionName, year, courseId, labBatch }),
      resolveCollegeAcademicYear(db, session.collegeId, now),
      loadOnDutyDay(db, session.collegeId, date),
    ]);
    const students = sortStudentsForList(rosterDocs);
    if (students.length === 0) {
      return NextResponse.json({ error: "No students are on this class's roster (check the section and, for a lab, the lab batch). Contact your HOD." }, { status: 400 });
    }

    // Which academic year this session belongs to - a Section is a year-slot a
    // new cohort occupies each year, so reports select sessions by it (audit
    // F-24). Sessions written before this existed carry none and are placed by
    // their date when read.
    // Students who are officially away for this period (an approved permission,
    // an event, ...) arrive already marked ON_DUTY: one document read for the
    // whole college-day, however many students are away. Resolved here, outside
    // the transaction, like the roster itself.
    // Wrap the whole DRAFT-create in a transaction so a concurrent
    // submission can't silently discard an in-flight roster merge. The
    // roster itself is fetched outside the transaction (two collection
    // queries via fetchSectionStudents cannot be done via tx.get), but the
    // read + merge + write of the studentAttendance doc is atomic.
    let resultSession: StudentAttendanceSession & { id: string };
    let resultStatus: number | undefined;
    await db.runTransaction(async (tx) => {
      const existingSnap = await tx.get(ref);
      if (existingSnap.exists) {
        const existing = existingSnap.data() as StudentAttendanceSession;
        if (existing.status === "SUBMITTED") {
          resultSession = { ...existing, id } as StudentAttendanceSession & { id: string };
          resultStatus = 200;
          return;
        }
        // DRAFT reconcile — preserve marks for still-present students
        const existingByStudent = new Map(existing.entries.map((e) => [e.studentId, e]));
        const entries: StudentAttendanceEntry[] = applyOnDutyToEntries(students.map((s) => {
          const prior = existingByStudent.get(s.id);
          return {
            studentId: s.id,
            rollNumber: s.rollNumber,
            name: s.name,
            status: prior?.status ?? null,
            // Keep what an ON_DUTY entry remembered, so a withdrawal can restore it.
            ...(prior?.previousStatus !== undefined ? { previousStatus: prior.previousStatus } : {}),
          };
        }), onDutyDay, periodNumber);
        const presentCount = presentCountOf(entries);
        // Self-heals a draft created before `semester` started being stamped
        // (existing.semester == null) - never overwrites one already set.
        const semesterFix = existing.semester == null && semester != null ? { semester } : {};
        // Same self-heal for the academic year (never overwrites one already set).
        const academicYearFix = existing.academicYear == null ? { academicYear } : {};
        // This caller passed the assignment / substitute check above, so a DRAFT that another
        // person opened (assignment reassigned, or the covering faculty and the original both
        // opening the period) becomes theirs; otherwise PATCH would refuse them (403) and the
        // period would stay stuck until the Dept Office corrects it.
        let ownerFix: Record<string, unknown> = {};
        if (existing.facultyId !== session.uid) {
          let name = assignment.facultyName ?? "";
          if (substituteFor) {
            const subFacSnap = await tx.get(collegeRef.collection("facultyMembers").doc(facultyMemberId));
            if (subFacSnap.exists) name = facultyDisplayName(subFacSnap.data() as FacultyMember);
          }
          ownerFix = {
            facultyId: session.uid,
            facultyName: name,
            substituteForFacultyId: substituteFor ? substituteFor.originalFacultyId : FieldValue.delete(),
            substituteForFacultyName: substituteFor ? substituteFor.originalFacultyName : FieldValue.delete(),
          };
        }
        tx.update(ref, {
          ...ownerFix,
          entries,
          totalStudents: entries.length,
          presentCount,
          updatedAt: now,
          ...semesterFix,
          ...academicYearFix,
        });
        resultSession = {
          ...existing, id, entries, totalStudents: entries.length, presentCount, updatedAt: now as unknown as StudentAttendanceSession["updatedAt"], ...semesterFix, ...academicYearFix,
          ...(ownerFix.facultyId ? { facultyId: session.uid, facultyName: ownerFix.facultyName as string } : {}),
        } as unknown as StudentAttendanceSession & { id: string };
        resultStatus = 200;
        return;
      }

      const entries: StudentAttendanceEntry[] = applyOnDutyToEntries(
        students.map((s) => ({ studentId: s.id, rollNumber: s.rollNumber, name: s.name, status: null })),
        onDutyDay,
        periodNumber
      );
      let facultyNameToStore = assignment.facultyName ?? "";
      if (substituteFor) {
        const subFacSnap = await collegeRef.collection("facultyMembers").doc(facultyMemberId).get();
        if (subFacSnap.exists) facultyNameToStore = facultyDisplayName(subFacSnap.data() as FacultyMember);
      }
      const attendanceSession = {
        collegeId: session.collegeId,
        department,
        assignmentId,
        ...(sectionId ? { sectionId } : {}),
        sectionName,
        ...(year != null ? { year } : {}),
        ...(semester != null ? { semester } : {}),
        academicYear,
        subjectId: assignment.subjectId,
        subjectName: assignment.subjectName,
        subjectCode: assignment.subjectCode,
        facultyId: session.uid,
        facultyName: facultyNameToStore,
        ...(substituteFor ? { substituteForFacultyId: substituteFor.originalFacultyId, substituteForFacultyName: substituteFor.originalFacultyName } : {}),
        date,
        periodNumber: windowCheck.slot.periodNumber,
        ...(labBatch ? { labBatch } : {}),
        status: "DRAFT" as const,
        entries,
        totalStudents: entries.length,
        presentCount: 0,
        classNotes: "",
        submittedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      tx.set(ref, attendanceSession);
      resultSession = { id, ...attendanceSession } as unknown as StudentAttendanceSession & { id: string };
      resultStatus = 201;
    });

    // Warn-only (not enforced): another assignment already has a session for this very class and
    // period, so both would count as held. Logged so the data can be checked before enforcing.
    if (resultStatus === 201 && sectionId) {
      try {
        const clash = await collegeRef.collection("studentAttendance")
          .where("sectionId", "==", sectionId).where("date", "==", date).where("periodNumber", "==", periodNumber).limit(5).get();
        const others = clash.docs.filter((d) => d.id !== id && (d.data() as { labBatch?: string }).labBatch === (labBatch || undefined));
        if (others.length > 0) console.warn("[student-attendance duplicate-period]", { id, sectionId, date, periodNumber, others: others.map((d) => d.id) });
      } catch (err) {
        console.warn("[student-attendance duplicate-period check failed]", err);
      }
    }

    return NextResponse.json({ session: resultSession! }, { status: resultStatus as unknown as number });

  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student-attendance POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
