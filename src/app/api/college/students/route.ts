export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { normalizeRosterDetails } from "@/lib/students/rosterFields";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { resolveBranchYearOwner, resolveFreshmanLandingDepartment, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import { isConfiguredSecondaryDepartmentOrChild, resolveDepartmentByNameOrCode } from "@/lib/departments/codeOrNameResolver";
import { getFacultyIdCandidates } from "@/lib/faculty/resolveFacultyMemberId";
import { resolveDepartmentCourseScope, resolveCatalogId, freshmanLandingDepartmentNames, expandDepartmentNameForRollup, type DepartmentWithId } from "@/lib/college/academicStructure";
import { fetchStudentsPage, fetchMatchingStudentIds, fetchStudentsForExport } from "@/lib/students/paginatedList";
import { isLikelySameUnassignedStudent } from "@/lib/students/duplicateDetection";
import { validateYearForCourseDuration, validateYearSemesterConsistency } from "@/lib/students/rosterValidation";
import type { Course, Section, StudentRecord, StudentStatus, DepartmentCourseScope } from "@/types";

const PAGE_SIZES = [10, 20, 30, 50];

// Roles that already see the whole college unscoped (no HOD/PANEL_MEMBER
// fan-out - see the role branching below) - the only ones server-side
// pagination is offered to.
const UNSCOPED_ROLES = ["PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE"];

// Sections a PANEL_MEMBER (faculty) is in charge of - students are only visible/
// editable within these. Returns [] if the faculty isn't assigned to any section.
async function getInchargeSections(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  uid: string
): Promise<Section[]> {
  const candidateIds = await getFacultyIdCandidates(db, collegeId, uid);
  const snap = await db
    .collection("colleges")
    .doc(collegeId)
    .collection("sections")
    .where("facultyInchargeUid", "in", candidateIds)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Section);
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE");
    const { searchParams } = new URL(request.url);
    const sectionFilter = searchParams.get("section");
    const yearFilter = searchParams.get("year");

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const studentsColl = collegeRef.collection("students");

    // ── Server-side paginated listing (College Office / Principal-tier
    // Students page) ────────────────────────────────────────────────────────
    // Opted into only when `page`, `idsOnly`, or `export` is present, so
    // every other existing caller of this endpoint (HOD/PANEL_MEMBER
    // dashboards, section rosters, promotions - none of which send any of
    // these) keeps getting the original, unpaginated `{ students }` shape
    // unchanged.
    if ((searchParams.has("page") || searchParams.has("idsOnly") || searchParams.has("export")) && UNSCOPED_ROLES.includes(session.role)) {
      const search = (searchParams.get("search") ?? "").trim().toLowerCase();

      if (searchParams.get("export") === "1") {
        // Multi-value, comma-separated - unlike the single-value pagination
        // filters above, an export can combine several departments/courses/
        // years at once (e.g. "every 1st and 2nd year B.Tech student across
        // these 3 departments"). An empty/absent param means "no filter on
        // that dimension", not "match nothing".
        const parseList = (name: string) => (searchParams.get(name) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const pickedDepartments = parseList("departments");
        const courses = parseList("courses");
        const years = parseList("years").map(Number).filter((n) => Number.isFinite(n));
        // A "no own sections" shared-first-year parent (e.g. VISHNU's "BASIC
        // SCIENCE") never itself houses a student - expand each picked name
        // to include its children too, or exporting by that parent would
        // return nothing (see expandDepartmentNameForRollup's own
        // doc-comment). A no-op for every other department name.
        let departments = pickedDepartments;
        if (pickedDepartments.length > 0) {
          const allDeptsSnap = await collegeRef.collection("departments").get();
          const allDepts = allDeptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DepartmentWithId[];
          departments = Array.from(new Set(pickedDepartments.flatMap((d) => expandDepartmentNameForRollup(allDepts, d))));
        }
        const { students, total, truncated } = await fetchStudentsForExport(studentsColl, { search, departments, courses, years });
        return NextResponse.json({ students, total, truncated });
      }

      const pickedDepartment = (searchParams.get("department") ?? "").trim();
      const course = (searchParams.get("course") ?? "").trim();
      const yearParam = searchParams.get("year");
      const year = yearParam ? Number(yearParam) : null;

      let departments: string[] = [];
      if (pickedDepartment) {
        const allDeptsSnap = await collegeRef.collection("departments").get();
        const allDepts = allDeptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DepartmentWithId[];
        departments = expandDepartmentNameForRollup(allDepts, pickedDepartment);
      }

      if (searchParams.get("idsOnly") === "1") {
        const ids = await fetchMatchingStudentIds(studentsColl, { departments, course, year, search });
        return NextResponse.json({ ids, total: ids.length });
      }

      const page = Math.max(1, Number(searchParams.get("page")) || 1);
      const pageSizeRaw = Number(searchParams.get("pageSize"));
      const pageSize = PAGE_SIZES.includes(pageSizeRaw) ? pageSizeRaw : 20;
      const { students, total } = await fetchStudentsPage(studentsColl, { page, pageSize, search, departments, course, year });
      return NextResponse.json({ students, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
    }

    const withCommonFilters = (q: FirebaseFirestore.Query): FirebaseFirestore.Query => {
      let out = q;
      if (sectionFilter) out = out.where("section", "==", sectionFilter);
      if (yearFilter) out = out.where("year", "==", Number(yearFilter));
      return out;
    };

    let primaryQuery: FirebaseFirestore.Query = studentsColl;
    // Only HOD has a narrower-than-college scope with a meaningful "secondary"
    // (view-only) counterpart - either a student pre-registered to this HOD's
    // department while primarily owned by another (e.g. Basic Science), or a
    // student who belongs to one of this HOD's own sub-departments (parent
    // HOD gets automatic view-only access). Every other role here already
    // sees the whole college unscoped, so nothing they see is ever "secondary".
    let secondaryQuery: FirebaseFirestore.Query | null = null;
    let childDeptQuery: FirebaseFirestore.Query | null = null;
    // A branch can be BOTH a standalone department with its own dedicated HOD
    // (its own assignedYears, e.g. CIVIL's [2,3,4]) AND grouped under a
    // sub-department for the shared first year (e.g. BS-English managing
    // CIVIL for year 1). Which HOD a given (department, year) student
    // actually belongs to depends on the year, not just the department name -
    // resolveBranchYearOwner below decides that. Same shape as the sections
    // route's identical split; kept in sync with it deliberately.
    let hodScope: Awaited<ReturnType<typeof getHodDepartmentScope>> | null = null;
    let hodDepartments: DepartmentYearRow[] = [];

    if (session.role === "PANEL_MEMBER") {
      const sections = await getInchargeSections(db, session.collegeId, session.uid);
      if (sections.length === 0) {
        return NextResponse.json({ students: [] });
      }
      // Section *names* aren't unique across years or departments (e.g. "A" exists
      // in both Year 1 and Year 2, and independently in both CSE and AIDS) - a
      // single `where("section", "in", names)` would silently pull in every other
      // year's/department's same-named section too. Match each in-charge section
      // by its exact (department, name, year) triple instead, one query per
      // section, then merge. A department can also run the exact same
      // (department, name, year) triple under two different courses (e.g. a
      // B.Tech "PHYSICS-IT-A" and an independent M.Tech "PHYSICS-IT-A" -
      // StudentRecord.courseId's doc-comment), so the section's own courseId
      // is included too whenever it has one - otherwise a panel member in
      // charge of one would see the other course's students mixed into their
      // roster.
      const sectionSnaps = await Promise.all(
        sections.slice(0, 30).flatMap((s) => {
          const withCourseId = (q: FirebaseFirestore.Query) => (s.courseId ? q.where("courseId", "==", s.courseId) : q);
          return [
            withCommonFilters(
              withCourseId(studentsColl.where("department", "==", s.department).where("section", "==", s.name).where("year", "==", s.year))
            ).get(),
            // A shared-first-year student in this section stays filed under
            // their common department (preserved until promotion - see
            // students/[id] PATCH) with secondaryDepartment naming this
            // section's real branch instead - catch them too, or a faculty
            // member in charge of a shared-year section would see an empty
            // roster.
            withCommonFilters(
              withCourseId(studentsColl.where("secondaryDepartment", "==", s.department).where("section", "==", s.name).where("year", "==", s.year))
            ).get(),
          ];
        })
      );
      const seen = new Set<string>();
      const students: (Omit<StudentRecord, "id"> & { id: string; accessLevel: "primary" | "secondary" })[] = [];
      for (const snap of sectionSnaps) {
        for (const d of snap.docs) {
          if (seen.has(d.id)) continue;
          seen.add(d.id);
          students.push({ id: d.id, ...(d.data() as Omit<StudentRecord, "id">), accessLevel: "primary" });
        }
      }
      students.sort((a, b) => (a.rollNumber ?? "").localeCompare(b.rollNumber ?? ""));
      return NextResponse.json({ students });
    } else if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      hodScope = scope;
      if (scope.ownDepartmentNames.length > 0) {
        primaryQuery = primaryQuery.where("department", "in", scope.ownDepartmentNames.slice(0, 30));
        // A shared-first-year student can be pre-registered straight toward a
        // specialization sub-department (e.g. "Cyber Security" under CSE,
        // college/departments secondaryDepartments can now name one directly -
        // see validateSecondaryDepartmentNames's doc-comment), not just the
        // plain parent department - so childDepartmentNames must be included
        // here too, or such a student stays invisible (not even view-only) to
        // the parent HOD who actually governs that sub-department. Still
        // "secondary"/view-only below, same as any other cross-listed match -
        // this only widens WHICH names can match, not the access level.
        const secondaryTargets = Array.from(new Set([...scope.ownDepartmentNames, ...scope.childDepartmentNames])).slice(0, 30);
        secondaryQuery = withCommonFilters(studentsColl.where("secondaryDepartment", "in", secondaryTargets));
        const deptsSnap = await db.collection("colleges").doc(session.collegeId).collection("departments").get();
        hodDepartments = deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DepartmentYearRow[];
      }
      // Sub-departments (parent HOD) and grouped/managed branches (sub-HOD) are
      // both queried together - a single `in` query covers both - but only
      // sub-departments are unconditionally "primary"; a managed branch is
      // filtered down to the years its manager relationship actually covers
      // below, once we have each student's year.
      const ownedDeptNames = [...scope.childDepartmentNames, ...scope.managedDepartmentNames];
      if (ownedDeptNames.length > 0) {
        childDeptQuery = withCommonFilters(studentsColl.where("department", "in", ownedDeptNames.slice(0, 30)));
      }
    }

    primaryQuery = withCommonFilters(primaryQuery);

    const [primarySnap, secondarySnap, childDeptSnap] = await Promise.all([
      primaryQuery.get(),
      secondaryQuery ? secondaryQuery.get() : Promise.resolve(null),
      childDeptQuery ? childDeptQuery.get() : Promise.resolve(null),
    ]);

    // A manager can run more than one course with different years (e.g. a
    // sub-department sharing a B.Tech's first year while also running an
    // independent course of its own) - resolveBranchYearOwner below needs
    // each student's own course to resolve ownership against the right one,
    // not always the manager's flat years. StudentRecord has no courseId of
    // its own (see the PANEL_MEMBER branch above), only the free-text
    // `course` admission field - resolved the same way RosterFieldInputs.tsx
    // and the roster-import path already do.
    let allCourses: Course[] = [];
    const deptIdByName = new Map<string, string>();
    if (hodScope && hodDepartments.length > 0) {
      const coursesSnap = await db.collection("colleges").doc(session.collegeId).collection("courses").get();
      allCourses = coursesSnap.docs.map((c) => ({ id: c.id, ...(c.data() as object) })) as Course[];
      for (const d of hodDepartments) if (d.name) deptIdByName.set(d.name, d.id);
    }
    const studentCatalogId = (data: Omit<StudentRecord, "id">) =>
      resolveCatalogId(allCourses, deptIdByName.get(data.department as string), data.course);

    const seenIds = new Set<string>();
    const students: (Omit<StudentRecord, "id"> & { id: string; accessLevel: "primary" | "secondary" })[] = [];
    for (const d of primarySnap.docs) {
      const data = d.data() as Omit<StudentRecord, "id">;
      // Own-department match: only actually "mine" if this year isn't claimed
      // by whoever manages this branch elsewhere (e.g. a shared first year
      // routed through a common department's sub-department instead).
      if (hodScope && hodDepartments.length > 0) {
        const owner = resolveBranchYearOwner(hodDepartments, data.department as string, data.year as number, studentCatalogId(data));
        if (!hodScope.ownDepartmentNames.includes(owner)) continue;
      }
      seenIds.add(d.id);
      students.push({ id: d.id, ...data, accessLevel: "primary" });
    }
    // Sub-department students are "primary": a parent HOD runs the whole
    // department tree. Only genuinely cross-listed students - registered to an
    // unrelated department and merely pre-registered here - stay view-only.
    // Same split as the sections route.
    if (childDeptSnap) {
      for (const d of childDeptSnap.docs) {
        if (seenIds.has(d.id)) continue;
        const data = d.data() as Omit<StudentRecord, "id">;
        const deptName = data.department as string;
        // A direct sub-department (childDepartmentNames) is fully owned
        // regardless of year - only a MANAGED branch needs this check, since
        // that's the relationship that's year-scoped (only the years the
        // manager - this HOD, or one of their own children - actually teaches).
        if (hodScope!.managedDepartmentNames.includes(deptName) && hodDepartments.length > 0) {
          const owner = resolveBranchYearOwner(hodDepartments, deptName, data.year as number, studentCatalogId(data));
          if (!hodScope!.ownDepartmentNames.includes(owner) && !hodScope!.childDepartmentNames.includes(owner)) continue;
        }
        seenIds.add(d.id);
        students.push({ id: d.id, ...data, accessLevel: "primary" });
      }
    }
    if (secondarySnap) {
      for (const d of secondarySnap.docs) {
        if (seenIds.has(d.id)) continue;
        seenIds.add(d.id);
        students.push({ id: d.id, ...(d.data() as Omit<StudentRecord, "id">), accessLevel: "secondary" });
      }
    }
    students.sort((a, b) => (a.rollNumber ?? "").localeCompare(b.rollNumber ?? ""));

    return NextResponse.json({ students });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Faculty (PANEL_MEMBER) can view their sections' rosters but cannot add
// students - that stays with HOD/Office/above.
//
// Two shapes of add are supported:
//  - Section-based: a `section` name + `year` resolve to an existing section;
//    the student is placed straight into it (department comes from the section).
//  - Unassigned: a `department` name (or `departmentId`) with no section; the
//    student is created under that department with `section: ""` (an "unassigned"
//    pool the College Office fills before sub-HODs section them). This is what
//    lets Office import/add a branch cohort before any sections exist.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE");
    const body = (await request.json()) as {
      name: string;
      section?: string;
      year: number;
      status?: StudentStatus;
      department?: string;
      departmentId?: string;
      // Optional roster details - every field the Excel/CSV import collects,
      // read through normalizeRosterDetails so a manually-added student
      // carries exactly the same information, shaped the same way.
      [key: string]: unknown;
    };

    // A roll number here is optional and provisional only - the same standing
    // it has as a column in the roster import. The real one is the
    // department's responsibility: the assigned HOD (years 2-4) or sub-HOD
    // (year 1) sets it once students are divided into sections (students/[id]
    // PATCH), and only that path checks it for uniqueness.
    if (!body.name?.trim() || !body.year) {
      return NextResponse.json({ error: "name and year are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const now = new Date();

    // Resolve the target department + section. `dept` is always the student's
    // owning department; `sectionName` is "" for an unassigned add. `courseId`
    // is the real reference StudentRecord.courseId needs (see its own
    // doc-comment) - a section name is only unique within one department's
    // one course, so a placed add always takes it from the section actually
    // resolved, never re-derived from the free-text `course` field.
    let dept = "";
    let sectionName = "";
    let courseId: string | undefined;
    // Populated only for an unassigned add (fetched once below) and reused
    // both to resolve `body.department` name/code-insensitively (matching
    // how the bulk importer already resolves department text -
    // resolveDepartmentByNameOrCode) and, right after, for the
    // freshman-landing remap.
    let allDepts: DepartmentWithId[] = [];

    if (body.section?.trim()) {
      const sectionsSnap = await collegeRef
        .collection("sections")
        .where("name", "==", body.section.trim().toUpperCase())
        .where("year", "==", Number(body.year))
        .limit(1)
        .get();
      if (sectionsSnap.empty) {
        return NextResponse.json({ error: "Section not found" }, { status: 400 });
      }
      const sectionDoc = sectionsSnap.docs[0].data() as Section;
      dept = sectionDoc.department;
      sectionName = sectionDoc.name;
      courseId = sectionDoc.courseId;
    } else {
      // Unassigned add - resolve the department by id or name/code.
      const allDeptsSnap = await collegeRef.collection("departments").get();
      allDepts = allDeptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DepartmentWithId[];
      if (body.departmentId) {
        const found = allDepts.find((d) => d.id === body.departmentId);
        if (!found) return NextResponse.json({ error: "Department not found" }, { status: 400 });
        dept = found.name;
      } else if (body.department?.trim()) {
        const resolvedName = resolveDepartmentByNameOrCode(allDepts, body.department);
        if (!resolvedName) return NextResponse.json({ error: "Department not found" }, { status: 400 });
        dept = resolvedName;
      } else {
        return NextResponse.json({ error: "Provide a section, or a department for an unassigned student" }, { status: 400 });
      }
    }

    // A "no own sections" shared-first-year parent (Department.
    // parentRunsOwnSections === false - e.g. VISHNU INSTITUTE OF TECHNOLOGY's
    // "BASIC SCIENCE") never itself houses a student - remap it to whichever
    // of its children actually manages the given Core Department before
    // anything else runs, so the HOD-scope check right below (and every
    // check after it) sees the real, correct landing department rather than
    // the parent's name. A no-op for every other department (see
    // resolveFreshmanLandingDepartment's own doc-comment).
    if (!sectionName && dept) {
      dept = resolveFreshmanLandingDepartment(allDepts, dept, typeof body.secondaryDepartment === "string" ? body.secondaryDepartment.trim() : undefined);
    }

    // An HOD/Sub-HOD may only add into a department they own or manage.
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (dept && !canHodEditDepartment(scope, dept)) {
        return NextResponse.json({ error: "That department is not yours or one you manage" }, { status: 403 });
      }
    }

    // An unassigned add's year must be one this department is actually
    // assigned to teach for the chosen course - resolved through the same
    // per-course override (Department.courseScopes) the Add Student form's
    // own Year dropdown already applies via resolveCatalogId (shared with
    // RosterFieldInputs.tsx) - reading only the flat fallback here let the
    // server reject a year the client's own dropdown had just offered (or
    // vice versa, for a department whose per-course override is narrower
    // than its flat default). A student added straight into an existing
    // section instead already inherits a year that section itself was
    // validated against at creation (sections POST), so this only needs to
    // apply to the unassigned path.
    if (!sectionName && dept) {
      // Course is required for every unassigned add, not just when the
      // client's own Course dropdown happens to be filled - mirrors the
      // bulk importer's identical requirement (import-excel/route.ts) and
      // the ROSTER_FIELDS `required` flag the Add/Edit form (and the import
      // page's Fix Row dialog, which posts here too) already shows an
      // asterisk for. Checked unconditionally (not just once the department
      // doc is re-looked-up below) so it's never skippable.
      if (!(typeof body.course === "string" && body.course.trim())) {
        return NextResponse.json({ error: "Course is required" }, { status: 400 });
      }

      // 1st-year students at a college that runs a shared/common first year
      // must land under one of that structure's Basic Science (Freshman)
      // departments, never directly under a real branch - the branch they're
      // headed for belongs in Core Department (secondaryDepartment) instead,
      // set once and promoted out of after year 1. A college with no such
      // shared-first-year structure at all (freshmanNames empty) is left
      // unrestricted - see freshmanLandingDepartmentNames's own doc-comment
      // for why this is inferred from the department data rather than a
      // stored flag. Checked before anything else in this block so a
      // misconfigured real branch's own (possibly stale) assignedYears can
      // never mask this more specific rule.
      if (Number(body.year) === 1) {
        const freshmanNames = freshmanLandingDepartmentNames(allDepts);
        if (freshmanNames.size > 0 && !freshmanNames.has(dept)) {
          return NextResponse.json(
            { error: `"${dept}" is a real branch - 1st Year students must be added under one of this college's Basic Science (Freshman) departments instead. Set "${dept}" as the Core Department.` },
            { status: 400 }
          );
        }
        // A student landed correctly under a Freshman department must still
        // say which real branch they're headed for - without Core Department,
        // they're stuck unpromotable and invisible to any branch's own HOD.
        const secondaryDeptForYear1 = typeof body.secondaryDepartment === "string" ? body.secondaryDepartment.trim() : "";
        if (freshmanNames.size > 0 && !secondaryDeptForYear1) {
          return NextResponse.json(
            { error: "Core Department is required for 1st Year students - name the branch this student will be promoted into." },
            { status: 400 }
          );
        }
      }

      const deptScopeSnap = await collegeRef.collection("departments").where("name", "==", dept).limit(1).get();
      if (!deptScopeSnap.empty) {
        const deptDoc = deptScopeSnap.docs[0];
        const deptScopeDoc = deptDoc.data() as {
          assignedYears?: number[]; secondaryDepartments?: string[]; courseScopes?: Record<string, DepartmentCourseScope>;
          parentDepartmentId?: string; managedDepartments?: string[];
        };
        // Guaranteed non-empty by the check at the top of this block.
        const courseName = (body.course as string).trim();
        let catalogId: string | undefined;
        {
          const coursesSnap = await collegeRef.collection("courses").where("name", "==", courseName).get();
          const sameCourseNameDocs = coursesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Course[];
          catalogId = resolveCatalogId(sameCourseNameDocs, deptDoc.id, courseName);
          // The department's OWN Course doc for this name (not just any
          // department's, which resolveCatalogId above is happy to fall back
          // to) - StudentRecord.courseId must always point at a course this
          // exact department offers, or a later same-named section under a
          // different course could still be picked up ambiguously. A true
          // sub-department (parentDepartmentId set - AIML/AIDS under AI,
          // ECE-VLSI under ECE, Cyber Security under CSE) never owns a Course
          // doc of its own though, same rule courseNamesForDepartment
          // (RosterFieldInputs.tsx) already applies for the Add/Edit form's
          // own Course dropdown - so its ONE specific parent's doc (not just
          // any department's) is checked next, keeping this just as
          // unambiguous as the direct match above.
          courseId = sameCourseNameDocs.find((c) => c.departmentId === deptDoc.id)?.id
            ?? (deptScopeDoc.parentDepartmentId
              ? sameCourseNameDocs.find((c) => c.departmentId === deptScopeDoc.parentDepartmentId)?.id
              : undefined);
          // A course name that doesn't resolve to a real Course doc THIS
          // department (or its parent) actually owns must reject, not just
          // silently save with no courseId - same check the bulk importer
          // already makes (import-excel/route.ts's identical resolveCourse
          // failure).
          if (!courseId) {
            return NextResponse.json({ error: `Course "${courseName}" is not offered by ${dept}` }, { status: 400 });
          }
          // Academic Year must fall within this specific course's own
          // configured duration (e.g. 1-4 for a B.Tech, 1-2 for an M.Tech) -
          // the same ceiling the Year dropdown itself already enforces
          // client-side (yearOptionsForCourse, RosterFieldInputs.tsx), now
          // backed up server-side too, mirroring the bulk importer's
          // identical check (import-excel/route.ts). Generic - reads
          // whatever durationYears this course was actually configured
          // with, never a hardcoded per-course-name table.
          const resolvedCourseDoc = sameCourseNameDocs.find((c) => c.id === courseId);
          const yearDurationError = validateYearForCourseDuration(Number(body.year), resolvedCourseDoc?.durationYears, courseName);
          if (yearDurationError) {
            return NextResponse.json({ error: yearDurationError }, { status: 400 });
          }
        }
        // Basic Year <-> Semester sanity check - mirrors the bulk importer's
        // identical check (import-excel/route.ts). Semester is free text
        // everywhere it's entered (including the Fix Row dialog, which can
        // pre-fill it from a failed import row's raw text), so this can't
        // rely on a dropdown constraining it the way Gender/Scholarship etc.
        // already do.
        if (typeof body.semester === "string" && body.semester.trim()) {
          const semesterError = validateYearSemesterConsistency(Number(body.year), Number(body.semester.match(/\d+/)?.[0]));
          if (semesterError) {
            return NextResponse.json({ error: semesterError }, { status: 400 });
          }
        }
        let assignedYears = resolveDepartmentCourseScope(deptScopeDoc, catalogId).assignedYears;
        // A sub-department an HOD created carries no assignedYears/courseScopes
        // of its own (Principal-only override, stripped from anything
        // HOD-created) - it inherits its parent's instead, same fallback
        // managerEffectiveYears (hodScope.ts) already uses for Sections/
        // Teaching Assignments/Timetable and the client's own Year dropdown
        // (RosterFieldInputs.tsx) - otherwise this check silently no-ops for a
        // sub-department (empty assignedYears skips the check below entirely)
        // instead of enforcing its real, inherited years.
        if (assignedYears.length === 0 && deptScopeDoc.parentDepartmentId) {
          const parentSnap = await collegeRef.collection("departments").doc(deptScopeDoc.parentDepartmentId).get();
          if (parentSnap.exists) {
            assignedYears = resolveDepartmentCourseScope(parentSnap.data() as typeof deptScopeDoc, catalogId).assignedYears;
          }
        }
        if (assignedYears.length > 0 && !assignedYears.includes(Number(body.year))) {
          return NextResponse.json({ error: `"${dept}" is not assigned to teach Year ${body.year}` }, { status: 400 });
        }

        // Secondary Department, when given, must actually be one this
        // department cross-lists to - not just any real, differently-named
        // department. Same rule the bulk importer's unassigned rows enforce
        // (college/students/import-excel) and for the same reason: without
        // it, a student can be saved cross-listed to a branch the department
        // never configured, which then surfaces as a bogus option wherever
        // Secondary Department values get read back (e.g. the Distribute
        // Unassigned dialog's branch picker).
        const secondaryDept = typeof body.secondaryDepartment === "string" ? body.secondaryDepartment.trim() : "";
        if (secondaryDept) {
          if (secondaryDept === dept) {
            return NextResponse.json({ error: "Core Department must differ from Department" }, { status: 400 });
          }
          // `secondaryDept` may itself be a sub-department of one of `dept`'s
          // configured branches (e.g. "ECE-VLSI" under "Electronics and
          // Communication Engineering") - the branch being configured is
          // enough, its own sub-departments don't need to be separately,
          // individually configured too (isConfiguredSecondaryDepartmentOrChild's
          // doc-comment).
          const secondaryDeptDoc = allDepts.find((d) => d.name.trim().toLowerCase() === secondaryDept.toLowerCase());
          let secondaryParentName: string | undefined;
          if (secondaryDeptDoc?.parentDepartmentId) {
            secondaryParentName = allDepts.find((d) => d.id === secondaryDeptDoc.parentDepartmentId)?.name;
          }
          // `dept`'s own sub-departments (if it's a parent) also count via
          // THEIR managedDepartments - same fold-in isConfiguredSecondary
          // Department does for the client's dropdown.
          const childDeptsSnap = await collegeRef.collection("departments").where("parentDepartmentId", "==", deptDoc.id).get();
          const childDepts = childDeptsSnap.docs.map((d) => d.data() as { managedDepartments?: string[] });
          if (!isConfiguredSecondaryDepartmentOrChild(deptScopeDoc, secondaryDept, secondaryParentName, childDepts)) {
            return NextResponse.json({ error: `"${dept}" does not cross-list to "${secondaryDept}"` }, { status: 400 });
          }
        }
      }
    }

    // De-dupe an unassigned add against an existing unassigned student who's
    // actually the same person - mirrors the bulk importer's own check
    // (import-excel/route.ts) so a row it rejected, then "fixed" here via the
    // import page's Fix Row dialog (which posts to this same endpoint)
    // without actually changing anything, is rejected the same way instead
    // of silently creating a real duplicate. A shared name alone never
    // counts (see isLikelySameUnassignedStudent's own doc-comment) - two
    // different students who happen to share a name, with nothing else in
    // common on file, can both be added.
    if (!sectionName && dept) {
      const roll = typeof body.rollNumber === "string" ? body.rollNumber.trim() : "";
      const yearNum = Number(body.year);
      if (roll) {
        const rollDupSnap = await collegeRef.collection("students")
          .where("department", "==", dept).where("year", "==", yearNum)
          .where("rollNumber", "==", roll).where("section", "==", "").limit(1).get();
        if (!rollDupSnap.empty) {
          return NextResponse.json(
            { error: `An unassigned student with this Roll Number already exists for ${dept} Year ${body.year}` },
            { status: 409 }
          );
        }
      } else {
        // Same real person can be represented with a given branch name in
        // either `department` or `secondaryDepartment`, depending on which
        // convention was used at the time (see import-excel's identical
        // by-both-fields indexing) - checked in both directions, against
        // both this row's own department and its Core Department.
        const secondaryDeptTrim = typeof body.secondaryDepartment === "string" ? body.secondaryDepartment.trim() : "";
        const lookupNames = Array.from(new Set([dept, ...(secondaryDeptTrim ? [secondaryDeptTrim] : [])]));
        const candidateSnaps = await Promise.all(
          lookupNames.flatMap((name) => [
            collegeRef.collection("students").where("department", "==", name).where("year", "==", yearNum).get(),
            collegeRef.collection("students").where("secondaryDepartment", "==", name).where("year", "==", yearNum).get(),
          ])
        );
        const nameLower = body.name.trim().toLowerCase();
        const seen = new Set<string>();
        for (const snap of candidateSnaps) {
          for (const doc of snap.docs) {
            if (seen.has(doc.id)) continue;
            seen.add(doc.id);
            const existing = doc.data() as Record<string, unknown> & { section?: string; name?: string };
            if (existing.section) continue; // only unassigned candidates count
            if (String(existing.name ?? "").trim().toLowerCase() !== nameLower) continue;
            if (isLikelySameUnassignedStudent(body, existing)) {
              return NextResponse.json(
                { error: `"${body.name.trim()}" already exists as an unassigned ${dept} Year ${body.year} student with matching details` },
                { status: 409 }
              );
            }
          }
        }
      }
    }

    const studentRef = collegeRef.collection("students").doc();
    const history = departmentHistoryEntry(
      db, session.collegeId, studentRef.id, dept, sectionName, Number(body.year), now
    );

    const batch = db.batch();
    batch.set(studentRef, {
      collegeId: session.collegeId,
      department: dept,
      section: sectionName,
      ...(courseId ? { courseId } : {}),
      year: Number(body.year),
      name: body.name.trim(),
      status: (body.status as StudentStatus | undefined) ?? "REGULAR",
      // Every roster detail the import collects, cleaned the same way its
      // buildStudentDoc cleans a parsed row - blanks omitted rather than
      // stored empty. rollNumber is defaulted after the spread so a body
      // without one still writes the "" the rest of the app expects.
      rollNumber: "",
      ...normalizeRosterDetails(body),
      createdAt: now,
      updatedAt: now,
    });
    batch.set(history.ref, history.data);
    await batch.commit();

    return NextResponse.json({ id: studentRef.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
