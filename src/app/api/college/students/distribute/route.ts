export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { evenSplit } from "@/lib/students/evenSplit";
import type { Section, StudentRecord } from "@/types";

// Bulk-distribute a department's UNASSIGNED students (section == "") across a
// set of that department's sections, split evenly in full-name order: the
// students are sorted by name and dealt out to the chosen sections in order, so
// the earliest names land in the first section, the next block in the second,
// and so on. Roll numbers are left exactly as imported. This is the "divide the
// branch's students into sections A/B/C by initial" step a sub-HOD runs after
// creating the sections. Each moved student also gets a departmentHistory entry.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE");
    const body = (await request.json()) as {
      departmentId?: string;
      department?: string;
      year: number;
      sectionIds: string[];
    };

    if (!body.year || !Array.isArray(body.sectionIds) || body.sectionIds.length === 0) {
      return NextResponse.json({ error: "year and at least one section are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const year = Number(body.year);

    // Resolve the target department name (by id or name).
    let deptName = "";
    if (body.departmentId) {
      const deptSnap = await collegeRef.collection("departments").doc(body.departmentId).get();
      if (!deptSnap.exists) return NextResponse.json({ error: "Department not found" }, { status: 400 });
      deptName = (deptSnap.data() as { name?: string }).name ?? "";
    } else if (body.department?.trim()) {
      const deptSnap = await collegeRef.collection("departments").where("name", "==", body.department.trim()).limit(1).get();
      if (deptSnap.empty) return NextResponse.json({ error: "Department not found" }, { status: 400 });
      deptName = (deptSnap.docs[0].data() as { name?: string }).name ?? body.department.trim();
    } else {
      return NextResponse.json({ error: "department or departmentId is required" }, { status: 400 });
    }

    // An HOD/Sub-HOD may only distribute within a department they own or manage.
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartment(scope, deptName)) {
        return NextResponse.json({ error: "That department is not yours or one you manage" }, { status: 403 });
      }
    }

    // Load the chosen sections, preserving the caller's order, and validate each
    // belongs to this exact (department, year).
    const sectionSnaps = await Promise.all(
      body.sectionIds.map((id) => collegeRef.collection("sections").doc(id).get())
    );
    const sections: Section[] = [];
    for (let i = 0; i < sectionSnaps.length; i++) {
      const snap = sectionSnaps[i];
      if (!snap.exists) return NextResponse.json({ error: `Section ${body.sectionIds[i]} not found` }, { status: 400 });
      const s = { id: snap.id, ...(snap.data() as object) } as Section;
      if (s.department !== deptName || s.year !== year) {
        return NextResponse.json(
          { error: `Section ${s.name} is not a ${deptName} Year ${year} section` },
          { status: 400 }
        );
      }
      sections.push(s);
    }

    // Load the unassigned cohort for this (department, year), sorted by full name.
    const unassignedSnap = await collegeRef.collection("students")
      .where("department", "==", deptName)
      .where("year", "==", year)
      .where("section", "==", "")
      .get();
    const cohort = unassignedSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<StudentRecord, "id">) }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

    if (cohort.length === 0) {
      return NextResponse.json({ error: "No unassigned students to distribute for this department and year" }, { status: 400 });
    }

    // Even split in order: with N students over K sections, the first (N mod K)
    // sections get one extra, so sizes differ by at most one and earliest names
    // fill the earliest sections.
    const slices = evenSplit(cohort, sections.length);

    const now = new Date();
    const batch = new ChunkedBatch(db);
    const perSection: { section: string; count: number }[] = [];

    for (let i = 0; i < sections.length; i++) {
      const slice = slices[i];
      const section = sections[i];
      for (const student of slice) {
        const ref = collegeRef.collection("students").doc(student.id);
        batch.update(ref, { section: section.name, year, updatedAt: now });
        const history = departmentHistoryEntry(db, session.collegeId, student.id, deptName, section.name, year, now);
        batch.set(history.ref, history.data);
      }
      perSection.push({ section: section.name, count: slice.length });
    }

    await batch.commit();

    return NextResponse.json({ distributed: cohort.length, perSection });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/distribute POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
