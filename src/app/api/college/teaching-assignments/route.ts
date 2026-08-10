export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { requiredFacultyCount } from "@/lib/college/facultyRatio";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import type { TeachingAssignment, TimetableSlot } from "@/types";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "HOD",
      "PRINCIPAL",
      "SUPER_ADMIN",
      "PANEL_MEMBER",
      "VICE_PRINCIPAL",
    );

    const { searchParams } = new URL(request.url);
    const deptView = searchParams.get("dept") === "true";
    const requestedFacultyId = searchParams.get("facultyId");
    const sectionId = searchParams.get("sectionId");

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    let assignmentQuery: FirebaseFirestore.Query = collegeRef.collection("teachingAssignments");
    let childAssignmentQuery: FirebaseFirestore.Query | null = null;
    let timetableSlots: (TimetableSlot & { id: string })[] = [];

    if (sectionId) {
      // Section-scoped view (e.g. "assign faculty per subject" on the section edit page) -
      // all HOD/Principal/etc. roles above may view any section within their own college.
      assignmentQuery = assignmentQuery.where("sectionId", "==", sectionId);
    } else if (deptView && session.role === "HOD") {
      // Resolve HOD's department scope, including any sub-departments. A parent
      // HOD runs the whole tree, so child assignments come back as "primary" -
      // fully editable - matching what the POST/PATCH/DELETE guards on this same
      // route already allow via canHodEditDepartment().
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (scope.departmentName) assignmentQuery = assignmentQuery.where("department", "==", scope.departmentName);
      if (scope.childDepartmentNames.length > 0) {
        childAssignmentQuery = collegeRef.collection("teachingAssignments")
          .where("department", "in", scope.childDepartmentNames);
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
      timetableSlots = slotsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TimetableSlot & { id: string }));
    }

    const [assignmentsSnap, childAssignmentsSnap] = await Promise.all([
      assignmentQuery.get(),
      childAssignmentQuery ? childAssignmentQuery.get() : Promise.resolve(null),
    ]);

    const assignments: (TeachingAssignment & { id: string; accessLevel: "primary" | "secondary" })[] = assignmentsSnap.docs
      .map((d) => ({ id: d.id, ...d.data(), accessLevel: "primary" } as TeachingAssignment & { id: string; accessLevel: "primary" | "secondary" }));
    if (childAssignmentsSnap) {
      // "primary", not "secondary": a parent HOD owns their sub-departments and
      // may edit and delete these, so the UI must not mark them view-only.
      for (const d of childAssignmentsSnap.docs) {
        assignments.push({ id: d.id, ...d.data(), accessLevel: "primary" } as TeachingAssignment & { id: string; accessLevel: "primary" | "secondary" });
      }
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
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
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
      }

      // Conflict check: this faculty already teaching this exact section+subject?
      // Only applies to current assignments - past ones are historical records and
      // may legitimately repeat the same section+subject across different years.
      if (!body.isPast) {
        // Firestore's "!=" excludes docs missing the field entirely, which every
        // pre-existing current assignment does - so the isPast!==true filter has
        // to happen in application code, not the query, to still catch them.
        const existing = await collegeRef.collection("teachingAssignments")
          .where("facultyId", "==", facultyId)
          .where("sectionId", "==", sectionId)
          .where("subjectId", "==", subjectId)
          .get();
        if (existing.docs.some((d) => !(d.data() as { isPast?: boolean }).isPast)) {
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
          const conflict = await collegeRef.collection("timetableSlots")
            .where("sectionId", "==", sectionId)
            .where("day", "==", slot.day)
            .where("periodNumber", "==", slot.periodNumber)
            .limit(1)
            .get();
          if (!conflict.empty) {
            return NextResponse.json({
              error: `Conflict: Section ${section.name} already has a subject scheduled on ${slot.day} period ${slot.periodNumber}`,
              assignmentId: ref.id,
            }, { status: 409 });
          }

          // A faculty member can't teach two classes at once - block regardless of section/year/course.
          const facultyConflict = await collegeRef.collection("timetableSlots")
            .where("facultyId", "==", facultyId)
            .where("day", "==", slot.day)
            .where("periodNumber", "==", slot.periodNumber)
            .limit(1)
            .get();
          if (!facultyConflict.empty) {
            const other = facultyConflict.docs[0].data() as { subjectName?: string };
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
            createdAt: now,
            updatedAt: now,
          });
          createdSlots.push(slotRef.id);
        }
      }

      return NextResponse.json({ id: ref.id, slotIds: createdSlots }, { status: 201 });
    } else if (body.academicYear && body.semester) {
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
        const [studentsSnap, assignmentsSnap] = await Promise.all([
          collegeRef.collection("students").where("department", "==", dept).get(),
          collegeRef.collection("teachingAssignments")
            .where("department", "==", dept)
            .where("academicYear", "==", body.academicYear)
            .get(),
        ]);
        const totalStudents = studentsSnap.size;
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
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
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
