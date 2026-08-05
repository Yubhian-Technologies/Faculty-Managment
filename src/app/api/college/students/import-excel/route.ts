export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildStudentDoc, type StudentImportRow } from "@/lib/students/importRow";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import type { Section } from "@/types";

// Bulk, multi-section roster upload (HOD's Excel/CSV template, also used by
// College Office) — unlike college/students/import (single sectionId for the
// whole batch), each row here names its own Section + Academic Year so one
// file can cover an entire department's (or the whole college's) intake in
// one go. Office also uses this to set `secondaryDepartment` for 1st-year
// rows registered to a core branch while sitting under Basic Science.
type BulkImportRow = StudentImportRow & { section: string; year: number; department?: string };

// Office's template asks for Department (and Secondary Department) by name,
// but typing a full department name for every row of a whole-college roster
// is tedious — accept the department's short Code too (e.g. "CSE"), same as
// how faculty/staff CSV imports already resolve codes. Returns the
// department's canonical `name` so everything downstream (section lookup,
// `secondaryDepartment` storage) stays keyed by the same full name the rest
// of the app uses, regardless of which form the office typed.
function buildDepartmentResolver(
  departmentsSnap: FirebaseFirestore.QuerySnapshot
): (input: string) => string | undefined {
  const byCodeOrName = new Map<string, string>();
  for (const d of departmentsSnap.docs) {
    const data = d.data() as { name?: string; code?: string };
    const name = (data.name ?? "").trim();
    if (!name) continue;
    byCodeOrName.set(name.toLowerCase(), name);
    const code = (data.code ?? "").trim();
    if (code) byCodeOrName.set(code.toLowerCase(), name);
  }
  return (input: string) => byCodeOrName.get(input.trim().toLowerCase());
}

// A department with sub-departments (e.g. "BDS" split into "BDS - Analog",
// "BDS - Digital") never itself owns a Section — every real section belongs
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
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE");
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
    // has sub-departments — like a Sub-HOD or the parent HOD themself — can
    // still be matched against a section that actually lives one level down
    // the tree, consistent with how sections/[id]/route.ts already treats a
    // parent HOD as having full access to their own sub-departments' sections.
    let hodScope: Awaited<ReturnType<typeof getHodDepartmentScope>> | null = null;
    if (session.role === "HOD") {
      hodScope = await getHodDepartmentScope(db, collegeId, session.uid);
    }

    const [sectionsSnap, departmentsSnap] = await Promise.all([
      db.collection("colleges").doc(collegeId).collection("sections").get(),
      db.collection("colleges").doc(collegeId).collection("departments").get(),
    ]);
    // Section name + year alone isn't unique college-wide — two different
    // departments can each have a "Section A, Year 1" — so every name::year
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
    // CSE) rather than via true parentDepartmentId hierarchy — those are two
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
    const resolveDepartment = buildDepartmentResolver(departmentsSnap);
    const relatedDepartmentNames = buildRelatedNamesResolver(departmentsSnap);

    const existingSnap = await db.collection("colleges").doc(collegeId).collection("students")
      .select("rollNumber", "section", "year").get();
    const existingRolls = new Set(
      existingSnap.docs.map((d) => {
        const s = d.data() as { rollNumber: string; section: string; year: number };
        return `${s.rollNumber}::${s.section}::${s.year}`;
      })
    );

    const now = new Date();
    const created: string[] = [];
    const failed: { row: number; rollNumber: string; error: string }[] = [];
    const studentsColl = db.collection("colleges").doc(collegeId).collection("students");
    const batch = new ChunkedBatch(db);

    for (let i = 0; i < body.records.length; i++) {
      const row = body.records[i];
      const rowNum = i + 2;

      if (!row.rollNumber?.trim()) { failed.push({ row: rowNum, rollNumber: "—", error: "Roll Number is required" }); continue; }
      if (!row.name?.trim()) { failed.push({ row: rowNum, rollNumber: row.rollNumber, error: "Name is required" }); continue; }
      if (!row.section?.trim()) { failed.push({ row: rowNum, rollNumber: row.rollNumber, error: "Section is required" }); continue; }
      if (!row.year) { failed.push({ row: rowNum, rollNumber: row.rollNumber, error: "Academic Year is required" }); continue; }

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

      // Resolved early (before section lookup) because it's also used to
      // pick between multiple same-named sections that only differ by which
      // branch they're cross-listed to — see below.
      let requestedSecondaryDept: string | undefined;
      if (row.secondaryDepartment?.trim()) {
        requestedSecondaryDept = resolveDepartment(row.secondaryDepartment);
        if (!requestedSecondaryDept) {
          failed.push({ row: rowNum, rollNumber: row.rollNumber, error: `Secondary Department "${row.secondaryDepartment}" not found` });
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
        // (hierarchy — a department with sub-departments never owns a
        // section directly, so "BDS" must still find the section actually
        // filed under "BDS - Analog"), then any department whose sections
        // are merely cross-listed to it (e.g. "CSE" naming a section that's
        // really owned by "Basic Science" but cross-lists to CSE) — these
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
          failed.push({ row: rowNum, rollNumber: row.rollNumber, error: `No section named "${row.section}" (Year ${row.year}) found owned by or cross-listed to ${departmentName} — create the section first, or check the Department/Section spelling` });
          continue;
        }
        if (matches.length > 1) {
          // Same-named sections can coexist under one department when they're
          // cross-listed to different branches (e.g. two "Section A"s under
          // Basic Science, one feeding CSE and one ECE) — the row's Secondary
          // Department picks between them.
          const narrowed = requestedSecondaryDept ? matches.filter(isSecondaryMatch) : [];
          if (narrowed.length === 1) matches = narrowed;
        }
        if (matches.length > 1) {
          failed.push({ row: rowNum, rollNumber: row.rollNumber, error: `Multiple sections named "${row.section}" (Year ${row.year}) exist under ${departmentName} — add or correct this row's Secondary Department to say which one` });
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
          // Ambiguous across departments — an HOD's own template has no
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
            failed.push({ row: rowNum, rollNumber: row.rollNumber, error: `Multiple sections named "${row.section}" (Year ${row.year}) exist across departments — add a Department value to this row to disambiguate` });
            continue;
          }
        }
      }
      if (hodScope && !(section.department === hodScope.departmentName || hodScope.childDepartmentNames.includes(section.department))) {
        failed.push({ row: rowNum, rollNumber: row.rollNumber, error: `Section ${row.section} is not in your department` });
        continue;
      }

      // Defaults from the section's own secondaryDepartments (inherited from
      // its Department at creation) — a row can still override it. Only
      // auto-fills when the section cross-lists to exactly one department;
      // when it splits across several (e.g. a shared first-year section
      // feeding both CSE and ECE), each row must say explicitly which one
      // this particular student is headed to.
      const sectionSecondaryDepts = section.secondaryDepartments ?? [];
      let secondaryDept = requestedSecondaryDept ?? "";
      if (!secondaryDept && sectionSecondaryDepts.length === 1) {
        secondaryDept = sectionSecondaryDepts[0];
      } else if (!secondaryDept && sectionSecondaryDepts.length > 1) {
        failed.push({ row: rowNum, rollNumber: row.rollNumber, error: `Section ${section.name} is cross-listed to multiple departments (${sectionSecondaryDepts.join(", ")}) — add a Secondary Department value to this row to say which one` });
        continue;
      }
      if (secondaryDept && secondaryDept.toLowerCase() === section.department.trim().toLowerCase()) {
        failed.push({ row: rowNum, rollNumber: row.rollNumber, error: "Secondary Department cannot be the same as the section's department" });
        continue;
      }
      // The section a row resolves to (by name/department/year) can be a real
      // match without actually being the right branch — e.g. a parent
      // department search can land on a sibling sub-department's
      // identically-named section. Cross-check the two independently-derived
      // facts against each other: a section only "is" a given secondaryDept
      // if it's the section's own department or one it's cross-listed to.
      if (secondaryDept && !sectionSecondaryDepts.some((d) => d.toLowerCase() === secondaryDept.toLowerCase())) {
        failed.push({ row: rowNum, rollNumber: row.rollNumber, error: `Section ${section.name} is not cross-listed to "${secondaryDept}" — check this row's Section/Department columns` });
        continue;
      }

      const roll = row.rollNumber.trim();
      const dedupeKey = `${roll}::${section.name}::${section.year}`;
      if (existingRolls.has(dedupeKey)) {
        failed.push({ row: rowNum, rollNumber: roll, error: "Roll number already exists in this section" });
        continue;
      }

      const docRef = studentsColl.doc();
      batch.set(docRef, buildStudentDoc(section, { ...row, secondaryDepartment: secondaryDept || undefined }, now));
      const history = departmentHistoryEntry(db, collegeId, docRef.id, section.department, section.name, section.year, now);
      batch.set(history.ref, history.data);
      existingRolls.add(dedupeKey);
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
