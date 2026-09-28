export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify } from "@/lib/notify";
import { getHodDepartmentScope, canHodEditDepartment, ownDepartmentNames } from "@/lib/departments/scope";
import { isTimetableInchargeForDepartment } from "@/lib/departments/timetableIncharge";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { isFacultyAvailable } from "@/types";
import type { DayOfWeek, FacultyAssignmentRequest } from "@/types";

const VALID_DAYS = new Set<DayOfWeek>(["MON", "TUE", "WED", "THU", "FRI", "SAT"]);

// Fulfills (allocate) or declines an incoming faculty-assignment request -
// the target department's HOD (or someone who edits that department, e.g.
// its own parent HOD), or a Timetable Incharge for ANY course-year in that
// department (see TimetableIncharge in src/types/core.ts - fulfilling isn't
// tied to one specific course-year, it's "does this department have anyone
// free"), may act on it. Allocating creates the actual TeachingAssignment
// record directly, filed under the *requesting* section's own department
// (matching how a normal direct assignment is filed). The lending side never
// places periods on the requester's timetable themselves - they only declare
// (via set_busy_periods) when the allocated faculty is already busy with
// their own department's classes; the requester places the subject on their
// own Timetable page via the usual "Add a subject" flow, which is blocked
// from those declared-busy cells the same way a real double-booking is (see
// busyPeriods merging into busyFaculty in src/lib/timetable/loadContext.ts).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("HOD", "PANEL_MEMBER", "COLLEGE_STAFF");
    const { id } = await params;
    const body = (await request.json()) as {
      action?: "allocate" | "decline" | "notify_timetable_updated" | "set_busy_periods";
      facultyId?: string;
      facultyName?: string;
      declineReason?: string;
      busyPeriods?: { day?: string; period?: number }[];
    };

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const reqRef = collegeRef.collection("facultyAssignmentRequests").doc(id);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists) return NextResponse.json({ error: "Request not found" }, { status: 404 });
    const reqData = reqSnap.data() as FacultyAssignmentRequest;

    const scope = session.role === "HOD" ? await getHodDepartmentScope(db, session.collegeId, session.uid) : null;
    if (scope) {
      // Own department/sub-departments only, not managed branches (see
      // ownDepartmentNames doc) - matches the GET route's incoming-list
      // filter, so a request that isn't listed here can't be acted on either.
      // Names the request's actual target department in the error - the most
      // common cause is the "Working As" switcher having moved to a
      // different department since the (now-stale) request list was loaded,
      // not a real permissions gap, and that's invisible without saying so.
      if (!ownDepartmentNames(scope).includes(reqData.targetDepartmentName)) {
        return NextResponse.json(
          { error: `This request was sent to ${reqData.targetDepartmentName}, not ${scope.departmentName || "your department"} - switch "Working As" and reload if you meant to act on it` },
          { status: 403 },
        );
      }
    } else {
      const ok = await isTimetableInchargeForDepartment(db, session.collegeId, session.uid, reqData.targetDepartmentName);
      if (!ok) {
        return NextResponse.json({ error: `This request was sent to ${reqData.targetDepartmentName}, not a department you're Timetable Incharge for` }, { status: 403 });
      }
    }

    const now = new Date();

    // The lending side's declaration of when the allocated faculty is
    // already busy (their own department's classes), expressed in the
    // REQUESTING section's own period numbering - see the doc-comment on
    // FacultyAssignmentRequest.busyPeriods. Always a full replace (same
    // convention as course-year-timings' semesters list), so removing an
    // entry client-side is just resubmitting the trimmed array.
    if (body.action === "set_busy_periods") {
      if (reqData.status !== "ALLOCATED") {
        return NextResponse.json({ error: "This request hasn't been allocated yet" }, { status: 409 });
      }
      const raw = body.busyPeriods ?? [];
      if (raw.length > 100) {
        return NextResponse.json({ error: "Too many busy periods" }, { status: 400 });
      }
      const busyPeriods: { day: DayOfWeek; period: number }[] = [];
      for (const bp of raw) {
        if (!bp.day || !VALID_DAYS.has(bp.day as DayOfWeek)) {
          return NextResponse.json({ error: `Invalid day: ${bp.day}` }, { status: 400 });
        }
        if (!Number.isInteger(bp.period) || (bp.period as number) < 1) {
          return NextResponse.json({ error: "Each period must be a positive number" }, { status: 400 });
        }
        busyPeriods.push({ day: bp.day as DayOfWeek, period: bp.period as number });
      }
      // De-dupe by day+period - a re-added entry shouldn't double up.
      const deduped = Array.from(
        new Map(busyPeriods.map((bp) => [`${bp.day}:${bp.period}`, bp])).values()
      );
      await reqRef.update({ busyPeriods: deduped, updatedAt: now });
      return NextResponse.json({ ok: true, busyPeriods: deduped });
    }

    // Fired once the lending side considers this lend "ready" - whether or
    // not they declared any busy periods (none can legitimately mean "fully
    // free") - so the requesting department knows they can go place the
    // subject on their own Timetable page.
    if (body.action === "notify_timetable_updated") {
      if (reqData.status !== "ALLOCATED") {
        return NextResponse.json({ error: "This request hasn't been allocated yet" }, { status: 409 });
      }
      await notify(
        db, session.collegeId, reqData.requestedBy, "FACULTY_ASSIGNMENT_ALLOCATED",
        "Ready to schedule",
        `${reqData.targetDepartmentName} shared ${reqData.allocatedFacultyName ?? "the allocated faculty"}'s busy periods for ${reqData.subjectName} (Section ${reqData.sectionName}) - you can now place it on your Timetable page`,
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
    const faculty = facultySnap.data() as { legalName?: string; department?: string; status?: string };
    const allocatedName = facultyDisplayName(faculty);
    // Defense-in-depth: the lending department's own picker already filters
    // to available faculty, but facultyId is still trusted input here.
    if (!isFacultyAvailable(faculty.status)) {
      return NextResponse.json({ error: "That faculty member is not currently available for teaching assignments" }, { status: 409 });
    }
    // An Incharge (no HOD scope tree) may only offer up faculty from the
    // exact department the request targeted - an HOD may also reach into a
    // sub-department's own faculty, same as before.
    const facultyInScope = scope
      ? canHodEditDepartment(scope, faculty.department ?? "")
      : faculty.department === reqData.targetDepartmentName;
    if (!facultyInScope) {
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
      facultyName: allocatedName || body.facultyName || "",
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
      allocatedFacultyName: allocatedName || body.facultyName || "",
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
      details: { subjectName: reqData.subjectName, sectionName: reqData.sectionName, facultyName: allocatedName },
      timestamp: now,
    });

    await notify(
      db, session.collegeId, reqData.requestedBy, "FACULTY_ASSIGNMENT_ALLOCATED",
      "Faculty assignment fulfilled",
      `${reqData.targetDepartmentName} assigned ${allocatedName || "a faculty member"} to ${reqData.subjectName} (Section ${reqData.sectionName}) - pick its weekly periods on the Timetable page`,
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
