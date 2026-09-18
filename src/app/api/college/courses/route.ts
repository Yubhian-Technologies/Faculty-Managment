export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { getRelatedDepartmentIds } from "@/lib/departments/scope";
import { fedYears, type DepartmentWithId } from "@/lib/college/academicStructure";
import { ensureAssignedYearsOpen } from "@/lib/departments/courseScopeValidation";
import { deriveHodScope } from "@/lib/departments/hodScope";
import { groupCoursesByIdentity } from "@/lib/departments/courseGrouping";
import { filterSubDepartmentCourses } from "@/lib/departments/subDepartmentCourses";
import type { Department, Course } from "@/types";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE", "ACCOUNTS", "PANEL_MEMBER", "COLLEGE_STAFF", "EXAM_CELL", "DEAN");
    const { searchParams } = new URL(request.url);
    const explicitDepartmentId = searchParams.get("departmentId");
    let departmentId = explicitDepartmentId;
    // Populated only for an HOD's own (no explicit departmentId) course list,
    // when their scope includes real branches reached via managedDepartments
    // (see below) - a wider set than the single `departmentId` above can express.
    let unionDepartmentIds: string[] | null = null;
    // departmentIds this HOD reaches ONLY through a managed-branch relationship
    // (never their own department or a real child/sub-department) - populated
    // below, consumed by the post-filter after the query runs (see there for why).
    const managedOnlyDeptIds: Set<string> = new Set();
    // Every department in the college - only fetched for an HOD (see below);
    // hoisted to this scope so the post-filter after the query can reuse it
    // too, rather than fetching it a third time.
    let allDepartments: Department[] = [];
    // Set when this request resolves to exactly ONE sub-department, which is
    // the only case where "which of the parent's courses does this child
    // offer" has a single answer: an explicitly-requested sub-department, or
    // a sub-HOD whose own list is that one child. A parent HOD, or an HOD
    // heading several departments, deliberately keeps the unfiltered union -
    // one child's removal must never hide a course from its siblings, and the
    // superset is what every one of those callers showed before this existed.
    let targetSubDepartment: (Department & { id: string }) | null = null;

    const db = getAdminDb();

    if (session.role === "HOD") {
      const userSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      const userData = userSnap.data() as { department?: string; departments?: string[] } | undefined;
      // Every department this HOD directly heads (usually one, can be more -
      // see src/lib/departments/scope.ts) - each contributes its own course
      // scope below, unioned together.
      const ownDeptNames = (userData?.departments && userData.departments.length > 0 ? userData.departments : [userData?.department ?? ""])
        .filter((n): n is string => !!n);

      allDepartments = ownDeptNames.length > 0
        ? (await db.collection("colleges").doc(session.collegeId).collection("departments").get())
            .docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Department[]
        : [];

      if (!explicitDepartmentId) {
        if (ownDeptNames.length > 0) {
          const byName = new Map(allDepartments.map((d) => [d.name, d]));

          const courseDeptIdSet = new Set<string>();
          for (const name of ownDeptNames) {
            const deptDoc = byName.get(name);
            if (!deptDoc) continue;
            // A sub-department shares its parent's programme by default, so a
            // sub-HOD resolves courses against the parent - same fallback
            // already used for section creation. It can also hold its OWN
            // Course docs now (a customised copy of a shared course, or a
            // programme only it runs - see subDepartmentCourses.ts), so its
            // own id goes in alongside the parent's rather than instead of it;
            // which of the two wins per course is decided by the resolution
            // below, once both sides have actually been fetched.
            const courseDeptId = deptDoc.parentDepartmentId ?? deptDoc.id;
            courseDeptIdSet.add(courseDeptId);
            courseDeptIdSet.add(deptDoc.id);
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
            if (ownDeptNames.length === 1) {
              const only = byName.get(ownDeptNames[0]);
              if (only?.parentDepartmentId) targetSubDepartment = only as Department & { id: string };
            }
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
        const inScope = ownDeptNames.some((name) => deriveHodScope(allDepartments, name).deptOptions.some((d) => d.id === explicitDepartmentId));
        if (!inScope) {
          return NextResponse.json({ error: "That department is outside your scope" }, { status: 403 });
        }
      }

      // Every departmentId reached ONLY via managedDepartments (never this
      // HOD's own department or a real child/sub-department) - mirrors
      // resolveScopeDepartments's own two branches (hodScope.ts): the cascade
      // case (a common department's sub-departments each managing branches)
      // and the isGroupingContainer case (a sub-HOD who IS the manager).
      // `managedDepartments` is deliberately course-blind (see its doc-comment
      // in types/core.ts - "who's authorized to edit a branch's roster", not
      // which of the branch's courses that covers), so a managed branch's own
      // UNRELATED course (e.g. its independent Masters of Technology, never
      // cross-listed to this manager at all) must not ride along just because
      // the branch itself is reachable - the post-filter below closes that gap
      // per-course via fedYears, the actual catalogId-aware cross-listing check.
      for (const name of ownDeptNames) {
        const scope = deriveHodScope(allDepartments, name);
        const managedNames = scope.isGroupingContainer
          ? (scope.ownDept?.managedDepartments ?? [])
          : scope.groupingChildren.flatMap((c) => c.managedDepartments ?? []);
        if (managedNames.length === 0) continue;
        for (const d of allDepartments) if (managedNames.includes(d.name)) managedOnlyDeptIds.add(d.id);
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

      // The requested department may be a sub-department, whose list is its
      // parent's minus whatever it has removed, with its own customised copies
      // standing in - resolved after the query, once both sides are in hand.
      const targetSnap = await db.collection("colleges").doc(session.collegeId)
        .collection("departments").doc(departmentId).get();
      const targetData = targetSnap.data() as Department | undefined;
      if (targetSnap.exists && targetData?.parentDepartmentId) {
        targetSubDepartment = { ...targetData, id: targetSnap.id };
      }
    } else if (departmentId === "__none__") {
      query = query.where("departmentId", "==", "__none__");
    }

    const snap = await query.get();
    let rawCourses = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Course & { id: string });

    // Drop a managed branch's own course that isn't actually part of the
    // managed relationship - e.g. a shared-first-year department reaching
    // into a branch's Course docs above (managedOnlyDeptIds) gets that
    // branch's shared "Bachelor of Technology" (its own courseScopes
    // explicitly cross-list this manager for some year) but never its
    // independent "Masters of Technology" (no such cross-listing exists for
    // that catalogId, so fedYears comes back empty). Own/child departments
    // are never filtered - only ids that got into the union purely via
    // managedDepartments. See fedYears' own doc-comment (academicStructure.ts)
    // for why this has to be checked per-catalogId rather than by department
    // name alone.
    if (managedOnlyDeptIds.size > 0) {
      const deptNameById = new Map(allDepartments.map((d) => [d.id, d.name]));
      rawCourses = rawCourses.filter((c) => {
        if (!managedOnlyDeptIds.has(c.departmentId)) return true;
        const deptName = deptNameById.get(c.departmentId);
        if (!deptName) return false;
        return fedYears({ name: deptName }, allDepartments, c.catalogId).length > 0;
      });
    }

    // For a single sub-department, settle its list against its parent's:
    // drop a parent course this child has removed, and let the child's own
    // customised copy stand in for the parent's doc rather than appearing
    // beside it as a duplicate. Runs before the grouping below, which only
    // collapses duplicates within ONE department and so would leave the
    // parent/child pair for the same programme showing twice.
    if (targetSubDepartment) {
      rawCourses = filterSubDepartmentCourses(targetSubDepartment, rawCourses) as (Course & { id: string })[];
    }

    // Collapse duplicate docs for the same conceptual course WITHIN one
    // department (a legacy pre-catalog doc alongside a properly catalog-
    // linked one - see lib/departments/courseGrouping.ts) - every picker that
    // reads this endpoint gets a clean list for free, and callers that need
    // to match another collection's courseId against the full duplicate set
    // (not just the one shown here) can use the returned mergedCourseIds.
    // Deliberately does NOT collapse across different departmentIds - that's
    // the separate, legitimate feeder-department case (getRelatedDepartmentIds
    // above), which some callers show and annotate rather than hide.
    const courses = groupCoursesByIdentity(rawCourses)
      .map(({ primary, memberIds }) => ({ ...primary, mergedCourseIds: memberIds }))
      .sort((a, b) => a.name.localeCompare(b.name));

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
      // Set when a sub-department is CUSTOMISING a course it currently
      // inherits from its parent, rather than adding a brand-new one: the
      // parent's Course doc to copy from. The new doc keeps the same
      // catalogId (it's the same programme) but is owned by the child, so it
      // carries its own timings and academic years from here on - those are
      // keyed `${courseId}_year${n}` and this is a different courseId. The
      // parent's current timings/academic years are copied across so the
      // child starts from what it already had rather than an empty schedule.
      copyFromCourseId?: string;
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

    // Customising an inherited course: the source must be the same programme
    // (same catalogId) owned by this sub-department's own parent. Anything
    // else - a sibling's copy, an unrelated department's course, a different
    // programme - would be copying a schedule this department has no claim to.
    let copySource: FirebaseFirestore.DocumentSnapshot | null = null;
    if (body.copyFromCourseId) {
      if (!dept.parentDepartmentId) {
        return NextResponse.json({ error: "Only a sub-department can customise an inherited course" }, { status: 400 });
      }
      const sourceSnap = await collegeRef.collection("courses").doc(body.copyFromCourseId).get();
      const source = sourceSnap.data() as { departmentId?: string; catalogId?: string } | undefined;
      if (!sourceSnap.exists || !source) {
        return NextResponse.json({ error: "The course being customised no longer exists" }, { status: 404 });
      }
      if (source.departmentId !== dept.parentDepartmentId) {
        return NextResponse.json({ error: "That course doesn't belong to this sub-department's parent" }, { status: 403 });
      }
      if (source.catalogId !== catalogId) {
        return NextResponse.json({ error: "A customised copy must stay the same course" }, { status: 400 });
      }
      copySource = sourceSnap;
    }

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
        // Customising a course the child had previously removed brings it
        // back: the live doc is the newer, more specific statement of intent,
        // and leaving the exclusion would strand a course it can see nowhere.
        ...(copySource ? { excludedCourseCatalogIds: FieldValue.arrayRemove(catalogId) } : {}),
      });
    }

    // Copy the parent's current schedule onto the child's own course, so
    // customising starts from what the department already had rather than a
    // blank timetable. Both collections key on `${courseId}_year${n}`, so the
    // new courseId gives the child docs of its own with no id collision - and
    // the parent's are left exactly as they were, still serving every sibling.
    if (copySource) {
      const sourceId = copySource.id;
      const [timingsSnap, yearsSnap] = await Promise.all([
        collegeRef.collection("courseYearTimings").where("courseId", "==", sourceId).get(),
        collegeRef.collection("courseAcademicYears").where("courseId", "==", sourceId).get(),
      ]);
      const copyBatch = db.batch();
      for (const d of timingsSnap.docs) {
        const data = d.data() as { year?: number };
        if (typeof data.year !== "number") continue;
        copyBatch.set(collegeRef.collection("courseYearTimings").doc(`${ref.id}_year${data.year}`), {
          ...data, departmentId, courseId: ref.id, createdAt: now, updatedAt: now,
        });
      }
      for (const d of yearsSnap.docs) {
        const data = d.data() as { year?: number };
        if (typeof data.year !== "number") continue;
        copyBatch.set(collegeRef.collection("courseAcademicYears").doc(`${ref.id}_year${data.year}`), {
          ...data, departmentId, courseId: ref.id, createdAt: now, updatedAt: now,
        });
      }
      await copyBatch.commit();
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
