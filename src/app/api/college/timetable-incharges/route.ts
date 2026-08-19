export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartmentId } from "@/lib/departments/scope";
import { timetableInchargeDocId } from "@/lib/departments/timetableIncharge";
import type { TimetableIncharge } from "@/types";

// One person - PANEL_MEMBER (teaching faculty) or COLLEGE_STAFF (technical
// supporting staff) - the HOD delegates a specific course-year's Timetable
// and Teaching Assignments to - see TimetableIncharge's own doc-comment. HOD
// keeps full access regardless; this only ever adds a second way in for
// whoever's delegated.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF",
    );
    const { searchParams } = new URL(request.url);
    const departmentId = searchParams.get("departmentId");
    const mine = searchParams.get("mine") === "true";
    const courseId = searchParams.get("courseId");
    const yearParam = searchParams.get("year");

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    if (courseId && yearParam) {
      // One exact course-year (the HOD's own "who's Incharge here" check on
      // the section-list page, before drilling into a specific section) -
      // read is open to the same broad set as everything else here; only
      // POST/DELETE (actually assigning/revoking) are scope-checked.
      const snap = await collegeRef.collection("timetableIncharges").doc(timetableInchargeDocId(courseId, Number(yearParam))).get();
      const incharge = snap.exists ? ({ id: snap.id, ...snap.data() } as TimetableIncharge) : null;
      return NextResponse.json({ incharge });
    }

    let query: FirebaseFirestore.Query = collegeRef.collection("timetableIncharges");

    if (mine) {
      // A faculty member's own "what am I responsible for" view (see
      // panel/timetable-incharge/page.tsx) - never anyone else's.
      query = query.where("uid", "==", session.uid);
    } else if (departmentId) {
      // The HOD's own management view for one department - Principal/VP/
      // SuperAdmin may look up any department; an HOD is restricted to their
      // own scope (own + sub-departments + managed branches).
      if (session.role === "HOD") {
        const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
        if (!canHodEditDepartmentId(scope, departmentId)) {
          return NextResponse.json({ error: "This department isn't yours" }, { status: 403 });
        }
      }
      query = query.where("departmentId", "==", departmentId);
    } else {
      return NextResponse.json({ error: "departmentId or mine=true is required" }, { status: 400 });
    }

    const snap = await query.get();
    const incharges = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TimetableIncharge);
    return NextResponse.json({ incharges });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable-incharges GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Assigns/re-assigns - setting a new uid for a course-year that already has
// one just overwrites it (the previous Incharge simply loses access, same as
// any other permission change - nothing about their past edits is undone).
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      courseId?: string; year?: number; personId?: string; personType?: "FACULTY" | "SUPPORTING_STAFF";
    };
    const courseId = body.courseId?.trim();
    const year = body.year;
    const personId = body.personId?.trim();
    const personType = body.personType;
    if (!courseId || !year || !personId || !personType) {
      return NextResponse.json({ error: "courseId, year, personId and personType are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // Either a teaching faculty member (facultyMembers) or a technical
    // supporting-staff member (supportingStaff, staffCategory === "TECHNICAL"
    // only - see supporting-staff/route.ts's own department scoping, which
    // applies the same restriction) - both are department-scoped rosters an
    // HOD already manages, so either is a legitimate Timetable Incharge.
    const personColl = personType === "FACULTY" ? "facultyMembers" : "supportingStaff";
    const [courseSnap, personSnap] = await Promise.all([
      collegeRef.collection("courses").doc(courseId).get(),
      collegeRef.collection(personColl).doc(personId).get(),
    ]);
    if (!courseSnap.exists) return NextResponse.json({ error: "Course not found" }, { status: 404 });
    if (!personSnap.exists) return NextResponse.json({ error: "That person was not found" }, { status: 404 });

    const course = courseSnap.data() as { name: string; departmentId: string };
    const person = personSnap.data() as {
      name: string; department?: string; userUid?: string; staffCategory?: string;
    };

    if (personType === "SUPPORTING_STAFF" && person.staffCategory !== "TECHNICAL") {
      return NextResponse.json({ error: "Only Technical supporting staff can be made Timetable Incharge" }, { status: 400 });
    }

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartmentId(scope, course.departmentId)) {
        return NextResponse.json({ error: "This course isn't in your department or one of your sub-departments" }, { status: 403 });
      }
    }
    // The person must belong to the exact same department as the course -
    // unlike Teaching Assignments (which allows a sub-department's specialist
    // onto a parent-owned section), Timetable Incharge is a straightforward
    // "someone in this department" delegation, matching how the HOD picks
    // them (a plain department roster dropdown, no cascade).
    const departmentSnap = await collegeRef.collection("departments").doc(course.departmentId).get();
    const departmentName = (departmentSnap.data() as { name?: string } | undefined)?.name;
    if (person.department !== departmentName) {
      return NextResponse.json({ error: "That person isn't in this course's department" }, { status: 400 });
    }
    if (!person.userUid) {
      return NextResponse.json({ error: "That person has no login yet - they can't be made Timetable Incharge" }, { status: 400 });
    }

    const assignerSnap = await collegeRef.collection("users").doc(session.uid).get();
    const assignerName = (assignerSnap.data() as { name?: string } | undefined)?.name ?? "";

    const now = new Date();
    const id = timetableInchargeDocId(courseId, year);
    const ref = collegeRef.collection("timetableIncharges").doc(id);
    const existing = await ref.get();
    await ref.set({
      collegeId: session.collegeId,
      departmentId: course.departmentId,
      departmentName: departmentName ?? person.department ?? "",
      courseId,
      courseName: course.name,
      year: Number(year),
      uid: person.userUid,
      facultyName: person.name,
      assignedBy: session.uid,
      assignedByName: assignerName,
      updatedAt: now,
      ...(existing.exists ? {} : { createdAt: now }),
    }, { merge: true });

    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable-incharges POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Revokes - the course-year reverts to HOD-only, same as it was before any
// delegation existed. Never deletes the Incharge's past edits (teaching
// assignments/timetable slots they made stay exactly as they are).
export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const ref = collegeRef.collection("timetableIncharges").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (session.role === "HOD") {
      const { departmentId } = snap.data() as TimetableIncharge;
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartmentId(scope, departmentId)) {
        return NextResponse.json({ error: "This department isn't yours" }, { status: 403 });
      }
    }

    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable-incharges DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
