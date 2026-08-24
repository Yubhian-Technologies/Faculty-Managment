export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildStudentDoc, type StudentImportRow } from "@/lib/students/importRow";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { resolveDepartmentByNameOrCode, resolveCourseByNameOrCode, isConfiguredSecondaryDepartmentOrChild } from "@/lib/departments/codeOrNameResolver";
import { resolveBranchYearOwner, resolveFreshmanLandingDepartment, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import { freshmanLandingDepartmentNames, type DepartmentWithId } from "@/lib/college/academicStructure";
import { isLikelySameUnassignedStudent, STRONG_IDENTITY_FIELDS } from "@/lib/students/duplicateDetection";
import { validateYearForCourseDuration, validateYearSemesterConsistency } from "@/lib/students/rosterValidation";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import type { Section } from "@/types";

// Bulk, multi-section roster upload (HOD's Excel/CSV template, also used by
// College Office) - unlike college/students/import (single sectionId for the
// whole batch), each row here names its own Section + Academic Year so one
// file can cover an entire department's (or the whole college's) intake in
// one go. Office also uses this to set `secondaryDepartment` for 1st-year
// rows registered to a core branch while sitting under Basic Science.
type BulkImportRow = StudentImportRow & { section: string; year: number; department?: string };

// Roll numbers are only unique within one (department, course, section,
// year) - a bare section name alone is NOT unique college-wide (two
// departments can each have an "A") nor even within one department (two
// different courses can each have a same-named section - see
// StudentRecord.courseId's doc-comment). `courseId` is "" for an unassigned
// student (no section yet) or a pre-backfill legacy doc that doesn't have one
// yet - an imperfect but strictly-better-than-before fallback for that case.
function rollDedupeKey(
  roll: string | undefined,
  department: string | undefined,
  courseId: string | undefined,
  section: string | undefined,
  year: number | undefined
): string {
  return `${roll ?? ""}::${department ?? ""}::${courseId ?? ""}::${section ?? ""}::${year ?? 0}`;
}

// A department with sub-departments (e.g. "BDS" split into "BDS - Analog",
// "BDS - Digital") never itself owns a Section - every real section belongs
// to one specific (sub-)department. So typing the *parent's* name/code, which
// is the natural thing for the office to do since that's the name on the
// building, must still resolve to whichever of its children actually owns
// the named section. Mirrors getRelatedDepartmentNames in lib/departments/
// scope.ts, reimplemented in-memory here (against the already-fetched
// departmentsSnap) to avoid a Firestore round trip per one of up to 500 rows.
function buildRelatedNamesResolver(
  departmentsSnap: FirebaseFirestore.QuerySnapshot
): (name: string) => string[] {
  const byId = new Map<string, { name: string; parentDepartmentId?: string }>();
  const idByLowerName = new Map<string, string>();
  for (const d of departmentsSnap.docs) {
    const data = d.data() as { name?: string; parentDepartmentId?: string };
    const name = (data.name ?? "").trim();
    if (!name) continue;
    byId.set(d.id, { name, parentDepartmentId: data.parentDepartmentId });
    idByLowerName.set(name.toLowerCase(), d.id);
  }
  const childrenOf = new Map<string, string[]>();
  for (const [, info] of byId) {
    if (!info.parentDepartmentId) continue;
    const arr = childrenOf.get(info.parentDepartmentId);
    if (arr) arr.push(info.name); else childrenOf.set(info.parentDepartmentId, [info.name]);
  }

  return (name: string) => {
    const id = idByLowerName.get(name.toLowerCase());
    const related = new Set<string>([name]);
    if (id) {
      const parentId = byId.get(id)?.parentDepartmentId;
      if (parentId) {
        const parentName = byId.get(parentId)?.name;
        if (parentName) related.add(parentName);
      }
      for (const childName of childrenOf.get(id) ?? []) related.add(childName);
    }
    return Array.from(related);
  };
}

export async function POST(request: Request) {
  try {
    // Importing students is the College Office's responsibility only - no HOD,
    // Principal, Vice Principal or Panel role may bulk-import. (Super Admin keeps
    // access as the platform-wide override, consistent with every other route.)
    const session = await requireCollegeMember("COLLEGE_OFFICE", "SUPER_ADMIN");
    const body = (await request.json()) as { records: BulkImportRow[] };

    if (!body.records || !Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }
    if (body.records.length > 500) {
      return NextResponse.json({ error: "Maximum 500 records per import" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;

    // Full scope (not just the department name) so an HOD whose department
    // has sub-departments - like a Sub-HOD or the parent HOD themself - can
    // still be matched against a section that actually lives one level down
    // the tree, consistent with how sections/[id]/route.ts already treats a
    // parent HOD as having full access to their own sub-departments' sections.
    let hodScope: Awaited<ReturnType<typeof getHodDepartmentScope>> | null = null;
    if (session.role === "HOD") {
      hodScope = await getHodDepartmentScope(db, collegeId, session.uid);
    }

    const [sectionsSnap, departmentsSnap, coursesSnap, courseYearTimingsSnap] = await Promise.all([
      db.collection("colleges").doc(collegeId).collection("sections").get(),
      db.collection("colleges").doc(collegeId).collection("departments").get(),
      db.collection("colleges").doc(collegeId).collection("courses").get(),
      db.collection("colleges").doc(collegeId).collection("courseYearTimings").get(),
    ]);
    // Per-course, per-year configured semester count, for the Year<->Semester
    // check below - a single whole-collection prefetch (not a per-row query,
    // per this route's own no-per-row-DB-call convention) feeding
    // validateYearSemesterConsistency's optional width override.
    const semesterCountsByCourse = new Map<string, Record<number, number>>();
    for (const d of courseYearTimingsSnap.docs) {
      const t = d.data() as { courseId: string; year: number; semesters?: unknown[] };
      const byYear = semesterCountsByCourse.get(t.courseId) ?? {};
      byYear[t.year] = (t.semesters ?? []).length;
      semesterCountsByCourse.set(t.courseId, byYear);
    }
    // Section name + year alone isn't unique college-wide - two different
    // departments can each have a "Section A, Year 1" - so every name::year
    // key keeps *all* matching sections, not just the last one seen, and a
    // department-qualified key is built alongside it to disambiguate whenever
    // a row does name its department. That department-qualified key isn't
    // unique either: a department can cross-list more than one same-named
    // section to different branches (e.g. two "Section A"s under Basic
    // Science, one cross-listed to CSE and one to ECE), so this must also
    // keep every match rather than the last one seen.
    // A department can also be named on a row via how it's cross-listed on
    // *another* department's sections (e.g. typing "CSE" for a row that
    // actually belongs to a "Basic Science"-owned section cross-listed to
    // CSE) rather than via true parentDepartmentId hierarchy - those are two
    // separate relationships (see Department.secondaryDepartments vs
    // .parentDepartmentId in src/types/core.ts) and a department can use
    // either, or neither, to route rows to its sections. So this also needs
    // a by-cross-listing index, keyed the same way, to search alongside the
    // hierarchy-based one below.
    const sectionsByNameYear = new Map<string, Section[]>();
    const sectionsByDeptKey = new Map<string, Section[]>();
    const sectionsBySecondaryDeptKey = new Map<string, Section[]>();
    for (const d of sectionsSnap.docs) {
      const s = { id: d.id, ...d.data() } as Section & { id: string };
      const nameYearKey = `${s.name.toUpperCase()}::${s.year}`;
      const existing = sectionsByNameYear.get(nameYearKey);
      if (existing) existing.push(s); else sectionsByNameYear.set(nameYearKey, [s]);
      const deptKey = `${s.department.trim().toLowerCase()}::${s.name.toUpperCase()}::${s.year}`;
      const existingByDept = sectionsByDeptKey.get(deptKey);
      if (existingByDept) existingByDept.push(s); else sectionsByDeptKey.set(deptKey, [s]);
      for (const secondary of s.secondaryDepartments ?? []) {
        const secondaryKey = `${secondary.trim().toLowerCase()}::${s.name.toUpperCase()}::${s.year}`;
        const existingBySecondary = sectionsBySecondaryDeptKey.get(secondaryKey);
        if (existingBySecondary) existingBySecondary.push(s); else sectionsBySecondaryDeptKey.set(secondaryKey, [s]);
      }
    }
    // Office's template asks for Department (and Secondary Department, and
    // now Course) by name, but typing the full name for every row of a
    // whole-college roster is tedious - accept the short Code too (e.g.
    // "CSE", "BTECH"), same as faculty/staff CSV imports already resolve
    // department codes. Resolves to the canonical `name` so everything
    // downstream (section lookup, `secondaryDepartment`/`course` storage)
    // stays keyed by the same full name the rest of the app uses, regardless
    // of which form the office typed.
    const plainDepartments = departmentsSnap.docs.map((d) => d.data() as { name?: string; code?: string });
    const departmentIdByLowerName = new Map<string, string>();
    const parentDepartmentIdById = new Map<string, string | undefined>();
    for (const d of departmentsSnap.docs) {
      const name = ((d.data() as { name?: string }).name ?? "").trim();
      if (name) departmentIdByLowerName.set(name.toLowerCase(), d.id);
      parentDepartmentIdById.set(d.id, (d.data() as { parentDepartmentId?: string }).parentDepartmentId);
    }
    const plainCourses = coursesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as { name?: string; code?: string; departmentId?: string; catalogId?: string; durationYears?: number }) }));
    const resolveDepartment = (input: string) => resolveDepartmentByNameOrCode(plainDepartments, input);
    // A sub-department (parentDepartmentId set - e.g. "AIML"/"AIDS" under
    // "Artificial Intelligence", "ECE-VLSI" under "ECE", "Cyber Security"
    // under "CSE") never owns a Course doc of its own - same rule
    // courseNamesForDepartment (RosterFieldInputs.tsx) already applies for the
    // Add/Edit form's Course dropdown, so a row naming the sub-department
    // directly must resolve Course through the parent's course catalog too,
    // or every 2nd-4th year student admitted straight into one would be
    // unimportable ("Course ... is not offered by <sub-department>") even
    // though the Add/Edit form's own Course picker happily offers it. This is
    // a true parentDepartmentId hierarchy, distinct from the feeder/
    // Secondary-Department relationship below (Chemistry/Physics/Maths/
    // English), which deliberately keeps NOT borrowing a course from whatever
    // it cross-lists to - those departments already own their own course docs.
    const effectiveCourseDepartmentId = (departmentId: string) => parentDepartmentIdById.get(departmentId) ?? departmentId;
    const resolveCourse = (departmentName: string, input: string) => {
      const departmentId = departmentIdByLowerName.get(departmentName.trim().toLowerCase());
      return departmentId ? resolveCourseByNameOrCode(plainCourses, effectiveCourseDepartmentId(departmentId), input) : undefined;
    };
    // Full Department rows (with managedDepartments/courseScopes/
    // parentDepartmentId) for resolveBranchYearOwner below - a REAL branch
    // (e.g. "Computer Science and Business Systems", no parentDepartmentId of
    // its own) can still be fed a shared year by another department via
    // Department.managedDepartments (the "grouped/managed branches" model,
    // e.g. "Basic Science - Chemistry" managing it for Year 1) while owning
    // its own, DIFFERENT course doc for its other years (2-4). That shared
    // year's actual Section lives under whoever feeds it, not the branch's
    // own otherwise-correct course doc - resolveCourseId below must route
    // through the same ownership resolveBranchYearOwner already uses for
    // section/roster access, or a student imported straight under the real
    // branch for the shared year gets a courseId no section for that year
    // actually uses, silently making them unassignable to any of them.
    const departmentRowsForOwner = departmentsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DepartmentYearRow[];
    const allDepartmentsFull = departmentsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DepartmentWithId[];
    // The Basic Science (Freshman) department names a 1st-year row may land
    // under directly - empty for a college with no shared first year at all,
    // in which case the checks below are simply no-ops. See
    // freshmanLandingDepartmentNames's own doc-comment.
    const freshmanNames = freshmanLandingDepartmentNames(allDepartmentsFull);

    // The real Course doc id behind a canonical course name (as resolved by
    // resolveCourse) within one department - a section can share its name
    // with another under a different course (see college/sections POST's own
    // duplicate check, scoped by courseId), so `courseId` is what actually
    // disambiguates "which section" a placed student is in - see
    // StudentRecord.courseId's doc-comment. Same parent fallback as
    // resolveCourse above - a sub-department's own sections already store the
    // PARENT's course doc id (there is no other one), so this must match.
    const resolveCourseId = (departmentName: string, canonicalCourseName: string, year: number): string | undefined => {
      const departmentId = departmentIdByLowerName.get(departmentName.trim().toLowerCase());
      if (!departmentId) return undefined;
      const catalogId = plainCourses.find((c) => (c.name ?? "").trim() === canonicalCourseName)?.catalogId;
      const ownerName = resolveBranchYearOwner(departmentRowsForOwner, departmentName, year, catalogId);
      const ownerId = ownerName === departmentName ? departmentId : (departmentIdByLowerName.get(ownerName.toLowerCase()) ?? departmentId);
      const effectiveId = effectiveCourseDepartmentId(ownerId);
      return plainCourses.find((c) => c.departmentId === effectiveId && (c.name ?? "").trim() === canonicalCourseName)?.id;
    };
    const relatedDepartmentNames = buildRelatedNamesResolver(departmentsSnap);
    // Full department docs (not just resolved names), keyed by canonical
    // name, so a resolved Secondary Department can be checked against what
    // the department actually cross-lists to - see isConfiguredSecondaryDepartment.
    const departmentDataByName = new Map(
      departmentsSnap.docs.map((d) => [
        ((d.data() as { name?: string }).name ?? "").trim(),
        d.data() as {
          secondaryDepartments?: string[];
          courseScopes?: Record<string, { secondaryDepartments?: string[] }>;
          parentDepartmentId?: string;
          managedDepartments?: string[];
        },
      ])
    );
    // id -> name, so a resolved Secondary Department's OWN parentDepartmentId
    // (when it's a sub-department, e.g. "ECE-VLSI") can resolve to its
    // parent's name - see isConfiguredSecondaryDepartmentOrChild's doc-comment.
    const departmentNameById = new Map(
      departmentsSnap.docs.map((d) => [d.id, ((d.data() as { name?: string }).name ?? "").trim()])
    );
    // parentDepartmentId -> its children's own managedDepartments - a parent
    // department (e.g. "BASIC SCIENCE") cross-lists to a real branch via
    // whichever of ITS sub-departments actually groups it (e.g. "Basic
    // Science - Chemistry" managing CSE/CSBS), same fold-in the client's own
    // dropdown does (secondaryDepartmentOptions, RosterFieldInputs.tsx).
    const childManagedDeptsByParentId = new Map<string, { managedDepartments?: string[] }[]>();
    for (const d of departmentsSnap.docs) {
      const data = d.data() as { parentDepartmentId?: string; managedDepartments?: string[] };
      if (!data.parentDepartmentId) continue;
      const arr = childManagedDeptsByParentId.get(data.parentDepartmentId) ?? [];
      arr.push({ managedDepartments: data.managedDepartments });
      childManagedDeptsByParentId.set(data.parentDepartmentId, arr);
    }

    const existingSnap = await db.collection("colleges").doc(collegeId).collection("students")
      .select("rollNumber", "section", "year", "name", "department", "secondaryDepartment", "courseId", ...STRONG_IDENTITY_FIELDS).get();
    // Placed-section roll dedupe: a section name is only unique within one
    // department's one course (see StudentRecord.courseId's doc-comment - two
    // different departments, or two different courses in the SAME
    // department, can each have their own "A"/"PHYSICS-IT-A"), so this key
    // includes `department` and `courseId` alongside the bare section name -
    // name+year alone previously false-matched roll numbers across genuinely
    // unrelated sections. A pre-backfill student doc with no courseId yet
    // keys with "" for it - an imperfect (but no worse than before) fallback
    // until the backfill migration runs.
    const existingRolls = new Set<string>();
    // Unassigned roll dedupe is its own, separate key space: roll numbers are
    // documented elsewhere as unique within a department+year (not
    // per-course - the Office issues them before a student is even sectioned,
    // let alone assigned a course), so this deliberately does NOT include
    // courseId or section (always "" for an unassigned student anyway).
    const existingUnassignedRolls = new Set<string>();
    // Office-imported students have no roll number yet, so they can't always
    // be de-duped by roll - candidates (the roll-less ones) are keyed by
    // name+dept+year instead, so re-running the same file doesn't create
    // duplicates. Indexed by BOTH department and secondaryDepartment: the
    // same real person can be represented with a given branch name in either
    // field, depending on whether the sheet used the shared-department
    // convention (department=common dept, secondaryDepartment=branch) or
    // named the branch directly - matching only one field would leave the
    // other route free to re-import the same student as a duplicate.
    //
    // A name+dept+year match alone is NOT treated as a duplicate though - a
    // college roster genuinely has same-named students, and rejecting a row
    // purely because someone else already shares a name is a false positive
    // (see isLikelySameUnassignedStudent's own doc-comment). Each key instead
    // maps to the candidate row(s) that share it, checked for real
    // corroborating detail below.
    const existingUnassignedByKey = new Map<string, Record<string, unknown>[]>();
    const addUnassignedCandidate = (key: string, s: Record<string, unknown>) => {
      const arr = existingUnassignedByKey.get(key);
      if (arr) arr.push(s); else existingUnassignedByKey.set(key, [s]);
    };
    for (const d of existingSnap.docs) {
      const s = d.data() as Record<string, unknown> & { rollNumber?: string; section?: string; year?: number; name?: string; department?: string; secondaryDepartment?: string; courseId?: string };
      if (!s.section) {
        if (s.rollNumber) {
          existingUnassignedRolls.add(`${s.rollNumber}::${s.department ?? ""}::${s.year ?? 0}`);
        }
        const nameLower = (s.name ?? "").trim().toLowerCase();
        addUnassignedCandidate(`${nameLower}::${(s.department ?? "").toLowerCase()}::${s.year ?? 0}`, s);
        if (s.secondaryDepartment) {
          addUnassignedCandidate(`${nameLower}::${s.secondaryDepartment.trim().toLowerCase()}::${s.year ?? 0}`, s);
        }
      } else {
        existingRolls.add(rollDedupeKey(s.rollNumber, s.department, s.courseId, s.section, s.year));
      }
    }

    // Lightweight direct-duplicate check on real-world unique identifiers -
    // Admission No, Hall Ticket No, Email - independent of the name+department
    // corroboration check above (which only catches a likely-SAME-PERSON
    // re-import): two clearly different-looking rows that happen to share
    // one of these should still be flagged, since a real college never
    // issues the same admission number/hall ticket/email to two different
    // students. Only checked when the field is actually populated - never
    // makes any of them required. Built once from the already-fetched
    // existingSnap (no extra read); grown only once a row is actually
    // written (not merely passes this check - see the two `registerIdentity`
    // call sites below), so a later row can still reuse a value a REJECTED
    // earlier row never actually claimed, and a duplicate two rows apart in
    // the SAME file is still caught.
    const existingAdmissionNos = new Set<string>();
    const existingHallTicketNos = new Set<string>();
    const existingEmails = new Set<string>();
    for (const d of existingSnap.docs) {
      const s = d.data() as Record<string, unknown>;
      const admissionNo = typeof s.admissionNo === "string" ? s.admissionNo.trim().toLowerCase() : "";
      if (admissionNo) existingAdmissionNos.add(admissionNo);
      const hallTicketNo = typeof s.hallTicketNo === "string" ? s.hallTicketNo.trim().toLowerCase() : "";
      if (hallTicketNo) existingHallTicketNos.add(hallTicketNo);
      const email = typeof s.email === "string" ? s.email.trim().toLowerCase() : "";
      if (email) existingEmails.add(email);
    }
    function findIdentityDuplicate(row: BulkImportRow): string | null {
      const admissionNo = row.admissionNo?.trim().toLowerCase();
      if (admissionNo && existingAdmissionNos.has(admissionNo)) return `Admission No "${row.admissionNo}" is already used by another student`;
      const hallTicketNo = row.hallTicketNo?.trim().toLowerCase();
      if (hallTicketNo && existingHallTicketNos.has(hallTicketNo)) return `Hall Ticket No "${row.hallTicketNo}" is already used by another student`;
      const email = row.email?.trim().toLowerCase();
      if (email && existingEmails.has(email)) return `Email "${row.email}" is already used by another student`;
      return null;
    }
    function registerIdentityValues(row: BulkImportRow) {
      const admissionNo = row.admissionNo?.trim().toLowerCase();
      if (admissionNo) existingAdmissionNos.add(admissionNo);
      const hallTicketNo = row.hallTicketNo?.trim().toLowerCase();
      if (hallTicketNo) existingHallTicketNos.add(hallTicketNo);
      const email = row.email?.trim().toLowerCase();
      if (email) existingEmails.add(email);
    }

    const now = new Date();
    const created: string[] = [];
    const failed: { row: number; rollNumber: string; error: string }[] = [];
    const studentsColl = db.collection("colleges").doc(collegeId).collection("students");
    const batch = new ChunkedBatch(db);

    for (let i = 0; i < body.records.length; i++) {
      const row = body.records[i];
      const rowNum = i + 2;

      // Roll Number is required only for section-based (placed) rows - the
      // Office's unassigned import doesn't collect it (checked in that path).
      if (!row.name?.trim()) { failed.push({ row: rowNum, rollNumber: row.rollNumber ?? "-", error: "Name is required" }); continue; }
      // Section may be blank for an "unassigned" import (a whole branch cohort
      // loaded before its sections exist); such rows must instead name a
      // Department. A row with neither can't be placed at all.
      if (!row.section?.trim() && !row.department?.trim()) { failed.push({ row: rowNum, rollNumber: row.rollNumber ?? "-", error: "Section or Department is required" }); continue; }
      if (!row.year) { failed.push({ row: rowNum, rollNumber: row.rollNumber ?? "-", error: "Academic Year is required" }); continue; }

      const identityDuplicateError = findIdentityDuplicate(row);
      if (identityDuplicateError) { failed.push({ row: rowNum, rollNumber: row.rollNumber ?? "-", error: identityDuplicateError }); continue; }

      // Department is optional at the row level (HOD's own template has no
      // such column at all) but, when present, both disambiguates the section
      // lookup for a whole-college roster and accepts the department's short
      // Code as well as its full name.
      let departmentName: string | undefined;
      if (row.department?.trim()) {
        departmentName = resolveDepartment(row.department);
        if (!departmentName) {
          failed.push({ row: rowNum, rollNumber: row.rollNumber, error: `Department "${row.department}" not found` });
          continue;
        }
      }

      // Unassigned import: no section named, only a department. Create the
      // student under that department with section "" for a sub-HOD to place
      // into a section later (Distribute). Skips all the section-matching and
      // cross-listing logic below, which only applies to placed students.
      if (!row.section?.trim()) {
        // A "no own sections" shared-first-year parent (e.g. VISHNU
        // INSTITUTE OF TECHNOLOGY's "BASIC SCIENCE") never itself houses a
        // student - remap it to whichever of its children actually manages
        // the row's Core Department, before the HOD-scope check right below,
        // so a Sub-HOD submitting the parent name directly is checked
        // against the real, correct child. A no-op for every other
        // department (see resolveFreshmanLandingDepartment's own
        // doc-comment). The row's Core Department is re-resolved to its
        // canonical name here (a cheap, pure in-memory lookup) since the
        // remap needs an exact match against managedDepartments - its full
        // validation happens again, unchanged, further below.
        if (row.secondaryDepartment?.trim()) {
          const peekedSecondary = resolveDepartment(row.secondaryDepartment);
          if (peekedSecondary) {
            departmentName = resolveFreshmanLandingDepartment(allDepartmentsFull, departmentName!, peekedSecondary);
          }
        }

        // departmentName is guaranteed here (the earlier guard rejects rows
        // with neither section nor department).
        if (hodScope && !canHodEditDepartment(hodScope, departmentName!)) {
          failed.push({ row: rowNum, rollNumber: row.rollNumber ?? "-", error: `${departmentName} is not yours or one you manage` });
          continue;
        }

        // 1st-year rows at a college that runs a shared/common first year
        // must land under one of that structure's Basic Science (Freshman)
        // departments, never directly under a real branch - the branch is
        // recorded via Core Department instead. Mirrors the same rule the
        // single "Add Student" endpoint enforces (college/students POST) - see
        // freshmanLandingDepartmentNames's own doc-comment for why this is
        // empty (no restriction) for a college with no shared first year.
        if (Number(row.year) === 1 && freshmanNames.size > 0 && !freshmanNames.has(departmentName!)) {
          failed.push({
            row: rowNum, rollNumber: row.rollNumber ?? "-",
            error: `"${departmentName}" is a real branch - 1st Year students must be imported under one of this college's Basic Science (Freshman) departments instead. Put "${departmentName}" in the Core Department column.`,
          });
          continue;
        }

        // Secondary Department is a column on the Office's template, and the
        // Office's rows are exactly the ones that need it: a 1st-year sitting
        // under a common department (Basic Science) while registered to the
        // core branch they'll be promoted into. It used to be forced to
        // undefined here, so the only path that could set it was the placed
        // (section-named) one - which the Office template never takes, since
        // it has no Section column. That made the field unreachable for the
        // people it exists for. Resolved before the duplicate check below so
        // that check can recognize this row by either field.
        let unassignedSecondary: string | undefined;
        if (row.secondaryDepartment?.trim()) {
          unassignedSecondary = resolveDepartment(row.secondaryDepartment);
          if (!unassignedSecondary) {
            failed.push({ row: rowNum, rollNumber: row.rollNumber ?? "-", error: `Core Department "${row.secondaryDepartment}" not found` });
            continue;
          }
          if (unassignedSecondary === departmentName) {
            failed.push({ row: rowNum, rollNumber: row.rollNumber ?? "-", error: "Core Department must differ from Department" });
            continue;
          }
          // A real department, differing from Department, is not enough on
          // its own - it must actually be one THIS department cross-lists to
          // (Department.secondaryDepartments or a courseScopes override).
          // Without this, any real department name was silently accepted
          // (e.g. "Physics" registering a student to "civil engineering",
          // which Physics never configured as a Secondary Department) - the
          // student saved fine, but then surfaced as a bogus, unconfigured
          // branch option everywhere Secondary Department values get read
          // back (the Distribute Unassigned dialog's branch picker, in
          // particular).
          const ownerDeptId = departmentIdByLowerName.get(departmentName!.toLowerCase());
          const ownerDeptData = departmentDataByName.get(departmentName!);
          const candidateData = departmentDataByName.get(unassignedSecondary);
          const candidateParentName = candidateData?.parentDepartmentId
            ? departmentNameById.get(candidateData.parentDepartmentId)
            : undefined;
          const ownerChildDepts = ownerDeptId ? (childManagedDeptsByParentId.get(ownerDeptId) ?? []) : [];
          if (!ownerDeptData || !isConfiguredSecondaryDepartmentOrChild(ownerDeptData, unassignedSecondary, candidateParentName, ownerChildDepts)) {
            failed.push({ row: rowNum, rollNumber: row.rollNumber ?? "-", error: `${departmentName} does not cross-list to "${unassignedSecondary}" - check Core Departments on the department` });
            continue;
          }
        }

        // A row correctly landed under a Freshman department for Year 1 must
        // still name the real branch via Core Department - without it, the
        // student is stuck unpromotable and invisible to any branch's own HOD.
        if (Number(row.year) === 1 && freshmanNames.size > 0 && !unassignedSecondary) {
          failed.push({
            row: rowNum, rollNumber: row.rollNumber ?? "-",
            error: "Core Department is required for 1st Year students - name the branch this student will be promoted into.",
          });
          continue;
        }

        // Course is required on every row - it accepts the department's short
        // Code too (same as Department/Secondary Department above), and must
        // be one this department actually offers, resolved to its catalog's
        // canonical name so it's never stored as whatever free text was
        // typed. Also resolves the real Course doc id (StudentRecord.courseId)
        // - not yet placed in a real Section, but this is still the
        // declared/intended course, and lets Distribute later narrow target
        // sections to it.
        if (!row.course?.trim()) {
          failed.push({ row: rowNum, rollNumber: row.rollNumber ?? "-", error: "Course is required" });
          continue;
        }
        const resolvedCourse = resolveCourse(departmentName!, row.course);
        if (!resolvedCourse) {
          failed.push({ row: rowNum, rollNumber: row.rollNumber ?? "-", error: `Course "${row.course}" is not offered by ${departmentName}` });
          continue;
        }
        const resolvedCourseId = resolveCourseId(departmentName!, resolvedCourse, Number(row.year));

        // Academic Year must fall within this specific course's own
        // configured duration (e.g. 1-4 for a B.Tech, 1-2 for an M.Tech) -
        // the same ceiling the manual Add/Edit form's own Year dropdown
        // already enforces (yearOptionsForCourse, RosterFieldInputs.tsx),
        // backed up here so import can't silently accept a Year 5 B.Tech row
        // the manual form would never have offered. Generic - reads
        // whatever durationYears this course was actually configured with,
        // never a hardcoded per-course-name table.
        const resolvedCourseDoc = resolvedCourseId ? plainCourses.find((c) => c.id === resolvedCourseId) : undefined;
        const yearDurationError = validateYearForCourseDuration(Number(row.year), resolvedCourseDoc?.durationYears, resolvedCourse);
        if (yearDurationError) { failed.push({ row: rowNum, rollNumber: row.rollNumber ?? "-", error: yearDurationError }); continue; }
        const yearSemesterError = validateYearSemesterConsistency(
          Number(row.year),
          row.semester ? Number(row.semester.match(/\d+/)?.[0]) : undefined,
          resolvedCourseId ? semesterCountsByCourse.get(resolvedCourseId) : undefined
        );
        if (yearSemesterError) { failed.push({ row: rowNum, rollNumber: row.rollNumber ?? "-", error: yearSemesterError }); continue; }

        // The Office doesn't know roll numbers yet, so they're optional here.
        // De-dupe by roll when it's present, otherwise by name+dept+year -
        // checked against both Department and Secondary Department, matching
        // how existingUnassignedByKey was indexed above.
        const roll = row.rollNumber?.trim() ?? "";
        const nameLower = row.name.trim().toLowerCase();
        const year = Number(row.year);
        const nameKey = `${nameLower}::${departmentName!.toLowerCase()}::${year}`;
        const nameKeyViaSecondary = unassignedSecondary ? `${nameLower}::${unassignedSecondary.toLowerCase()}::${year}` : null;
        // Department-scoped (not courseId-scoped - see existingUnassignedRolls'
        // own comment above) - was previously department-BLIND entirely (any
        // two departments' unassigned students with the same roll+year
        // falsely collided), fixed alongside the courseId gap since both are
        // the same "roll dedupe key was too loose" family of bug.
        const rollKey = `${roll}::${departmentName}::${year}`;
        if (roll && existingUnassignedRolls.has(rollKey)) {
          failed.push({ row: rowNum, rollNumber: roll, error: `An unassigned student with this Roll Number already exists for ${departmentName} Year ${row.year}` });
          continue;
        }
        if (!roll) {
          // A shared name alone is NOT a duplicate - only a name match PLUS a
          // real corroborating detail (email, mobile, Aadhar, ...) is (see
          // isLikelySameUnassignedStudent's own doc-comment). Two different
          // students with the same name, and nothing else in common on file,
          // both get imported.
          const candidates = [
            ...(existingUnassignedByKey.get(nameKey) ?? []),
            ...(nameKeyViaSecondary ? existingUnassignedByKey.get(nameKeyViaSecondary) ?? [] : []),
          ];
          const dup = candidates.find((c) => isLikelySameUnassignedStudent(row as unknown as Record<string, unknown>, c));
          if (dup) {
            failed.push({ row: rowNum, rollNumber: "-", error: `"${row.name.trim()}" already exists as an unassigned ${departmentName} Year ${row.year} student with matching details` });
            continue;
          }
        }
        const docRef = studentsColl.doc();
        batch.set(docRef, buildStudentDoc(
          { collegeId, department: departmentName!, name: "", year: Number(row.year), courseId: resolvedCourseId },
          { ...row, rollNumber: roll, secondaryDepartment: unassignedSecondary, course: resolvedCourse },
          now
        ));
        const history = departmentHistoryEntry(db, collegeId, docRef.id, departmentName!, "", Number(row.year), now);
        batch.set(history.ref, history.data);
        if (roll) {
          existingUnassignedRolls.add(rollKey);
        } else {
          // Registered as a candidate too, so a second, genuinely duplicate
          // row later in the SAME file (matching on a strong field) is still
          // caught, the same as it would be against an already-saved student.
          const newCandidate = row as unknown as Record<string, unknown>;
          addUnassignedCandidate(nameKey, newCandidate);
          if (nameKeyViaSecondary) addUnassignedCandidate(nameKeyViaSecondary, newCandidate);
        }
        registerIdentityValues(row);
        created.push(roll || row.name.trim());
        continue;
      }

      // Section-based (placed) rows still require a roll number - it's the
      // per-section identity/de-dupe key the rest of the flow relies on.
      if (!row.rollNumber?.trim()) { failed.push({ row: rowNum, rollNumber: "-", error: "Roll Number is required" }); continue; }

      // Resolved early (before section lookup) because it's also used to
      // pick between multiple same-named sections that only differ by which
      // branch they're cross-listed to - see below.
      let requestedSecondaryDept: string | undefined;
      if (row.secondaryDepartment?.trim()) {
        requestedSecondaryDept = resolveDepartment(row.secondaryDepartment);
        if (!requestedSecondaryDept) {
          failed.push({ row: rowNum, rollNumber: row.rollNumber, error: `Core Department "${row.secondaryDepartment}" not found` });
          continue;
        }
      }
      const isSecondaryMatch = (s: Section) =>
        s.department.toLowerCase() === requestedSecondaryDept!.toLowerCase() ||
        (s.secondaryDepartments ?? []).some((d) => d.toLowerCase() === requestedSecondaryDept!.toLowerCase());

      const sectionNameYearKey = `${row.section.trim().toUpperCase()}::${Number(row.year)}`;

      let section: Section | undefined;
      if (departmentName) {
        // Try the named department itself, then its true parent/children
        // (hierarchy - a department with sub-departments never owns a
        // section directly, so "BDS" must still find the section actually
        // filed under "BDS - Analog"), then any department whose sections
        // are merely cross-listed to it (e.g. "CSE" naming a section that's
        // really owned by "Basic Science" but cross-lists to CSE) - these
        // are two independent relationships, and a row can rely on either.
        const tried = new Map<string, Section>();
        for (const name of relatedDepartmentNames(departmentName)) {
          for (const match of sectionsByDeptKey.get(`${name.toLowerCase()}::${sectionNameYearKey}`) ?? []) {
            tried.set(match.id, match);
          }
        }
        for (const match of sectionsBySecondaryDeptKey.get(`${departmentName.toLowerCase()}::${sectionNameYearKey}`) ?? []) {
          tried.set(match.id, match);
        }
        let matches = Array.from(tried.values());
        if (matches.length === 0) {
          failed.push({ row: rowNum, rollNumber: row.rollNumber, error: `No section named "${row.section}" (Year ${row.year}) found owned by or cross-listed to ${departmentName} - create the section first, or check the Department/Section spelling` });
          continue;
        }
        if (matches.length > 1) {
          // Same-named sections can coexist under one department when they're
          // cross-listed to different branches (e.g. two "Section A"s under
          // Basic Science, one feeding CSE and one ECE) - the row's Secondary
          // Department picks between them.
          const narrowed = requestedSecondaryDept ? matches.filter(isSecondaryMatch) : [];
          if (narrowed.length === 1) matches = narrowed;
        }
        if (matches.length > 1) {
          failed.push({ row: rowNum, rollNumber: row.rollNumber, error: `Multiple sections named "${row.section}" (Year ${row.year}) exist under ${departmentName} - add or correct this row's Core Department to say which one` });
          continue;
        }
        section = matches[0];
      } else {
        const candidates = sectionsByNameYear.get(sectionNameYearKey) ?? [];
        if (candidates.length === 0) {
          failed.push({ row: rowNum, rollNumber: row.rollNumber, error: `Section ${row.section} (Year ${row.year}) not found` });
          continue;
        } else if (candidates.length === 1) {
          section = candidates[0];
        } else {
          // Ambiguous across departments - an HOD's own template has no
          // Department column, so narrow to their own department tree (own
          // department or one of its sub-departments) if that resolves it
          // uniquely, then to the row's Secondary Department if that does;
          // otherwise this needs a human to say which.
          let narrowed = hodScope
            ? candidates.filter((c) => c.department === hodScope.departmentName || hodScope.childDepartmentNames.includes(c.department))
            : candidates;
          if (narrowed.length > 1 && requestedSecondaryDept) {
            const bySecondary = narrowed.filter(isSecondaryMatch);
            if (bySecondary.length === 1) narrowed = bySecondary;
          }
          if (narrowed.length === 1) {
            section = narrowed[0];
          } else {
            failed.push({ row: rowNum, rollNumber: row.rollNumber, error: `Multiple sections named "${row.section}" (Year ${row.year}) exist across departments - add a Department value to this row to disambiguate` });
            continue;
          }
        }
      }
      if (hodScope && !(section.department === hodScope.departmentName || hodScope.childDepartmentNames.includes(section.department))) {
        failed.push({ row: rowNum, rollNumber: row.rollNumber, error: `Section ${row.section} is not in your department` });
        continue;
      }

      // Defaults from the section's own secondaryDepartments (inherited from
      // its Department at creation) - a row can still override it. Only
      // auto-fills when the section cross-lists to exactly one department;
      // when it splits across several (e.g. a shared first-year section
      // feeding both CSE and ECE), each row must say explicitly which one
      // this particular student is headed to.
      const sectionSecondaryDepts = section.secondaryDepartments ?? [];
      let secondaryDept = requestedSecondaryDept ?? "";
      if (!secondaryDept && sectionSecondaryDepts.length === 1) {
        secondaryDept = sectionSecondaryDepts[0];
      } else if (!secondaryDept && sectionSecondaryDepts.length > 1) {
        failed.push({ row: rowNum, rollNumber: row.rollNumber, error: `Section ${section.name} is cross-listed to multiple departments (${sectionSecondaryDepts.join(", ")}) - add a Core Department value to this row to say which one` });
        continue;
      }
      if (secondaryDept && secondaryDept.toLowerCase() === section.department.trim().toLowerCase()) {
        failed.push({ row: rowNum, rollNumber: row.rollNumber, error: "Core Department cannot be the same as the section's department" });
        continue;
      }
      // The section a row resolves to (by name/department/year) can be a real
      // match without actually being the right branch - e.g. a parent
      // department search can land on a sibling sub-department's
      // identically-named section. Cross-check the two independently-derived
      // facts against each other: a section only "is" a given secondaryDept
      // if it's the section's own department or one it's cross-listed to.
      if (secondaryDept && !sectionSecondaryDepts.some((d) => d.toLowerCase() === secondaryDept.toLowerCase())) {
        failed.push({ row: rowNum, rollNumber: row.rollNumber, error: `Section ${section.name} is not cross-listed to "${secondaryDept}" - check this row's Section/Department columns` });
        continue;
      }

      const roll = row.rollNumber.trim();
      const dedupeKey = rollDedupeKey(roll, section.department, section.courseId, section.name, section.year);
      if (existingRolls.has(dedupeKey)) {
        failed.push({ row: rowNum, rollNumber: roll, error: "Roll number already exists in this section" });
        continue;
      }

      // Course is required on every row, including a placed one - it must not
      // just be one the department offers in general, but the SPECIFIC
      // section's own course. `section` was resolved by name/department/year
      // (+ cross-listing), independently of any Course column on the row, so
      // the two can disagree (e.g. the row says "MTECH" but the resolved
      // "PHYSICS-IT-A" section is actually the B.Tech one) -
      // StudentRecord.courseId must never end up wrong just because a
      // different, unrelated same-named section happened to match the
      // department+name+year search first.
      if (!row.course?.trim()) {
        failed.push({ row: rowNum, rollNumber: row.rollNumber, error: "Course is required" });
        continue;
      }
      const resolvedPlacedCourse = resolveCourse(section.department, row.course);
      const resolvedPlacedCourseId = resolvedPlacedCourse ? resolveCourseId(section.department, resolvedPlacedCourse, section.year) : undefined;
      if (!resolvedPlacedCourse || !resolvedPlacedCourseId) {
        failed.push({ row: rowNum, rollNumber: row.rollNumber, error: `Course "${row.course}" is not offered by ${section.department}` });
        continue;
      }
      if (resolvedPlacedCourseId !== section.courseId) {
        failed.push({ row: rowNum, rollNumber: row.rollNumber, error: `Course "${resolvedPlacedCourse}" does not match section ${section.name}'s actual course (${section.courseName ?? "unknown"}) - check this row's Section/Course columns` });
        continue;
      }
      const placedCourse = resolvedPlacedCourse;

      // Year vs course duration is already structurally enforced for a
      // placed row - a section can't have been created with an
      // out-of-duration year in the first place (sections/route.ts POST),
      // and `section` was only just resolved by matching row.year against a
      // REAL section - so there's nothing left to check there. Year <->
      // Semester consistency isn't tied to sections at all though, so it
      // still needs its own check here, same as the unassigned path.
      const placedYearSemesterError = validateYearSemesterConsistency(
        section.year,
        row.semester ? Number(row.semester.match(/\d+/)?.[0]) : undefined,
        semesterCountsByCourse.get(section.courseId)
      );
      if (placedYearSemesterError) { failed.push({ row: rowNum, rollNumber: row.rollNumber, error: placedYearSemesterError }); continue; }

      const docRef = studentsColl.doc();
      batch.set(docRef, buildStudentDoc(section, { ...row, secondaryDepartment: secondaryDept || undefined, course: placedCourse }, now));
      const history = departmentHistoryEntry(db, collegeId, docRef.id, section.department, section.name, section.year, now);
      batch.set(history.ref, history.data);
      existingRolls.add(dedupeKey);
      registerIdentityValues(row);
      created.push(roll);
    }

    if (created.length > 0) await batch.commit();

    return NextResponse.json({ created: created.length, failed }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/import-excel POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
