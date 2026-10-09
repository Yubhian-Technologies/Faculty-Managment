export const dynamic = "force-dynamic";

import { MAX_FACULTY_PER_SUBJECT } from "@/lib/teaching/facultyCap";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify } from "@/lib/notify";
import { getHodDepartmentScope, canHodEditDepartment, facultyManageableDepartmentNames } from "@/lib/departments/scope";
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

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS", "PANEL_MEMBER", "COLLEGE_STAFF",
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
      // Timetable editor only: allocated lends onto the section this Incharge
      // is delegated, even when someone else raised them (same as the HOD path).
      const incharSectionId = new URL(request.url).searchParams.get("sectionId");
      if (incharSectionId) {
        const sec = (await db.collection("colleges").doc(session.collegeId).collection("sections").doc(incharSectionId).get())
          .data() as { courseId?: string; year?: number } | undefined;
        if (sec?.courseId && sec.year != null && await isTimetableIncharge(db, session.collegeId, session.uid, sec.courseId, sec.year)) {
          const allocatedSnap = await coll.where("sectionId", "==", incharSectionId).where("status", "==", "ALLOCATED").get();
          for (const d of allocatedSnap.docs) {
            if (seen.has(d.id)) continue;
            seen.add(d.id);
            requests.push({ id: d.id, ...d.data() });
          }
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
    // Every department this HOD heads, not just the one picked in "Working
    // as": a request from one of their departments (IT) to another they also
    // head (CSBS) must reach them, whichever one they happen to be working in.
    const allScope = await getHodDepartmentScope(db, session.collegeId, session.uid, { activeOnly: false });
    const myNames = facultyManageableDepartmentNames(allScope);

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
    // Timetable editor only: every allocated lend onto this section, not just
    // the ones this person raised. Placing a lent-in subject is the section's
    // HOD / Sub-HOD's job, and the request may have been raised by someone
    // else in that department - without it the subject never reaches their
    // "Add a subject" picker. Gated by the same rule as the draft route
    // (canHodEditDepartment on the section's department).
    const sectionId = new URL(request.url).searchParams.get("sectionId");
    if (sectionId) {
      const sectionSnap = await db.collection("colleges").doc(session.collegeId).collection("sections").doc(sectionId).get();
      const sectionDepartment = (sectionSnap.data() as { department?: string } | undefined)?.department;
      if (sectionDepartment && canHodEditDepartment(scope, sectionDepartment)) {
        const allocatedSnap = await coll.where("sectionId", "==", sectionId).where("status", "==", "ALLOCATED").get();
        for (const d of allocatedSnap.docs) {
          if (seen.has(d.id)) continue;
          seen.add(d.id);
          requests.push({ id: d.id, ...d.data() });
        }
      }
    }
    requests.sort((a, b) => {
      const ta = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      const tb = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      return tb - ta;
    });

    return NextResponse.json({ requests });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
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
    const body = (await readJsonBody(request)) as {
      courseId?: string;
      sectionId?: string;
      subjectId?: string;
      targetDepartmentId?: string;
      // The same subject may be asked of several departments at once: one request goes to each.
      targetDepartmentIds?: string[];
    };
    const { courseId, sectionId, subjectId } = body;
    const targetDepartmentIds = Array.from(new Set(
      [...(body.targetDepartmentIds ?? []), ...(body.targetDepartmentId ? [body.targetDepartmentId] : [])].filter(Boolean),
    ));
    if (!courseId || !sectionId || !subjectId || targetDepartmentIds.length === 0) {
      return NextResponse.json({ error: "courseId, sectionId, subjectId and at least one target department are required" }, { status: 400 });
    }
    if (targetDepartmentIds.length > 20) {
      return NextResponse.json({ error: "At most 20 departments at a time" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const [courseSnap, sectionSnap, subjectSnap, targetDeptSnaps] = await Promise.all([
      collegeRef.collection("courses").doc(courseId).get(),
      collegeRef.collection("sections").doc(sectionId).get(),
      collegeRef.collection("subjects").doc(subjectId).get(),
      db.getAll(...targetDepartmentIds.map((id) => collegeRef.collection("departments").doc(id))),
    ]);
    if (!courseSnap.exists) return NextResponse.json({ error: "Course not found" }, { status: 404 });
    if (!sectionSnap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    if (!subjectSnap.exists) return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    if (targetDeptSnaps.some((d) => !d.exists)) return NextResponse.json({ error: "Target department not found" }, { status: 404 });

    const course = courseSnap.data() as { name: string };
    const section = sectionSnap.data() as { name: string; year: number; department: string };
    const subject = subjectSnap.data() as { name: string; code: string; hoursPerWeek: number };

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
    // A subject that already has faculty can still be asked of other departments (to add more),
    // up to the most faculty one subject can have in a section.
    const existingSnap = await collegeRef.collection("teachingAssignments")
      .where("sectionId", "==", sectionId).where("subjectId", "==", subjectId).get();
    const assignedCount = existingSnap.docs.filter((d) => !(d.data() as { isPast?: boolean }).isPast).length;
    if (assignedCount >= MAX_FACULTY_PER_SUBJECT) {
      return NextResponse.json({ error: `This subject already has ${MAX_FACULTY_PER_SUBJECT} faculty for this section - the most allowed` }, { status: 409 });
    }

    // One request per department; a department that already has an open request for this subject
    // and section is skipped (no duplicates to the same department), the rest still go.
    const openSnap = await collegeRef.collection("facultyAssignmentRequests")
      .where("sectionId", "==", sectionId)
      .where("subjectId", "==", subjectId)
      .where("status", "==", "PENDING")
      .get();
    const alreadyAsked = new Set(openSnap.docs.map((d) => (d.data() as { targetDepartmentId?: string }).targetDepartmentId));

    const requesterSnap = await collegeRef.collection("users").doc(session.uid).get();
    const requesterName = (requesterSnap.data() as { name?: string } | undefined)?.name ?? "HOD";

    const now = new Date();
    const created: { id: string; departmentName: string }[] = [];
    const skipped: { departmentName: string; reason: string }[] = [];
    for (const targetDeptSnap of targetDeptSnaps) {
      const targetDepartmentId = targetDeptSnap.id;
      const targetDept = targetDeptSnap.data() as { name: string; hodUid?: string };
      if (alreadyAsked.has(targetDepartmentId)) {
        skipped.push({ departmentName: targetDept.name, reason: "A request for this subject and section is already pending with them" });
        continue;
      }
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
      created.push({ id: ref.id, departmentName: targetDept.name });
    }

    if (created.length === 0) {
      return NextResponse.json({ error: skipped[0]?.reason ?? "Nothing to send", skipped }, { status: 409 });
    }
    return NextResponse.json({ id: created[0].id, created, skipped }, { status: 201 });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty-assignment-requests POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// The requesting side takes back a request it sent (same people who may send
// one: the section's HOD, or the Timetable Incharge for its course-year).
// Only a request still waiting (PENDING) or already declined can go - an
// allocated one has a real assignment behind it, which is removed from the
// assignment itself.
export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PANEL_MEMBER", "COLLEGE_STAFF");
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const ref = collegeRef.collection("facultyAssignmentRequests").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Request not found" }, { status: 404 });
    const req = snap.data() as { status?: string; courseId?: string; year?: number; sectionId?: string; requestingDepartment?: string; requestedBy?: string };
    if (req.status === "ALLOCATED") {
      return NextResponse.json({ error: "This request is already allocated - remove the teaching assignment instead" }, { status: 409 });
    }

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (req.requestedBy !== session.uid && !canHodEditDepartment(scope, req.requestingDepartment ?? "")) {
        return NextResponse.json({ error: "This request is not from your department or one of your sub-departments" }, { status: 403 });
      }
    } else {
      const ok = req.courseId && req.year != null
        && await isTimetableIncharge(db, session.collegeId, session.uid, req.courseId, req.year);
      if (!ok) {
        return NextResponse.json({ error: "You are not the Timetable Incharge for this course & year" }, { status: 403 });
      }
    }

    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty-assignment-requests DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
