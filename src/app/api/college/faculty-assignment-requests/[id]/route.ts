export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify } from "@/lib/notify";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import type { FacultyAssignmentRequest } from "@/types";

// Fulfills (allocate) or declines an incoming faculty-assignment request -
// only the target department's HOD (or someone who edits that department,
// e.g. its own parent HOD) may act on it. Allocating creates the actual
// TeachingAssignment record directly, filed under the *requesting* section's
// own department (matching how a normal direct assignment is filed) - the
// requester then picks weekly periods for it the usual way, via the
// Timetable page's "Add a subject".
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("HOD");
    const { id } = await params;
    const body = (await request.json()) as {
      action?: "allocate" | "decline" | "notify_timetable_updated";
      facultyId?: string;
      facultyName?: string;
      declineReason?: string;
    };

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const reqRef = collegeRef.collection("facultyAssignmentRequests").doc(id);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists) return NextResponse.json({ error: "Request not found" }, { status: 404 });
    const reqData = reqSnap.data() as FacultyAssignmentRequest;

    const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
    if (!canHodEditDepartment(scope, reqData.targetDepartmentName)) {
      return NextResponse.json({ error: "This request wasn't sent to your department" }, { status: 403 });
    }

    const now = new Date();

    // Fired by the Timetable page's "Update" button (in place of the normal
    // "Publish") once the lending HOD has placed their allocated faculty's
    // weekly periods on the requester's timetable - a lightweight notify-only
    // step, no state change here (the timetable publish already happened via
    // its own endpoint).
    if (body.action === "notify_timetable_updated") {
      if (reqData.status !== "ALLOCATED") {
        return NextResponse.json({ error: "This request hasn't been allocated yet" }, { status: 409 });
      }
      await notify(
        db, session.collegeId, reqData.requestedBy, "FACULTY_ASSIGNMENT_ALLOCATED",
        "Timetable updated",
        `${reqData.targetDepartmentName} placed ${reqData.allocatedFacultyName ?? "the allocated faculty"}'s weekly periods for ${reqData.subjectName} (Section ${reqData.sectionName})`,
        `/hod/timetable/${reqData.courseId}/${reqData.year}/${reqData.sectionId}`
      );
      return NextResponse.json({ ok: true });
    }

    if (reqData.status !== "PENDING") {
      return NextResponse.json({ error: "This request has already been handled" }, { status: 409 });
    }

    if (body.action === "decline") {
      await reqRef.update({ status: "DECLINED", declineReason: body.declineReason ?? "", updatedAt: now });
      await notify(
        db, session.collegeId, reqData.requestedBy, "FACULTY_ASSIGNMENT_DECLINED",
        "Faculty assignment request declined",
        `${reqData.targetDepartmentName} couldn't lend a faculty member for ${reqData.subjectName} (Section ${reqData.sectionName})`,
        "/hod/assignment-requests"
      );
      return NextResponse.json({ ok: true });
    }

    if (body.action !== "allocate" || !body.facultyId) {
      return NextResponse.json({ error: "action and facultyId are required" }, { status: 400 });
    }

    const facultySnap = await collegeRef.collection("facultyMembers").doc(body.facultyId).get();
    if (!facultySnap.exists) return NextResponse.json({ error: "Faculty not found" }, { status: 404 });
    const faculty = facultySnap.data() as { name?: string; department?: string };
    if (!canHodEditDepartment(scope, faculty.department ?? "")) {
      return NextResponse.json({ error: "That faculty member isn't in your department" }, { status: 403 });
    }

    const courseSnap = await collegeRef.collection("courses").doc(reqData.courseId).get();
    const course = courseSnap.data() as { departmentId?: string } | undefined;

    const existing = await collegeRef.collection("teachingAssignments")
      .where("facultyId", "==", body.facultyId)
      .where("sectionId", "==", reqData.sectionId)
      .where("subjectId", "==", reqData.subjectId)
      .get();
    if (existing.docs.some((d) => !(d.data() as { isPast?: boolean }).isPast)) {
      return NextResponse.json({ error: "This faculty is already assigned to this subject for this section" }, { status: 409 });
    }

    const taRef = collegeRef.collection("teachingAssignments").doc();
    await taRef.set({
      collegeId: session.collegeId,
      facultyId: body.facultyId,
      facultyName: faculty.name ?? body.facultyName ?? "",
      department: reqData.requestingDepartment,
      departmentId: course?.departmentId ?? "",
      courseId: reqData.courseId,
      courseName: reqData.courseName,
      year: reqData.year,
      sectionId: reqData.sectionId,
      sectionName: reqData.sectionName,
      subjectId: reqData.subjectId,
      subjectName: reqData.subjectName,
      subjectCode: reqData.subjectCode,
      hoursPerWeek: reqData.hoursPerWeek,
      assignedBy: session.uid,
      assignedByName: session.role,
      createdAt: now,
      updatedAt: now,
      assignmentAcademicYear: "",
      assignmentSemester: "",
    });

    await reqRef.update({
      status: "ALLOCATED",
      allocatedFacultyId: body.facultyId,
      allocatedFacultyName: faculty.name ?? body.facultyName ?? "",
      allocatedBy: session.uid,
      teachingAssignmentId: taRef.id,
      updatedAt: now,
    });

    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "FACULTY_ASSIGNMENT_ALLOCATED",
      performedBy: session.uid,
      performedByName: session.role,
      targetId: id,
      details: { subjectName: reqData.subjectName, sectionName: reqData.sectionName, facultyName: faculty.name ?? "" },
      timestamp: now,
    });

    await notify(
      db, session.collegeId, reqData.requestedBy, "FACULTY_ASSIGNMENT_ALLOCATED",
      "Faculty assignment fulfilled",
      `${reqData.targetDepartmentName} assigned ${faculty.name ?? "a faculty member"} to ${reqData.subjectName} (Section ${reqData.sectionName}) - pick its weekly periods on the Timetable page`,
      "/hod/assignment-requests"
    );

    return NextResponse.json({ ok: true, teachingAssignmentId: taRef.id });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty-assignment-requests/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
