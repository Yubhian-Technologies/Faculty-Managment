export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Section, StudentStatus } from "@/types";

type ImportRow = {
  rollNumber: string;
  name: string;
  status?: string;
};

function parseStatus(v: string | undefined): StudentStatus {
  return v?.trim().toUpperCase().startsWith("DET") ? "DETAINED" : "REGULAR";
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as { sectionId: string; records: ImportRow[] };

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

    const batch = db.batch();
    let batchCount = 0;

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
      batch.set(docRef, {
        collegeId: session.collegeId,
        department: section.department,
        section: section.name,
        year: section.year,
        rollNumber: roll,
        name: row.name.trim(),
        status: parseStatus(row.status),
        createdAt: now,
        updatedAt: now,
      });
      existingRolls.add(roll);
      created.push(roll);
      batchCount++;

      if (batchCount === 499) break;
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
