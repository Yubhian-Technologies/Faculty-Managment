export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { normalizeRosterDetails } from "@/lib/students/rosterFields";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { resolveBranchYearOwner, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import { getFacultyIdCandidates } from "@/lib/faculty/resolveFacultyMemberId";
import { resolveDepartmentCourseScope, resolveCatalogId } from "@/lib/college/academicStructure";
import type { Course, Section, StudentRecord, StudentStatus, DepartmentCourseScope } from "@/types";

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
    const studentsColl = db.collection("colleges").doc(session.collegeId).collection("students");
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
      // section, then merge. This is also what implicitly pins the student to the
      // right *course*: StudentRecord has no courseId of its own, so a student's
      // course is only ever determined by which Section (department+courseId+
      // name+year) they're enrolled in - matching that exact triple is matching
      // the exact section, and therefore the exact course.
      const sectionSnaps = await Promise.all(
        sections.slice(0, 30).flatMap((s) => [
          withCommonFilters(
            studentsColl.where("department", "==", s.department).where("section", "==", s.name).where("year", "==", s.year)
          ).get(),
          // A shared-first-year student in this section stays filed under
          // their common department (preserved until promotion - see
          // students/[id] PATCH) with secondaryDepartment naming this
          // section's real branch instead - catch them too, or a faculty
          // member in charge of a shared-year section would see an empty
          // roster.
          withCommonFilters(
            studentsColl.where("secondaryDepartment", "==", s.department).where("section", "==", s.name).where("year", "==", s.year)
          ).get(),
        ])
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
        secondaryQuery = withCommonFilters(studentsColl.where("secondaryDepartment", "in", scope.ownDepartmentNames.slice(0, 30)));
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
    // owning department; `sectionName` is "" for an unassigned add.
    let dept = "";
    let sectionName = "";

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
    } else {
      // Unassigned add - resolve the department by id or name.
      if (body.departmentId) {
        const deptSnap = await collegeRef.collection("departments").doc(body.departmentId).get();
        if (!deptSnap.exists) return NextResponse.json({ error: "Department not found" }, { status: 400 });
        dept = (deptSnap.data() as { name?: string }).name ?? "";
      } else if (body.department?.trim()) {
        const deptSnap = await collegeRef.collection("departments").where("name", "==", body.department.trim()).limit(1).get();
        if (deptSnap.empty) return NextResponse.json({ error: "Department not found" }, { status: 400 });
        dept = (deptSnap.docs[0].data() as { name?: string }).name ?? body.department.trim();
      } else {
        return NextResponse.json({ error: "Provide a section, or a department for an unassigned student" }, { status: 400 });
      }
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
      const deptScopeSnap = await collegeRef.collection("departments").where("name", "==", dept).limit(1).get();
      if (!deptScopeSnap.empty) {
        const deptDoc = deptScopeSnap.docs[0];
        const deptScopeDoc = deptDoc.data() as {
          assignedYears?: number[]; secondaryDepartments?: string[]; courseScopes?: Record<string, DepartmentCourseScope>;
          parentDepartmentId?: string;
        };
        const courseName = typeof body.course === "string" ? body.course : undefined;
        let catalogId: string | undefined;
        if (courseName) {
          const coursesSnap = await collegeRef.collection("courses").where("name", "==", courseName).get();
          const sameCourseNameDocs = coursesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Course[];
          catalogId = resolveCatalogId(sameCourseNameDocs, deptDoc.id, courseName);
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
