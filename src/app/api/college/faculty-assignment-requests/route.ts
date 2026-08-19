export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify } from "@/lib/notify";
import { getHodDepartmentScope, canHodEditDepartment, ownDepartmentNames } from "@/lib/departments/scope";
import { isTimetableIncharge } from "@/lib/departments/timetableIncharge";

// Lets an HOD ask an unrelated department (one they have no direct
// own/managed/feeder access to - see college/faculty/route.ts) to lend a
// faculty member for a subject on one of their own sections, instead of
// leaving it permanently unstaffed. The target department's HOD, or a
// Timetable Incharge for any course-year in that department, fulfills or
// declines it via PATCH /[id] (see isTimetableInchargeForDepartment there).
//
// A Timetable Incharge (see TimetableIncharge in src/types/core.ts) can send
// these too, for their own delegated course-year.

export async function GET() {
  try {
    const session = await requireCollegeMember(
      "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "DEAN", "PANEL_MEMBER", "COLLEGE_STAFF",
    );
    const db = getAdminDb();
    const coll = db.collection("colleges").doc(session.collegeId).collection("facultyAssignmentRequests");

    if (session.role === "PANEL_MEMBER" || session.role === "COLLEGE_STAFF") {
      // Every department this uid is Timetable Incharge for (any course-year)
      // - fulfilling an incoming request isn't tied to one specific
      // course-year, so this is broader than isTimetableIncharge's own
      // single-course-year check (see isTimetableInchargeForDepartment).
      const inchargeSnap = await db.collection("colleges").doc(session.collegeId)
        .collection("timetableIncharges").where("uid", "==", session.uid).get();
      const myDeptNames = Array.from(new Set(
        inchargeSnap.docs.map((d) => (d.data() as { departmentName?: string }).departmentName).filter((n): n is string => !!n)
      ));

      const [outgoingSnap, incomingSnap] = await Promise.all([
        coll.where("requestedBy", "==", session.uid).get(),
        myDeptNames.length > 0 ? coll.where("targetDepartmentName", "in", myDeptNames.slice(0, 30)).get() : Promise.resolve(null),
      ]);
      const seen = new Set<string>();
      const requests: { id: string; [key: string]: unknown }[] = [];
      for (const d of outgoingSnap.docs) { seen.add(d.id); requests.push({ id: d.id, ...d.data() }); }
      if (incomingSnap) {
        for (const d of incomingSnap.docs) {
          if (seen.has(d.id)) continue;
          seen.add(d.id);
          requests.push({ id: d.id, ...d.data() });
        }
      }
      requests.sort((a, b) => {
        const ta = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
        const tb = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
        return tb - ta;
      });
      return NextResponse.json({ requests });
    }

    if (session.role !== "HOD") {
      // Oversight roles see everything for the college.
      const snap = await coll.orderBy("createdAt", "desc").get();
      return NextResponse.json({ requests: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
    }

    const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
    // Own department + literal sub-departments only - NOT managed/grouped
    // branches. A request names a specific target department; only that
    // department (or its real parent, if it's a sub-department with no HOD
    // of its own) should see it, not whoever else happens to administer it
    // via a managedDepartments grouping (see ownDepartmentNames doc).
    const myNames = ownDepartmentNames(scope);

    const [outgoingSnap, incomingSnap] = await Promise.all([
      coll.where("requestedBy", "==", session.uid).get(),
      myNames.length > 0 ? coll.where("targetDepartmentName", "in", myNames.slice(0, 30)).get() : Promise.resolve(null),
    ]);

    const seen = new Set<string>();
    const requests: { id: string; [key: string]: unknown }[] = [];
    for (const d of outgoingSnap.docs) {
      seen.add(d.id);
      requests.push({ id: d.id, ...d.data() });
    }
    if (incomingSnap) {
      for (const d of incomingSnap.docs) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        requests.push({ id: d.id, ...d.data() });
      }
    }
    requests.sort((a, b) => {
      const ta = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      const tb = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      return tb - ta;
    });

    return NextResponse.json({ requests });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty-assignment-requests GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PANEL_MEMBER", "COLLEGE_STAFF");
    const body = (await request.json()) as {
      courseId?: string;
      sectionId?: string;
      subjectId?: string;
      targetDepartmentId?: string;
    };
    const { courseId, sectionId, subjectId, targetDepartmentId } = body;
    if (!courseId || !sectionId || !subjectId || !targetDepartmentId) {
      return NextResponse.json({ error: "courseId, sectionId, subjectId and targetDepartmentId are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const [courseSnap, sectionSnap, subjectSnap, targetDeptSnap] = await Promise.all([
      collegeRef.collection("courses").doc(courseId).get(),
      collegeRef.collection("sections").doc(sectionId).get(),
      collegeRef.collection("subjects").doc(subjectId).get(),
      collegeRef.collection("departments").doc(targetDepartmentId).get(),
    ]);
    if (!courseSnap.exists) return NextResponse.json({ error: "Course not found" }, { status: 404 });
    if (!sectionSnap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    if (!subjectSnap.exists) return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    if (!targetDeptSnap.exists) return NextResponse.json({ error: "Target department not found" }, { status: 404 });

    const course = courseSnap.data() as { name: string };
    const section = sectionSnap.data() as { name: string; year: number; department: string };
    const subject = subjectSnap.data() as { name: string; code: string; hoursPerWeek: number };
    const targetDept = targetDeptSnap.data() as { name: string; hodUid?: string };

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartment(scope, section.department)) {
        return NextResponse.json({ error: "Section is not in your department or one of your sub-departments" }, { status: 403 });
      }
    } else {
      const ok = await isTimetableIncharge(db, session.collegeId, session.uid, courseId, section.year);
      if (!ok) {
        return NextResponse.json({ error: "You are not the Timetable Incharge for this course & year" }, { status: 403 });
      }
    }
    if (targetDept.name === section.department) {
      return NextResponse.json({ error: "Pick a different department - this one already owns the section" }, { status: 400 });
    }

    const existingSnap = await collegeRef.collection("teachingAssignments")
      .where("sectionId", "==", sectionId).where("subjectId", "==", subjectId).get();
    if (existingSnap.docs.some((d) => !(d.data() as { isPast?: boolean }).isPast)) {
      return NextResponse.json({ error: "This subject already has a faculty member assigned for this section" }, { status: 409 });
    }

    const dupeSnap = await collegeRef.collection("facultyAssignmentRequests")
      .where("sectionId", "==", sectionId)
      .where("subjectId", "==", subjectId)
      .where("status", "==", "PENDING")
      .limit(1)
      .get();
    if (!dupeSnap.empty) {
      return NextResponse.json({ error: "A request for this subject and section is already pending" }, { status: 409 });
    }

    const requesterSnap = await collegeRef.collection("users").doc(session.uid).get();
    const requesterName = (requesterSnap.data() as { name?: string } | undefined)?.name ?? "HOD";

    const now = new Date();
    const ref = collegeRef.collection("facultyAssignmentRequests").doc();
    await ref.set({
      collegeId: session.collegeId,
      courseId,
      courseName: course.name,
      year: section.year,
      sectionId,
      sectionName: section.name,
      requestingDepartment: section.department,
      subjectId,
      subjectName: subject.name,
      subjectCode: subject.code,
      hoursPerWeek: subject.hoursPerWeek,
      targetDepartmentId,
      targetDepartmentName: targetDept.name,
      requestedBy: session.uid,
      requestedByName: requesterName,
      status: "PENDING",
      createdAt: now,
      updatedAt: now,
    });

    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "FACULTY_ASSIGNMENT_REQUESTED",
      performedBy: session.uid,
      performedByName: requesterName,
      targetId: ref.id,
      details: { subjectName: subject.name, sectionName: section.name, targetDepartment: targetDept.name },
      timestamp: now,
    });

    if (targetDept.hodUid) {
      await notify(
        db,
        session.collegeId,
        targetDept.hodUid,
        "FACULTY_ASSIGNMENT_REQUESTED",
        "Faculty assignment requested",
        `${requesterName} asked ${targetDept.name} to lend a faculty member for ${subject.name} (${course.name}, Section ${section.name})`,
        "/hod/assignment-requests"
      );
    }

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty-assignment-requests POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
