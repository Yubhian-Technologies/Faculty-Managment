export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import {
  findBranchClaimConflicts,
  branchClaimConflictMessage,
  type DepartmentClaimRow,
} from "@/lib/departments/managedBranches";
import { validateAssignedYears, validateSecondaryDepartmentNames } from "@/lib/departments/courseScopeValidation";

// yyyy-mm-dd, the same shape StudentRecord.dateOfBirth already uses.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE", "ACCOUNTS", "COLLEGE_ACCOUNTS", "PANEL_MEMBER", "EXAM_CELL", "DEAN");

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const [snap, hodSnap] = await Promise.all([
      collegeRef.collection("departments").orderBy("name").get(),
      collegeRef.collection("users").where("role", "==", "HOD").get(),
    ]);

    // Self-heal hodUid/hodName drift: these fields only update when
    // explicitly written (Assign HOD save, syncDepartmentHod on account
    // create/edit - see src/lib/departments/scope.ts). If a department's
    // recorded HOD disagrees with who actually has this department on their
    // own login (the field that drives their real dashboard access), fix the
    // department doc here - so "No HOD assigned" can't linger while that HOD
    // is actively working, and anything else keyed off hodUid (budget/
    // recruitment/indent routing) sees the correct person too. Departments
    // with more than one HOD login claiming them are left untouched rather
    // than guessed.
    //
    // An HOD's `departments` array can legitimately list more than one
    // department (see college/departments PATCH below) - the SAME uid
    // appearing against several department names here is expected, not a
    // drift signal. Only two *different* HOD logins both claiming the same
    // department name is a real conflict.
    const hodByDepartment = new Map<string, { uid: string; name: string }>();
    const ambiguousDepartments = new Set<string>();
    for (const doc of hodSnap.docs) {
      const data = doc.data() as { department?: string; departments?: string[]; name?: string };
      const depts = (data.departments && data.departments.length > 0 ? data.departments : [data.department ?? ""])
        .map((d) => d.trim())
        .filter(Boolean);
      for (const dept of depts) {
        const existing = hodByDepartment.get(dept);
        if (existing && existing.uid !== doc.id) ambiguousDepartments.add(dept);
        else hodByDepartment.set(dept, { uid: doc.id, name: data.name ?? "" });
      }
    }

    const departments = await Promise.all(
      snap.docs.map(async (d) => {
        const data = d.data() as { name?: string; hodUid?: string; hodName?: string };
        const name = data.name?.trim() ?? "";
        const actualHod = ambiguousDepartments.has(name) ? undefined : hodByDepartment.get(name);

        if (actualHod && actualHod.uid !== data.hodUid) {
          await d.ref.update({ hodUid: actualHod.uid, hodName: actualHod.name, updatedAt: new Date() }).catch(() => {});
          return { id: d.id, ...data, hodUid: actualHod.uid, hodName: actualHod.name };
        }
        if (!actualHod && data.hodUid && !ambiguousDepartments.has(name)) {
          // Recorded HOD no longer actually has this department on their own login.
          await d.ref.update({ hodUid: "", hodName: "", updatedAt: new Date() }).catch(() => {});
          return { id: d.id, ...data, hodUid: "", hodName: "" };
        }
        return { id: d.id, ...data };
      })
    );

    return NextResponse.json({ departments });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/departments GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD");

    const body = (await request.json()) as {
      name: string;
      code: string;
      hodUid?: string;
      hodName?: string;
      hasSubDepartments?: boolean;
      parentDepartmentId?: string;
      secondaryDepartments?: string[];
      managedDepartments?: string[];
      assignedYears?: number[];
      commonYearStart?: string;
      commonYearEnd?: string;
    };

    const { name, code, hodUid, hodName } = body;

    if (!name || !code) {
      return NextResponse.json({ error: "Name and code are required" }, { status: 400 });
    }

    const collegeId = session.collegeId;
    const db = getAdminDb();
    const now = new Date();

    // Years taught can now be set at creation (it used to be edit-only), so a
    // Principal configuring e.g. a shared first-year department gets it right
    // in one step rather than creating it and immediately editing it.
    let assignedYears: number[] | undefined;
    if (body.assignedYears !== undefined) {
      if (!Array.isArray(body.assignedYears)) {
        return NextResponse.json({ error: "assignedYears must be an array" }, { status: 400 });
      }
      assignedYears = Array.from(new Set(body.assignedYears.map(Number).filter((y) => Number.isFinite(y))));
      const yearsError = await validateAssignedYears(db, collegeId, assignedYears);
      if (yearsError) return NextResponse.json({ error: yearsError }, { status: 400 });
    }

    // Approximate period the shared first year runs for. Advisory only - it
    // gives the Principal's cohort-advance screen its context, and never gates
    // a write.
    const commonYearStart = body.commonYearStart?.trim() || undefined;
    const commonYearEnd = body.commonYearEnd?.trim() || undefined;
    for (const [label, value] of [["commonYearStart", commonYearStart], ["commonYearEnd", commonYearEnd]] as const) {
      if (value !== undefined && !DATE_RE.test(value)) {
        return NextResponse.json({ error: `${label} must be a yyyy-mm-dd date` }, { status: 400 });
      }
    }
    if (commonYearStart && commonYearEnd && commonYearEnd < commonYearStart) {
      return NextResponse.json({ error: "First-year period end must be on or after its start" }, { status: 400 });
    }

    // Department name and code are the join keys the whole scoping model relies
    // on: getHodDepartmentScope resolves an HOD to their department BY NAME
    // (where("name","==",name).limit(1)), and sections/students store the
    // department as that name string. Two departments sharing a name would make
    // a section under either visible to the other's HOD, so names must be unique
    // per college. Codes must be unique too - they seed batch IDs and reports
    // (the import route already enforces this; the manual add didn't). Match is
    // case-insensitive. This is the single read the secondary/managed blocks
    // below reuse instead of re-fetching the collection.
    const trimmedName = name.trim();
    const upperCode = code.toUpperCase().trim();
    const existingDeptsSnap = await db.collection("colleges").doc(collegeId).collection("departments").get();
    for (const d of existingDeptsSnap.docs) {
      const data = d.data() as { name?: string; code?: string };
      if ((data.name ?? "").trim().toLowerCase() === trimmedName.toLowerCase()) {
        return NextResponse.json({ error: `A department named "${trimmedName}" already exists` }, { status: 409 });
      }
      if ((data.code ?? "").toUpperCase().trim() === upperCode) {
        return NextResponse.json({ error: `Short code "${upperCode}" is already used by another department` }, { status: 409 });
      }
    }
    const deptByName = new Map(
      existingDeptsSnap.docs.map((d) => [(d.data() as { name?: string }).name ?? "", d.data() as { parentDepartmentId?: string }])
    );

    // Cross-listing can be set on either a top-level department (by
    // Principal/VP) or a sub-department (by its parent's HOD, right here at
    // sub-department creation). The *target* must always be a top-level
    // department, never another sub-department. A department can cross-list
    // to more than one other department (e.g. a shared first-year department
    // feeding both CSE and ECE).
    let secondaryDepartments: string[] = [];
    if (body.secondaryDepartments && body.secondaryDepartments.length > 0) {
      const names = Array.from(new Set(body.secondaryDepartments.map((s) => s.trim()).filter(Boolean)));
      if (names.includes(name.trim())) {
        return NextResponse.json({ error: "Secondary department must be different from this department" }, { status: 400 });
      }
      const byName = deptByName;
      for (const secName of names) {
        const secDept = byName.get(secName);
        if (!secDept) {
          return NextResponse.json({ error: `Secondary department "${secName}" not found` }, { status: 400 });
        }
        if (secDept.parentDepartmentId) {
          return NextResponse.json({ error: `"${secName}" is a sub-department and can't be used as a secondary department` }, { status: 400 });
        }
      }
      secondaryDepartments = names;
    }

    // Grouped/managed branches: the top-level departments this (sub-)department's
    // HOD gets FULL control of. Same validation as secondaryDepartments - the
    // target must be an existing top-level department, never a sub-department -
    // but a different field with different meaning (full management vs view-only
    // cross-listing), so it's resolved into the sub-HOD's editable scope.
    let managedDepartments: string[] = [];
    if (body.managedDepartments && body.managedDepartments.length > 0) {
      const names = Array.from(new Set(body.managedDepartments.map((s) => s.trim()).filter(Boolean)));
      if (names.includes(name.trim())) {
        return NextResponse.json({ error: "Managed department must be different from this department" }, { status: 400 });
      }
      const byName = deptByName;
      for (const mName of names) {
        const mDept = byName.get(mName);
        if (!mDept) {
          return NextResponse.json({ error: `Managed department "${mName}" not found` }, { status: 400 });
        }
        if (mDept.parentDepartmentId) {
          return NextResponse.json({ error: `"${mName}" is a sub-department and can't be used as a managed department` }, { status: 400 });
        }
      }
      // A branch may be grouped under only ONE sub-department - see
      // src/lib/departments/managedBranches.ts. Re-checked inside the
      // transaction below so two concurrent creates can't both claim it.
      const conflicts = findBranchClaimConflicts(
        existingDeptsSnap.docs.map((d) => ({ ...(d.data() as DepartmentClaimRow), id: d.id })),
        names
      );
      if (conflicts.length > 0) {
        return NextResponse.json({ error: branchClaimConflictMessage(conflicts) }, { status: 409 });
      }
      managedDepartments = names;
    }

    // An HOD may only create a sub-department under their own department,
    // and only when their Principal has enabled sub-departments for it -
    // this is what "sub-HOD" management looks like: it's just this same
    // POST, scoped to a parentDepartmentId the caller owns.
    let parentDepartmentId: string | undefined;
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, collegeId, session.uid);
      if (!body.parentDepartmentId || !scope.ownDepartmentIds.includes(body.parentDepartmentId)) {
        return NextResponse.json({ error: "You can only add sub-departments under your own department" }, { status: 403 });
      }
      const ownDeptSnap = await db.collection("colleges").doc(collegeId).collection("departments").doc(body.parentDepartmentId).get();
      if (!(ownDeptSnap.data() as { hasSubDepartments?: boolean } | undefined)?.hasSubDepartments) {
        return NextResponse.json({ error: "Sub-departments are not enabled for your department" }, { status: 403 });
      }
      parentDepartmentId = body.parentDepartmentId;
    }

    const deptsColl = db.collection("colleges").doc(collegeId).collection("departments");
    const docData = {
      collegeId,
      name: name.trim(),
      code: code.toUpperCase().trim(),
      hodUid: hodUid ?? "",
      hodName: hodName ?? "",
      isActive: true,
      ...(parentDepartmentId ? { parentDepartmentId } : {}),
      ...(session.role !== "HOD" && body.hasSubDepartments ? { hasSubDepartments: true } : {}),
      // Years taught and the shared-first-year period are Principal/VP territory,
      // exactly as they are on PATCH - an HOD creating a sub-department here
      // can set its Sub-HOD and grouping, nothing that redefines the academic
      // calendar. Stripped rather than rejected so the sub-department flow
      // (hod/settings/sub-departments) keeps working unchanged.
      ...(session.role !== "HOD" && assignedYears !== undefined ? { assignedYears } : {}),
      ...(session.role !== "HOD" && commonYearStart !== undefined ? { commonYearStart } : {}),
      ...(session.role !== "HOD" && commonYearEnd !== undefined ? { commonYearEnd } : {}),
      ...(secondaryDepartments.length > 0 ? { secondaryDepartments } : {}),
      ...(managedDepartments.length > 0 ? { managedDepartments } : {}),
      createdAt: now,
      updatedAt: now,
    };

    let ref: FirebaseFirestore.DocumentReference;
    if (managedDepartments.length > 0) {
      // Grouping branches is the one constraint here that must hold under
      // concurrency: without a re-read inside the transaction, two sub-departments
      // created at nearly the same time could both pass the check above and both
      // claim the same branch. Mirrors the no-double-booking transaction in
      // college/hiring-batches/route.ts. (Name/code uniqueness above remains a
      // plain read-and-loop, as it has always been.)
      ref = deptsColl.doc();
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(deptsColl);
        const conflicts = findBranchClaimConflicts(
          fresh.docs.map((d) => ({ ...(d.data() as DepartmentClaimRow), id: d.id })),
          managedDepartments
        );
        if (conflicts.length > 0) throw new Error(`BRANCH_CLAIMED:${branchClaimConflictMessage(conflicts)}`);
        tx.set(ref, docData);
      });
    } else {
      ref = await deptsColl.add(docData);
    }

    // Keep the HOD's own profile department in sync - faculty-requirement
    // and other HOD-scoped routes resolve department from their user doc,
    // not from the department's hodUid pointer. Additive: this HOD may
    // already head other departments, which stay untouched.
    if (hodUid) {
      await db.collection("colleges").doc(collegeId).collection("users").doc(hodUid)
        .update({ department: name.trim(), departments: FieldValue.arrayUnion(name.trim()), updatedAt: now })
        .catch(() => {});
    }

    await db
      .collection("colleges")
      .doc(collegeId)
      .collection("auditLogs")
      .add({
        collegeId,
        action: "DEPARTMENT_CREATED" as string,
        performedBy: session.uid,
        performedByName: session.role === "HOD" ? "HOD" : "Principal",
        targetId: ref.id,
        details: { name, code, ...(parentDepartmentId ? { parentDepartmentId } : {}) },
        timestamp: now,
      });

    return NextResponse.json({ deptId: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof Error && err.message.startsWith("BRANCH_CLAIMED:")) {
      return NextResponse.json({ error: err.message.slice("BRANCH_CLAIMED:".length) }, { status: 409 });
    }
    console.error("[college/departments POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD");
    const { searchParams } = new URL(request.url);
    const deptId = searchParams.get("deptId");
    if (!deptId) {
      return NextResponse.json({ error: "deptId required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;
    const deptRef = db.collection("colleges").doc(collegeId).collection("departments").doc(deptId);
    const deptSnap = await deptRef.get();
    if (!deptSnap.exists) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }
    const dept = deptSnap.data() as { name: string; hodUid?: string; parentDepartmentId?: string; managedDepartments?: string[] };

    // An HOD may only delete a sub-department under their own department -
    // this is the "sub-HOD" management surface, not general department admin.
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, collegeId, session.uid);
      if (!dept.parentDepartmentId || !scope.ownDepartmentIds.includes(dept.parentDepartmentId)) {
        return NextResponse.json({ error: "You can only delete sub-departments under your own department" }, { status: 403 });
      }
    }

    // Refuse to delete a department that still has sub-departments - otherwise
    // a main department can be removed while its sub-department (and that
    // sub-department's own students/sections) are still intact, orphaning the
    // sub-department's `parentDepartmentId` pointer. Cleanup must go
    // bottom-up: delete the sub-departments first.
    const childDeptsSnap = await db
      .collection("colleges")
      .doc(collegeId)
      .collection("departments")
      .where("parentDepartmentId", "==", deptId)
      .limit(1)
      .get();
    if (!childDeptsSnap.empty) {
      return NextResponse.json(
        { error: "Cannot delete a department that still has sub-departments. Remove them first." },
        { status: 409 }
      );
    }

    // Refuse to delete a department that still has students or sections -
    // deleting it would silently orphan their `department` string references.
    // A shared-first-year student stays filed under their common department
    // (preserved until promotion) with secondaryDepartment naming this
    // department instead, when THIS department is their real destination
    // branch - the department-only check misses them entirely, which would
    // let a branch with a live, un-promoted cohort be deleted outright.
    const [studentsSnap, studentsSecondarySnap, sectionsSnap] = await Promise.all([
      db.collection("colleges").doc(collegeId).collection("students").where("department", "==", dept.name).limit(1).get(),
      db.collection("colleges").doc(collegeId).collection("students").where("secondaryDepartment", "==", dept.name).limit(1).get(),
      db.collection("colleges").doc(collegeId).collection("sections").where("department", "==", dept.name).limit(1).get(),
    ]);
    if (!studentsSnap.empty || !studentsSecondarySnap.empty || !sectionsSnap.empty) {
      return NextResponse.json(
        { error: "Cannot delete a department that still has students or sections. Remove them first." },
        { status: 409 }
      );
    }

    // A sub-department that still manages real branches (Department.
    // managedDepartments) with their own active students/sections can't be
    // deleted either - those branches would become unreachable by any HOD
    // until re-grouped elsewhere. Remove them from Managed Departments first.
    const managedBranches = dept.managedDepartments ?? [];
    if (managedBranches.length > 0) {
      const branchChecks = await Promise.all(
        managedBranches.map(async (branchName) => {
          const [branchSections, branchStudents] = await Promise.all([
            db.collection("colleges").doc(collegeId).collection("sections").where("department", "==", branchName).limit(1).get(),
            db.collection("colleges").doc(collegeId).collection("students").where("secondaryDepartment", "==", branchName).limit(1).get(),
          ]);
          return !branchSections.empty || !branchStudents.empty;
        })
      );
      if (branchChecks.some(Boolean)) {
        return NextResponse.json(
          { error: "Cannot delete: this department still manages branches with active students or sections. Remove them from Managed Departments first." },
          { status: 409 }
        );
      }
    }

    const batch = db.batch();

    // Keep the (sub-)HOD's own profile in sync - otherwise their account is
    // left pointing at a department that no longer exists. Only THIS
    // department leaves their portfolio; any other department they head
    // (see college/departments PATCH) stays untouched.
    if (dept.hodUid) {
      const hodRef = db.collection("colleges").doc(collegeId).collection("users").doc(dept.hodUid);
      const hodSnap = await hodRef.get();
      const hodData = hodSnap.data() as { department?: string; departments?: string[] } | undefined;
      const currentDepts = (hodData?.departments && hodData.departments.length > 0 ? hodData.departments : [hodData?.department ?? ""])
        .filter(Boolean);
      const remaining = currentDepts.filter((d) => d !== dept.name);
      batch.update(hodRef, { department: remaining[0] ?? "", departments: remaining, updatedAt: new Date() });
    }

    // Strip this department's name from any OTHER department's
    // managedDepartments/secondaryDepartments arrays. Without this, a stale
    // reference survives the delete - and if a NEW, unrelated department is
    // later created reusing this exact name, it would be silently and
    // instantly "claimed" by whichever sub-department still lists it, purely
    // by name coincidence, with no confirmation step.
    const allDeptsSnap = await db.collection("colleges").doc(collegeId).collection("departments").get();
    for (const d of allDeptsSnap.docs) {
      if (d.id === deptId) continue;
      const other = d.data() as { managedDepartments?: string[]; secondaryDepartments?: string[] };
      const managed = other.managedDepartments ?? [];
      const secondary = other.secondaryDepartments ?? [];
      const newManaged = managed.filter((n) => n !== dept.name);
      const newSecondary = secondary.filter((n) => n !== dept.name);
      if (newManaged.length !== managed.length || newSecondary.length !== secondary.length) {
        batch.update(d.ref, {
          ...(newManaged.length !== managed.length ? { managedDepartments: newManaged } : {}),
          ...(newSecondary.length !== secondary.length ? { secondaryDepartments: newSecondary } : {}),
          updatedAt: new Date(),
        });
      }
    }

    batch.delete(deptRef);
    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/departments DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD");

    const body = (await request.json()) as {
      deptId: string;
      hodUid?: string;
      hodName?: string;
      isActive?: boolean;
      name?: string;
      code?: string;
      assignedYears?: number[];
      hasSubDepartments?: boolean;
      secondaryDepartments?: string[];
      managedDepartments?: string[];
      // Clearing this (empty string or null) promotes a sub-department back
      // to a plain top-level department - e.g. converting one from the
      // hasSubDepartments/parentDepartmentId model to the flat
      // managedDepartments model, so it can have its own independent HOD and
      // "Years Taught" for the years its former parent doesn't manage it for.
      // Principal/VP/Super Admin only - structural, same tier as
      // hasSubDepartments below. Re-parenting (a non-empty value) is
      // deliberately not supported here; only promotion.
      parentDepartmentId?: string | null;
      commonYearStart?: string;
      commonYearEnd?: string;
      // Per-course override of assignedYears/secondaryDepartments - see
      // Department.courseScopes. Principal/VP/Super Admin only: deliberately
      // NOT added to the HOD-restricted allowlist below, same tier as
      // assignedYears/hasSubDepartments.
      courseScope?:
        | { catalogId: string; assignedYears: number[]; secondaryDepartments: string[] }
        | { catalogId: string; clear: true };
    };

    const { deptId, ...rawUpdates } = body;
    if (!deptId) {
      return NextResponse.json({ error: "deptId required" }, { status: 400 });
    }

    const db = getAdminDb();
    const deptRef = db.collection("colleges").doc(session.collegeId).collection("departments").doc(deptId);

    // A (main) HOD may only manage their own sub-departments here - the
    // "sub-HOD" management surface, not general department admin - and only
    // a safe subset of fields: reassigning the Sub-HOD and cross-listing.
    // Renaming, deactivating, or nesting further sub-departments stays
    // Principal/VP-only.
    let updates = rawUpdates;
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      const targetSnap = await deptRef.get();
      const targetDept = targetSnap.data() as { parentDepartmentId?: string } | undefined;
      if (!targetDept?.parentDepartmentId || !scope.ownDepartmentIds.includes(targetDept.parentDepartmentId)) {
        return NextResponse.json({ error: "You can only manage your own sub-departments" }, { status: 403 });
      }
      const restricted: typeof rawUpdates = {};
      if ("hodUid" in rawUpdates) restricted.hodUid = rawUpdates.hodUid;
      if ("hodName" in rawUpdates) restricted.hodName = rawUpdates.hodName;
      if ("secondaryDepartments" in rawUpdates) restricted.secondaryDepartments = rawUpdates.secondaryDepartments;
      if ("managedDepartments" in rawUpdates) restricted.managedDepartments = rawUpdates.managedDepartments;
      updates = restricted;
    }

    // Renaming (or re-coding) a department must not collide with another one -
    // the scope model joins departments on their name, and codes seed batch
    // IDs/reports, so both stay unique per college (same rule as create). Only
    // runs when name/code is actually part of this update (HOD edits can't
    // touch either - they're stripped above).
    if (updates.name !== undefined || updates.code !== undefined) {
      const [allSnap, currentSnap] = await Promise.all([
        db.collection("colleges").doc(session.collegeId).collection("departments").get(),
        deptRef.get(),
      ]);
      const cur = currentSnap.data() as { name?: string; code?: string } | undefined;
      const finalName = (updates.name ?? cur?.name ?? "").trim();
      const finalCode = (updates.code ?? cur?.code ?? "").toUpperCase().trim();
      for (const d of allSnap.docs) {
        if (d.id === deptId) continue;
        const data = d.data() as { name?: string; code?: string };
        if (updates.name !== undefined && (data.name ?? "").trim().toLowerCase() === finalName.toLowerCase()) {
          return NextResponse.json({ error: `A department named "${finalName}" already exists` }, { status: 409 });
        }
        if (updates.code !== undefined && (data.code ?? "").toUpperCase().trim() === finalCode) {
          return NextResponse.json({ error: `Short code "${finalCode}" is already used by another department` }, { status: 409 });
        }
      }
    }

    if (updates.secondaryDepartments !== undefined) {
      const names = Array.from(new Set(updates.secondaryDepartments.map((s) => s.trim()).filter(Boolean)));
      if (names.length > 0) {
        const currentSnap = await deptRef.get();
        const currentData = currentSnap.data() as { name?: string; parentDepartmentId?: string } | undefined;
        const currentName = updates.name?.trim() ?? currentData?.name ?? "";
        const deptsSnap = await db.collection("colleges").doc(session.collegeId).collection("departments").get();
        const byName = new Map(deptsSnap.docs.map((d) => [(d.data() as { name?: string }).name ?? "", d.data() as { parentDepartmentId?: string }]));
        const secError = validateSecondaryDepartmentNames(names, currentName, byName);
        if (secError) return NextResponse.json({ error: secError }, { status: 400 });
      }
      updates.secondaryDepartments = names;
    }

    // Per-course override of assignedYears/secondaryDepartments - see
    // Department.courseScopes. Popped off `updates` (rather than left as a
    // literal `courseScope` field) and resolved into a `courseScopes.<id>`
    // dot-path key on `courseScopePatch`, merged in at write time below -
    // touches only that one catalogId, sibling overrides and the flat fields
    // are untouched.
    const { courseScope, ...updatesWithoutCourseScope } = updates;
    updates = updatesWithoutCourseScope;
    const courseScopePatch: Record<string, unknown> = {};
    if (courseScope) {
      const courseSnap = await db.collection("colleges").doc(session.collegeId).collection("courses")
        .where("departmentId", "==", deptId)
        .where("catalogId", "==", courseScope.catalogId)
        .limit(1)
        .get();
      if (courseSnap.empty) {
        return NextResponse.json({ error: "This department does not offer that course yet" }, { status: 400 });
      }

      if ("clear" in courseScope && courseScope.clear) {
        courseScopePatch[`courseScopes.${courseScope.catalogId}`] = FieldValue.delete();
      } else if ("assignedYears" in courseScope) {
        const durationYears = (courseSnap.docs[0].data() as { durationYears?: number }).durationYears ?? 0;
        const years = Array.from(new Set(courseScope.assignedYears.map(Number).filter((y) => Number.isFinite(y))));
        const tooLong = years.filter((y) => y > durationYears);
        if (tooLong.length > 0) {
          return NextResponse.json(
            { error: `Year(s) ${tooLong.join(", ")} are beyond this course's ${durationYears}-year duration` },
            { status: 400 }
          );
        }
        const yearsError = await validateAssignedYears(db, session.collegeId, years);
        if (yearsError) return NextResponse.json({ error: yearsError }, { status: 400 });

        const names = Array.from(new Set(courseScope.secondaryDepartments.map((s) => s.trim()).filter(Boolean)));
        if (names.length > 0) {
          const currentSnap = await deptRef.get();
          const currentName = updates.name?.trim() ?? (currentSnap.data() as { name?: string } | undefined)?.name ?? "";
          const deptsSnap = await db.collection("colleges").doc(session.collegeId).collection("departments").get();
          const byName = new Map(deptsSnap.docs.map((d) => [(d.data() as { name?: string }).name ?? "", d.data() as { parentDepartmentId?: string }]));
          const secError = validateSecondaryDepartmentNames(names, currentName, byName);
          if (secError) return NextResponse.json({ error: secError }, { status: 400 });
        }

        courseScopePatch[`courseScopes.${courseScope.catalogId}`] = { assignedYears: years, secondaryDepartments: names };
      }
    }

    if (updates.managedDepartments !== undefined) {
      const names = Array.from(new Set(updates.managedDepartments.map((s) => s.trim()).filter(Boolean)));
      if (names.length > 0) {
        const currentSnap = await deptRef.get();
        const currentData = currentSnap.data() as { name?: string; parentDepartmentId?: string } | undefined;
        const currentName = updates.name?.trim() ?? currentData?.name ?? "";
        if (names.includes(currentName)) {
          return NextResponse.json({ error: "Managed department must be different from this department" }, { status: 400 });
        }
        const deptsSnap = await db.collection("colleges").doc(session.collegeId).collection("departments").get();
        const byName = new Map(deptsSnap.docs.map((d) => [(d.data() as { name?: string }).name ?? "", d.data() as { parentDepartmentId?: string }]));
        for (const mName of names) {
          const mDept = byName.get(mName);
          if (!mDept) {
            return NextResponse.json({ error: `Managed department "${mName}" not found` }, { status: 400 });
          }
          if (mDept.parentDepartmentId) {
            return NextResponse.json({ error: `"${mName}" is a sub-department and can't be used as a managed department` }, { status: 400 });
          }
        }
        // A branch may be grouped under only ONE sub-department. This department's
        // own existing claims don't conflict with itself, so re-saving an
        // unchanged list stays a no-op. Re-checked in the transaction below.
        const conflicts = findBranchClaimConflicts(
          deptsSnap.docs.map((d) => ({ ...(d.data() as DepartmentClaimRow), id: d.id })),
          names,
          deptId
        );
        if (conflicts.length > 0) {
          return NextResponse.json({ error: branchClaimConflictMessage(conflicts) }, { status: 409 });
        }
      }
      updates.managedDepartments = names;
    }

    if (updates.assignedYears) {
      const yearsError = await validateAssignedYears(db, session.collegeId, updates.assignedYears);
      if (yearsError) return NextResponse.json({ error: yearsError }, { status: 400 });
    }

    // Promote a sub-department back to top-level (see the field's own doc
    // above) - the only supported change here is clearing it entirely.
    let clearParentDepartmentId = false;
    if ("parentDepartmentId" in updates) {
      if (updates.parentDepartmentId) {
        return NextResponse.json(
          { error: "Re-parenting a department isn't supported - only clearing parentDepartmentId to promote it to top-level" },
          { status: 400 }
        );
      }
      clearParentDepartmentId = true;
      delete updates.parentDepartmentId;
    }

    for (const label of ["commonYearStart", "commonYearEnd"] as const) {
      const value = updates[label];
      if (value !== undefined && value !== "" && !DATE_RE.test(value)) {
        return NextResponse.json({ error: `${label} must be a yyyy-mm-dd date` }, { status: 400 });
      }
    }
    if (updates.commonYearStart && updates.commonYearEnd && updates.commonYearEnd < updates.commonYearStart) {
      return NextResponse.json({ error: "First-year period end must be on or after its start" }, { status: 400 });
    }

    const now = new Date();

    // Keep the outgoing/incoming HOD's own profile department in sync with
    // the assignment - faculty-requirement and other HOD-scoped routes
    // resolve department from their user doc, not from hodUid. Additive: an
    // HOD can now head more than one department at once (see
    // src/lib/departments/scope.ts), so reassigning this ONE department only
    // ever adds/removes that one name from each side's `departments` array -
    // it must never touch any other department either of them heads.
    if (updates.hodUid !== undefined) {
      const deptSnap = await deptRef.get();
      const prev = deptSnap.data() as { hodUid?: string; name?: string } | undefined;
      const finalName = updates.name?.trim() ?? prev?.name ?? "";
      const usersColl = db.collection("colleges").doc(session.collegeId).collection("users");

      if (prev?.hodUid && prev.hodUid !== updates.hodUid && finalName) {
        const outgoingRef = usersColl.doc(prev.hodUid);
        const outgoingSnap = await outgoingRef.get();
        const outgoingData = outgoingSnap.data() as { department?: string; departments?: string[] } | undefined;
        const remaining = (outgoingData?.departments && outgoingData.departments.length > 0 ? outgoingData.departments : [outgoingData?.department ?? ""])
          .filter((d) => d && d !== finalName);
        await outgoingRef.update({ department: remaining[0] ?? "", departments: remaining, updatedAt: now }).catch(() => {});
      }
      if (updates.hodUid && finalName) {
        await usersColl.doc(updates.hodUid).update({
          department: finalName,
          departments: FieldValue.arrayUnion(finalName),
          updatedAt: now,
        }).catch(() => {});
      }
    }

    if (updates.managedDepartments !== undefined && updates.managedDepartments.length > 0) {
      // Same re-check under a transaction as the create path - two Sub-HOD edits
      // landing together must not both claim the same branch.
      const deptsColl = db.collection("colleges").doc(session.collegeId).collection("departments");
      const claimed = updates.managedDepartments;
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(deptsColl);
        const conflicts = findBranchClaimConflicts(
          fresh.docs.map((d) => ({ ...(d.data() as DepartmentClaimRow), id: d.id })),
          claimed,
          deptId
        );
        if (conflicts.length > 0) throw new Error(`BRANCH_CLAIMED:${branchClaimConflictMessage(conflicts)}`);
        tx.update(deptRef, {
          ...updates,
          ...courseScopePatch,
          ...(clearParentDepartmentId ? { parentDepartmentId: FieldValue.delete() } : {}),
          updatedAt: now,
        });
      });
    } else {
      await deptRef.update({
        ...updates,
        ...courseScopePatch,
        ...(clearParentDepartmentId ? { parentDepartmentId: FieldValue.delete() } : {}),
        updatedAt: now,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof Error && err.message.startsWith("BRANCH_CLAIMED:")) {
      return NextResponse.json({ error: err.message.slice("BRANCH_CLAIMED:".length) }, { status: 409 });
    }
    console.error("[college/departments PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
