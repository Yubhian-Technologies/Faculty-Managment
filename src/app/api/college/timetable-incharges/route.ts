export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartmentId } from "@/lib/departments/scope";
import { findBranchManager, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import { timetableInchargeDocId } from "@/lib/departments/timetableIncharge";
import type { TimetableIncharge } from "@/types";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";

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
      // own scope (own + sub-departments + managed branches). `departmentId`
      // is already explicit here, so check against the HOD's FULL authority
      // (activeOnly: false) rather than whichever department merely happens
      // to be active in the Working-as switcher - see getHodDepartmentScope.
      if (session.role === "HOD") {
        const scope = await getHodDepartmentScope(db, session.collegeId, session.uid, { activeOnly: false });
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
//
// `courseIds` (plural) is the shared-first-year form: a sub-department (e.g.
// "BASIC SCIENCE ENGLISH") manages several branches' own Year-1 course docs
// (e.g. "data science", "machine learning" - see Department.managedDepartments/
// findBranchManager), each with its OWN Course doc and its OWN
// TimetableIncharge doc (isTimetableIncharge stays keyed by courseId+year for
// every existing write-route check) - but the HOD picking one person to cover
// that whole sub-department shouldn't have to repeat this dialog once per
// branch. One request writes one doc per courseId, all pointing at the same
// person. `courseId` (singular) is kept for a plain, non-shared course-year -
// behaviorally identical to passing `courseIds: [courseId]`, minus the
// same-owner-department relaxation below (a person there must belong to the
// course's own department, exactly as before).
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      courseId?: string; courseIds?: string[]; year?: number; personId?: string; personType?: "FACULTY" | "SUPPORTING_STAFF";
    };
    const courseIds = (body.courseIds?.length ? body.courseIds : body.courseId ? [body.courseId] : [])
      .map((c) => c.trim())
      .filter(Boolean);
    const isBatch = Boolean(body.courseIds?.length);
    const year = body.year;
    const personId = body.personId?.trim();
    const personType = body.personType;
    if (courseIds.length === 0 || !year || !personId || !personType) {
      return NextResponse.json({ error: "courseId(s), year, personId and personType are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // Either a teaching faculty member (facultyMembers) or a technical
    // supporting-staff member (supportingStaff, staffCategory === "TECHNICAL"
    // only - see supporting-staff/route.ts's own department scoping, which
    // applies the same restriction) - both are department-scoped rosters an
    // HOD already manages, so either is a legitimate Timetable Incharge.
    const personColl = personType === "FACULTY" ? "facultyMembers" : "supportingStaff";
    const [courseSnaps, personSnap, departmentsSnap] = await Promise.all([
      Promise.all(courseIds.map((id) => collegeRef.collection("courses").doc(id).get())),
      collegeRef.collection(personColl).doc(personId).get(),
      collegeRef.collection("departments").get(),
    ]);
    const missingCourse = courseSnaps.findIndex((s) => !s.exists);
    if (missingCourse !== -1) return NextResponse.json({ error: "Course not found" }, { status: 404 });
    if (!personSnap.exists) return NextResponse.json({ error: "That person was not found" }, { status: 404 });

    const courses = courseSnaps.map((s) => ({ id: s.id, ...(s.data() as { name: string; departmentId: string; catalogId?: string }) }));
    const person = personSnap.data() as {
      name?: string; legalName?: string; department?: string; userUid?: string; staffCategory?: string;
    };
    const departments = departmentsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DepartmentYearRow, "id">) }));
    const departmentById = new Map(departments.map((d) => [d.id, d]));

    if (personType === "SUPPORTING_STAFF" && person.staffCategory !== "TECHNICAL") {
      return NextResponse.json({ error: "Only Technical supporting staff can be made Timetable Incharge" }, { status: 400 });
    }

    if (session.role === "HOD") {
      // Each course's departmentId is already explicit, so authorize against
      // the HOD's FULL scope (every department they actually head, including
      // managed branches), not just whichever one is currently active in the
      // Working-as switcher - otherwise assigning an Incharge for a course in
      // the HOD's OTHER department fails purely because the switcher happens
      // to be parked elsewhere. See getHodDepartmentScope's activeOnly option.
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid, { activeOnly: false });
      const unauthorized = courses.find((c) => !canHodEditDepartmentId(scope, c.departmentId));
      if (unauthorized) {
        return NextResponse.json({ error: "This course isn't in your department or one of your sub-departments" }, { status: 403 });
      }
    }

    // Single-course callers keep the original strict rule: the person must
    // belong to the exact same department as the course - unlike Teaching
    // Assignments (which allows a sub-department's specialist onto a
    // parent-owned section), Timetable Incharge is normally a straightforward
    // "someone in this department" delegation, no cascade.
    //
    // A batch call is different by construction: every branch course here
    // shares ONE managing sub-department (that's the whole point of grouping
    // them). `ownerName` resolves to that shared manager (findBranchManager) -
    // or, for a standalone branch with no manager, its own name, same as the
    // non-batch rule. Every course in the batch must resolve to the SAME
    // owner, or the batch doesn't actually represent one coherent unit. The
    // person, in turn, may belong to that owning sub-department itself, to
    // any one of the branches it manages (`branchNames` - e.g. "data
    // science", "machine learning"), OR to the owner's own PARENT department
    // (e.g. "BASIC SCIENCE") - a sub-department rarely has much of its own
    // dedicated roster; most of its faculty commonly sit at the parent
    // instead (see the Faculty Register's "Sub-Department HODs" grouping).
    let ownerName: string | undefined;
    let ownerDept: DepartmentYearRow | undefined;
    const branchNames = new Set<string>();
    for (const c of courses) {
      const deptName = departmentById.get(c.departmentId)?.name;
      if (!deptName) return NextResponse.json({ error: "Course department not found" }, { status: 404 });
      branchNames.add(deptName);
      const manager = isBatch ? findBranchManager(departments, deptName, c.catalogId) : null;
      const resolved = manager?.department.name ?? deptName;
      if (ownerName === undefined) {
        ownerName = resolved;
        ownerDept = manager?.department ?? departmentById.get(c.departmentId);
      } else if (ownerName !== resolved) {
        return NextResponse.json({ error: "These courses don't share one managing department" }, { status: 400 });
      }
    }
    const ownerParentName = ownerDept?.parentDepartmentId ? departmentById.get(ownerDept.parentDepartmentId)?.name : undefined;
    const eligibleNames = new Set([ownerName, ...(isBatch ? branchNames : []), ...(isBatch && ownerParentName ? [ownerParentName] : [])]);
    if (!person.department || !eligibleNames.has(person.department)) {
      return NextResponse.json(
        { error: isBatch ? "That person isn't in this sub-department, its parent department, or one of the branches it manages" : "That person isn't in this course's department" },
        { status: 400 },
      );
    }
    if (!person.userUid) {
      return NextResponse.json({ error: "That person has no login yet - they can't be made Timetable Incharge" }, { status: 400 });
    }

    const assignerSnap = await collegeRef.collection("users").doc(session.uid).get();
    const assignerName = (assignerSnap.data() as { name?: string } | undefined)?.name ?? "";
    const facultyName = personType === "FACULTY" ? facultyDisplayName(person) : (person.name ?? "");

    const now = new Date();
    const ids = await Promise.all(courses.map(async (c) => {
      const id = timetableInchargeDocId(c.id, year);
      const ref = collegeRef.collection("timetableIncharges").doc(id);
      const existing = await ref.get();
      await ref.set({
        collegeId: session.collegeId,
        departmentId: c.departmentId,
        departmentName: departmentById.get(c.departmentId)?.name ?? person.department ?? "",
        courseId: c.id,
        courseName: c.name,
        year: Number(year),
        uid: person.userUid,
        facultyName,
        assignedBy: session.uid,
        assignedByName: assignerName,
        updatedAt: now,
        ...(existing.exists ? {} : { createdAt: now }),
      }, { merge: true });
      return id;
    }));

    return NextResponse.json(isBatch ? { ids } : { id: ids[0] });
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
// `ids` (comma-separated, plural) revokes a whole shared-first-year batch -
// one Timetable Incharge doc per branch course-year - in one call, each
// individually scope-checked exactly like a single `id` delete.
export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const idsParam = searchParams.get("ids");
    const id = searchParams.get("id");
    const ids = idsParam ? idsParam.split(",").map((s) => s.trim()).filter(Boolean) : id ? [id] : [];
    if (ids.length === 0) return NextResponse.json({ error: "id or ids is required" }, { status: 400 });

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const scope = session.role === "HOD"
      ? await getHodDepartmentScope(db, session.collegeId, session.uid, { activeOnly: false })
      : null;

    const refs = ids.map((docId) => collegeRef.collection("timetableIncharges").doc(docId));
    const snaps = await Promise.all(refs.map((r) => r.get()));
    for (const snap of snaps) {
      if (!snap.exists) continue; // already revoked/never existed - deleting the rest of the batch still proceeds
      if (scope) {
        // Same activeOnly: false reasoning as POST above - the record's own
        // departmentId is already explicit.
        const { departmentId } = snap.data() as TimetableIncharge;
        if (!canHodEditDepartmentId(scope, departmentId)) {
          return NextResponse.json({ error: "This department isn't yours" }, { status: 403 });
        }
      }
    }

    await Promise.all(refs.map((r) => r.delete()));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable-incharges DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
