export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getRelatedDepartmentIds } from "@/lib/departments/scope";
import type { DepartmentWithId } from "@/lib/college/academicStructure";
import { ensureAssignedYearsOpen } from "@/lib/departments/courseScopeValidation";
import { deriveHodScope } from "@/lib/departments/hodScope";
import type { Department } from "@/types";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE", "ACCOUNTS", "PANEL_MEMBER", "EXAM_CELL", "DEAN");
    const { searchParams } = new URL(request.url);
    const explicitDepartmentId = searchParams.get("departmentId");
    let departmentId = explicitDepartmentId;
    // Populated only for an HOD's own (no explicit departmentId) course list,
    // when their scope includes real branches reached via managedDepartments
    // (see below) - a wider set than the single `departmentId` above can express.
    let unionDepartmentIds: string[] | null = null;

    const db = getAdminDb();

    if (session.role === "HOD") {
      const userSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      const userData = userSnap.data() as { department?: string; departments?: string[] } | undefined;
      // Every department this HOD directly heads (usually one, can be more -
      // see src/lib/departments/scope.ts) - each contributes its own course
      // scope below, unioned together.
      const ownDeptNames = (userData?.departments && userData.departments.length > 0 ? userData.departments : [userData?.department ?? ""])
        .filter((n): n is string => !!n);

      if (!explicitDepartmentId) {
        if (ownDeptNames.length > 0) {
          const allDeptsSnap = await db.collection("colleges").doc(session.collegeId).collection("departments").get();
          const allDepartments = allDeptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Department[];
          const byName = new Map(allDepartments.map((d) => [d.name, d]));

          const courseDeptIdSet = new Set<string>();
          for (const name of ownDeptNames) {
            const deptDoc = byName.get(name);
            if (!deptDoc) continue;
            // A sub-department never owns courses of its own - it shares its
            // parent's program - so a sub-HOD resolves courses against the
            // parent instead, same fallback already used for section creation.
            const courseDeptId = deptDoc.parentDepartmentId ?? deptDoc.id;
            courseDeptIdSet.add(courseDeptId);
            const relatedIds = await getRelatedDepartmentIds(db, session.collegeId, courseDeptId);
            for (const id of relatedIds) courseDeptIdSet.add(id);

            // Additionally union in any REAL branch this department (or, for a
            // parent HOD, any of its sub-departments) fully manages via
            // managedDepartments - a shared-first-year section is filed
            // against that branch's OWN Course doc (see sections/route.ts
            // POST), never the manager's, so without this an HOD managing
            // branches this way could never see (or build a timetable for)
            // their own shared-year sections. This only adds to the
            // parent/legacy secondaryDepartments feeder resolution above,
            // never replaces it, so that shape keeps working unchanged.
            const scope = deriveHodScope(allDepartments, name);
            for (const d of scope.deptOptions) courseDeptIdSet.add(d.id);
          }
          if (courseDeptIdSet.size > 0) {
            unionDepartmentIds = Array.from(courseDeptIdSet).slice(0, 30);
          } else {
            departmentId = "__none__";
          }
        } else {
          departmentId = "__none__";
        }
      } else {
        // An explicitly-requested departmentId (Teaching Assignments/Sections
        // asking for a specific scope department's courses) must actually be
        // within this HOD's own scope - own department, parent (sub-HOD),
        // real sub-departments, or managed branches - never an arbitrary
        // department elsewhere in the college. Was previously unchecked.
        const deptsSnap = await db.collection("colleges").doc(session.collegeId).collection("departments").get();
        const departments = deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Department[];
        const inScope = ownDeptNames.some((name) => deriveHodScope(departments, name).deptOptions.some((d) => d.id === explicitDepartmentId));
        if (!inScope) {
          return NextResponse.json({ error: "That department is outside your scope" }, { status: 403 });
        }
      }
    }

    let query = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("courses") as FirebaseFirestore.Query;

    if (unionDepartmentIds) {
      query = unionDepartmentIds.length > 1
        ? query.where("departmentId", "in", unionDepartmentIds)
        : query.where("departmentId", "==", unionDepartmentIds[0]);
    } else if (departmentId && departmentId !== "__none__") {
      // A department fed by another (e.g. IT fed by Basic Science's shared
      // 1st-year course - see resolveSubjectDepartment) never owns a course
      // of its own for that shared year, so its Course dropdown falls back to
      // the feeder's course - same relationship subjects/route.ts already
      // uses for visibility.
      const relatedIds = await getRelatedDepartmentIds(db, session.collegeId, departmentId);
      query = relatedIds.length > 1
        ? query.where("departmentId", "in", relatedIds)
        : query.where("departmentId", "==", departmentId);
    } else if (departmentId === "__none__") {
      query = query.where("departmentId", "==", "__none__");
    }

    const snap = await query.get();
    const courses = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((a as { name?: string }).name ?? "").localeCompare((b as { name?: string }).name ?? ""));

    return NextResponse.json({ courses });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/courses GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      departmentId: string;
      catalogId: string;
      // This course's own Years Taught, set atomically with its creation
      // rather than as a separate follow-up edit. Required unconditionally -
      // a department's flat assignedYears is a legacy fallback only (no
      // longer editable from Add/Edit Department), so every course must
      // decide its own years right here or it would resolve to nothing.
      // Secondary Departments is deliberately NOT accepted here - it always
      // follows the department's own flat secondaryDepartments (see below),
      // never re-picked per course.
      courseScope?: { assignedYears: number[] };
    };

    const { departmentId, catalogId } = body;
    if (!departmentId || !catalogId) {
      return NextResponse.json({ error: "departmentId and catalogId are required" }, { status: 400 });
    }
    if (!body.courseScope || !Array.isArray(body.courseScope.assignedYears) || body.courseScope.assignedYears.length === 0) {
      return NextResponse.json({ error: "Select at least one year this department teaches this course" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // A department course can only be created from a catalog entry the Principal
    // fixed - name/code/duration come from there so they can never drift.
    const catalogSnap = await collegeRef.collection("courseCatalog").doc(catalogId).get();
    if (!catalogSnap.exists) {
      return NextResponse.json({ error: "Selected course is not in the catalog" }, { status: 400 });
    }
    const catalog = catalogSnap.data() as { name: string; code: string; durationYears: number; isActive?: boolean };
    if (catalog.isActive === false) {
      return NextResponse.json({ error: "Selected course is inactive" }, { status: 400 });
    }

    // Don't let the same course be added to a department twice.
    const dupe = await collegeRef.collection("courses")
      .where("departmentId", "==", departmentId)
      .where("catalogId", "==", catalogId)
      .limit(1)
      .get();
    if (!dupe.empty) {
      return NextResponse.json({ error: "This course is already added to the department" }, { status: 409 });
    }

    const deptSnap = await collegeRef.collection("departments").doc(departmentId).get();
    if (!deptSnap.exists) {
      return NextResponse.json({ error: "Department not found" }, { status: 400 });
    }
    const dept = { id: deptSnap.id, ...(deptSnap.data() as object) } as DepartmentWithId;

    const years = Array.from(new Set(body.courseScope.assignedYears.map(Number).filter((y) => Number.isFinite(y))));
    const tooLong = years.filter((y) => y > catalog.durationYears);
    if (tooLong.length > 0) {
      return NextResponse.json(
        { error: `Year(s) ${tooLong.join(", ")} are beyond this course's ${catalog.durationYears}-year duration` },
        { status: 400 }
      );
    }
    // Opens whichever of these years the college hasn't already opened -
    // Years Taught no longer requires pre-opening them one at a time via the
    // old "+ Add Year" button before a longer course's later years become
    // assignable.
    await ensureAssignedYearsOpen(db, session.collegeId, years);

    // Secondary Departments always follows this department's own flat field
    // (set on Add/Edit Department) rather than anything the client sends -
    // it was already validated when it was set there, so it's trusted as-is.
    const secNames = Array.from(new Set((dept.secondaryDepartments ?? []).map((s) => s.trim()).filter(Boolean)));

    const scopeToWrite: { assignedYears: number[]; secondaryDepartments: string[] } = { assignedYears: years, secondaryDepartments: secNames };

    const now = new Date();
    const coursesCol = collegeRef.collection("courses");
    // Re-checked here, transactionally, right before the write - the plain
    // get()-then-add() duplicate check above (line ~120) has a race: two
    // submits for the same (departmentId, catalogId) landing close together
    // (a double-click, or two people submitting at once) could both read
    // "not a duplicate" before either had written, and both succeed, leaving
    // this course listed twice everywhere it's picked from. Re-validating
    // inside the transaction that actually writes closes that window -
    // Firestore retries whichever one loses the race once it notices the
    // query's result set changed underneath it.
    const ref = coursesCol.doc();
    let duplicateError: string | null = null;
    await db.runTransaction(async (tx) => {
      const dupeSnap = await tx.get(
        coursesCol.where("departmentId", "==", departmentId).where("catalogId", "==", catalogId).limit(1)
      );
      if (!dupeSnap.empty) {
        duplicateError = "This course is already added to the department";
        return;
      }
      tx.set(ref, {
        collegeId: session.collegeId,
        departmentId,
        catalogId,
        name: catalog.name,
        code: catalog.code,
        durationYears: Number(catalog.durationYears),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    });
    if (duplicateError) {
      return NextResponse.json({ error: duplicateError }, { status: 409 });
    }

    if (scopeToWrite) {
      await collegeRef.collection("departments").doc(departmentId).update({
        [`courseScopes.${catalogId}`]: scopeToWrite,
        updatedAt: now,
      });
    }

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/courses POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
