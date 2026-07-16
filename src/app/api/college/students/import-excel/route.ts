export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildStudentDoc, type StudentImportRow } from "@/lib/students/importRow";
import type { Section } from "@/types";

// Bulk, multi-section roster upload (HOD's Excel/CSV template) — unlike
// college/students/import (single sectionId for the whole batch), each row
// here names its own Section + Academic Year so one file can cover an entire
// department's intake in one go.
type BulkImportRow = StudentImportRow & { section: string; year: number };

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as { records: BulkImportRow[] };

    if (!body.records || !Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }
    if (body.records.length > 500) {
      return NextResponse.json({ error: "Maximum 500 records per import" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;

    let hodDept = "";
    if (session.role === "HOD") {
      const hodSnap = await db.collection("colleges").doc(collegeId).collection("users").doc(session.uid).get();
      hodDept = (hodSnap.data() as { department?: string } | undefined)?.department ?? "";
    }

    const sectionsSnap = await db.collection("colleges").doc(collegeId).collection("sections").get();
    const sectionsByKey = new Map<string, Section>();
    for (const d of sectionsSnap.docs) {
      const s = { id: d.id, ...d.data() } as Section & { id: string };
      sectionsByKey.set(`${s.name.toUpperCase()}::${s.year}`, s);
    }

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
    const batch = db.batch();
    let batchCount = 0;

    for (let i = 0; i < body.records.length; i++) {
      const row = body.records[i];
      const rowNum = i + 2;

      if (!row.rollNumber?.trim()) { failed.push({ row: rowNum, rollNumber: "—", error: "Roll Number is required" }); continue; }
      if (!row.name?.trim()) { failed.push({ row: rowNum, rollNumber: row.rollNumber, error: "Name is required" }); continue; }
      if (!row.section?.trim()) { failed.push({ row: rowNum, rollNumber: row.rollNumber, error: "Section is required" }); continue; }
      if (!row.year) { failed.push({ row: rowNum, rollNumber: row.rollNumber, error: "Academic Year is required" }); continue; }

      const sectionKey = `${row.section.trim().toUpperCase()}::${Number(row.year)}`;
      const section = sectionsByKey.get(sectionKey);
      if (!section) {
        failed.push({ row: rowNum, rollNumber: row.rollNumber, error: `Section ${row.section} (Year ${row.year}) not found` });
        continue;
      }
      if (hodDept && section.department !== hodDept) {
        failed.push({ row: rowNum, rollNumber: row.rollNumber, error: `Section ${row.section} is not in your department` });
        continue;
      }

      const roll = row.rollNumber.trim();
      const dedupeKey = `${roll}::${section.name}::${section.year}`;
      if (existingRolls.has(dedupeKey)) {
        failed.push({ row: rowNum, rollNumber: roll, error: "Roll number already exists in this section" });
        continue;
      }

      const docRef = studentsColl.doc();
      batch.set(docRef, buildStudentDoc(section, row, now));
      existingRolls.add(dedupeKey);
      created.push(roll);
      batchCount++;

      if (batchCount === 499) break;
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
