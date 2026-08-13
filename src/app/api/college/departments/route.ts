export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import {
  findBranchClaimConflicts,
  branchClaimConflictMessage,
  type DepartmentClaimRow,
} from "@/lib/departments/managedBranches";

// Years a department teaches must be a subset of the years this college has
// actually opened (Location Admin's Academic Years toggle) - mirrors the same
// check done for Section creation in college/sections/route.ts. Shared by the
// create and update paths so both reject the same way.
// Returns an error message, or null when the years are valid.
async function validateAssignedYears(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  assignedYears: number[]
): Promise<string | null> {
  const academicYearsSnap = await db
    .collection("colleges")
    .doc(collegeId)
    .collection("academicYears")
    .get();
  const openYears = new Set(
    academicYearsSnap.docs
      .map((d) => d.data() as { yearNumber: number; isActive: boolean })
      .filter((y) => y.isActive)
      .map((y) => y.yearNumber)
  );
  const invalid = assignedYears.filter((y) => !openYears.has(Number(y)));
  return invalid.length > 0 ? `Year(s) ${invalid.join(", ")} are not open for this college` : null;
}

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
    const hodByDepartment = new Map<string, { uid: string; name: string }>();
    const ambiguousDepartments = new Set<string>();
    for (const doc of hodSnap.docs) {
      const data = doc.data() as { department?: string; name?: string };
      const dept = data.department?.trim();
      if (!dept) continue;
      if (hodByDepartment.has(dept)) ambiguousDepartments.add(dept);
      else hodByDepartment.set(dept, { uid: doc.id, name: data.name ?? "" });
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
      if (!scope.departmentId || body.parentDepartmentId !== scope.departmentId) {
        return NextResponse.json({ error: "You can only add sub-departments under your own department" }, { status: 403 });
      }
      const ownDeptSnap = await db.collection("colleges").doc(collegeId).collection("departments").doc(scope.departmentId).get();
      if (!(ownDeptSnap.data() as { hasSubDepartments?: boolean } | undefined)?.hasSubDepartments) {
        return NextResponse.json({ error: "Sub-departments are not enabled for your department" }, { status: 403 });
      }
      parentDepartmentId = scope.departmentId;
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
    // not from the department's hodUid pointer.
    if (hodUid) {
      await db.collection("colleges").doc(collegeId).collection("users").doc(hodUid)
        .update({ department: name.trim(), updatedAt: now })
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
    const dept = deptSnap.data() as { name: string; hodUid?: string; parentDepartmentId?: string };

    // An HOD may only delete a sub-department under their own department -
    // this is the "sub-HOD" management surface, not general department admin.
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, collegeId, session.uid);
      if (!scope.departmentId || dept.parentDepartmentId !== scope.departmentId) {
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
    const [studentsSnap, sectionsSnap] = await Promise.all([
      db.collection("colleges").doc(collegeId).collection("students").where("department", "==", dept.name).limit(1).get(),
      db.collection("colleges").doc(collegeId).collection("sections").where("department", "==", dept.name).limit(1).get(),
    ]);
    if (!studentsSnap.empty || !sectionsSnap.empty) {
      return NextResponse.json(
        { error: "Cannot delete a department that still has students or sections. Remove them first." },
        { status: 409 }
      );
    }

    // Keep the (sub-)HOD's own profile in sync - otherwise their account is
    // left pointing at a department that no longer exists.
    if (dept.hodUid) {
      await db.collection("colleges").doc(collegeId).collection("users").doc(dept.hodUid)
        .update({ department: "", updatedAt: new Date() })
        .catch(() => {});
    }

    await deptRef.delete();

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
      commonYearStart?: string;
      commonYearEnd?: string;
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
      if (!scope.departmentId || !targetDept || targetDept.parentDepartmentId !== scope.departmentId) {
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
        if (names.includes(currentName)) {
          return NextResponse.json({ error: "Secondary department must be different from this department" }, { status: 400 });
        }
        const deptsSnap = await db.collection("colleges").doc(session.collegeId).collection("departments").get();
        const byName = new Map(deptsSnap.docs.map((d) => [(d.data() as { name?: string }).name ?? "", d.data() as { parentDepartmentId?: string }]));
        for (const secName of names) {
          const secDept = byName.get(secName);
          if (!secDept) {
            return NextResponse.json({ error: `Secondary department "${secName}" not found` }, { status: 400 });
          }
          if (secDept.parentDepartmentId) {
            return NextResponse.json({ error: `"${secName}" is a sub-department and can't be used as a secondary department` }, { status: 400 });
          }
        }
      }
      updates.secondaryDepartments = names;
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
    // resolve department from their user doc, not from hodUid.
    if (updates.hodUid !== undefined) {
      const deptSnap = await deptRef.get();
      const prev = deptSnap.data() as { hodUid?: string; name?: string } | undefined;
      const finalName = updates.name?.trim() ?? prev?.name ?? "";
      const usersColl = db.collection("colleges").doc(session.collegeId).collection("users");

      if (prev?.hodUid && prev.hodUid !== updates.hodUid) {
        await usersColl.doc(prev.hodUid).update({ department: "", updatedAt: now }).catch(() => {});
      }
      if (updates.hodUid) {
        await usersColl.doc(updates.hodUid).update({ department: finalName, updatedAt: now }).catch(() => {});
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
        tx.update(deptRef, { ...updates, updatedAt: now });
      });
    } else {
      await deptRef.update({ ...updates, updatedAt: now });
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
