export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { requiredFacultyCount } from "@/lib/college/facultyRatio";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { getActiveSubstitutionsForDates, currentWeekDateKeys } from "@/lib/leave/periodCoverage";
import { resolveSectionCurrentSemester, resolveRequestedSemester, matchesCurrentSemester } from "@/lib/college/semester";
import { currentTimetableAcademicYear, matchesCurrentAcademicYear } from "@/lib/college/academicSession";
import { isTimetableIncharge } from "@/lib/departments/timetableIncharge";
import type { TeachingAssignment, TimetableSlot } from "@/types";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "HOD",
      "PRINCIPAL",
      "SUPER_ADMIN",
      "PANEL_MEMBER",
      "COLLEGE_STAFF",
      "VICE_PRINCIPAL",
    );

    const { searchParams } = new URL(request.url);
    const deptView = searchParams.get("dept") === "true";
    const requestedFacultyId = searchParams.get("facultyId");
    const sectionId = searchParams.get("sectionId");
    // Course-year-scoped view (e.g. a Timetable Incharge's own narrow "my
    // course & year" page, which - unlike an HOD's dept=true view - has no
    // business seeing the rest of the department's assignments).
    const courseIdParam = searchParams.get("courseId");
    const yearParam = searchParams.get("year");
    // Optional - the Teaching Assignments and Timetable editor pages' own
    // semester picker (see TeachingAssignment.timetableSemester) narrows the
    // section-scoped view down to one semester's assignments; omitted keeps
    // the previous all-assignments-for-this-section behavior unchanged for
    // any caller that hasn't been updated to offer a picker.
    const semesterParam = searchParams.get("semester");
    const requestedSemester = semesterParam != null ? Number(semesterParam) : null;

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    let assignmentQuery: FirebaseFirestore.Query = collegeRef.collection("teachingAssignments");
    let childAssignmentQuery: FirebaseFirestore.Query | null = null;
    let timetableSlots: (TimetableSlot & { id: string })[] = [];

    if (sectionId) {
      // Section-scoped view (e.g. "assign faculty per subject" on the section edit page) -
      // all HOD/Principal/etc. roles above may view any section within their own college.
      assignmentQuery = assignmentQuery.where("sectionId", "==", sectionId);
    } else if (courseIdParam && yearParam) {
      assignmentQuery = assignmentQuery.where("courseId", "==", courseIdParam).where("year", "==", Number(yearParam));
    } else if (deptView && session.role === "HOD") {
      // Resolve HOD's department scope, including any sub-departments. A parent
      // HOD runs the whole tree, so child assignments come back as "primary" -
      // fully editable - matching what the POST/PATCH/DELETE guards on this same
      // route already allow via canHodEditDepartment().
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (scope.ownDepartmentNames.length > 0) {
        assignmentQuery = assignmentQuery.where("department", "in", scope.ownDepartmentNames.slice(0, 30));
      }
      // Sub-departments AND grouped/managed branches (a Sub-HOD manages their
      // branches' assignments; a main HOD rolls up its sub-HODs' branches).
      const ownedDeptNames = [...scope.childDepartmentNames, ...scope.managedDepartmentNames];
      if (ownedDeptNames.length > 0) {
        childAssignmentQuery = collegeRef.collection("teachingAssignments")
          .where("department", "in", ownedDeptNames.slice(0, 30));
      }
    } else {
      // Viewing a specific faculty member's assignments - HOD/Principal/SuperAdmin may look up anyone;
      // everyone else (including a faculty viewing their own "Teaching Load") is restricted to themselves.
      const canViewOthers = ["HOD", "PRINCIPAL", "SUPER_ADMIN"].includes(session.role);
      // teachingAssignments/timetableSlots key off the FacultyMember doc id, not
      // the login uid — resolve "myself" through the userUid back-link (see
      // GET /api/college/faculty/me for the same lookup).
      const facultyId = requestedFacultyId && canViewOthers
        ? requestedFacultyId
        : await resolveFacultyMemberId(db, session.collegeId, session.uid);

      assignmentQuery = assignmentQuery.where("facultyId", "==", facultyId);

      const slotsSnap = await collegeRef
        .collection("timetableSlots")
        .where("facultyId", "==", facultyId)
        .get();
      const rawOwnSlots = slotsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TimetableSlot & { id: string }));
      // A faculty's own slots can span several different courses/years, each
      // with its own independent semester calendar (or none) - resolved once
      // per distinct (courseId, year) pair here (small set for one person)
      // rather than per slot, then used to drop a PRIOR semester's own slots
      // from "my teaching load" the same way every other timetable read
      // does. Keyed by the pair itself (not a joined/re-split string) since
      // courseId is an opaque Firestore doc id that may itself contain "_".
      const distinctCourseYears = new Map<string, { courseId: string; year: number }>();
      for (const s of rawOwnSlots) distinctCourseYears.set(`${s.courseId} ${s.year}`, { courseId: s.courseId, year: s.year });
      const semesterByCourseYear = new Map<string, number | null>();
      for (const [key, { courseId, year }] of distinctCourseYears) {
        semesterByCourseYear.set(key, await resolveSectionCurrentSemester(db, session.collegeId, courseId, year));
      }
      const ownSlots = rawOwnSlots.filter((s) =>
        matchesCurrentSemester(s.semester, semesterByCourseYear.get(`${s.courseId} ${s.year}`) ?? null)
      );

      // This week's approved-leave substitutions - both directions: mark this
      // faculty's own slots that are being covered by someone else, and add
      // synthetic entries for periods THEY are covering for someone else
      // (their own facultyId won't otherwise appear on that slot). Covers
      // every day of the currently-displayed week, not just today - see
      // currentWeekDateKeys. See lib/leave/periodCoverage.ts and the same
      // overlay in GET college/timetable-slots / college/class-leader/timetable.
      const substitutions = await getActiveSubstitutionsForDates(db, session.collegeId, currentWeekDateKeys());
      const substitutionBySlotId = new Map(substitutions.map((s) => [s.timetableSlotId, s]));
      timetableSlots = ownSlots.map((s) => {
        const sub = substitutionBySlotId.get(s.id);
        return sub
          ? { ...s, substituteFacultyId: sub.substituteFacultyId, substituteFacultyName: sub.substituteFacultyName, substituteForName: sub.requesterName }
          : s;
      });

      const ownSlotIds = new Set(ownSlots.map((s) => s.id));
      for (const sub of substitutions) {
        if (sub.substituteFacultyId !== facultyId || ownSlotIds.has(sub.timetableSlotId)) continue;
        timetableSlots.push({
          id: `substitute_${sub.timetableSlotId}`,
          collegeId: session.collegeId,
          department: "",
          assignmentId: "",
          facultyId,
          facultyName: sub.substituteFacultyName,
          courseId: "",
          year: 0,
          sectionId: "",
          subjectId: "",
          subjectName: sub.subjectName,
          day: sub.day,
          periodNumber: sub.periodNumber,
          createdAt: null as unknown as TimetableSlot["createdAt"],
          updatedAt: null as unknown as TimetableSlot["updatedAt"],
          substituteForName: sub.requesterName,
        } as TimetableSlot & { id: string });
      }
    }

    const [assignmentsSnap, childAssignmentsSnap] = await Promise.all([
      assignmentQuery.get(),
      childAssignmentQuery ? childAssignmentQuery.get() : Promise.resolve(null),
    ]);

    let assignments: (TeachingAssignment & { id: string; accessLevel: "primary" | "secondary" })[] = assignmentsSnap.docs
      .map((d) => ({ id: d.id, ...d.data(), accessLevel: "primary" } as TeachingAssignment & { id: string; accessLevel: "primary" | "secondary" }));
    if (childAssignmentsSnap) {
      // "primary", not "secondary": a parent HOD owns their sub-departments and
      // may edit and delete these, so the UI must not mark them view-only.
      for (const d of childAssignmentsSnap.docs) {
        assignments.push({ id: d.id, ...d.data(), accessLevel: "primary" } as TeachingAssignment & { id: string; accessLevel: "primary" | "secondary" });
      }
    }
    if (requestedSemester != null) {
      assignments = assignments.filter((a) => matchesCurrentSemester(a.timetableSemester, requestedSemester));
    }
    assignments.sort((a, b) => {
      const ta =
        a.createdAt && typeof (a.createdAt as { toMillis?: () => number }).toMillis === "function"
          ? (a.createdAt as { toMillis: () => number }).toMillis()
          : new Date(a.createdAt as unknown as string).getTime();
      const tb =
        b.createdAt && typeof (b.createdAt as { toMillis?: () => number }).toMillis === "function"
          ? (b.createdAt as { toMillis: () => number }).toMillis()
          : new Date(b.createdAt as unknown as string).getTime();
      return tb - ta; // descending
    });

    return NextResponse.json({ assignments, timetableSlots });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/teaching-assignments GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Two independent creation shapes share this collection (see subjects/route.ts for
// the same pattern): course/section-scoped (HOD Sections/Timetable flow - courseId +
// sectionId + subjectId, also stages timetable slots) and semester-scoped (HOD
// Teaching Assignments page - academicYear + semester, no section link).
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF");
    const body = (await request.json()) as {
      facultyId: string;
      facultyName?: string;
      courseId?: string;
      sectionId?: string;
      subjectId: string;
      academicYear?: string;
      semester?: number;
      section?: string;
      hoursPerWeek?: number;
      totalHoursAllotted?: number;
      slots?: { day: string; periodNumber: number; classroom?: string }[];
      // Course/section-scoped only - which of the course-year's configured
      // semesters (see lib/college/semester.ts) this assignment and its
      // slots are for. Omitted when the course-year has none configured, or
      // to fall back to whichever semester today's date resolves to.
      timetableSemester?: number;
      isPast?: boolean;
      assignmentAcademicYear?: string;
      assignmentSemester?: string;
      passPercentage?: number;
      studentFeedback?: number;
    };

    const { facultyId, facultyName, courseId, sectionId, subjectId } = body;
    if (!facultyId || !subjectId) {
      return NextResponse.json({ error: "facultyId and subjectId are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    if (courseId && sectionId) {
      const [courseSnap, sectionSnap, subjectSnap] = await Promise.all([
        collegeRef.collection("courses").doc(courseId).get(),
        collegeRef.collection("sections").doc(sectionId).get(),
        collegeRef.collection("subjects").doc(subjectId).get(),
      ]);
      if (!courseSnap.exists) return NextResponse.json({ error: "Course not found" }, { status: 404 });
      if (!sectionSnap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
      if (!subjectSnap.exists) return NextResponse.json({ error: "Subject not found" }, { status: 404 });

      const course = courseSnap.data() as { name: string; departmentId: string };
      const section = sectionSnap.data() as { name: string; year: number; department: string };
      const subject = subjectSnap.data() as { name: string; code: string; hoursPerWeek: number };

      // A parent department's HOD has full control over their own department and
      // every sub-department beneath it, so both the section and the faculty may
      // come from any of them (e.g. a shared Basic Science section staffed with a
      // BS-Physics specialist). A sub-HOD, having no children, is still limited to
      // their own department.
      if (session.role === "HOD") {
        const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
        if (!canHodEditDepartment(scope, section.department)) {
          return NextResponse.json(
            { error: "Section is not in your department or one of your sub-departments" },
            { status: 403 },
          );
        }

        const facultySnap = await collegeRef.collection("facultyMembers").doc(facultyId).get();
        if (!facultySnap.exists) return NextResponse.json({ error: "Faculty not found" }, { status: 404 });
        const facultyDept = (facultySnap.data() as { department?: string }).department ?? "";
        if (!canHodEditDepartment(scope, facultyDept)) {
          return NextResponse.json({ error: "Faculty must be in your department or one of your sub-departments" }, { status: 403 });
        }
      } else if (session.role === "PANEL_MEMBER" || session.role === "COLLEGE_STAFF") {
        // Co-editor, not a handoff - a faculty member only reaches here at all
        // if the HOD delegated THIS exact course-year's Timetable/Teaching
        // Assignments to them (see lib/departments/timetableIncharge.ts).
        // Never grants access to any other course-year, even one they'd
        // otherwise be scoped to via their own department.
        const ok = await isTimetableIncharge(db, session.collegeId, session.uid, courseId, section.year);
        if (!ok) {
          return NextResponse.json({ error: "You are not the Timetable Incharge for this course & year" }, { status: 403 });
        }
      }

      // Which of the course-year's configured semesters (if any) this
      // assignment and its slots belong to - resolved/validated once here,
      // then stamped onto everything this request writes below, so a
      // Semester 2 booking can never silently land under the wrong semester.
      const semesterResult = await resolveRequestedSemester(db, session.collegeId, courseId, section.year, body.timetableSemester ?? null);
      if (!semesterResult.ok) {
        return NextResponse.json({ error: semesterResult.error }, { status: 400 });
      }
      const timetableSemester = semesterResult.semester;
      // This session - a Section is a fixed year-slot a new cohort occupies
      // every academic year (see Section.batch's own doc-comment), so a slot
      // booked here has to be tagged and conflict-checked against the SAME
      // session's own slots, never a past cohort's - see
      // lib/college/academicSession.ts's own doc-comment.
      const currentAcademicYear = currentTimetableAcademicYear();

      // Conflict check: this faculty already teaching this exact section+subject
      // IN THIS SAME SEMESTER? Only applies to current assignments - past ones
      // are historical records and may legitimately repeat the same
      // section+subject across different years. A different semester's own
      // assignment for the same section+subject isn't a conflict - each
      // semester is its own independent timetable (see matchesCurrentSemester).
      if (!body.isPast) {
        // Firestore's "!=" excludes docs missing the field entirely, which every
        // pre-existing current assignment does - so the isPast!==true filter has
        // to happen in application code, not the query, to still catch them.
        const existing = await collegeRef.collection("teachingAssignments")
          .where("facultyId", "==", facultyId)
          .where("sectionId", "==", sectionId)
          .where("subjectId", "==", subjectId)
          .get();
        if (existing.docs.some((d) => {
          const data = d.data() as { isPast?: boolean; timetableSemester?: number | null };
          return !data.isPast && matchesCurrentSemester(data.timetableSemester, timetableSemester);
        })) {
          return NextResponse.json({ error: "This faculty is already assigned to this subject for this section" }, { status: 409 });
        }
      }

      const now = new Date();
      const ref = collegeRef.collection("teachingAssignments").doc();

      await ref.set({
        collegeId: session.collegeId,
        facultyId,
        facultyName: facultyName ?? "",
        department: section.department,
        departmentId: course.departmentId,
        courseId,
        courseName: course.name,
        year: section.year,
        sectionId,
        sectionName: section.name,
        subjectId,
        subjectName: subject.name,
        subjectCode: subject.code,
        hoursPerWeek: body.hoursPerWeek != null ? Number(body.hoursPerWeek) : subject.hoursPerWeek,
        assignedBy: session.uid,
        assignedByName: session.role,
        createdAt: now,
        updatedAt: now,
        assignmentAcademicYear: body.assignmentAcademicYear ?? "",
        assignmentSemester: body.assignmentSemester ?? "",
        ...(timetableSemester != null ? { timetableSemester } : {}),
        ...(body.isPast ? {
          isPast: true,
          ...(body.passPercentage != null ? { passPercentage: Number(body.passPercentage) } : {}),
          ...(body.studentFeedback != null ? { studentFeedback: Number(body.studentFeedback) } : {}),
        } : {}),
      });

      // Create any staged timetable slots (day + period) for this assignment -
      // past rows never have any (no live schedule to book).
      const createdSlots: string[] = [];
      if (!body.isPast && body.slots?.length) {
        for (const slot of body.slots) {
          // Same-semester only - a different semester's own slot in this
          // exact day/period isn't a real clash, it's a separate timetable
          // (see matchesCurrentSemester). Fetched un-filtered by semester
          // (day+period narrows this to at most a couple of docs already)
          // and matched in application code for the same null-tolerant
          // semantics used everywhere else this concept appears.
          const conflictSnap = await collegeRef.collection("timetableSlots")
            .where("sectionId", "==", sectionId)
            .where("day", "==", slot.day)
            .where("periodNumber", "==", slot.periodNumber)
            .get();
          const conflict = conflictSnap.docs.find((d) => {
            const data = d.data() as { semester?: number | null; academicYear?: string };
            return matchesCurrentSemester(data.semester, timetableSemester) && matchesCurrentAcademicYear(data.academicYear, currentAcademicYear);
          });
          if (conflict) {
            return NextResponse.json({
              error: `Conflict: Section ${section.name} already has a subject scheduled on ${slot.day} period ${slot.periodNumber}`,
              assignmentId: ref.id,
            }, { status: 409 });
          }

          // A faculty member can't teach two classes at once - block regardless
          // of section/year/course, but only within the same semester (a
          // different semester never happens at the same real-world time).
          const facultyConflictSnap = await collegeRef.collection("timetableSlots")
            .where("facultyId", "==", facultyId)
            .where("day", "==", slot.day)
            .where("periodNumber", "==", slot.periodNumber)
            .get();
          const facultyConflict = facultyConflictSnap.docs.find((d) => {
            const data = d.data() as { semester?: number | null; academicYear?: string };
            return matchesCurrentSemester(data.semester, timetableSemester) && matchesCurrentAcademicYear(data.academicYear, currentAcademicYear);
          });
          if (facultyConflict) {
            const other = facultyConflict.data() as { subjectName?: string };
            return NextResponse.json({
              error: `Conflict: ${facultyName || "this faculty"} already teaches ${other.subjectName ?? "another class"} on ${slot.day} period ${slot.periodNumber} in a different section`,
              assignmentId: ref.id,
            }, { status: 409 });
          }

          const slotRef = collegeRef.collection("timetableSlots").doc();
          await slotRef.set({
            collegeId: session.collegeId,
            department: section.department,
            assignmentId: ref.id,
            facultyId,
            facultyName: facultyName ?? "",
            courseId,
            year: section.year,
            sectionId,
            subjectId,
            subjectName: subject.name,
            day: slot.day,
            periodNumber: slot.periodNumber,
            classroom: slot.classroom ?? null,
            ...(timetableSemester != null ? { semester: timetableSemester } : {}),
            academicYear: currentAcademicYear,
            createdAt: now,
            updatedAt: now,
          });
          createdSlots.push(slotRef.id);
        }
      }

      return NextResponse.json({ id: ref.id, slotIds: createdSlots }, { status: 201 });
    } else if (body.academicYear && body.semester) {
      // This legacy semester-scoped shape (no section/course link) is
      // unrelated to Timetable Incharge delegation - PANEL_MEMBER is only in
      // the allow-list above for the course/section-scoped branch, guarded
      // by isTimetableIncharge there. Reject explicitly here rather than
      // falling through the HOD-only check below unchecked.
      if (session.role === "PANEL_MEMBER" || session.role === "COLLEGE_STAFF") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
      const [facultySnap, subjectSnap] = await Promise.all([
        collegeRef.collection("facultyMembers").doc(body.facultyId).get(),
        collegeRef.collection("subjects").doc(body.subjectId).get(),
      ]);

      if (!facultySnap.exists) {
        return NextResponse.json({ error: "Faculty not found" }, { status: 400 });
      }
      if (!subjectSnap.exists) {
        return NextResponse.json({ error: "Subject not found" }, { status: 400 });
      }

      const faculty = facultySnap.data() as { name?: string; department?: string };
      const subject = subjectSnap.data() as { name?: string; code?: string; department?: string; hoursPerWeek?: number };

      // HOD may assign within their own department and any sub-department beneath
      // it, for both the faculty and the subject; Principal/Super Admin can cross
      // departments freely.
      if (session.role === "HOD") {
        const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
        const facultyDept = faculty.department ?? "";
        const subjectDept = subject.department ?? "";
        if (!canHodEditDepartment(scope, facultyDept) || !canHodEditDepartment(scope, subjectDept)) {
          return NextResponse.json(
            { error: "Faculty/subject must be in your department or one of your sub-departments" },
            { status: 403 },
          );
        }
      }

      const now = new Date();
      const ref = await collegeRef.collection("teachingAssignments").add({
        collegeId: session.collegeId,
        facultyId: body.facultyId,
        facultyName: faculty.name ?? "",
        subjectId: body.subjectId,
        subjectName: subject.name ?? "",
        subjectCode: subject.code ?? "",
        department: subject.department ?? faculty.department ?? "",
        academicYear: body.academicYear,
        semester: Number(body.semester),
        section: body.section ?? "",
        hoursPerWeek: body.hoursPerWeek ?? subject.hoursPerWeek ?? 0,
        ...(body.totalHoursAllotted != null ? { totalHoursAllotted: Number(body.totalHoursAllotted) } : {}),
        assignedBy: session.uid,
        assignedByName: session.role,
        createdAt: now,
        updatedAt: now,
      });

      // Non-blocking ratio reference: surface whether this department is now
      // staffed at/beyond the 1:15 hiring-pipeline ratio, without preventing the
      // assignment (HOD/Principal still decide) - see faculty-requirement route
      // for the same STUDENT_FACULTY_RATIO used during hiring/vacancy sizing.
      let ratioWarning: string | undefined;
      const dept = subject.department ?? faculty.department ?? "";
      if (dept) {
        // Includes shared-first-year students pre-registered to `dept` via
        // secondaryDepartment (department preserved until promotion) - same
        // union sections/route.ts's studentCount aggregation and
        // faculty-requirement's own count use, so this warning isn't
        // undercounting a branch's incoming year-1 cohort.
        const [studentsSnap, studentsSecondarySnap, assignmentsSnap] = await Promise.all([
          collegeRef.collection("students").where("department", "==", dept).get(),
          collegeRef.collection("students").where("secondaryDepartment", "==", dept).get(),
          collegeRef.collection("teachingAssignments")
            .where("department", "==", dept)
            .where("academicYear", "==", body.academicYear)
            .get(),
        ]);
        const countedStudentIds = new Set<string>();
        for (const d of studentsSnap.docs) countedStudentIds.add(d.id);
        for (const d of studentsSecondarySnap.docs) countedStudentIds.add(d.id);
        const totalStudents = countedStudentIds.size;
        const required = requiredFacultyCount(totalStudents);
        const distinctFaculty = new Set(
          assignmentsSnap.docs.map((d) => (d.data() as { facultyId?: string }).facultyId).filter(Boolean)
        );
        if (required > 0 && distinctFaculty.size >= required) {
          ratioWarning = `${dept} now has ${distinctFaculty.size} faculty assigned against a ratio-based requirement of ${required} (1:15 student-faculty ratio).`;
        }
      }

      return NextResponse.json({ id: ref.id, ...(ratioWarning ? { ratioWarning } : {}) }, { status: 201 });
    } else {
      return NextResponse.json(
        { error: "Either (courseId, sectionId) or (academicYear, semester) is required" },
        { status: 400 }
      );
    }
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/teaching-assignments POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF");
    const { searchParams } = new URL(request.url);
    const assignmentId = searchParams.get("id");
    if (!assignmentId) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const ref = collegeRef.collection("teachingAssignments").doc(assignmentId);

    if (session.role === "HOD") {
      const assignmentSnap = await ref.get();
      if (!assignmentSnap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const assignmentDept = (assignmentSnap.data() as { department?: string }).department ?? "";
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartment(scope, assignmentDept)) {
        return NextResponse.json(
          { error: "You can only remove assignments in your own department or its sub-departments" },
          { status: 403 },
        );
      }
    } else if (session.role === "PANEL_MEMBER" || session.role === "COLLEGE_STAFF") {
      const assignmentSnap = await ref.get();
      if (!assignmentSnap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const assignment = assignmentSnap.data() as { courseId?: string; year?: number };
      const ok = assignment.courseId && assignment.year != null
        && await isTimetableIncharge(db, session.collegeId, session.uid, assignment.courseId, assignment.year);
      if (!ok) {
        return NextResponse.json({ error: "You are not the Timetable Incharge for this course & year" }, { status: 403 });
      }
    }

    const slotsSnap = await collegeRef.collection("timetableSlots").where("assignmentId", "==", assignmentId).get();
    const batch = db.batch();
    slotsSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(ref);
    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/teaching-assignments DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
