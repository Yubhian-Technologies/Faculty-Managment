export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildStudentDoc, type StudentImportRow } from "@/lib/students/importRow";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import type { Section } from "@/types";

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE");
    const body = (await request.json()) as { sectionId: string; records: StudentImportRow[] };

    if (!body.sectionId) {
      return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    }
    if (!body.records || !Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }
    if (body.records.length > 500) {
      return NextResponse.json({ error: "Maximum 500 records per import" }, { status: 400 });
    }

    const db = getAdminDb();
    const sectionSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("sections")
      .doc(body.sectionId)
      .get();

    if (!sectionSnap.exists) {
      return NextResponse.json({ error: "Section not found" }, { status: 400 });
    }
    const section = sectionSnap.data() as Section;

    if (session.role === "PANEL_MEMBER" && section.facultyInchargeUid !== session.uid) {
      return NextResponse.json({ error: "You are not in charge of this section" }, { status: 403 });
    }
    if (session.role === "HOD") {
      const hodSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      const hodDept = (hodSnap.data() as { department?: string } | undefined)?.department ?? "";
      if (hodDept && section.department !== hodDept) {
        return NextResponse.json({ error: "Section is not in your department" }, { status: 403 });
      }
    }

    const studentsColl = db.collection("colleges").doc(session.collegeId).collection("students");
    const existingSnap = await studentsColl
      .where("section", "==", section.name)
      .where("year", "==", section.year)
      .select("rollNumber")
      .get();
    const existingRolls = new Set(existingSnap.docs.map((d) => (d.data() as { rollNumber: string }).rollNumber));

    const now = new Date();
    const created: string[] = [];
    const failed: { row: number; rollNumber: string; error: string }[] = [];

    const batch = new ChunkedBatch(db);

    // This route's upload template has no per-row secondary-department column
    // (unlike students/import-excel) — the section itself is the only source.
    // Only auto-fill when the section cross-lists to exactly one department;
    // when it splits across several (e.g. a shared first-year section feeding
    // both CSE and ECE), there's no single default to apply, so leave it
    // unset — use students/import-excel to set it per row instead.
    const secondaryDepartment = section.secondaryDepartments?.length === 1 ? section.secondaryDepartments[0] : "";

    for (let i = 0; i < body.records.length; i++) {
      const row = body.records[i];
      const rowNum = i + 2;

      if (!row.rollNumber?.trim()) { failed.push({ row: rowNum, rollNumber: "—", error: "Roll Number is required" }); continue; }
      if (!row.name?.trim()) { failed.push({ row: rowNum, rollNumber: row.rollNumber, error: "Name is required" }); continue; }

      const roll = row.rollNumber.trim();
      if (existingRolls.has(roll)) {
        failed.push({ row: rowNum, rollNumber: roll, error: "Roll number already exists in this section" });
        continue;
      }

      const docRef = studentsColl.doc();
      batch.set(docRef, buildStudentDoc(section, { ...row, secondaryDepartment: row.secondaryDepartment?.trim() || secondaryDepartment || undefined }, now));
      const history = departmentHistoryEntry(db, session.collegeId, docRef.id, section.department, section.name, section.year, now);
      batch.set(history.ref, history.data);
      existingRolls.add(roll);
      created.push(roll);
    }

    await batch.commit();

    return NextResponse.json({ created: created.length, failed }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/import POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
