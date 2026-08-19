export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartmentId } from "@/lib/departments/scope";
import { findBranchManager, resolveBranchYearOwner, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import { getFacultyIdCandidates, resolveLoginUidForFacultyMember } from "@/lib/faculty/resolveFacultyMemberId";
import { resolveDepartmentCourseScope } from "@/lib/college/academicStructure";
import { deriveHodScope } from "@/lib/departments/hodScope";
import type { Department, DepartmentCourseScope } from "@/types";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_OFFICE");
    const { searchParams } = new URL(request.url);
    const yearFilter = searchParams.get("year");
    const courseFilter = searchParams.get("courseId");
    const departmentIdFilter = searchParams.get("departmentId");

    const db = getAdminDb();
    const sectionsColl = db.collection("colleges").doc(session.collegeId).collection("sections");
    const withCommonFilters = (q: FirebaseFirestore.Query): FirebaseFirestore.Query => {
      let out = q;
      if (courseFilter) out = out.where("courseId", "==", courseFilter);
      if (yearFilter) out = out.where("year", "==", Number(yearFilter));
      return out;
    };

    let primaryQuery: FirebaseFirestore.Query = sectionsColl;
    // A parent HOD gets full ("primary") access to their own sub-departments'
    // sections too - they own the whole department tree, same as the
    // sub-HOD who runs that sub-department day to day (see
    // assertHodOwnsSection in sections/[id]/route.ts, which mirrors this).
    //
    // An HOD's Sections page deliberately does NOT also pull in sections
    // cross-listed to them via `secondaryDepartments` (a different, unrelated
    // top-level department's section feeding this one - e.g. Physics' own
    // year-1 sections feeding Information Technology) even read-only. That
    // grant used to exist here (mirroring the still-present one in the
    // students route) but conflated "years this department actually teaches"
    // (its own assignedYears/courseScopes) with "years some other department
    // has decided to feed it" - an HOD only ever sees sections for years
    // their own department is actually scoped to. This is scoped to Sections
    // specifically; the separate "Incoming Students" feature (hod/students/
    // incoming, keyed off Student.secondaryDepartment) and Teaching
    // Assignments' own cross-listed view are untouched.
    let childDeptQuery: FirebaseFirestore.Query | null = null;
    // A branch can be BOTH a standalone department with its own dedicated HOD
    // (its own assignedYears, e.g. CIVIL's [2,3,4]) AND grouped under a
    // sub-department for the shared first year (e.g. BS-English managing
    // CIVIL for year 1). The two never overlap in years, so which HOD a given
    // (department, year) section actually belongs to depends on the year, not
    // just the department name - resolveBranchYearOwner below decides that.
    // Populated only for an HOD (this college's departments), and only used
    // when there's an actual managed-branch relationship to disambiguate.
    let hodScope: Awaited<ReturnType<typeof getHodDepartmentScope>> | null = null;
    let hodDepartments: DepartmentYearRow[] = [];
    const catalogIdByCourseId = new Map<string, string | undefined>();

    // A caller with unrestricted college-wide read access (Principal/VP/Super
    // Admin/Office already see every section regardless of department) can
    // narrow explicitly to one department - resolved through the same
    // shared/managed-branch expansion the HOD scope below uses (deriveHodScope),
    // so a shared first-year department (e.g. "Basic Science") reaches the real
    // branches' own sections instead of matching a courseId/department value no
    // section is ever filed against (see the Timetable page, this param's first
    // caller). Deliberately NOT honored for HOD/PANEL_MEMBER: an HOD's own
    // (no-param) query below already returns their full, correctly
    // owner-checked scope for free - narrowing it further here would need
    // resolveBranchYearOwner redone against an arbitrary requested department
    // rather than the caller's own, so it's simplest and safest not to offer it.
    if (
      departmentIdFilter &&
      (session.role === "PRINCIPAL" || session.role === "VICE_PRINCIPAL" || session.role === "SUPER_ADMIN" || session.role === "COLLEGE_OFFICE")
    ) {
      const deptsSnap = await db.collection("colleges").doc(session.collegeId).collection("departments").get();
      const allDepartments = deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Department[];
      const namedDept = allDepartments.find((d) => d.id === departmentIdFilter);
      const scopeNames = namedDept
        ? (() => {
            const scope = deriveHodScope(allDepartments, namedDept.name);
            return scope.deptOptions.length > 0 ? scope.deptOptions.map((d) => d.name) : [namedDept.name];
          })()
        : ["__none__"];
      primaryQuery = sectionsColl.where("department", "in", scopeNames.slice(0, 30));
    } else if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      hodScope = scope;
      if (scope.ownDepartmentNames.length > 0) {
        primaryQuery = primaryQuery.where("department", "in", scope.ownDepartmentNames.slice(0, 30));
      }
      // Sub-departments (parent HOD) and grouped/managed branches (sub-HOD) are
      // both fully-owned - one `in` query covers both, tagged primary below.
      const ownedDeptNames = [...scope.childDepartmentNames, ...scope.managedDepartmentNames];
      if (ownedDeptNames.length > 0) {
        childDeptQuery = withCommonFilters(sectionsColl.where("department", "in", ownedDeptNames.slice(0, 30)));
      }
      if (scope.ownDepartmentNames.length > 0) {
        const deptsSnap = await db.collection("colleges").doc(session.collegeId).collection("departments").get();
        hodDepartments = deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DepartmentYearRow[];
        // A manager can run more than one course with different years (e.g. a
        // sub-department sharing a B.Tech's first year while also running an
        // independent course of its own) - resolveBranchYearOwner below needs
        // each section's own course to resolve ownership against the right
        // one, not always the manager's flat years.
        const coursesSnap = await db.collection("colleges").doc(session.collegeId).collection("courses").get();
        for (const c of coursesSnap.docs) {
          catalogIdByCourseId.set(c.id, (c.data() as { catalogId?: string }).catalogId);
        }
      }
    } else if (session.role === "PANEL_MEMBER") {
      const candidateIds = await getFacultyIdCandidates(db, session.collegeId, session.uid);
      primaryQuery = primaryQuery.where("facultyInchargeUid", "in", candidateIds);
    }

    primaryQuery = withCommonFilters(primaryQuery);

    const [primarySnap, childDeptSnap] = await Promise.all([
      primaryQuery.get(),
      childDeptQuery ? childDeptQuery.get() : Promise.resolve(null),
    ]);

    const seenIds = new Set<string>();
    const sections: { id: string; accessLevel: "primary" | "secondary"; [key: string]: unknown }[] = [];
    for (const d of primarySnap.docs) {
      const data = d.data();
      // Own-department match: only actually "mine" if this year isn't claimed
      // by whoever manages this branch elsewhere (e.g. a shared first year
      // routed through a common department's sub-department instead).
      if (hodScope && hodDepartments.length > 0) {
        const catalogId = catalogIdByCourseId.get(data.courseId as string);
        const owner = resolveBranchYearOwner(hodDepartments, data.department as string, data.year as number, catalogId);
        if (!hodScope.ownDepartmentNames.includes(owner)) continue;
      }
      seenIds.add(d.id);
      sections.push({ id: d.id, ...data, accessLevel: "primary" });
    }
    if (childDeptSnap) {
      for (const d of childDeptSnap.docs) {
        if (seenIds.has(d.id)) continue;
        const data = d.data();
        const deptName = data.department as string;
        // A direct sub-department (childDepartmentNames) is fully owned
        // regardless of year - only a MANAGED branch needs this check, since
        // that's the relationship that's year-scoped (only the years the
        // manager - this HOD, or one of their own children - actually teaches).
        if (hodScope!.managedDepartmentNames.includes(deptName) && hodDepartments.length > 0) {
          const catalogId = catalogIdByCourseId.get(data.courseId as string);
          const owner = resolveBranchYearOwner(hodDepartments, deptName, data.year as number, catalogId);
          if (!hodScope!.ownDepartmentNames.includes(owner) && !hodScope!.childDepartmentNames.includes(owner)) continue;
        }
        seenIds.add(d.id);
        sections.push({ id: d.id, ...data, accessLevel: "primary" });
      }
    }
    sections.sort((a, b) => {
      const ya = (a.year as number | undefined) ?? 0;
      const yb = (b.year as number | undefined) ?? 0;
      if (ya !== yb) return ya - yb;
      return ((a.name as string | undefined) ?? "").localeCompare((b.name as string | undefined) ?? "");
    });

    // `studentCount` used to be a manually-typed capacity estimate ("Student
    // Intake"); now that rosters are actually imported, overwrite it with the
    // real enrolled count per (department, section, year) instead of trusting
    // the stored field, which nothing writes anymore. The key also includes
    // the section's own cross-listed department (or "" if none): two
    // sections can otherwise share the exact same (department, name, year)
    // when they're cross-listed to different branches - e.g. two "A"s under
    // Basic Science, one feeding CSE and one ECE - and without this, both
    // would be double-counted into a single merged total instead of their
    // own real counts. Also includes `courseId` - a department can run a
    // same-named section under more than one course (see StudentRecord.
    // courseId's doc-comment), and without it a student in one gets
    // double-counted into the other's total too.
    //
    // A shared-first-year student (department = the common department or one
    // of its sub-departments, secondaryDepartment = their real branch) stays
    // filed that way until promotion (see students/[id] PATCH, distribute,
    // distribute-cohort) - so the section they're actually sitting in belongs
    // to secondaryDepartment, not department. Matched via a second query
    // rather than folded into the first, since it's keyed on a different
    // field.
    const deptNames = Array.from(new Set(sections.map((s) => s.department as string).filter(Boolean)));
    if (deptNames.length > 0) {
      const chunks: string[][] = [];
      for (let i = 0; i < deptNames.length; i += 30) chunks.push(deptNames.slice(i, i + 30));

      const [primaryStudentSnaps, secondaryStudentSnaps] = await Promise.all([
        Promise.all(
          chunks.map((chunk) =>
            db.collection("colleges").doc(session.collegeId).collection("students")
              .where("department", "in", chunk)
              .get()
          )
        ),
        Promise.all(
          chunks.map((chunk) =>
            db.collection("colleges").doc(session.collegeId).collection("students")
              .where("secondaryDepartment", "in", chunk)
              .get()
          )
        ),
      ]);

      const countMap = new Map<string, number>();
      const countedIds = new Set<string>();
      for (const snap of primaryStudentSnaps) {
        for (const d of snap.docs) {
          if (countedIds.has(d.id)) continue;
          countedIds.add(d.id);
          const s = d.data() as { department?: string; section?: string; year?: number; secondaryDepartment?: string; courseId?: string };
          const key = `${s.department ?? ""}|${s.section ?? ""}|${s.year ?? 0}|${(s.secondaryDepartment ?? "").toLowerCase()}|${s.courseId ?? ""}`;
          countMap.set(key, (countMap.get(key) ?? 0) + 1);
        }
      }
      for (const snap of secondaryStudentSnaps) {
        for (const d of snap.docs) {
          if (countedIds.has(d.id)) continue;
          countedIds.add(d.id);
          const s = d.data() as { secondaryDepartment?: string; section?: string; year?: number; courseId?: string };
          // The section a shared-first-year student actually sits in is their
          // real branch's own - never itself cross-listed (see hod/sections/
          // new's managed-branch mode) - so the disambiguator stays "", same
          // as such a section's own (always-empty) secondaryDepartments.
          const key = `${s.secondaryDepartment ?? ""}|${s.section ?? ""}|${s.year ?? 0}|${""}|${s.courseId ?? ""}`;
          countMap.set(key, (countMap.get(key) ?? 0) + 1);
        }
      }

      for (const sec of sections) {
        const secondaryDepts = sec.secondaryDepartments as string[] | undefined;
        const secondary = secondaryDepts?.length === 1 ? secondaryDepts[0].toLowerCase() : "";
        const key = `${sec.department as string}|${sec.name as string}|${sec.year as number}|${secondary}|${(sec.courseId as string | undefined) ?? ""}`;
        sec.studentCount = countMap.get(key) ?? 0;
      }
    }

    return NextResponse.json({ sections });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[sections GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    // Sections are HOD-managed: an HOD (own department, its sub-departments, and
    // any managed branch) creates them; Super Admin retains an override. Reads
    // (GET above) stay open to Principal/VP/Office/Panel.
    const session = await requireCollegeMember("HOD", "SUPER_ADMIN");
    const body = (await request.json()) as {
      courseId: string;
      name: string;
      year: number;
      batch: string;
      studentCount?: number;
      facultyInchargeUid?: string;
      facultyInchargeName?: string;
      departmentId?: string;
      secondaryDepartment?: string;
    };

    if (!body.courseId || !body.name?.trim() || !body.year || !body.batch?.trim()) {
      return NextResponse.json({ error: "courseId, name, year, batch are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const courseSnap = await db.collection("colleges").doc(session.collegeId).collection("courses").doc(body.courseId).get();
    if (!courseSnap.exists) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 });
    }
    const course = courseSnap.data() as { name: string; durationYears: number; departmentId?: string; catalogId?: string };
    if (Number(body.year) < 1 || Number(body.year) > course.durationYears) {
      return NextResponse.json({ error: `Year must be between 1 and ${course.durationYears} for ${course.name}` }, { status: 400 });
    }

    // Reject years the college hasn't opened via Academic Years. Colleges that have
    // never configured any academic years yet are left unrestricted (no doc to check
    // against), so this only enforces once someone has actually set the list up.
    const academicYearsSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("academicYears")
      .get();
    if (!academicYearsSnap.empty) {
      const activeYears = new Set(
        academicYearsSnap.docs
          .map((d) => d.data() as { yearNumber: number; isActive: boolean })
          .filter((y) => y.isActive)
          .map((y) => y.yearNumber)
      );
      if (!activeYears.has(Number(body.year))) {
        return NextResponse.json({ error: `Year ${body.year} is not open for this college` }, { status: 400 });
      }
    }

    // Resolve the owning department: HOD uses their own. Principal/VP/Office
    // pick a department explicitly (a course can be shared by a parent
    // department and its sub-departments, e.g. BS's "B.Sc" course is also
    // used by BS-Physics/BS-Maths - so the course's own departmentId alone
    // can no longer determine which one a new section belongs to). Fall back
    // to deriving it from the course for any older caller that doesn't send
    // departmentId.
    let dept = "";
    // True only when the HOD explicitly named a department they reach via
    // `managedDepartments` (the Sub-Department -> Department cascade) rather
    // than acting on their own department directly. Gates the shared-year
    // fallback below - CSE's own dedicated HOD naming CSE plainly must never
    // get the fallback that lets Basic Science/BS-Maths create CSE's shared
    // first year, even though something elsewhere manages CSE for that year.
    // Super Admin keeps the override (not HOD-scoped, so never restricted here).
    let viaManagedBranch = session.role !== "HOD";
    if (session.role === "HOD") {
      // A parent department's HOD runs its sub-departments too, so they may
      // create a section directly in one by naming it. Omitting departmentId
      // keeps the old behaviour (their own department), which is also all a
      // sub-HOD can ever do.
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (body.departmentId && !canHodEditDepartmentId(scope, body.departmentId)) {
        return NextResponse.json(
          { error: "That department is not yours or one of your sub-departments" },
          { status: 403 },
        );
      }
      viaManagedBranch = !!body.departmentId && scope.managedDepartmentIds.includes(body.departmentId);
      if (body.departmentId) {
        const deptSnap = await db.collection("colleges").doc(session.collegeId)
          .collection("departments").doc(body.departmentId).get();
        dept = (deptSnap.data() as { name?: string } | undefined)?.name ?? "";
      } else if (scope.ownDepartmentNames.length > 1) {
        // Which of this HOD's several departments the section belongs to is
        // no longer implicit - the client must say.
        return NextResponse.json(
          { error: "You manage more than one department - specify which department this section belongs to" },
          { status: 400 },
        );
      } else {
        dept = scope.ownDepartmentNames[0] ?? "";
      }
    } else if (body.departmentId) {
      const deptSnap = await db.collection("colleges").doc(session.collegeId).collection("departments").doc(body.departmentId).get();
      if (!deptSnap.exists) {
        return NextResponse.json({ error: "Department not found" }, { status: 404 });
      }
      const deptData = deptSnap.data() as { name?: string; parentDepartmentId?: string };
      if (course.departmentId !== body.departmentId && course.departmentId !== deptData.parentDepartmentId) {
        return NextResponse.json({ error: "Selected course does not belong to this department" }, { status: 400 });
      }
      dept = deptData.name ?? "";
    } else if (course.departmentId) {
      const courseDeptSnap = await db.collection("colleges").doc(session.collegeId).collection("departments").doc(course.departmentId).get();
      dept = (courseDeptSnap.data() as { name?: string } | undefined)?.name ?? "";
    }

    // A department can only hold sections for years the Principal/VP has
    // actually assigned it for this course (Department.courseScopes when the
    // department has a per-course override for it - e.g. an independent
    // M.Tech running years 1-2 under a department whose B.Tech runs 2-4 -
    // else its flat Department.assignedYears; see resolveDepartmentCourseScope)
    // - otherwise the year-allocation feature is purely decorative. This same
    // lookup also validates the section's own cross-listed (secondary)
    // department - a department/sub-department can be configured with several
    // possible destinations (e.g. a shared first-year sub-department feeding
    // both CSE and ECE), but each individual section commits to exactly one,
    // since its whole cohort promotes into that one branch together.
    let secondaryDepartments: string[] = [];
    if (dept) {
      const allDeptsSnap = await db.collection("colleges").doc(session.collegeId).collection("departments").get();
      const allDepts = allDeptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as
        (DepartmentYearRow & { name?: string; secondaryDepartments?: string[]; courseScopes?: Record<string, DepartmentCourseScope> })[];
      const deptDoc = allDepts.find((d) => d.name === dept);
      if (deptDoc) {
        const deptScope = resolveDepartmentCourseScope(deptDoc, course.catalogId);
        let assignedYears = deptScope.assignedYears;
        // A sub-department created by an HOD carries no assignedYears/
        // courseScopes of its own (Principal-only override, stripped from
        // anything HOD-created) - it inherits its parent's instead, same
        // fallback managerEffectiveYears (hodScope.ts) already uses for
        // Sections/Teaching Assignments/Timetable. Without this, targeting a
        // plain sub-department directly (not via a managed branch) silently
        // accepted any year in the course's span.
        if (assignedYears.length === 0 && deptDoc.parentDepartmentId) {
          const parentDoc = allDepts.find((d) => d.id === deptDoc.parentDepartmentId);
          if (parentDoc) {
            assignedYears = resolveDepartmentCourseScope(parentDoc, course.catalogId).assignedYears;
          }
        }
        if (assignedYears.length > 0 && !assignedYears.includes(Number(body.year))) {
          // A real branch (e.g. IT) reached through a sub-department's managed
          // grouping (BS-Maths managing IT + CSBS) never carries the shared
          // first year in its OWN "Years Taught" - that's configured on the
          // managing sub-department (or its parent common department) instead.
          // Before rejecting, check whether whoever manages this branch teaches
          // the requested year - if so, this section is exactly that shared-year
          // section and should be allowed. Only applies when the caller actually
          // reached `dept` via that managed-branch relationship (viaManagedBranch) -
          // otherwise this is the branch's own dedicated HOD naming their own
          // department directly, who must stay strictly within their own
          // assignedYears even though someone elsewhere also manages this branch.
          const manager = viaManagedBranch ? findBranchManager(allDepts, dept, course.catalogId) : null;
          const allowedViaManager = manager?.years.includes(Number(body.year)) ?? false;
          if (!allowedViaManager) {
            return NextResponse.json(
              { error: `Your department is not assigned to teach Year ${body.year}` },
              { status: 400 }
            );
          }
        }
        // Available branches: this department's own configured secondaries
        // (for this course), or - for a sub-department with none of its own -
        // those inherited from its parent, so a sub-HOD can create the shared
        // first-year branch sections.
        let availableSecondaryDepts = deptScope.secondaryDepartments;
        if (availableSecondaryDepts.length === 0 && deptDoc.parentDepartmentId) {
          const parent = allDepts.find((d) => d.id === deptDoc.parentDepartmentId);
          availableSecondaryDepts = parent ? resolveDepartmentCourseScope(parent, course.catalogId).secondaryDepartments : [];
        }
        const chosen = body.secondaryDepartment?.trim()
          || (availableSecondaryDepts.length === 1 ? availableSecondaryDepts[0] : "");
        if (chosen) {
          if (!availableSecondaryDepts.includes(chosen)) {
            return NextResponse.json(
              { error: `"${chosen}" is not one of this department's configured secondary departments` },
              { status: 400 }
            );
          }
          secondaryDepartments = [chosen];
        }
      }
    }

    // Reject an exact duplicate. Within a program a class section is identified
    // by department + course + year + section name, plus its cross-listed branch
    // (a shared first-year department may legitimately run two same-named
    // sections feeding different branches - e.g. Basic Science "A" -> CSE and
    // another "A" -> ECE). Batch is deliberately NOT part of the identity: only
    // one batch occupies a given year at a time, and leaving it out also stops
    // inconsistent batch text ("2025-26" vs "2025-2026") from slipping a real
    // duplicate past this check.
    const sectionName = body.name.trim().toUpperCase();
    const chosenSecondary = (secondaryDepartments[0] ?? "").toLowerCase();
    const siblingSnap = await db.collection("colleges").doc(session.collegeId).collection("sections")
      .where("department", "==", dept)
      .where("courseId", "==", body.courseId)
      .where("year", "==", Number(body.year))
      .get();
    const isDuplicate = siblingSnap.docs.some((d) => {
      const s = d.data() as { name?: string; secondaryDepartments?: string[] };
      return (s.name ?? "").toUpperCase() === sectionName
        && (s.secondaryDepartments?.[0] ?? "").toLowerCase() === chosenSecondary;
    });
    if (isDuplicate) {
      return NextResponse.json(
        {
          error: `Section ${sectionName} already exists for ${dept} Year ${body.year}`
            + `${secondaryDepartments[0] ? ` (feeding ${secondaryDepartments[0]})` : ""}.`,
        },
        { status: 409 }
      );
    }

    // The Class Incharge picker supplies a FacultyMember doc id, but this field
    // is read by comparing against the login uid — resolve it now so the two
    // stay in sync (see resolveFacultyMemberId.ts).
    const facultyInchargeUid = body.facultyInchargeUid
      ? await resolveLoginUidForFacultyMember(db, session.collegeId, body.facultyInchargeUid)
      : null;

    const now = new Date();
    const ref = db.collection("colleges").doc(session.collegeId).collection("sections").doc();

    await ref.set({
      collegeId: session.collegeId,
      department: dept,
      ...(secondaryDepartments.length > 0 ? { secondaryDepartments } : {}),
      courseId: body.courseId,
      courseName: course.name,
      name: sectionName,
      year: Number(body.year),
      batch: body.batch.trim(),
      facultyInchargeUid,
      facultyInchargeName: body.facultyInchargeName ?? "",
      studentCount: body.studentCount != null ? Math.max(0, Number(body.studentCount)) : 0,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[sections POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
